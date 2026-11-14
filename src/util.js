'use strict';
// Shared helpers: logging, process spawning, streaming downloads with progress + sha256, version compare.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

let LOG_FILE = null;
function setLogFile(f) {
  LOG_FILE = f;
  try { fs.mkdirSync(path.dirname(f), { recursive: true }); } catch {}
  try { // keep the log small
    if (fs.existsSync(f) && fs.statSync(f).size > 2 * 1024 * 1024) fs.renameSync(f, f + '.old');
  } catch {}
}
function log(...a) {
  const line = `[${new Date().toISOString()}] ${a.map(x => (typeof x === 'string' ? x : (x && x.stack) || JSON.stringify(x))).join(' ')}`;
  try { if (LOG_FILE) fs.appendFileSync(LOG_FILE, line + '\n'); } catch {}
  if (process.env.GRAB_SELFTEST || process.env.GRAB_DEBUG) { try { process.stdout.write(line + '\n'); } catch {} }
}

// Run a command, collect output. Never throws on exit code; returns {code, out, err}.
function run(cmd, args = [], opts = {}) {
  return new Promise((resolve) => {
    let out = '', err = '', done = false;
    let p;
    try {
      p = spawn(cmd, args, { windowsHide: true, ...opts, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) { return resolve({ code: -1, out: '', err: String(e && e.message || e) }); }
    const timer = opts.timeout ? setTimeout(() => { try { p.kill('SIGKILL'); } catch {} }, opts.timeout) : null;
    p.stdout.on('data', d => { out += d; if (opts.onData) opts.onData(String(d)); });
    p.stderr.on('data', d => { err += d; if (opts.onData) opts.onData(String(d)); });
    p.on('error', e => { if (done) return; done = true; if (timer) clearTimeout(timer); resolve({ code: -1, out, err: err + String(e.message || e) }); });
    p.on('close', code => { if (done) return; done = true; if (timer) clearTimeout(timer); resolve({ code: code == null ? -1 : code, out, err }); });
    if (opts.input != null) { try { p.stdin.write(opts.input); } catch {} }
    try { p.stdin.end(); } catch {}
    if (opts.signal) opts.signal.addEventListener('abort', () => { try { p.kill(); } catch {} }, { once: true });
  });
}

const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// Stream a URL to a file. fetchImpl defaults to Electron's net.fetch (follows redirects, uses system proxy/certs).
async function download(url, dest, { headers = {}, onProgress, signal, fetchImpl } = {}) {
  const f = fetchImpl || globalThis.__grabFetch || globalThis.fetch;
  const res = await f(url, { headers: { 'User-Agent': BROWSER_UA, Accept: '*/*', ...headers }, redirect: 'follow', signal });
  if (!res.ok) throw new Error(`Download failed (HTTP ${res.status})`);
  const total = Number(res.headers.get('content-length')) || 0;
  const finalUrl = res.url || url;
  const disp = res.headers.get('content-disposition') || '';
  const hash = crypto.createHash('sha256');
  const out = fs.createWriteStream(dest);
  let received = 0, lastEmit = 0, lastBytes = 0, lastT = Date.now(), speed = 0;
  const reader = res.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const buf = Buffer.from(value);
      hash.update(buf);
      received += buf.length;
      if (!out.write(buf)) await new Promise(r => out.once('drain', r));
      const now = Date.now();
      if (now - lastEmit > 120) {
        const dt = (now - lastT) / 1000;
        if (dt >= 0.5) { speed = (received - lastBytes) / dt; lastBytes = received; lastT = now; }
        lastEmit = now;
        if (onProgress) onProgress({ received, total, speed });
      }
    }
  } catch (e) {
    out.destroy();
    throw signal && signal.aborted ? new Error('Canceled') : e;
  }
  await new Promise((resolve, reject) => { out.end(resolve); out.on('error', reject); });
  if (onProgress) onProgress({ received, total: total || received, speed });
  return { sha256: hash.digest('hex'), size: received, finalUrl, disposition: disp };
}

// Pick a sensible file name from URL / Content-Disposition.
function fileNameFor(url, disposition) {
  const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition || '');
  if (m) return sanitize(decodeURIComponent(m[1]));
  try {
    const u = new URL(url);
    const base = decodeURIComponent(path.posix.basename(u.pathname || '')) || 'download';
    return sanitize(base);
  } catch { return 'download'; }
}
function sanitize(n) { return String(n).replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 120) || 'download'; }

// Loose version compare: 1.10.0 > 1.9; ignores build suffixes after ',' (Homebrew style).
function cmpVer(a, b) {
  const pa = String(a || '').split(',')[0].split(/[^0-9]+/).filter(Boolean).map(Number);
  const pb = String(b || '').split(',')[0].split(/[^0-9]+/).filter(Boolean).map(Number);
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}
function looksNumericVer(v) { return /^\d+(\.\d+)*/.test(String(v || '').trim()); }

// Run async tasks with a concurrency limit.
async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const k = i++; try { out[k] = await fn(items[k], k); } catch (e) { out[k] = undefined; } }
  }));
  return out;
}

function rmrf(p) { try { fs.rmSync(p, { recursive: true, force: true }); } catch {} }

module.exports = { setLogFile, log, run, download, fileNameFor, cmpVer, looksNumericVer, pool, rmrf, BROWSER_UA };
