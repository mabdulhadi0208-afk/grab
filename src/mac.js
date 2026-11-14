'use strict';
// macOS backend. Catalog = Homebrew's public cask index (official vendor download URLs + sha256),
// installed without needing Homebrew itself: download -> verify -> mount/unpack -> copy .app to /Applications.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { log, run, download, fileNameFor, cmpVer, looksNumericVer, pool, rmrf } = require('./util');

const CASK_URL = 'https://formulae.brew.sh/api/cask.json';

const POPULAR = [
  'google-chrome', 'discord', 'spotify', 'visual-studio-code', 'whatsapp', 'zoom', 'firefox', 'notion',
  'vlc', 'obs', 'telegram', 'steam', 'brave-browser', 'arc', 'chatgpt', 'claude', 'raycast', 'rectangle',
  'slack', 'figma', 'iina', 'the-unarchiver', 'appcleaner', 'handbrake', 'iterm2', 'docker-desktop',
  'obsidian', 'capcut', 'microsoft-teams', 'blender', 'audacity', 'minecraft', 'epic-games', 'cursor',
];

// ---------- catalog ----------
// Where each kind of cask artifact goes (user-level folders, no admin needed). Apps + suites go to /Applications.
const EXTRA_DIRS = {
  font: 'Library/Fonts', prefpane: 'Library/PreferencePanes', qlplugin: 'Library/QuickLook',
  screen_saver: 'Library/Screen Savers', colorpicker: 'Library/ColorPickers', service: 'Library/Services',
  input_method: 'Library/Input Methods', dictionary: 'Library/Dictionaries', keyboard_layout: 'Library/Keyboard Layouts',
  mdimporter: 'Library/Spotlight', audio_unit_plugin: 'Library/Audio/Plug-Ins/Components',
  vst_plugin: 'Library/Audio/Plug-Ins/VST', vst3_plugin: 'Library/Audio/Plug-Ins/VST3',
};
const KIND_LABEL = { font: 'Font', prefpane: 'Settings pane', qlplugin: 'Quick Look plugin', screen_saver: 'Screen saver', colorpicker: 'Color picker', service: 'Service', input_method: 'Input method', dictionary: 'Dictionary', keyboard_layout: 'Keyboard layout', mdimporter: 'Spotlight plugin', audio_unit_plugin: 'Audio plugin', vst_plugin: 'Audio plugin', vst3_plugin: 'Audio plugin', suite: 'App suite', installer: 'Installer', pkg: 'Installer' };

function parseArtifacts(arts) {
  const apps = [], pkgs = [], extras = [];
  let manual = null;
  const push = (arr, list, extra = {}) => {
    for (const x of list) {
      if (typeof x === 'string') arr.push({ src: x, dest: path.posix.basename(x), ...extra });
      else if (x && x.target && arr.length) arr[arr.length - 1].dest = path.posix.basename(String(x.target));
    }
  };
  for (const a of arts || []) {
    if (!a || typeof a !== 'object') continue;
    for (const [kind, list] of Object.entries(a)) {
      if (!Array.isArray(list)) continue;
      if (kind === 'app' || kind === 'suite') push(apps, list);
      else if (kind === 'pkg') { for (const x of list) if (typeof x === 'string') pkgs.push(x); }
      else if (EXTRA_DIRS[kind]) push(extras, list, { kind });
      else if (kind === 'installer') { for (const x of list) if (x && typeof x.manual === 'string') manual = x.manual; }
    }
  }
  let kind = 'app';
  if (!apps.length) kind = pkgs.length ? 'pkg' : manual ? 'installer' : extras.length ? extras[0].kind : 'none';
  else if (arts && arts.some(a => a && a.suite)) kind = 'suite';
  return { apps, pkgs, extras, manual, kind };
}

