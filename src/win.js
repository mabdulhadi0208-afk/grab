'use strict';
// Windows backend. Catalog = the official winget community index (the same SQLite DB winget uses),
// installs go through winget itself (official installer URLs + hash checks + silent install).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { log, run, download, cmpVer, rmrf } = require('./util');

const SOURCES = [
  'https://cdn.winget.microsoft.com/cache/source2.msix',
  'https://cdn.winget.microsoft.com/cache/source.msix',
];

const POPULAR = [
  'Google.Chrome', 'Discord.Discord', 'Spotify.Spotify', 'Microsoft.VisualStudioCode', 'Valve.Steam',
  'Mozilla.Firefox', 'Zoom.Zoom', 'VideoLAN.VLC', 'OBSProject.OBSStudio', 'Telegram.TelegramDesktop',
  'Brave.Brave', 'EpicGames.EpicGamesLauncher', 'Notion.Notion', '7zip.7zip', 'Microsoft.PowerToys',
  'Opera.OperaGX', 'SlackTechnologies.Slack', 'Figma.Figma', 'Audacity.Audacity', 'Python.Python.3.13',
  'Git.Git', 'ShareX.ShareX', 'Blizzard.BattleNet', 'Obsidian.Obsidian', 'OpenAI.ChatGPT', 'Anthropic.Claude',
  'Anysphere.Cursor', 'Microsoft.Teams', 'BlenderFoundation.Blender', 'Bytedance.CapCut',
];

// well-known homepages (for icons); everything else gets a guessed domain or a letter tile
const HOMES = {
  'Google.Chrome': 'https://google.com/chrome', 'Discord.Discord': 'https://discord.com', 'Spotify.Spotify': 'https://spotify.com',
  'Microsoft.VisualStudioCode': 'https://code.visualstudio.com', 'Valve.Steam': 'https://store.steampowered.com',
  'Mozilla.Firefox': 'https://firefox.com', 'Zoom.Zoom': 'https://zoom.us', 'VideoLAN.VLC': 'https://videolan.org',
  'OBSProject.OBSStudio': 'https://obsproject.com', 'Telegram.TelegramDesktop': 'https://telegram.org', 'Brave.Brave': 'https://brave.com',
  'EpicGames.EpicGamesLauncher': 'https://epicgames.com', 'Notion.Notion': 'https://notion.so', '7zip.7zip': 'https://7-zip.org',
  'Microsoft.PowerToys': 'https://learn.microsoft.com', 'Opera.OperaGX': 'https://opera.com', 'SlackTechnologies.Slack': 'https://slack.com',
  'Figma.Figma': 'https://figma.com', 'Audacity.Audacity': 'https://audacityteam.org', 'Git.Git': 'https://git-scm.com',
  'ShareX.ShareX': 'https://getsharex.com', 'Blizzard.BattleNet': 'https://battle.net', 'Obsidian.Obsidian': 'https://obsidian.md',
  'OpenAI.ChatGPT': 'https://chatgpt.com', 'Anthropic.Claude': 'https://claude.ai', 'Anysphere.Cursor': 'https://cursor.com',
  'Microsoft.Teams': 'https://teams.microsoft.com', 'BlenderFoundation.Blender': 'https://blender.org', 'Bytedance.CapCut': 'https://capcut.com',
  'Python.Python.3.13': 'https://python.org',
};

function homeFor(id) {
  if (HOMES[id]) return HOMES[id];
  const pub = String(id).split('.')[0].toLowerCase().replace(/[^a-z0-9-]/g, '');
  return pub.length > 1 ? `https://${pub}.com` : '';
}

// ---------- catalog ----------
async function initSql() {
  const initSqlJs = require('sql.js/dist/sql-wasm.js');
  const wasmBinary = fs.readFileSync(require.resolve('sql.js/dist/sql-wasm.wasm'));
  return initSqlJs({ wasmBinary });
}

function rowsOf(db, sql) {
  const r = db.exec(sql);
  if (!r.length) return [];
  const { columns, values } = r[0];
  return values.map(v => Object.fromEntries(columns.map((c, i) => [c, v[i]])));
}

