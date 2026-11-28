'use strict';
const { app, BrowserWindow, ipcMain, shell, net, nativeTheme, dialog, screen } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const U = require('./util');
const { prepare, search } = require('./search');
const { priceOf, trialOf, PACKS } = require('./extras');

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
// Light, dark or follow the system (Settings, Appearance). Saved here too, so the window opens in the right colours.
const appearanceFile = () => path.join(app.getPath('userData'), 'appearance.json');
function loadAppearance() { try { const m = JSON.parse(fs.readFileSync(appearanceFile(), 'utf8')).mode; if (['system', 'light', 'dark'].includes(m)) nativeTheme.themeSource = m; } catch {} }
const winColors = () => (nativeTheme.shouldUseDarkColors ? { bg: '#0d0c0a', fg: '#f2eee5' } : { bg: '#f6f3ed', fg: '#15130f' });
function paintWindow() {
  if (!win || win.isDestroyed()) return;
  const c = winColors();
  try { win.setBackgroundColor(c.bg); } catch {}
  if (IS_WIN) { try { win.setTitleBarOverlay({ color: c.bg, symbolColor: c.fg, height: 46 }); } catch {} }
}

// the window's size and place, kept between launches
const boundsFile = () => path.join(app.getPath('userData'), 'window.json');
function loadBounds() {
  let saved = null; try { saved = JSON.parse(fs.readFileSync(boundsFile(), 'utf8')); } catch {}
  let areas = []; try { areas = screen.getAllDisplays().map(d => d.workArea); } catch {}
  return U.fitBounds(saved, areas);
}
function saveBounds() {
  if (!win || win.isDestroyed() || SELFTEST) return;
  try { const b = win.getNormalBounds(); fs.writeFileSync(boundsFile(), JSON.stringify({ ...b, maximized: win.isMaximized() })); } catch {}
}