function slimCask(c, arch) {
  if (!c || !c.token || !c.url || c.disabled) return null;
  let url = c.url, sha = c.sha256, ver = c.version, specs = c.url_specs || {};
  if (arch === 'x64' && c.variations && typeof c.variations === 'object') {
    for (const [k, v] of Object.entries(c.variations)) {
      if (k.startsWith('arm64') || k.includes('linux') || !v || !v.url) continue;
      url = v.url; sha = v.sha256 || sha; ver = v.version || ver; specs = v.url_specs || specs; break;
    }
  }
  const { apps, pkgs, extras, manual, kind } = parseArtifacts(c.artifacts);
  if (kind === 'none') return null; // command-line-only tools
  let host = '';
  try { host = new URL(url).hostname; } catch {}
  return {
    id: c.token,
    name: (Array.isArray(c.name) && c.name[0]) || c.token,
    desc: c.desc || '',
    aka: Array.isArray(c.name) ? c.name.slice(1).join('|') : '',
    old: Array.isArray(c.old_tokens) ? c.old_tokens.slice(0, 4) : [],
    home: c.homepage || '',
    ver: String(ver || ''),
    url, sha: sha || 'no_check', host,
    apps, pkgs, extras, manual, kind, label: kind === 'app' ? '' : (KIND_LABEL[kind] || ''),
    ua: specs.user_agent || null,
    ref: specs.referer || null,
    deprecated: !!c.deprecated,
    autoUpdates: !!c.auto_updates,
  };
}

function slimAll(raw, arch) {
  const out = [];
  for (const c of raw) { const s = slimCask(c, arch); if (s) out.push(s); }
  const pop = new Map(POPULAR.map((t, i) => [t, i]));
  for (const it of out) {
    if (pop.has(it.id)) it.boost = 200 - pop.get(it.id);
    else if (it.kind !== 'app') it.boost = -60; // real apps first, fonts/plugins after
  }
  return out;
}

