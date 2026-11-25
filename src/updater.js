'use strict';
// Auto update, ported from Surge: GitHub Releases -> background download -> verify -> stage -> swap -> relaunch (with rollback).
// State machine: idle -> checking -> available -> downloading -> unpacking -> ready -> installing   (error -> retried on next poll)
const { app, net, powerMonitor } = require('electron');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const U = require('./util');

const REPO = 'mabdulhadi0208-afk/grab';
const IS_WIN = process.platform === 'win32';
const ASSET = IS_WIN ? 'Grab-win-x64.exe' : `Grab-mac-${process.arch}.zip`;
const POLL_MS = 60 * 1000;

const state = { status: 'idle', latest: null, url: null, size: 0, progress: 0, bytes: 0, speed: 0, error: null, staged: null, justUpdated: null };
let send = () => {}, timer = null, lastTag = null, polling = false, abortCtl = null, lastFocus = 0;

const updDir = () => path.join(app.getPath('userData'), 'update');
const flagFile = () => path.join(app.getPath('userData'), 'just-updated');
const ver = (v) => String(v || '').replace(/^v/, '');
const newer = (a, b) => U.cmpVer(ver(a), ver(b)) > 0;
const same = (a, b) => U.cmpVer(ver(a), ver(b)) === 0;
function log(...a) { U.log('updater:', ...a); }
function pub() { const { staged, ...s } = state; return { ...s, ready: !!staged, current: app.getVersion() }; }
function set(p) { Object.assign(state, p); send('updater', pub()); }

function bundlePath() {
  const p = process.execPath, i = p.indexOf('.app/Contents/MacOS/');
  return i > 0 ? p.slice(0, i + 4) : null;
}
function stagedVersion(appPath) {
  try {
    if (IS_WIN) return state.latest ? ver(state.latest) : null;
    const pl = fs.readFileSync(path.join(appPath, 'Contents', 'Info.plist'), 'utf8');
    return (/CFBundleShortVersionString<\/key>\s*<string>([^<]+)/.exec(pl) || [])[1] || null;
  } catch { return null; }
}
function clearStaged() { U.rmrf(updDir()); state.staged = null; }

// Latest tag via the releases/latest redirect: no API key, no API rate limit.
async function latestTag() {
  try {
    const res = await net.fetch(`https://github.com/${REPO}/releases/latest`, { method: 'HEAD', redirect: 'manual' });
    const loc = res.headers.get('location') || res.url || '';
    const m = /\/tag\/([^/?#\s]+)/.exec(loc);
    if (m) return decodeURIComponent(m[1]);
  } catch {}
  try { // fallback: REST API
    const res = await net.fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { 'User-Agent': 'Grab', Accept: 'application/vnd.github+json' } });
    if (res.ok) return (await res.json()).tag_name || null;
  } catch {}
  return null;
}
async function probe(url) {
  try {
    const res = await net.fetch(url, { method: 'HEAD', redirect: 'follow' });
    return { ok: res.ok, size: Number(res.headers.get('content-length')) || 0 };
  } catch { return { ok: false, size: 0 }; }
}

async function check(manual = false) {
  if (['downloading', 'unpacking', 'installing', 'checking'].includes(state.status)) return pub();
  set({ status: 'checking', error: null });
  try {
    const latest = await latestTag();
    if (!latest) throw new Error('GitHub did not answer');
    lastTag = latest;
    if (!newer(latest, app.getVersion())) { if (state.staged) clearStaged(); set({ status: 'uptodate', latest }); return pub(); }
    if (state.staged) {
      const sv = stagedVersion(state.staged);
      if (sv && same(sv, latest)) { set({ status: 'ready', latest }); return pub(); }
      log('discarding stale staged copy', sv); clearStaged();
    }
    const url = `https://github.com/${REPO}/releases/download/${latest}/${ASSET}`;
    const p = await probe(url);
    if (!p.ok) throw new Error(`${latest} is published but its file is not ready yet`);
    set({ status: 'available', latest, url, size: p.size, progress: 0, bytes: 0 });
    log('available', latest, (p.size / 1048576).toFixed(1) + ' MB');
    download(); // always in the background, like Surge
  } catch (e) { set({ status: 'error', error: e.message }); log('check failed:', e.message); lastTag = null; }
  return pub();
}