// Read packages out of a winget index.db (supports V2 'packages' table and V1 'manifest' layout).
function readIndex(SQL, buf) {
  const db = new SQL.Database(new Uint8Array(buf));
  try {
    const tables = rowsOf(db, "SELECT name FROM sqlite_master WHERE type='table'").map(r => r.name);
    const map = new Map();
    if (tables.includes('packages')) {
      const cols = rowsOf(db, 'PRAGMA table_info(packages)').map(r => r.name);
      if (cols.includes('id') && cols.includes('name')) {
        const verCol = cols.includes('latest_version') ? 'latest_version' : (cols.includes('version') ? 'version' : null);
        const monCol = cols.includes('moniker') ? 'moniker' : null;
        const rows = rowsOf(db, `SELECT id, name${verCol ? ', ' + verCol + ' AS ver' : ''}${monCol ? ', moniker' : ''} FROM packages`);
        for (const r of rows) if (typeof r.id === 'string') map.set(r.id, { id: r.id, name: String(r.name || r.id), ver: String(r.ver || ''), moniker: r.moniker || '' });
      }
    }
    if (!map.size && tables.includes('manifest') && tables.includes('ids')) {
      const rows = rowsOf(db, `SELECT ids.id AS id, names.name AS name, versions.version AS ver, monikers.moniker AS moniker
        FROM manifest LEFT JOIN ids ON ids.rowid = manifest.id LEFT JOIN names ON names.rowid = manifest.name
        LEFT JOIN versions ON versions.rowid = manifest.version LEFT JOIN monikers ON monikers.rowid = manifest.moniker`);
      for (const r of rows) {
        if (typeof r.id !== 'string') continue;
        const prev = map.get(r.id);
        if (!prev || cmpVer(r.ver, prev.ver) > 0) map.set(r.id, { id: r.id, name: String(r.name || r.id), ver: String(r.ver || ''), moniker: r.moniker || '' });
      }
    }
    return [...map.values()];
  } finally { db.close(); }
}

async function extractIndex(msix, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  // Windows 10+ ships bsdtar, which reads zip/msix
  // use Windows' own bsdtar (reads zip/msix); a GNU tar from Git earlier on PATH can't
  const sysTar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
  let r = await run(fs.existsSync(sysTar) ? sysTar : 'tar', ['-xf', msix, '-C', outDir, 'Public/index.db'], { timeout: 120000 });
  let db = path.join(outDir, 'Public', 'index.db');
  if (r.code === 0 && fs.existsSync(db)) return db;
  const zip = msix.replace(/\.msix$/i, '') + '.zip';
  fs.copyFileSync(msix, zip);
  r = await run('powershell', ['-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -LiteralPath '${zip.replace(/'/g, "''")}' -DestinationPath '${outDir.replace(/'/g, "''")}' -Force`], { timeout: 180000 });
  if (fs.existsSync(db)) return db;
  throw new Error('Could not unpack the winget index');
}

function decorate(items) {
  const pop = new Map(POPULAR.map((t, i) => [t, i]));
  for (const it of items) {
    it.desc = '';
    it.aka = it.moniker || ''; // searchable alias, e.g. "vscode"
    it.publisher = String(it.id).split('.')[0];
    it.home = homeFor(it.id);
    if (pop.has(it.id)) it.boost = 200 - pop.get(it.id);
  }
  return items;
}

async function fetchCatalog(cacheFile, _arch, { force = false } = {}) {
  let cached = null;
  try { cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8')); } catch {}
  const fresh = cached && cached.items && cached.items.length > 1000 && Date.now() - cached.ts < 12 * 3600e3 && cached.v === 2;
  if (fresh && !force) return { items: decorate(cached.items), ts: cached.ts, source: 'cache' };
  let lastErr;
  const SQL = await initSql();
  for (const url of SOURCES) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'grab-idx-'));
    try {
      const msix = path.join(tmp, 'source.msix');
      await download(url, msix, {});
      const dbFile = await extractIndex(msix, path.join(tmp, 'x'));
      const items = readIndex(SQL, fs.readFileSync(dbFile));
      log('winget index', url, items.length, 'packages');
      if (items.length < 1000) throw new Error('index too small: ' + items.length);
      const slim = items.map(({ id, name, ver, moniker }) => ({ id, name, ver, moniker }));
      const data = { v: 2, ts: Date.now(), items: slim };
      try { fs.writeFileSync(cacheFile, JSON.stringify(data)); } catch {}
      return { items: decorate(slim), ts: data.ts, source: 'network' };
    } catch (e) { lastErr = e; log('index source failed', url, e); }
    finally { rmrf(tmp); }
  }
  if (cached && cached.items && cached.items.length) return { items: decorate(cached.items), ts: cached.ts, source: 'stale-cache' };
  throw new Error('Could not load the app catalog. Check your internet connection. (' + (lastErr && lastErr.message) + ')');
}

// ---------- winget CLI ----------
const COMMON = ['--accept-source-agreements', '--disable-interactivity'];

async function wingetVersion() {
  const r = await run('winget', ['--version'], { timeout: 20000 });
  return r.code === 0 ? r.out.trim() : null;
}

