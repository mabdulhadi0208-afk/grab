'use strict';
// Screenshots of every main screen, light and dark, with sample data (scripts/demo-preload.js).
// Run: xvfb-run -a npx electron scripts/shots.js --no-sandbox   (writes PNGs at 2x to $GRAB_SHOTS or /tmp/grab-shots)
const { app, BrowserWindow, ipcMain, nativeTheme } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

app.commandLine.appendSwitch('force-device-scale-factor', '2');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'grab-shots-')));
const OUT = process.env.GRAB_SHOTS || '/tmp/grab-shots';
const W = 1440, H = 900;
app.on('window-all-closed', () => {}); // one window per shot: keep running between them
ipcMain.handle('appearance', (_e, m) => { nativeTheme.themeSource = m; });

const click = (s) => `document.querySelector(${JSON.stringify(s)}).click()`;
const SHOTS = [
  ['discover', { upd: 'downloading' }, []],
  ['search', {}, [`(() => { const q = document.querySelector('#q'); q.value = 'code'; q.dispatchEvent(new Event('input')); })()`]],
  ['pack', {}, [click('[data-pack="dev"]')]],
  ['detail', {}, [click('[data-open="figma"]')]],
  ['updates', { upd: 'ready' }, [click('[data-view="updates"]')]],
  ['installed', {}, [click('[data-view="installed"]')]],
  ['downloads', { upd: 'downloading' }, [click('[data-view="downloads"]'), `setTimeout(() => __demo.emit('job', { id: 9, itemId: 'raycast', name: 'Raycast', verb: 'install', state: 'done', result: 'installed', pct: 100, msg: 'Installed', created: Date.now() - 999999 }), 2400)`]],
  ['saved', {}, [click('[data-view="saved"]')]],
  ['settings', { upd: 'ready' }, [click('[data-view="settings"]')]],
  ['whats-new', {}, [click('[data-view="settings"]'), `setTimeout(() => document.querySelector('[data-whatsnew]').click(), 300)`]],
  ['uninstall-dialog', {}, [click('[data-view="installed"]'), `setTimeout(() => document.querySelector('[data-remove="discord"]').click(), 300)`]],
  ['access', { access: 'denied' }, []],
  ['restart', { upd: 'installing' }, []],
  ['offline', { offline: '1' }, []],
  ['downloads-empty', { jobs: '0' }, [click('[data-view="downloads"]')]],
  ['menu', {}, [`document.querySelector('#view').scrollTop = 700`, `(() => { const c = document.querySelector('.grid [data-open="figma"]'); const r = c.getBoundingClientRect(); c.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: r.left + 120, clientY: r.top + 60 })); })()`]],
  ['shortcuts', {}, [`document.dispatchEvent(new KeyboardEvent('keydown', { key: '?', bubbles: true }))`]],
];
const ONLY = (process.env.GRAB_ONLY || '').split(',').filter(Boolean);
const wait = (ms) => new Promise(r => setTimeout(r, ms));

app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  for (const theme of ['light', 'dark']) {
    nativeTheme.themeSource = theme;
    for (const [name, q, steps] of SHOTS) {
      if (ONLY.length && !ONLY.includes(name)) continue;
      const w = new BrowserWindow({ width: W, height: H, useContentSize: true, show: true, backgroundColor: theme === 'dark' ? '#0d0c0a' : '#f6f3ed', webPreferences: { preload: path.join(__dirname, 'demo-preload.js'), contextIsolation: false, sandbox: false } });
      w.webContents.on('console-message', (_e, level, msg) => { if (level >= 2) console.log(`[${name}] console`, level, msg); });
      const ready = new Promise(r => w.webContents.once('dom-ready', r));
      w.loadFile(path.join(__dirname, '..', 'src', 'ui', 'index.html'), { query: { ...q, theme } }).catch(e => console.log('load failed', name, e.message));
      await ready; // not 'load': that also waits for every app icon to arrive over the network
      await wait(1500);
      for (const s of steps) { await w.webContents.executeJavaScript(s + ';1').catch(e => console.log('step failed', name, e.message)); await wait(400); }
      w.focus();
      await wait(3200);
      // settle every one-shot entrance (a busy machine can otherwise hand back a frame from mid-animation); the hero dots keep drifting
      await w.webContents.executeJavaScript(`new Promise(r => { for (const a of document.getAnimations()) { const t = a.effect && a.effect.getTiming(); if (t && t.iterations !== Infinity) { try { a.finish(); } catch {} } } requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 600))); })`).catch(() => {});
      const img = await w.webContents.capturePage();
      const f = path.join(OUT, `grab-${name}-${theme}.png`);
      fs.writeFileSync(f, img.toPNG());
      console.log('saved', f, img.getSize());
      w.destroy();
    }
  }
  app.quit();
});
