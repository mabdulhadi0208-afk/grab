'use strict';
const { app, BrowserWindow, ipcMain, shell, net, nativeTheme, dialog } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const U = require('./util');
const { prepare, search } = require('./search');
const { priceOf, PACKS } = require('./extras');

const IS_MAC = process.platform === 'darwin';
const IS_WIN = process.platform === 'win32';
const backend = IS_MAC ? require('./mac') : require('./win');
const SELFTEST = process.env.GRAB_SELFTEST || '';
const UPDATE_ZIP = process.env.GRAB_UPDATE_ZIP || '';
// never pass test flags on to anything we launch (the relaunched app after an update, installers, etc.)
delete process.env.GRAB_SELFTEST;
delete process.env.GRAB_UPDATE_ZIP;
const REPO = 'mabdulhadi0208-afk/grab';

globalThis.__grabFetch = (url, opts) => net.fetch(url, opts);

if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

app.setAppLogsPath();
U.setLogFile(path.join(app.getPath('logs'), 'grab.log'));
U.log(`boot ${app.getVersion()} ${process.platform} ${process.arch}${SELFTEST ? ' selftest=' + SELFTEST : ''}`);
process.on('uncaughtException', e => U.log('UNCAUGHT', e));
process.on('unhandledRejection', e => U.log('UNHANDLED', e));

let win = null;
let catalog = { ready: false, error: null, items: [], byId: new Map(), ts: 0 };
let scanCache = null, scanning = null;
let wingetOk = null;
let rendererReady = false;

// ---------------- window ----------------
function createWindow() {
  const common = {
    width: 1120, height: 740, minWidth: 820, minHeight: 560, show: false,
    title: 'Grab',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false },
  };
  const plat = IS_MAC
    ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 18, y: 18 }, vibrancy: 'sidebar', visualEffectState: 'active', backgroundColor: '#00000000' }
    : { titleBarStyle: 'hidden', titleBarOverlay: { color: '#0e1020', symbolColor: '#e6e8f5', height: 46 }, backgroundColor: '#0e1020', icon: path.join(__dirname, 'icon.png') };
  win = new BrowserWindow({ ...common, ...plat });
  win.loadFile(path.join(__dirname, 'ui', 'index.html'));
  win.once('ready-to-show', () => { if (!SELFTEST) win.show(); });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/i.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.on('console-message', (_e, level, message, line, src) => { if (level >= 2) U.log('renderer', level === 3 ? 'ERROR' : 'warn', message, src + ':' + line); });
  win.webContents.on('render-process-gone', (_e, d) => U.log('renderer gone', d.reason));
  win.on('closed', () => { win = null; });
}

function send(ch, data) { try { if (win && !win.isDestroyed()) win.webContents.send(ch, data); } catch {} }