// Parse winget's fixed-width tables (list / upgrade). Truncated ids ("Foo.Ba…") are resolved later.
function parseTable(text) {
  const lines = String(text).split(/\r?\n/).map(l => l.split('\r').pop());
  const sep = lines.findIndex(l => /^-{10,}\s*$/.test(l.trim()));
  if (sep < 1) return [];
  const header = lines[sep - 1].replace(/^[\s\-\\|/]+(?=\S)/, m => ' '.repeat(m.length));
  const starts = [];
  const re = /\S+/g; let m;
  while ((m = re.exec(header))) starts.push({ i: m.index, name: m[0].toLowerCase() });
  const rows = [];
  for (let k = sep + 1; k < lines.length; k++) {
    const l = lines[k];
    if (!l.trim()) break;
    if (/^\d+\s+\S.*(available|upgrade|package)/i.test(l.trim()) && l.length < starts[starts.length - 1].i) break;
    const cells = {};
    starts.forEach((s, j) => { cells[s.name] = l.slice(s.i, j + 1 < starts.length ? starts[j + 1].i : undefined).trim(); });
    const vals = Object.values(cells);
    rows.push({ name: vals[0] || '', id: cells.id || vals[1] || '', ver: cells.version || vals[2] || '', avail: cells.available || '', source: cells.source || '' });
  }
  return rows;
}

function resolveId(row, catalogById, items) {
  const id = row.id;
  if (catalogById.has(id)) return id;
  const trunc = /[…]$|\.\.\.$/.test(id);
  if (!trunc) return null;
  const prefix = id.replace(/(…|\.\.\.)$/, '');
  const cands = items.filter(it => it.id.startsWith(prefix));
  if (cands.length === 1) return cands[0].id;
  const byName = cands.filter(it => it.name.toLowerCase().startsWith(row.name.replace(/(…|\.\.\.)$/, '').toLowerCase()));
  return byName.length === 1 ? byName[0].id : null;
}

async function scanInstalled(items, catalogById) {
  // one at a time: parallel winget calls can fight over the source lock
  const list = await run('winget', ['list', '--source', 'winget', ...COMMON], { timeout: 180000 });
  const up = await run('winget', ['upgrade', '--source', 'winget', ...COMMON], { timeout: 180000 });
  const ups = new Map();
  for (const r of parseTable(up.out)) { const id = resolveId(r, catalogById, items); if (id) ups.set(id, r.avail || r.ver); }
  const found = [];
  for (const r of parseTable(list.out)) {
    const id = resolveId(r, catalogById, items);
    if (!id || found.some(f => f.item.id === id)) continue;
    found.push({ item: catalogById.get(id), path: null, installedVer: r.ver, update: ups.has(id), latest: ups.get(id) || '' });
  }
  for (const [id, avail] of ups) if (!found.some(f => f.item.id === id) && catalogById.has(id)) found.push({ item: catalogById.get(id), installedVer: '', update: true, latest: avail });
  found.sort((a, b) => (b.update - a.update) || a.item.name.localeCompare(b.item.name));
  return found;
}

const OK_TEXT = /Successfully installed|already installed|No available upgrade|No newer package versions|Successfully uninstalled/i;

function parseProgress(chunk, onProgress, onStage) {
  const s = String(chunk);
  const u = { KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3 };
  const m = /([\d.]+)\s*(KB|MB|GB)\s*\/\s*([\d.]+)\s*(KB|MB|GB)/i.exec(s.split('\r').filter(Boolean).pop() || s);
  if (m) onProgress({ received: parseFloat(m[1]) * u[m[2].toUpperCase()], total: parseFloat(m[3]) * u[m[4].toUpperCase()] });
  else { const p = /(\d{1,3})\s*%/.exec(s); if (p) onProgress({ pct: Math.min(100, +p[1]) }); }
  if (/Successfully verified installer hash/i.test(s)) onStage('Verified');
  if (/Starting package install|Installing/i.test(s)) onStage('Installing');
  if (/Downloading/i.test(s)) onStage('Downloading');
}

async function wingetDo(verb, id, { onProgress = () => {}, onStage = () => {}, signal } = {}) {
  const args = [verb, '--id', id, '--exact', '--source', 'winget', ...COMMON];
  if (verb !== 'uninstall') args.push('--accept-package-agreements', '--silent');
  else args.push('--silent');
  let all = '';
  const r = await run('winget', args, { onData: d => { all += d; parseProgress(d, onProgress, onStage); }, signal, timeout: 3600e3 });
  const text = all || (r.out + r.err);
  log('winget', verb, id, 'exit', r.code, text.split(/\r?\n/).map(l => l.split('\r').pop()).filter(l => l.trim()).slice(-4).join(' | '));
  if (signal && signal.aborted) throw new Error('Canceled');
  // 0x8A15002B = no applicable upgrade (already newest)
  if (r.code === 0 || OK_TEXT.test(text) || r.code === -1978335189) return { status: 'installed' };
  const lastLine = text.split(/\r?\n/).map(l => l.split('\r').pop().trim()).filter(l => l && !/^[-\\|/█▒ ]+$/.test(l)).pop() || '';
  throw new Error(lastLine ? lastLine.slice(0, 160) : `winget failed (code ${r.code})`);
}

module.exports = { POPULAR, fetchCatalog, readIndex, initSql, parseTable, resolveId, scanInstalled, wingetVersion, wingetDo, homeFor, decorate };