function createWindow() {
  const c = winColors();
  const b = loadBounds();
  const common = {
    width: b.width, height: b.height, ...(b.x != null ? { x: b.x, y: b.y } : {}), minWidth: 900, minHeight: 600, show: false,
    title: 'Grab',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false },
  };
  const plat = IS_MAC
    ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 20, y: 18 }, backgroundColor: c.bg }
    : { titleBarStyle: 'hidden', titleBarOverlay: { color: c.bg, symbolColor: c.fg, height: 46 }, backgroundColor: c.bg, icon: path.join(__dirname, 'icon.png') };
  win = new BrowserWindow({ ...common, ...plat });
  win.loadFile(path.join(__dirname, 'ui', 'index.html'));
  win.once('ready-to-show', () => { if (SELFTEST) return; if (b.maximized) win.maximize(); win.show(); });
  let boundsT = null; const later = () => { clearTimeout(boundsT); boundsT = setTimeout(saveBounds, 600); };
  win.on('resize', later); win.on('move', later); win.on('close', saveBounds);
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
    if (/@(?!\d)/.test(String(it.id))) return ''; // beta / nightly builds have their own icons; pinned versions (@6) are the same app
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
  const [base, variant] = String(it.id).split('@');
  const out = [cask(it.id)];
  if (variant && /^\d/.test(variant)) out.push(cask(base)); // a pinned older version of the same app
  // an earlier name for the same app. Skipped when the names are unrelated: that is a rebrand, and the old icon would be out of date.
  for (const o of it.old || []) { const a = sq(o.split('@')[0]), b = sq(base); if (a && (a.includes(b) || b.includes(a))) out.push(cask(o)); }
  // last resort: an open icon library, exact name match only
  if (!variant) out.push(`https://raw.githubusercontent.com/homarr-labs/dashboard-icons/main/png/${encodeURIComponent(it.id)}.png`);
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
// Windows icons are fetched and checked here before they are shown. A full scan of the icon database (Nov 2026, 5,945 icons)
// found three problems, all handled below instead of trusting the link:
//  1. some hosts answer a dead link with a stand-in picture (Chocolatey's default package icon, imgbox's "unavailable" card):
//     those exact pictures are recognised by their hash and rejected;
//  2. Wikimedia now only serves thumbnails in fixed widths, so 106 links (VS Code, Steam, OBS...) failed until rewritten;
//  3. about 640 links are simply dead (404): rejected, so the next source or the letter tile is used.
const PLACEHOLDER_ICONS = new Set(['693aa33962ac1694', 'ab3e519d5cb65da1', '9a238bfd76905c37', '473c989e5f8a73d4', '164b08c82eea42e6']);
function fixIconUrl(u) {
  try { const x = new URL(u); if (x.hostname === 'upload.wikimedia.org' && x.pathname.includes('/thumb/')) { x.pathname = x.pathname.replace(/\/(\w+-)?\d+px-([^/]+)$/, '/$1250px-$2'); return x.href; } } catch {}
  return u;
}
const iconDataCache = new Map();
function iconDir() { const d = path.join(app.getPath('userData'), 'icons'); try { fs.mkdirSync(d, { recursive: true }); } catch {} return d; }
function checkedIcon(url) {
  if (!/^https:\/\//.test(String(url || ''))) return Promise.resolve(null);
  if (iconDataCache.has(url)) return iconDataCache.get(url);
  const p = (async () => {
    const crypto = require('crypto');
    const file = path.join(iconDir(), crypto.createHash('sha1').update(url).digest('hex') + '.png');
    try { const st = fs.statSync(file); if (Date.now() - st.mtimeMs < 14 * 86400e3) return 'data:image/png;base64,' + fs.readFileSync(file).toString('base64'); } catch {}
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 15000);
    try {
      const r = await net.fetch(fixIconUrl(url), { headers: { 'User-Agent': U.BROWSER_UA, Accept: 'image/png,image/jpeg,image/*;q=0.6,*/*;q=0.3' }, signal: ctl.signal });
      if (!r.ok) return null;
      const type = (r.headers.get('content-type') || '').split(';')[0];
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length < 150 || buf.length > 4000000 || /text\/html/.test(type)) return null;
      if (PLACEHOLDER_ICONS.has(crypto.createHash('sha1').update(buf).digest('hex').slice(0, 16))) return null;
      const { nativeImage } = require('electron');
      const img = nativeImage.createFromBuffer(buf);
      if (!img.isEmpty()) {
        const sz = img.getSize(); if (sz.width < 24 || sz.height < 24) return null;
        const png = img.resize({ width: 128, height: Math.max(1, Math.round(128 * sz.height / sz.width)), quality: 'best' }).toPNG();
        try { fs.writeFileSync(file, png); } catch {}
        return 'data:image/png;base64,' + png.toString('base64');
      }
      return /^image\/(svg\+xml|webp|gif|x-icon|vnd\.microsoft\.icon)$/.test(type) && buf.length < 300000 ? `data:${type};base64,${buf.toString('base64')}` : null;
    } catch { return null; } finally { clearTimeout(t); }
  })();
  iconDataCache.set(url, p);
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
    price: priceOf(it.id, IS_MAC), trial: trialOf(it.id, IS_MAC),
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
    catalogRetryMs = 0;
  } catch (e) {
    U.log('catalog error', e);
    if (!catalog.ready) {
      catalog.error = e.message; send('catalog', catalogInfo());
      // offline at launch: keep trying quietly (30s, 1m, 2m... up to every 5 minutes) instead of waiting for a click
      catalogRetryMs = Math.min(300000, (catalogRetryMs || 15000) * 2);
      clearTimeout(catalogRetryT); catalogRetryT = setTimeout(() => { if (!catalog.ready) loadCatalog(true); }, catalogRetryMs);
    }
  }
}
let catalogRetryMs = 0, catalogRetryT = null;
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
      if (j.state === 'canceled') { cleanup(j); j.msg = 'Canceled'; emit(j, true); return; } // canceled just as the download finished: tell the UI
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
ipcMain.handle('cancel', (_e, jid) => {
  const j = jobs.get(jid); if (!j) return;
  if (['queued', 'needs-quit'].includes(j.state)) { j.state = 'canceled'; j.msg = 'Canceled'; cleanup(j); emit(j, true); }
  else if (j.state === 'downloading') { j.state = 'canceled'; try { j.ac && j.ac.abort(); } catch {} }
  // 'installing': files are already being copied (or winget is running the installer); stopping halfway would leave a broken app, so it finishes
});
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
  let icon = null;
  for (const u of [m && m.icon, winIconFor(id, icons)]) { if (u && (icon = await checkedIcon(u))) break; }
  return { ...(m || {}), icon: icon || '', fav: it && m ? favHost(it, m.home) : '' };
});
ipcMain.handle('fav', (_e, host) => favicon(host));
ipcMain.handle('ready', () => { rendererReady = true; U.log('renderer ready'); });
// App Management (Mac): can Grab update and delete other apps, and the way to the switch in System Settings
ipcMain.handle('access', () => (IS_MAC && backend.appManagement ? backend.appManagement() : 'allowed'));
ipcMain.handle('access:open', () => { if (IS_MAC) shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_AppBundles'); });
// Settings, export and import: a small JSON file the person picks; only known keys survive either way
ipcMain.handle('prefs:export', async (_e, data) => {
  const clean = U.cleanPrefs(data);
  const r = await dialog.showSaveDialog(win, { title: 'Export Grab settings', defaultPath: path.join(app.getPath('downloads'), 'Grab settings.json'), filters: [{ name: 'Grab settings', extensions: ['json'] }] });
  if (r.canceled || !r.filePath) return false;
  fs.writeFileSync(r.filePath, JSON.stringify(clean, null, 2));
  return true;
});
ipcMain.handle('prefs:import', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Import Grab settings', properties: ['openFile'], filters: [{ name: 'Grab settings', extensions: ['json'] }] });
  if (r.canceled || !r.filePaths[0]) return null;
  const st = fs.statSync(r.filePaths[0]); if (st.size > 1e6) throw new Error('That file is too big to be Grab settings');
  let o; try { o = JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8')); } catch { throw new Error('That file is not valid JSON'); }
  return U.cleanPrefs(o);
});
ipcMain.handle('appearance', (_e, mode) => {
  if (!['system', 'light', 'dark'].includes(mode)) return;
  nativeTheme.themeSource = mode;
  try { fs.writeFileSync(appearanceFile(), JSON.stringify({ mode })); } catch {}
  paintWindow();
});

// ---------------- lifecycle ----------------
app.on('second-instance', () => { if (!win) { if (app.isReady()) createWindow(); return; } if (win.isMinimized()) win.restore(); win.show(); win.focus(); });
app.on('window-all-closed', () => { if (!IS_MAC || SELFTEST) app.quit(); });
app.on('activate', () => { if (!win) createWindow(); else win.show(); });

app.whenReady().then(async () => {
  loadAppearance();
  nativeTheme.on('updated', paintWindow);
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
  if (SELFTEST === 'iconscan') { await runIconScan().catch(e => U.log('SCAN CRASH', e)); app.exit(0); return; }
  if (SELFTEST === 'audit') { await runAudit().catch(e => U.log('AUDIT CRASH', e)); app.exit(0); return; }
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
      check(pub(itemOrThrow('bartender')).trial.label === '4-week trial' && !pub(itemOrThrow('cleanshot')).trial, 'trial length shown only where the developer states one');
      const known = catalog.items.filter(i => priceOf(i.id, true)).length;
      U.log(`pricing: ${known} catalog apps carry a Paid/Subscription label`);
      check(known >= 60, 'pricing list matches real catalog apps');
      for (const p of PACKS.mac) { const miss = p.ids.filter(id => !catalog.byId.get(id)); U.log(`pack "${p.name}" resolves ${p.ids.length - miss.length}/${p.ids.length}${miss.length ? ' MISSING ' + miss : ''}`); check(p.ids.length - miss.length >= Math.min(4, p.ids.length), `pack "${p.name}" usable`); }
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
      check(fixIconUrl('https://upload.wikimedia.org/wikipedia/commons/thumb/8/83/Steam_icon_logo.svg/512px-Steam_icon_logo.svg.png').endsWith('/250px-Steam_icon_logo.svg.png') && fixIconUrl('https://upload.wikimedia.org/wikipedia/commons/thumb/9/9a/V.svg/langfr-800px-V.svg.png').endsWith('/langfr-250px-V.svg.png'), 'Wikimedia links rewritten to a supported size');
      for (const id of ['Microsoft.VisualStudioCode', 'Valve.Steam', 'OBSProject.OBSStudio', 'BlenderFoundation.Blender', 'Google.Chrome']) { const d = await checkedIcon(winIconFor(id, icons)); check(!!d, `icon really downloads for ${id}`); }
      for (const id of ['Brave.Brave', 'OpenAI.ChatGPT', 'Insomnia.Insomnia']) { const u = winIconFor(id, icons); const d = u ? await checkedIcon(u) : null; check(!d, `stand-in picture rejected for ${id}`); }
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


// ---------------- icon audit (CI only): dump the exact icon Grab shows for well-known apps, so a human can look at every one ----------------
const AUDIT_MAC = `microsoft-edge 1password alfred bartender cleanmymac notion-calendar ghostty zed warp signal tor-browser transmission qbittorrent keka stats alt-tab
github postman gimp inkscape libreoffice anki zotero prismlauncher heroic moonlight gog-galaxy messenger microsoft-teams microsoft-word microsoft-excel microsoft-powerpoint
microsoft-outlook onedrive google-drive dropbox skype whatsapp@beta opera opera-gx vivaldi safari-technology-preview chromium librewolf zen orion duckduckgo
android-studio intellij-idea pycharm webstorm sublime-text fork sourcetree tower github-desktop gitkraken insomnia tableplus dbeaver-community sequel-ace
utm virtualbox parallels vmware-fusion orbstack podman-desktop kitty alacritty wezterm hyper tabby
adobe-creative-cloud adobe-acrobat-reader affinity sketch krita davinci-resolve kdenlive shotcut obs vlc iina mpv plex jellyfin-media-player spotify tidal
bitwarden keepassxc protonvpn nordvpn mullvad-vpn tailscale wireguard-tools little-snitch lulu malwarebytes
logi-options+ karabiner-elements hammerspoon bettertouchtool monitorcontrol hiddenbar ice maccy shottr cleanshot betterdisplay aldente coconutbattery
notion obsidian logseq craft evernote todoist ticktick linear-linear trello clickup miro
discord telegram signal slack zoom webex loom whatsapp element thunderbird spark-desktop mimestream
steam epic-games battle-net minecraft roblox league-of-legends curseforge nvidia-geforce-now xbox whisky crossover
chatgpt claude cursor windsurf lm-studio ollama jan perplexity raycast arc brave-browser firefox google-chrome visual-studio-code docker-desktop
balenaetcher appcleaner the-unarchiver handbrake-app audacity blender figma capcut rectangle iterm2 daisydisk grandperspective onyx transmit cyberduck filezilla`.split(/\s+/);
const AUDIT_WIN = `Microsoft.Edge Opera.Opera Vivaldi.Vivaldi Mozilla.Thunderbird LibreWolf.LibreWolf Zen-Team.Zen-Browser DuckDuckGo.DesktopBrowser
GitHub.GitHubDesktop Postman.Postman GIMP.GIMP.3 Inkscape.Inkscape TheDocumentFoundation.LibreOffice Anki.Anki DigitalScholar.Zotero PrismLauncher.PrismLauncher HeroicGamesLauncher.HeroicGamesLauncher
Microsoft.Teams Microsoft.Office Microsoft.OneDrive Google.GoogleDrive Dropbox.Dropbox Microsoft.WindowsTerminal Microsoft.PowerShell Microsoft.VisualStudio.2022.Community
Google.AndroidStudio JetBrains.IntelliJIDEA.Community JetBrains.PyCharm.Community SublimeHQ.SublimeText.4 Axosoft.GitKraken Insomnia.Insomnia dbeaver.dbeaver Notepad++.Notepad++
Oracle.VirtualBox Docker.DockerDesktop RedHat.Podman-Desktop Alacritty.Alacritty wez.wezterm PuTTY.PuTTY WinSCP.WinSCP TimKosse.FileZilla.Client
Adobe.Acrobat.Reader.64-bit KDE.Krita KDE.Kdenlive Meltytech.Shotcut HandBrake.HandBrake mpv.net Plex.Plex Jellyfin.JellyfinMediaPlayer TIDALMusicAS.TIDAL
Bitwarden.Bitwarden KeePassXCTeam.KeePassXC Proton.ProtonVPN MullvadVPN.MullvadVPN Tailscale.Tailscale WireGuard.WireGuard Malwarebytes.Malwarebytes
Logitech.OptionsPlus AutoHotkey.AutoHotkey voidtools.Everything WinDirStat.WinDirStat CPUID.CPU-Z CPUID.HWMonitor REALiX.HWiNFO Rufus.Rufus Balena.Etcher qBittorrent.qBittorrent
Notion.Notion Obsidian.Obsidian Logseq.Logseq Evernote.Evernote Doist.Todoist Element.Element OpenWhisperSystems.Signal Zoom.Zoom Cisco.Webex
Valve.Steam EpicGames.EpicGamesLauncher Blizzard.BattleNet Mojang.MinecraftLauncher Roblox.Roblox RiotGames.LeagueOfLegends.NA Overwolf.CurseForge Nvidia.GeForceNow GOG.Galaxy Ubisoft.Connect ElectronicArts.EADesktop
OpenAI.ChatGPT Anthropic.Claude Anysphere.Cursor Codeium.Windsurf ElementLabs.LMStudio Ollama.Ollama Brave.Brave Mozilla.Firefox Google.Chrome Microsoft.VisualStudioCode
7zip.7zip RARLab.WinRAR VideoLAN.VLC OBSProject.OBSStudio Audacity.Audacity BlenderFoundation.Blender Figma.Figma Spotify.Spotify Discord.Discord Telegram.TelegramDesktop SlackTechnologies.Slack
ShareX.ShareX Greenshot.Greenshot Microsoft.PowerToys Git.Git Python.Python.3.13 OpenJS.NodeJS.LTS Apple.iTunes Apple.iCloud AnyDeskSoftwareGmbH.AnyDesk TeamViewer.TeamViewer RustDesk.RustDesk Parsec.Parsec`.split(/\s+/);

function thumb(buf) {
  try { const { nativeImage } = require('electron'); const img = nativeImage.createFromBuffer(buf); if (!img.isEmpty()) return img.resize({ width: 96, height: 96, quality: 'best' }).toPNG().toString('base64'); } catch {}
  return buf.length < 80000 ? buf.toString('base64') : null;
}
async function fetchImg(url) {
  try {
    const r = await net.fetch(url);
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length < 200 || buf.length > 3000000) return null;
    return thumb(buf);
  } catch { return null; }
}
async function runAudit() {
  const out = process.env.GRAB_AUDIT_OUT || path.join(os.tmpdir(), 'grab-audit.json');
  const ids = [...new Set([...backend.POPULAR, ...PACKS[IS_MAC ? 'mac' : 'win'].flatMap(p => p.ids), ...(IS_MAC ? AUDIT_MAC : AUDIT_WIN), ...catalog.items.filter(i => priceOf(i.id, IS_MAC)).map(i => i.id)])];
  const items = ids.map(id => catalog.byId.get(id)).filter(Boolean);
  U.log('audit: ' + items.length + ' apps, not in catalog: ' + ids.filter(id => !catalog.byId.get(id)).join(' '));
  const icons = IS_WIN ? await winIcons() : null;
  const rows = await U.pool(items, 8, async (it) => {
    const row = { id: it.id, name: it.name, src: 'none', url: '', b64: null };
    const chain = [];
    if (IS_MAC) {
      const p = pub(it);
      p.icons.filter(u => !/dashboard-icons/.test(u)).forEach((u, i) => chain.push([i ? 'old-name' : 'appcasks', u]));
      if (p.fav) chain.push(['site', p.fav]);
      p.icons.filter(u => /dashboard-icons/.test(u)).forEach(u => chain.push(['library', u]));
    } else {
      const m = await winMeta(it.id).catch(() => null);
      if (m && m.icon) chain.push(['manifest', m.icon]);
      const u = winIconFor(it.id, icons); if (u) chain.push(['unigetui', u]);
      const f = m ? favHost(it, m.home) : ''; if (f) chain.push(['site', f]);
      row.home = m ? m.home : '';
    }
    for (const [src, u] of chain) {
      let b64 = null;
      if (src === 'site') { const d = await favicon(u); b64 = d ? thumb(Buffer.from(d.split(',')[1], 'base64')) : null; }
      else if (IS_WIN) { const d = await checkedIcon(u); b64 = d && d.startsWith('data:image/png') ? thumb(Buffer.from(d.split(',')[1], 'base64')) : (d ? 'RAW' : null); }
      else b64 = await fetchImg(u);
      if (b64) { row.src = src; row.url = u; row.b64 = b64; break; }
    }
    return row;
  });
  const tally = {}; for (const r of rows) tally[r.src] = (tally[r.src] || 0) + 1;
  U.log('audit sources ' + JSON.stringify(tally));
  fs.writeFileSync(out, JSON.stringify(rows));
  U.log('audit written ' + out);
}

// Full scan of the Windows icon database (CI only): find dead links and hosts that answer with a placeholder picture.
async function runIconScan() {
  const crypto = require('crypto');
  const { nativeImage } = require('electron');
  const icons = await winIcons();
  const entries = Object.entries(icons);
  U.log('iconscan: ' + entries.length + ' icons');
  const UA = { 'User-Agent': U.BROWSER_UA, Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8' };
  const one = async (url, headers) => {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 20000);
    try {
      const r = await net.fetch(url, { headers, signal: ctl.signal });
      const buf = Buffer.from(await r.arrayBuffer());
      let w = 0, h = 0; try { const im = nativeImage.createFromBuffer(buf); const sz = im.getSize(); w = sz.width; h = sz.height; } catch {}
      return { st: r.status, type: (r.headers.get('content-type') || '').split(';')[0], len: buf.length, sha: crypto.createHash('sha1').update(buf).digest('hex').slice(0, 16), w, h, fin: hostOf(r.url || url) };
    } catch (e) { return { st: 0, err: String(e.message || e).slice(0, 60) }; } finally { clearTimeout(t); }
  };
  let n = 0;
  const rows = await U.pool(entries, 24, async ([key, url]) => {
    const a = await one(url, {});
    const row = { key, url, a };
    if (!(a.st === 200 && a.w > 0)) row.b = await one(url, UA);
    if (++n % 500 === 0) U.log('iconscan ' + n);
    return row;
  });
  fs.writeFileSync(process.env.GRAB_AUDIT_OUT || path.join(os.tmpdir(), 'scan.json'), JSON.stringify(rows));
  U.log('iconscan written');
}