async function fetchCatalog(cacheFile, arch, { force = false } = {}) {
  let cached = null;
  try { cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8')); } catch {}
  const fresh = cached && cached.items && cached.items.length > 1000 && Date.now() - cached.ts < 12 * 3600e3 && cached.arch === arch && cached.v === 4;
  if (fresh && !force) return { items: cached.items, ts: cached.ts, source: 'cache' };
  try {
    const f = globalThis.__grabFetch || globalThis.fetch;
    const res = await f(CASK_URL, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const raw = await res.json();
    const items = slimAll(raw, arch);
    if (items.length < 1000) throw new Error('catalog too small: ' + items.length);
    const data = { v: 4, ts: Date.now(), arch, items };
    try { fs.writeFileSync(cacheFile, JSON.stringify(data)); } catch (e) { log('catalog cache write failed', e); }
    return { items, ts: data.ts, source: 'network' };
  } catch (e) {
    log('catalog fetch failed', e);
    if (cached && cached.items && cached.items.length) return { items: cached.items, ts: cached.ts, source: 'stale-cache' };
    throw new Error('Could not load the app catalog. Check your internet connection.');
  }
}

// ---------- installed apps ----------
function appDirs() { return ['/Applications', path.join(os.homedir(), 'Applications')]; }

function extraDest(e) { return path.join(os.homedir(), EXTRA_DIRS[e.kind], e.dest); }
function findInstalledPath(item) {
  for (const a of item.apps || []) for (const d of appDirs()) {
    const p = path.join(d, a.dest);
    if (fs.existsSync(p)) return p;
  }
  for (const e of item.extras || []) { const p = extraDest(e); if (fs.existsSync(p)) return p; }
  return null;
}

async function readVersion(appPath) {
  const plist = path.join(appPath, 'Contents', 'Info.plist');
  for (const key of ['CFBundleShortVersionString', 'CFBundleVersion']) {
    const r = await run('/usr/bin/plutil', ['-extract', key, 'raw', '-o', '-', plist], { timeout: 5000 });
    if (r.code === 0 && r.out.trim()) return r.out.trim();
  }
  return '';
}

// Scan /Applications, match apps to catalog entries, flag updates.
async function scanInstalled(items) {
  const byApp = new Map();
  for (const it of items) for (const a of it.apps || []) {
    const k = a.dest.toLowerCase();
    const prev = byApp.get(k);
    // prefer the canonical cask (no @beta etc, shortest token)
    if (!prev || (prev.id.includes('@') && !it.id.includes('@')) || (!!prev.id.includes('@') === !!it.id.includes('@') && it.id.length < prev.id.length)) byApp.set(k, it);
  }
  const found = [];
  for (const d of appDirs()) {
    let names = [];
    try { names = fs.readdirSync(d); } catch { continue; }
    for (const n of names) {
      if (!n.endsWith('.app')) continue;
      const it = byApp.get(n.toLowerCase());
      if (it && !found.some(f => f.item.id === it.id)) found.push({ item: it, path: path.join(d, n) });
    }
  }
  await pool(found, 8, async (f) => { f.installedVer = await readVersion(f.path); });
  for (const f of found) {
    const latest = f.item.ver.split(',')[0];
    f.update = latest !== 'latest' && looksNumericVer(latest) && looksNumericVer(f.installedVer) && cmpVer(latest, f.installedVer) > 0;
  }
  found.sort((a, b) => (b.update - a.update) || a.item.name.localeCompare(b.item.name));
  return found;
}

// ---------- install pipeline ----------
async function sniff(file) {
  const fd = fs.openSync(file, 'r');
  const b = Buffer.alloc(8);
  try { fs.readSync(fd, b, 0, 8, 0); } finally { fs.closeSync(fd); }
  if (b[0] === 0x50 && b[1] === 0x4b) return 'zip';
  if (b.toString('latin1', 0, 4) === 'xar!') return 'pkg';
  if (b[0] === 0x1f && b[1] === 0x8b) return 'tgz';
  if (b.toString('latin1', 0, 3) === 'BZh') return 'tbz';
  if (b[0] === 0xfd && b.toString('latin1', 1, 5) === '7zXZ') return 'txz';
  const lower = file.toLowerCase();
  if (lower.endsWith('.pkg') || lower.endsWith('.mpkg')) return 'pkg';
  return 'dmg';
}

function findByName(root, names, depth = 3) {
  const want = names.map(n => n.toLowerCase());
  const q = [[root, 0]];
  while (q.length) {
    const [dir, d] = q.shift();
    let ents = [];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of ents) {
      if (e.name.startsWith('.') || e.name === '__MACOSX') continue;
      const p = path.join(dir, e.name);
      if (want.includes(e.name.toLowerCase())) return p;
      if (e.isDirectory() && !e.isSymbolicLink() && d < depth && !e.name.endsWith('.app')) q.push([p, d + 1]);
    }
  }
  return null;
}
function findAll(root, ext, depth = 2) {
  const res = [], q = [[root, 0]];
  while (q.length) {
    const [dir, d] = q.shift();
    let ents = [];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of ents) {
      if (e.name.startsWith('.') || e.name === '__MACOSX') continue;
      const p = path.join(dir, e.name);
      if (e.name.toLowerCase().endsWith(ext)) res.push(p);
      else if (e.isDirectory() && !e.isSymbolicLink() && d < depth) q.push([p, d + 1]);
    }
  }
  return res;
}

async function attach(file, mnt) {
  fs.mkdirSync(mnt, { recursive: true });
  // 'Y' answers a licence agreement if the DMG has one
  const r = await run('/usr/bin/hdiutil', ['attach', '-nobrowse', '-noautoopen', '-noverify', '-readonly', '-mountpoint', mnt, file], { input: 'Y\n'.repeat(50), timeout: 180000 });
  if (r.code !== 0) throw new Error('Could not open the disk image (' + (r.err || r.out).trim().split('\n').pop() + ')');
}
async function detach(mnt) {
  let r = await run('/usr/bin/hdiutil', ['detach', mnt, '-quiet'], { timeout: 30000 });
  if (r.code !== 0) r = await run('/usr/bin/hdiutil', ['detach', mnt, '-force', '-quiet'], { timeout: 30000 });
}