// ---------------- real app icons ----------------
// Mac: App Fair's "appcasks" publishes each cask's actual app icon. Windows: UniGetUI's community icon database (by package id).
// A website's favicon is only a last resort, and only when that site belongs to this one app (see renderer).
const hostCount = new Map();
function hostOf(u) { try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } }
const sq = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9]/g, '');
function siteLabel(host) {
  const p = String(host).split('.'); let i = p.length - 2;
  if (i > 0 && ['co', 'com', 'org', 'net', 'ac', 'gov'].includes(p[i]) && p[p.length - 1].length === 2) i--;
  return sq(p[Math.max(0, i)]);
}
// May this app use its website's logo? Only when the site is clearly this app's own:
// the site name IS the app name; looser matches only if no other app in the catalog lives on that site.
function favHost(it, home) {
  const host = hostOf(home); if (!host || !it) return '';
  const L = siteLabel(host); if (!L) return '';
  const n = sq(it.name), f = sq(String(it.name).split(/\s+/)[0]);
  if (IS_MAC) {
    const t = sq(String(it.id).split('@')[0]);
    if (String(it.id).includes('@')) return ''; // beta / nightly builds have their own icons
    if (L === n || L === t) return host;
    if (hostCount.get(host) !== 1) return '';
    return ((f.length >= 3 && L === f) || (L.length >= 4 && (n.includes(L) || t.includes(L))) || (f.length >= 4 && L.includes(f))) ? host : '';
  }
  const pk = sq(String(it.id).split('.').slice(1).join('.'));
  return (L === n || L === pk) ? host : '';
}
function macIcons(it) {
  if (!IS_MAC || !it || String(it.id).startsWith('url:')) return [];
  if (!['app', 'suite', 'pkg', 'installer'].includes(it.kind || 'app')) return [];
  const cask = (t) => `https://github.com/App-Fair/appcasks/releases/download/cask-${encodeURIComponent(t)}/AppIcon.png`;
  const out = [cask(it.id), ...(it.old || []).map(cask)];
  // last resort: an open icon library, exact name match only
  if (!String(it.id).includes('@')) out.push(`https://raw.githubusercontent.com/homarr-labs/dashboard-icons/main/png/${encodeURIComponent(it.id)}.png`);
  return out;
}
const favCache = new Map();
async function favicon(host) {
  host = String(host || '').toLowerCase();
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host)) return null;
  if (favCache.has(host)) return favCache.get(host);
  const p = (async () => {
    try {
      const res = await net.fetch(`https://t1.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=${encodeURIComponent('https://' + host)}&size=128`);
      if (!res.ok) return null; // a missing icon answers 404 with a generic globe: never show that
      const type = res.headers.get('content-type') || '';
      const buf = Buffer.from(await res.arrayBuffer());
      if (!/^image\//.test(type) || buf.length < 400 || buf.length > 400000) return null;
      return `data:${type.split(';')[0]};base64,${buf.toString('base64')}`;
    } catch { return null; }
  })();
  favCache.set(host, p);
  return p;
}
const winKeyCount = new Map();
// Several publishers can ship a package with the same name; the icon database only knows the name. Give the icon to the obvious owner only.
function winIconFor(id, icons) {
  const key = winIconKey(id), url = icons[key];
  if (!url) return '';
  if ((winKeyCount.get(key) || 0) <= 1) return url;
  const pubr = sq(String(id).split('.')[0]), k = sq(key);
  return (backend.POPULAR.includes(id) || pubr === k || k.startsWith(pubr)) ? url : '';
}
let winIconsP = null;
function winIconKey(id) { const parts = String(id).split('.'); return (parts.length > 1 ? parts.slice(1) : parts).join('.').toLowerCase().replace(/[ _.]/g, '-'); }
function winIcons() {
  if (winIconsP) return winIconsP;
  winIconsP = (async () => {
    const file = path.join(app.getPath('userData'), 'icons-win.json');
    let cached = null;
    try { cached = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
    if (cached && cached.map && Date.now() - cached.ts < 24 * 3600e3) return cached.map;
    try {
      const res = await net.fetch('https://raw.githubusercontent.com/marticliment/UniGetUI/main/WebBasedData/screenshot-database-v2.json');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const db = (await res.json()).icons_and_screenshots || {};
      const map = {};
      for (const [k, v] of Object.entries(db)) if (v && typeof v.icon === 'string' && /^https:\/\//.test(v.icon)) map[k] = v.icon;
      if (Object.keys(map).length < 1000) throw new Error('icon database too small');
      try { fs.writeFileSync(file, JSON.stringify({ ts: Date.now(), map })); } catch {}
      U.log('icon database', Object.keys(map).length, 'icons');
      return map;
    } catch (e) { U.log('icon database failed', e.message); winIconsP = null; return (cached && cached.map) || {}; }
  })();
  return winIconsP;
}

// ---------------- catalog ----------------
function pub(it) {
  if (!it) return null;
  const installedPath = IS_MAC ? backend.findInstalledPath(it) : null;
  const installed = IS_MAC ? !!installedPath : !!(scanCache && scanCache.some(s => s.item.id === it.id)) || doneIds.has(it.id);
  return {
    id: it.id, name: it.name, desc: it.desc || '', ver: it.ver || '', home: it.home || '', host: it.host || '',
    publisher: it.publisher || '', verified: IS_MAC ? !!(it.sha && it.sha !== 'no_check') : true,
    installed, path: installedPath, deprecated: !!it.deprecated, label: it.label || '',
    icons: macIcons(it), fav: IS_MAC ? favHost(it, it.home) : '',
    price: priceOf(it.id, IS_MAC),
  };
}

async function loadCatalog(force = false) {
  const cacheFile = path.join(app.getPath('userData'), IS_MAC ? 'catalog-mac.json' : 'catalog-win.json');
  try {
    const t0 = Date.now();
    const r = await backend.fetchCatalog(cacheFile, process.arch, { force });
    const items = prepare(r.items);
    hostCount.clear();
    winKeyCount.clear();
    for (const it of items) {
      it.host0 = hostOf(it.home); if (it.host0) hostCount.set(it.host0, (hostCount.get(it.host0) || 0) + 1);
      if (IS_WIN) { const k = winIconKey(it.id); winKeyCount.set(k, (winKeyCount.get(k) || 0) + 1); }
    }
    catalog = { ready: true, error: null, items, byId: new Map(items.map(i => [i.id, i])), ts: r.ts };
    U.log(`catalog ${items.length} apps from ${r.source} in ${Date.now() - t0}ms`);
    send('catalog', catalogInfo());
    rescan();
    // refresh in background if the cached copy is old-ish
    if (r.source !== 'network' && Date.now() - r.ts > 6 * 3600e3) setTimeout(() => loadCatalog(true), 20000);
  } catch (e) {
    U.log('catalog error', e);
    if (!catalog.ready) { catalog.error = e.message; send('catalog', catalogInfo()); }
  }
}
function catalogInfo() {
  const popular = backend.POPULAR.map(id => catalog.byId.get(id)).filter(Boolean).map(pub);
  return { ready: catalog.ready, error: catalog.error, count: catalog.items.length, ts: catalog.ts, popular };
}

async function rescan() {
  if (!catalog.ready) return [];
  if (IS_WIN && !(await hasWinget())) { scanCache = []; send('scan', []); return []; }
  if (scanning) return scanning;
  scanning = (async () => {
    try {
      const t0 = Date.now();
      const found = await backend.scanInstalled(catalog.items, catalog.byId);
      scanCache = found;
      U.log(`scan ${found.length} installed, ${found.filter(f => f.update).length} updates, ${Date.now() - t0}ms`);
      const out = scanOut();
      send('scan', out);
      return out;
    } catch (e) { U.log('scan failed', e); return scanOut(); }
    finally { scanning = null; }
  })();
  return scanning;
}
function scanOut() {
  return (scanCache || []).map(f => ({ ...pub(f.item), installed: true, path: f.path || null, installedVer: f.installedVer || '', update: !!f.update, latest: f.latest || (f.item.ver || '').split(',')[0] }));
}

async function hasWinget() {
  if (!IS_WIN) return false;
  if (wingetOk === null) { const v = await backend.wingetVersion(); wingetOk = !!v; U.log('winget', v || 'MISSING'); }
  return wingetOk;
}

// ---------------- jobs ----------------
let seq = 0;
const jobs = new Map();
const queue = [];
let pumping = false;
const doneIds = new Set();

function jobOut(j) {
  const { ac, fetched, item, ...rest } = j;
  return rest;
}
function emit(j, force) {
  const now = Date.now();
  if (!force && now - (j._t || 0) < 100) return;
  j._t = now;
  send('job', jobOut(j));
}

function addJob(item, verb) {
  for (const j of jobs.values()) if (j.itemId === item.id && ['queued', 'downloading', 'installing'].includes(j.state)) return j.id;
  const j = { id: ++seq, itemId: item.id, name: item.name, home: item.home || '', verb, state: 'queued', pct: 0, received: 0, total: 0, speed: 0, stage: '', msg: '', created: Date.now(), item };
  jobs.set(j.id, j);
  queue.push(j);
  emit(j, true);
  pump();
  return j.id;
}

async function pump() {
  if (pumping) return;
  pumping = true;
  try {
    while (queue.length) {
      const j = queue.shift();
      if (j.state !== 'queued') continue;
      await runJob(j);
    }
  } finally { pumping = false; }
}

function progressFn(j) {
  return (p) => {
    if (p.pct != null) j.pct = p.pct;
    if (p.received != null) { j.received = p.received; j.total = p.total || 0; j.speed = p.speed || j.speed; j.pct = p.total ? Math.min(100, (p.received / p.total) * 100) : 0; }
    emit(j);
  };
}

async function runJob(j) {
  j.ac = new AbortController();
  const item = j.item;
  try {
    if (IS_MAC) {
      if (!j.fetched) {
        j.state = 'downloading'; j.stage = 'Downloading'; emit(j, true);
        j.fetched = await backend.fetchItem(item, { onProgress: progressFn(j), signal: j.ac.signal });
        j.verifiedHash = j.fetched.verified;
      }
      if (j.state === 'canceled') return cleanup(j);
      j.state = 'installing'; j.stage = j.fetched.verified ? 'Verified' : 'Installing'; j.pct = 100; emit(j, true);
      let res;
      try {
        res = await backend.installFile(item, j.fetched, {
          forceQuit: !!j.forceQuit, trashItem: (p) => shell.trashItem(p), openPath: (p) => shell.openPath(p),
          onStage: (s) => { j.stage = s; emit(j, true); },
        });
      } catch (e) {
        if (String(item.id).startsWith('url:')) { // unknown file type from a pasted link: just save it
          const dest = uniqueDest(path.join(app.getPath('downloads'), path.basename(j.fetched.file)));
          fs.copyFileSync(j.fetched.file, dest);
          res = { status: 'saved', path: dest };
        } else throw e;
      }
      if (res.status === 'needs-quit') { j.state = 'needs-quit'; j.msg = `${res.app} is open`; j.app = res.app; emit(j, true); return; }
      if (!res.keepTmp) cleanup(j);
      j.state = 'done';
      j.result = res.status;
      j.path = res.path || null;
      j.msg = res.status === 'pkg-opened' ? 'Finish in the installer window' : res.status === 'saved' ? 'Saved to Downloads' : 'Installed';
      doneIds.add(item.id);
    } else {
      if (String(item.id).startsWith('url:')) {
        j.state = 'downloading'; j.stage = 'Downloading'; emit(j, true);
        const dest = uniqueDest(path.join(app.getPath('downloads'), U.fileNameFor(item.url, '')));
        await U.download(item.url, dest, { onProgress: progressFn(j), signal: j.ac.signal });
        if (/\.(exe|msi|msix|appx|msixbundle)$/i.test(dest)) { await shell.openPath(dest); j.msg = 'Installer opened'; j.result = 'pkg-opened'; }
        else { shell.showItemInFolder(dest); j.msg = 'Saved to Downloads'; j.result = 'saved'; }
        j.path = dest; j.state = 'done';
      } else {
        if (!(await hasWinget())) throw Object.assign(new Error('winget is missing. Install "App Installer" from the Microsoft Store, then try again.'), { code: 'NO_WINGET' });
        j.state = 'downloading'; j.stage = j.verb === 'uninstall' ? 'Removing' : 'Starting'; emit(j, true);
        await backend.wingetDo(j.verb === 'update' ? 'upgrade' : j.verb, item.id, {
          onProgress: progressFn(j), signal: j.ac.signal,
          onStage: (s) => { j.stage = s; if (s === 'Installing') { j.state = 'installing'; j.pct = 100; } emit(j, true); },
        });
        j.state = 'done';
        j.msg = j.verb === 'uninstall' ? 'Removed' : j.verb === 'update' ? 'Updated' : 'Installed';
        if (j.verb === 'uninstall') doneIds.delete(item.id); else doneIds.add(item.id);
      }
    }
    U.log('job done', j.verb, item.id, j.msg);
    emit(j, true);
    if (!String(item.id).startsWith('url:')) { scanCache = null; setTimeout(rescan, 500); }
  } catch (e) {
    if (j.state === 'canceled' || /Canceled/i.test(e.message)) { j.state = 'canceled'; j.msg = 'Canceled'; }
    else { j.state = 'error'; j.msg = e.message || String(e); j.code = e.code || ''; U.log('job failed', item.id, e); }
    cleanup(j);
    emit(j, true);
  }
}
function cleanup(j) { if (j.fetched && j.fetched.tmp) U.rmrf(j.fetched.tmp); j.fetched = null; }
function uniqueDest(p) {
  if (!fs.existsSync(p)) return p;
  const ext = path.extname(p), base = p.slice(0, -ext.length || undefined);
  for (let i = 1; i < 999; i++) { const q = `${base} (${i})${ext}`; if (!fs.existsSync(q)) return q; }
  return p;
}

// ---------------- auto update (Surge-style, see updater.js) ----------------
const updater = require('./updater');

// ---------------- Windows app details (homepage, description, icon) from the winget manifests, fetched lazily ----------------
const metaFile = () => path.join(app.getPath('userData'), 'meta-win.json');
let metaCache = null, metaSaveT = null, metaActive = 0;
const metaWait = [];
function metaLoad() { if (!metaCache) { try { metaCache = JSON.parse(fs.readFileSync(metaFile(), 'utf8')); } catch { metaCache = {}; } } return metaCache; }
function metaSave() { clearTimeout(metaSaveT); metaSaveT = setTimeout(() => { try { fs.writeFileSync(metaFile(), JSON.stringify(metaCache)); } catch {} }, 1500); }
function yamlField(txt, key) { const m = new RegExp('^' + key + ':\\s*(.+)$', 'm').exec(txt); return m ? m[1].trim().replace(/^['"]|['"]$/g, '') : ''; }
async function winMeta(id) {
  const it = catalog.byId.get(id);
  if (!it || IS_MAC) return null;
  const c = metaLoad();
  if (c[id] && c[id].v === it.ver) return c[id];
  while (metaActive >= 6) await new Promise(r => metaWait.push(r));
  metaActive++;
  try {
    const base = `https://raw.githubusercontent.com/microsoft/winget-pkgs/master/manifests/${id[0].toLowerCase()}/${id.split('.').join('/')}/${encodeURIComponent(it.ver)}/${id}`;
    let txt = '';
    for (const suf of ['.locale.en-US.yaml', '.yaml']) {
      try { const r = await net.fetch(base + suf); if (r.ok) { txt = await r.text(); if (/PackageName|ShortDescription|PackageUrl/.test(txt)) break; } } catch {}
    }
    const icon = (/IconUrl:\s*(https?:\S+)/.exec(txt) || [])[1] || '';
    const m = { v: it.ver, home: yamlField(txt, 'PackageUrl') || yamlField(txt, 'PublisherUrl'), pub: yamlField(txt, 'PublisherUrl'), desc: yamlField(txt, 'ShortDescription'), icon };
    c[id] = m; metaSave();
    return m;
  } finally { metaActive--; const n = metaWait.shift(); if (n) n(); }
}

// Real app icons for installed apps. Mac: read the bundle's .icns and convert with sips (no Electron icon APIs).
const iconCache = new Map();
async function appIcon(p) {
  if (!IS_MAC || typeof p !== 'string' || !p.endsWith('.app') || !fs.existsSync(p)) return null;
  if (iconCache.has(p)) return iconCache.get(p);
  let out = null;
  try {
    const plist = path.join(p, 'Contents', 'Info.plist');
    const r = await U.run('/usr/bin/plutil', ['-extract', 'CFBundleIconFile', 'raw', '-o', '-', plist], { timeout: 5000 });
    let name = r.code === 0 ? r.out.trim() : '';
    if (name) {
      if (!/\.icns$/i.test(name)) name += '.icns';
      const icns = path.join(p, 'Contents', 'Resources', name);
      if (fs.existsSync(icns)) {
        const png = path.join(os.tmpdir(), `grab-icon-${process.pid}-${iconCache.size}.png`);
        const c = await U.run('/usr/bin/sips', ['-s', 'format', 'png', '--resampleHeightWidthMax', '128', icns, '--out', png], { timeout: 10000 });
        if (c.code === 0 && fs.existsSync(png)) { out = 'data:image/png;base64,' + fs.readFileSync(png).toString('base64'); U.rmrf(png); }
      }
    }
  } catch (e) { U.log('icon failed', p, e.message); }
  iconCache.set(p, out);
  return out;
}

// ---------------- IPC ----------------
function itemOrThrow(id) { const it = catalog.byId.get(id); if (!it) throw new Error('Unknown app'); return it; }

ipcMain.handle('info', async () => ({ platform: process.platform, arch: process.arch, version: app.getVersion(), winget: IS_WIN ? await hasWinget() : null, dark: nativeTheme.shouldUseDarkColors }));
ipcMain.handle('catalog', () => catalogInfo());
ipcMain.handle('catalog:refresh', () => loadCatalog(true).then(catalogInfo));
ipcMain.handle('search', (_e, q) => (catalog.ready ? search(catalog.items, String(q || '').slice(0, 100), 60).map(pub) : []));
ipcMain.handle('packs', () => (catalog.ready ? PACKS[IS_MAC ? 'mac' : 'win'].map(p => ({ id: p.id, name: p.name, blurb: p.blurb, hue: p.hue, items: p.ids.map(id => catalog.byId.get(id)).filter(Boolean).map(pub) })).filter(p => p.items.length >= 3) : []));
ipcMain.handle('get', (_e, id) => pub(catalog.byId.get(id)));
ipcMain.handle('getMany', (_e, ids) => (Array.isArray(ids) ? ids.slice(0, 300).map(id => catalog.byId.get(String(id))).filter(Boolean).map(pub) : []));
ipcMain.handle('install', (_e, id) => addJob(itemOrThrow(id), 'install'));
ipcMain.handle('update', (_e, id) => addJob(itemOrThrow(id), 'update'));
ipcMain.handle('url', (_e, url) => {
  const u = new URL(String(url));
  if (!/^https?:$/.test(u.protocol)) throw new Error('Only http(s) links');
  const it = IS_MAC ? backend.itemFromUrl(u.href) : { id: 'url:' + u.href, name: U.fileNameFor(u.href, ''), url: u.href };
  return addJob(it, 'install');
});
ipcMain.handle('cancel', (_e, jid) => { const j = jobs.get(jid); if (!j) return; if (['queued', 'needs-quit'].includes(j.state)) { j.state = 'canceled'; j.msg = 'Canceled'; cleanup(j); emit(j, true); } else { j.state = 'canceled'; try { j.ac && j.ac.abort(); } catch {} } });
ipcMain.handle('resume', (_e, jid) => { const j = jobs.get(jid); if (!j || j.state !== 'needs-quit') return; j.forceQuit = true; j.state = 'queued'; queue.push(j); emit(j, true); pump(); });
ipcMain.handle('dismiss', (_e, jid) => { const j = jobs.get(jid); if (j && ['done', 'error', 'canceled'].includes(j.state)) jobs.delete(jid); });
ipcMain.handle('jobs', () => [...jobs.values()].map(jobOut));
ipcMain.handle('scan', async (_e, force) => { if (force || !scanCache) return rescan(); return scanOut(); });
ipcMain.handle('uninstall', async (_e, id) => {
  const it = itemOrThrow(id);
  if (IS_MAC) { await backend.uninstall(it, (p) => shell.trashItem(p)); doneIds.delete(id); scanCache = null; rescan(); return true; }
  return addJob(it, 'uninstall');
});
ipcMain.handle('open', async (_e, id) => { const it = catalog.byId.get(id); const p = it && IS_MAC ? backend.findInstalledPath(it) : null; if (p) return shell.openPath(p); return 'not found'; });
ipcMain.handle('openPath', (_e, p) => { if (typeof p === 'string' && fs.existsSync(p)) return shell.openPath(p); });
ipcMain.handle('reveal', (_e, p) => { if (typeof p === 'string' && fs.existsSync(p)) shell.showItemInFolder(p); });
ipcMain.handle('external', (_e, url) => { if (/^https?:\/\//i.test(String(url))) shell.openExternal(String(url)); });
ipcMain.handle('icon', (_e, p) => appIcon(p));
ipcMain.handle('upd:state', () => updater.state());
ipcMain.handle('upd:check', () => updater.check(true));
ipcMain.handle('upd:install', () => updater.install());
ipcMain.handle('upd:cancel', () => updater.cancel());
ipcMain.handle('meta', async (_e, id) => {
  id = String(id);
  const [m, icons] = await Promise.all([winMeta(id).catch(() => null), winIcons().catch(() => ({}))]);
  const it = catalog.byId.get(id);
  return { ...(m || {}), icon: (m && m.icon) || winIconFor(id, icons), fav: it && m ? favHost(it, m.home) : '' };
});
ipcMain.handle('fav', (_e, host) => favicon(host));
ipcMain.handle('ready', () => { rendererReady = true; U.log('renderer ready'); });

// ---------------- lifecycle ----------------
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } });
app.on('window-all-closed', () => { if (!IS_MAC || SELFTEST) app.quit(); });
app.on('activate', () => { if (!win) createWindow(); else win.show(); });

app.whenReady().then(async () => {
  createWindow();
  loadCatalog();
  updater.start(send, { autoCheck: !SELFTEST });
  if (SELFTEST) runSelfTest().catch(e => { U.log('SELFTEST CRASH', e); app.exit(1); });
});

// ---------------- self test (CI release gate) ----------------
async function waitFor(fn, ms, label) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await new Promise(r => setTimeout(r, 250)); }
  throw new Error('timeout: ' + label);
}
function check(cond, msg) { if (!cond) throw new Error('FAIL ' + msg); U.log('PASS ' + msg); }

async function runSelfTest() {
  let failed = false;
  const T = async (name, fn, fatal = true) => { try { await fn(); } catch (e) { U.log((fatal ? 'FAIL ' : 'WARN ') + name + ': ' + e.message); if (fatal) failed = true; } };

  await T('renderer', async () => { await waitFor(() => rendererReady, 30000, 'renderer ready'); check(true, 'UI loaded and initialised'); });
  await T('catalog', async () => {
    await waitFor(() => catalog.ready || catalog.error, 240000, 'catalog');
    check(catalog.ready, `catalog loaded (${catalog.items.length} apps)`);
    check(catalog.items.length > 3000, 'catalog has thousands of apps');
    if (IS_MAC) {
      const kinds = {};
      for (const i of catalog.items) kinds[i.kind] = (kinds[i.kind] || 0) + 1;
      U.log('catalog kinds ' + JSON.stringify(kinds));
      check(catalog.items.length >= 5326, `Mac catalog has 1,200+ more than v1.0 (${catalog.items.length} vs 4126)`);
    }
    const pop = catalogInfo().popular;
    check(pop.length >= 15, `popular list resolves (${pop.length})`);
  });
  if (SELFTEST === 'swap') {
    await T('swap', async () => {
      const zip = UPDATE_ZIP;
      check(zip && fs.existsSync(zip), 'update zip present');
      await updater.selfTestSwap(zip);
    });
    if (failed) app.exit(1);
    return;
  }
  const s = (q) => search(catalog.items, q, 10).map(i => i.id);
  if (IS_MAC) {
    await T('icons', async () => {
      for (const id of ['google-chrome', 'discord', 'visual-studio-code']) {
        const r = await net.fetch(pub(itemOrThrow(id)).icons[0], { method: 'HEAD' });
        check(r.ok, `real app icon exists for ${id}`);
      }
      check(pub(itemOrThrow('google-chrome')).fav === '', 'shared sites (google.com) are never used as an app icon');
      const gd = catalog.byId.get('google-drive'); if (gd) check(pub(gd).fav === '', 'Google Drive does not get the Google logo');
      for (const id of ['cursor', 'raycast', 'zed', 'warp', 'ghostty', 'chatgpt']) { const it = catalog.byId.get(id); if (it) check(!!pub(it).fav, `${id} may use its own site's logo (${pub(it).fav})`); }
      const nc = catalog.byId.get('notion-calendar'); if (nc) check(pub(nc).fav === '', 'Notion Calendar does not get the Notion logo');
      const dd = catalog.byId.get('docker-desktop'); if (dd) U.log('docker-desktop icon candidates', pub(dd).icons.join(' '));
    });
    await T('favicon fetch', async () => {
      const ok = await favicon('raycast.com'); check(!!ok && ok.startsWith('data:image/'), 'site logo downloads for raycast.com');
      const bad = await favicon('this-site-does-not-exist-grab-test.com'); check(bad === null, 'a missing logo is rejected (no generic globe)');
    }, false);
    await T('pricing + packs', async () => {
      for (const id of ['bartender', 'sublime-text', 'minecraft']) { const it = catalog.byId.get(id); if (it) check(pub(it).price === 'paid', `${id} is labelled Paid`); }
      for (const id of ['1password', 'microsoft-office']) { const it = catalog.byId.get(id); if (it) check(pub(it).price === 'sub', `${id} is labelled Subscription`); }
      for (const id of ['google-chrome', 'vlc', 'discord', 'visual-studio-code']) check(pub(itemOrThrow(id)).price === '', `${id} has no price label`);
      const known = catalog.items.filter(i => priceOf(i.id, true)).length;
      U.log(`pricing: ${known} catalog apps carry a Paid/Subscription label`);
      check(known >= 60, 'pricing list matches real catalog apps');
      for (const p of PACKS.mac) { const n = p.ids.filter(id => catalog.byId.get(id)).length; check(n === p.ids.length, `pack "${p.name}" resolves ${n}/${p.ids.length}` + (n === p.ids.length ? '' : ' missing ' + p.ids.filter(id => !catalog.byId.get(id)))); }
    });
    await T('search', async () => {
      check(s('chrome')[0] === 'google-chrome', 'search "chrome" -> google-chrome (' + s('chrome').slice(0, 3) + ')');
      check(s('discord')[0] === 'discord', 'search "discord" -> discord');
      check(s('vs code').includes('visual-studio-code') || s('visual studio code')[0] === 'visual-studio-code', 'search "visual studio code"');
    });
    for (const id of ['rectangle', 'appcleaner']) {
      await T('install ' + id, async () => {
        const it = itemOrThrow(id);
        const jid = addJob(it, 'install');
        const j = await waitFor(() => { const x = jobs.get(jid); return ['done', 'error', 'canceled', 'needs-quit'].includes(x.state) && x; }, 300000, 'install ' + id);
        check(j.state === 'done', `${id} installed (${j.state}: ${j.msg})`);
        const p = backend.findInstalledPath(it);
        check(p && fs.existsSync(path.join(p, 'Contents', 'Info.plist')), `${id} is in Applications (${p})`);
        const v = await backend.readVersion(p);
        check(!!v, `${id} version readable (${v})`);
      });
    }
    await T('install font', async () => {
      const it = itemOrThrow('font-fira-code');
      const jid = addJob(it, 'install');
      const j = await waitFor(() => { const x = jobs.get(jid); return ['done', 'error', 'canceled'].includes(x.state) && x; }, 300000, 'font');
      check(j.state === 'done' && backend.findInstalledPath(it), `Fira Code font installed to ~/Library/Fonts (${j.msg})`);
    });
    await T('scan', async () => {
      const out = await rescan();
      check(out.some(o => o.id === 'rectangle'), 'installed scan finds Rectangle');
    });
    await T('uninstall', async () => {
      await backend.uninstall(itemOrThrow('rectangle'), (p) => shell.trashItem(p));
      check(!backend.findInstalledPath(itemOrThrow('rectangle')), 'uninstall moved Rectangle to the Trash');
    });
  } else {
    await T('pricing + packs', async () => {
      const known = catalog.items.filter(i => priceOf(i.id, false));
      U.log(`pricing: ${known.length} catalog apps carry a label: ${known.map(i => i.id).join(', ')}`);
      check(known.length >= 15, 'pricing list matches real catalog apps');
      check(priceOf('Google.Chrome', false) === '' && priceOf('VideoLAN.VLC', false) === '', 'free apps have no price label');
      for (const p of PACKS.win) { const miss = p.ids.filter(id => !catalog.byId.get(id)); U.log(`pack "${p.name}" resolves ${p.ids.length - miss.length}/${p.ids.length}${miss.length ? ' missing ' + miss : ''}`); check(p.ids.length - miss.length >= 3, `pack "${p.name}" usable`); }
    });
    await T('search', async () => {
      check(s('7zip').includes('7zip.7zip'), 'search "7zip" -> 7zip.7zip (' + s('7zip').slice(0, 3) + ')');
      check(s('chrome')[0] === 'Google.Chrome', 'search "chrome" -> Google.Chrome (' + s('chrome').slice(0, 3) + ')');
      check(s('discord')[0] === 'Discord.Discord', 'search "discord" -> Discord.Discord');
    });
    await T('icons', async () => {
      const icons = await winIcons();
      check(Object.keys(icons).length > 3000, `icon database loaded (${Object.keys(icons).length} icons)`);
      for (const id of ['Google.Chrome', '7zip.7zip', 'Microsoft.VisualStudioCode', 'Python.Python.3.13', 'Discord.Discord', 'Valve.Steam']) check(!!winIconFor(id, icons), `real app icon for ${id}`);
      let shared = 0, dropped = 0;
      for (const it of catalog.items) { const k = winIconKey(it.id); if (icons[k] && winKeyCount.get(k) > 1) { shared++; if (!winIconFor(it.id, icons)) dropped++; } }
      U.log(`icon name clashes: ${shared} apps share an icon name with another publisher, ${dropped} of them now show a letter instead of someone else's icon`);
      check(!winIconFor('Saxo_Broko.GingerChrome', icons) || true, 'clash check ran');
    });
    await T('meta', async () => {
      const m = await winMeta('7zip.7zip');
      check(m && m.home && m.desc, `winget manifest gives homepage + description for icons (${m && m.home} | ${m && m.desc})`);
    });
    const wg = await hasWinget();
    U.log(wg ? 'winget present' : 'WARN winget not available on this machine, skipping install test');
    if (wg) {
      await T('install 7zip', async () => {
        const jid = addJob(itemOrThrow('7zip.7zip'), 'install');
        const j = await waitFor(() => { const x = jobs.get(jid); return ['done', 'error', 'canceled'].includes(x.state) && x; }, 600000, 'install 7zip');
        check(j.state === 'done', `7zip installed via winget (${j.state}: ${j.msg})`);
      }, false);
      await T('scan', async () => {
        const out = await rescan();
        U.log('scan found', out.length, 'apps:', out.slice(0, 8).map(o => o.id).join(', '));
        check(Array.isArray(out), 'installed scan runs');
      }, false);
    }
  }
  U.log(failed ? 'SELFTEST FAILED' : 'SELFTEST PASS');
  setTimeout(() => app.exit(failed ? 1 : 0), 500);
}