async function download() {
  if (!state.url || ['downloading', 'unpacking', 'installing'].includes(state.status)) return;
  const dir = updDir(); U.rmrf(dir); fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, ASSET);
  try {
    set({ status: 'downloading', progress: 0, bytes: 0, speed: 0 });
    let ok = false, err = null;
    for (let i = 0; i < 3 && !ok; i++) { // 3 attempts
      abortCtl = new AbortController();
      try {
        await U.download(state.url, file, { signal: abortCtl.signal, onProgress: (p) => set({ bytes: p.received, speed: p.speed || 0, progress: (p.total || state.size) ? Math.min(99, Math.round(p.received / (p.total || state.size) * 100)) : 0 }) });
        ok = true;
      } catch (e) { err = e; log('download attempt', i + 1, 'failed:', e.message); if (abortCtl.signal.aborted) break; await new Promise(r => setTimeout(r, 1500)); }
    }
    abortCtl = null;
    if (!ok) throw err || new Error('download failed');
    if (state.size && fs.statSync(file).size !== state.size) throw new Error('download incomplete');
    set({ progress: 100, status: 'unpacking' });
    if (IS_WIN) { state.staged = file; set({ status: 'ready' }); log('staged installer', state.latest); return; }
    const r = await U.run('/usr/bin/ditto', ['-x', '-k', file, dir], { timeout: 300000 });
    if (r.code !== 0) throw new Error('could not unpack the update');
    const appName = fs.readdirSync(dir).find(f => f.endsWith('.app'));
    if (!appName) throw new Error('no app in the update');
    if (appName !== 'Grab.app') fs.renameSync(path.join(dir, appName), path.join(dir, 'Grab.app'));
    U.rmrf(file);
    const staged = path.join(dir, 'Grab.app'), sv = stagedVersion(staged);
    if (!sv || !same(sv, state.latest)) throw new Error(`unpacked version mismatch (${sv})`);
    await U.run('/usr/bin/xattr', ['-cr', staged]);
    state.staged = staged;
    set({ status: 'ready' });
    log('staged', state.latest);
  } catch (e) {
    abortCtl = null;
    if (state.status === 'available' && /Canceled/i.test(String(e && e.message))) { log('download canceled'); return; } // the user hit Cancel: not an error
    set({ status: 'error', error: e.message }); log('download failed:', e.message);
  }
}

function install() {
  if (!state.staged) {
    // 'error' after a failed check has no download link yet: check again instead of doing nothing
    if (state.status === 'available' || (state.status === 'error' && state.url)) download();
    else if (state.status === 'error') check(true);
    return pub();
  }
  const logf = path.join(app.getPath('logs'), 'update.log');
  try { fs.writeFileSync(flagFile(), ver(state.latest)); } catch {}
  if (IS_WIN) {
    // NSIS /S replaces the app in place and --force-run relaunches it. Retry up to 4x, make sure Grab is running after, reopen the old one if all fail.
    const exe = process.execPath, cmd = path.join(updDir(), 'update.cmd');
    fs.writeFileSync(cmd, ['@echo off', 'setlocal', 'set GRAB_SELFTEST=', 'set GRAB_UPDATE_ZIP=', `set "LOG=${logf}"`, `echo === %DATE% %TIME% swapping to ${state.latest} >> "%LOG%"`, 'timeout /t 2 /nobreak >nul', 'set N=0', ':try',
      `"${state.staged}" /S --force-run`, 'set RC=%ERRORLEVEL%', 'echo installer exit %RC% >> "%LOG%"', 'if "%RC%"=="0" goto ok', 'set /a N+=1', 'if %N% GEQ 4 goto fail', 'timeout /t 3 /nobreak >nul', 'goto try',
      ':ok', 'timeout /t 6 /nobreak >nul', `tasklist /FI "IMAGENAME eq Grab.exe" | find /I "Grab.exe" >nul || start "" "${exe}"`, 'echo launched OK >> "%LOG%"', 'exit /b 0',
      ':fail', 'echo all attempts failed, reopening the current version >> "%LOG%"', `start "" "${exe}"`, 'exit /b 1'].join('\r\n'));
    set({ status: 'installing' }); log('installing (windows)', state.latest);
    spawn('cmd.exe', ['/c', cmd], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    setTimeout(() => app.exit(0), 400);
    return pub();
  }
  const sv = stagedVersion(state.staged);
  if (!sv || !(newer(sv, app.getVersion()) || process.env.__GRAB_SWAP_TEST)) { clearStaged(); set({ status: 'error', error: 'staged copy was not newer' }); return pub(); }
  const target = bundlePath();
  if (!target) { set({ status: 'error', error: 'Not running from an app bundle' }); return pub(); }
  try { fs.accessSync(path.dirname(target), fs.constants.W_OK); } catch { set({ status: 'error', error: 'Grab is in a protected folder. Move it to Applications.' }); return pub(); }
  const script = path.join(updDir(), 'swap.sh');
  fs.writeFileSync(script, `#!/bin/bash
exec >> "${logf}" 2>&1
unset GRAB_SELFTEST GRAB_UPDATE_ZIP __GRAB_SWAP_TEST
echo "=== $(date) swapping ${app.getVersion()} -> ${sv}"
NEW="${state.staged}"; APP="${target}"; OLDPID=${process.pid}
for i in $(seq 1 40); do kill -0 $OLDPID 2>/dev/null || break; sleep 0.1; done
kill -0 $OLDPID 2>/dev/null && { echo "old pid still alive, SIGTERM"; kill -TERM $OLDPID 2>/dev/null; sleep 1; }
kill -0 $OLDPID 2>/dev/null && { echo "old pid stuck, SIGKILL"; kill -KILL $OLDPID 2>/dev/null; sleep 0.5; }
rm -rf "$APP.old"; mv "$APP" "$APP.old" || { echo "mv failed"; open -a "$APP"; exit 1; }
if mv "$NEW" "$APP" 2>/dev/null || ditto "$NEW" "$APP"; then xattr -cr "$APP" 2>/dev/null; echo "swapped"; else echo "swap failed, rolling back"; rm -rf "$APP"; mv "$APP.old" "$APP"; fi
open -a "$APP" || ("$APP/Contents/MacOS/Grab" >/dev/null 2>&1 & disown)
for i in $(seq 1 40); do pgrep -f "$APP/Contents/MacOS/Grab" >/dev/null && break; sleep 0.25; done
if pgrep -f "$APP/Contents/MacOS/Grab" >/dev/null; then echo "launched OK"; rm -rf "$APP.old"; else echo "launch failed, restoring old"; rm -rf "$APP"; mv "$APP.old" "$APP" 2>/dev/null; open -a "$APP"; fi
sleep 8; pgrep -f "$APP/Contents/MacOS/Grab" >/dev/null || { echo "no Grab running after swap, relaunching"; open -a "$APP"; }
echo "=== done"
`);
  fs.chmodSync(script, 0o755);
  set({ status: 'installing' }); log('installing', sv);
  spawn('/bin/bash', [script], { detached: true, stdio: 'ignore', env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME: process.env.HOME || '' } }).unref();
  setTimeout(() => app.exit(0), 150);
  setTimeout(() => { try { process.kill(process.pid, 'SIGKILL'); } catch {} }, 2500); // if Electron won't die, make it
  return pub();
}