async function isRunning(appPath) {
  const r = await run('/usr/bin/pgrep', ['-f', path.join(appPath, 'Contents', 'MacOS') + '/'], { timeout: 5000 });
  return r.code === 0 && r.out.trim().length > 0;
}
async function quitApp(appPath) {
  const name = path.basename(appPath, '.app').replace(/"/g, '');
  await run('/usr/bin/osascript', ['-e', `tell application "${name}" to quit`], { timeout: 15000 });
  for (let i = 0; i < 20; i++) { if (!(await isRunning(appPath))) return; await new Promise(r => setTimeout(r, 500)); }
  await run('/usr/bin/pkill', ['-f', path.join(appPath, 'Contents', 'MacOS') + '/']);
  await new Promise(r => setTimeout(r, 800));
}

function shq(s) { return "'" + String(s).replace(/'/g, "'\\''") + "'"; }

async function copyApp(src, dest, trashItem) {
  if (fs.existsSync(dest)) {
    let gone = false;
    try { await trashItem(dest); gone = !fs.existsSync(dest); } catch (e) { log('trash failed', e.message); }
    if (!gone) rmrf(dest);
  }
  let r = fs.existsSync(dest) ? { code: 1 } : await run('/usr/bin/ditto', [src, dest], { timeout: 600000 });
  if (r.code !== 0) {
    // needs admin rights (app owned by root, or /Applications locked down)
    log('ditto needs admin', r.err);
    const script = `rm -rf ${shq(dest)} && /usr/bin/ditto ${shq(src)} ${shq(dest)}`;
    r = await run('/usr/bin/osascript', ['-e', `do shell script ${JSON.stringify(script)} with administrator privileges`], { timeout: 600000 });
    if (r.code !== 0) throw new Error(/cancel/i.test(r.err) ? 'Install canceled (admin password needed)' : 'Could not copy the app into Applications');
  }
  await run('/usr/bin/xattr', ['-dr', 'com.apple.quarantine', dest], { timeout: 30000 });
}

// Phase 1: download + verify. Returns { tmp, file }.
async function fetchItem(item, { onProgress, signal }) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'grab-'));
  const headers = {};
  if (item.ref) headers.Referer = item.ref;
  if (item.ua && !/fake|browser/i.test(String(item.ua)) && typeof item.ua === 'string' && item.ua.includes('/')) headers['User-Agent'] = item.ua;
  let file = path.join(tmp, 'download.bin');
  try {
    const r = await download(item.url, file, { headers, onProgress, signal });
    const nice = path.join(tmp, fileNameFor(r.finalUrl, r.disposition));
    if (nice !== file) { fs.renameSync(file, nice); file = nice; }
    if (item.sha && item.sha !== 'no_check') {
      if (r.sha256.toLowerCase() !== String(item.sha).toLowerCase()) throw new Error('Checksum did not match the official one. Blocked for your safety.');
    }
    return { tmp, file, verified: !!(item.sha && item.sha !== 'no_check') };
  } catch (e) { rmrf(tmp); throw e; }
}

// Phase 2: unpack + install. opts.forceQuit lets us close a running copy.
// Returns { status: 'installed'|'pkg-opened'|'needs-quit', path, app }
async function installFile(item, fetched, { forceQuit = false, trashItem, openPath, onStage } = {}) {
  const { tmp, file } = fetched;
  const kind = await sniff(file);
  log('install', item.id, kind, path.basename(file));
  if (kind === 'pkg') { await openPath(file); return { status: 'pkg-opened', keepTmp: true }; }

  let root, mnt = null;
  if (kind === 'dmg') { mnt = path.join(tmp, 'mnt'); onStage && onStage('Opening disk image'); await attach(file, mnt); root = mnt; }
  else {
    root = path.join(tmp, 'x'); fs.mkdirSync(root);
    onStage && onStage('Unpacking');
    const r = kind === 'zip' ? await run('/usr/bin/ditto', ['-x', '-k', file, root], { timeout: 600000 })
      : await run('/usr/bin/tar', [kind === 'tgz' ? '-xzf' : kind === 'tbz' ? '-xjf' : '-xJf', file, '-C', root], { timeout: 600000 });
    if (r.code !== 0) throw new Error('Could not unpack the download');
    // a zip that only contains a dmg / pkg
    const inner = findAll(root, '.dmg', 1)[0];
    if (inner && !findAll(root, '.app', 2).length) { mnt = path.join(tmp, 'mnt'); await attach(inner, mnt); root = mnt; }
  }

  try {
    // pick the apps to copy
    let plan = [];
    for (const a of item.apps || []) {
      let src = path.join(root, a.src);
      if (!fs.existsSync(src)) src = findByName(root, [path.posix.basename(a.src)], 3);
      if (src) plan.push({ src, dest: a.dest });
    }
    // fonts, plugins, screen savers... -> the matching folder in ~/Library
    const extraPlan = [];
    for (const e of item.extras || []) {
      let src = path.join(root, e.src);
      if (!fs.existsSync(src)) src = findByName(root, [path.posix.basename(e.src)], 4);
      if (src) extraPlan.push({ src, dest: extraDest(e) });
    }
    if (!plan.length && extraPlan.length) {
      onStage && onStage('Installing');
      for (const p of extraPlan) {
        fs.mkdirSync(path.dirname(p.dest), { recursive: true });
        rmrf(p.dest);
        const r = await run('/usr/bin/ditto', [p.src, p.dest], { timeout: 300000 });
        if (r.code !== 0) throw new Error('Could not copy ' + path.basename(p.dest));
      }
      return { status: 'installed', path: extraPlan[0].dest };
    }
    // vendor installers that must be run by hand ("Foo Installer.app")
    if (!plan.length && item.manual) {
      const inst = path.join(root, item.manual);
      const src = fs.existsSync(inst) ? inst : findByName(root, [path.posix.basename(item.manual)], 3);
      if (src) {
        const keep = path.join(tmp, 'run-' + path.basename(src));
        await run('/usr/bin/ditto', [src, keep], { timeout: 300000 });
        await run('/usr/bin/xattr', ['-dr', 'com.apple.quarantine', keep]);
        await openPath(keep);
        return { status: 'pkg-opened', keepTmp: true };
      }
    }
    if (!plan.length && !(item.pkgs || []).length) {
      const any = findAll(root, '.app', 2).filter(p => !/uninstall/i.test(path.basename(p)));
      if (any.length) plan = [{ src: any[0], dest: path.basename(any[0]) }];
    }
    if (!plan.length) {
      const pkg = (item.pkgs || []).map(p => findByName(root, [path.posix.basename(p)], 3)).find(Boolean) || findAll(root, '.pkg', 2)[0];
      if (pkg) {
        const keep = path.join(tmp, path.basename(pkg));
        await run('/bin/cp', ['-R', pkg, keep]);
        await openPath(keep);
        return { status: 'pkg-opened', keepTmp: true };
      }
      throw new Error('No app found inside the download');
    }

    const appsDir = '/Applications';
    // is any target currently open?
    for (const p of plan) {
      const dest = path.join(appsDir, p.dest);
      if (fs.existsSync(dest) && await isRunning(dest)) {
        if (!forceQuit) return { status: 'needs-quit', app: p.dest.replace(/\.app$/, ''), keepTmp: true };
        onStage && onStage('Closing ' + p.dest.replace(/\.app$/, ''));
        await quitApp(dest);
      }
    }
    onStage && onStage('Installing');
    let first = null;
    for (const p of plan) {
      const dest = path.join(appsDir, p.dest);
      await copyApp(p.src, dest, trashItem);
      first = first || dest;
    }
    for (const p of extraPlan) { fs.mkdirSync(path.dirname(p.dest), { recursive: true }); rmrf(p.dest); await run('/usr/bin/ditto', [p.src, p.dest], { timeout: 300000 }); }
    return { status: 'installed', path: first };
  } finally {
    if (mnt) await detach(mnt);
  }
}

async function uninstall(item, trashItem) {
  const p = findInstalledPath(item);
  if (!p) throw new Error('Not installed');
  if (p.endsWith('.app') && await isRunning(p)) await quitApp(p);
  await trashItem(p);
  return true;
}

// Install a raw link (dmg/zip/pkg) with no catalog entry.
function itemFromUrl(url) {
  return { id: 'url:' + url, name: fileNameFor(url, ''), desc: url, url, sha: 'no_check', apps: [], pkgs: [], ver: '' };
}

module.exports = { POPULAR, EXTRA_DIRS, fetchCatalog, slimCask, slimAll, parseArtifacts, findInstalledPath, scanInstalled, fetchItem, installFile, uninstall, itemFromUrl, readVersion, sniff };