async function poll() {
  if (polling || ['downloading', 'unpacking', 'installing', 'checking'].includes(state.status)) return;
  polling = true;
  const tag = await latestTag().finally(() => { polling = false; });
  if (!tag || tag === lastTag) return;
  lastTag = tag;
  if (newer(tag, app.getVersion())) check(false);
  else if (state.status === 'idle') set({ status: 'uptodate', latest: tag });
}

function cancel() {
  if (state.status !== 'downloading') return pub(); // nothing to cancel: keep the real state (a ready update stays ready)
  try { abortCtl && abortCtl.abort(); } catch {}
  set({ status: 'available', progress: 0, bytes: 0, speed: 0 });
  return pub();
}

// Stage a local zip as if it were a downloaded update (CI release gate).
async function selfTestSwap(zip) {
  const dir = updDir(); U.rmrf(dir); fs.mkdirSync(dir, { recursive: true });
  const r = await U.run('/usr/bin/ditto', ['-x', '-k', zip, dir], { timeout: 300000 });
  if (r.code !== 0) throw new Error('unzip failed');
  state.staged = path.join(dir, 'Grab.app'); state.latest = 'v' + app.getVersion();
  process.env.__GRAB_SWAP_TEST = '1';
  return install();
}

function start(sender, { autoCheck = true } = {}) {
  send = sender;
  try {
    if (fs.existsSync(flagFile())) {
      const v = fs.readFileSync(flagFile(), 'utf8').trim(); fs.rmSync(flagFile());
      state.justUpdated = app.getVersion(); log('updated to', app.getVersion(), '(expected', v + ')');
    }
  } catch {}
  // resume a staged update from a previous run
  const staged = IS_WIN ? path.join(updDir(), ASSET) : path.join(updDir(), 'Grab.app');
  if (!IS_WIN && fs.existsSync(staged)) { const sv = stagedVersion(staged); if (sv && newer(sv, app.getVersion())) { state.staged = staged; state.status = 'ready'; state.latest = 'v' + sv; } else clearStaged(); }
  else if (IS_WIN) clearStaged();
  if (!autoCheck) return;
  setTimeout(() => check(false), 3000);
  timer = setInterval(poll, POLL_MS);
  try { powerMonitor.on('resume', () => setTimeout(() => check(false), 8000)); } catch {}
  app.on('browser-window-focus', () => { if (Date.now() - lastFocus > 5 * 60e3) { lastFocus = Date.now(); poll(); } });
}

module.exports = { start, check, download, install, cancel, state: pub, selfTestSwap };
