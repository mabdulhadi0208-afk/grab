'use strict';
// Speed check with sample data (scripts/demo-preload.js): time to the first app card, the time each section takes to
// switch, and frame times while the main view scrolls, light and dark. Lower is better; compare before and after UI work.
// Run: xvfb-run -a npx electron scripts/perf.js --no-sandbox   (GRAB_UI=<dir> measures another copy of src/ui)
const { app, BrowserWindow, ipcMain, nativeTheme } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'grab-perf-')));
const UI = process.env.GRAB_UI || path.join(__dirname, '..', 'src', 'ui');
const RUNS = +(process.env.GRAB_PERF_RUNS || 3);
app.on('window-all-closed', () => {}); // one window per run: keep going between them
ipcMain.handle('appearance', (_e, m) => { nativeTheme.themeSource = m; });
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

const MEASURE = `(async () => {
  const raf2 = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  const out = { firstCard: 0, switches: {}, scroll: null };
  const t0 = performance.now();
  while (!document.querySelector('.card')) { await new Promise(r => setTimeout(r, 5)); if (performance.now() - t0 > 10000) break; }
  out.firstCard = Math.round(performance.now());
  await new Promise(r => setTimeout(r, 1200));
  for (const v of ['updates', 'installed', 'downloads', 'saved', 'settings', 'discover']) {
    const b = document.querySelector('[data-view="' + v + '"]');
    const s = performance.now(); b.click(); await raf2(); out.switches[v] = +(performance.now() - s).toFixed(1);
    await new Promise(r => setTimeout(r, 500));
  }
  const view = document.querySelector('#view'); view.scrollTop = 0; await raf2();
  const fr = []; let last = performance.now();
  for (let i = 0; i < 120; i++) { view.scrollTop += 24; await new Promise(r => requestAnimationFrame(r)); const n = performance.now(); fr.push(n - last); last = n; if (view.scrollTop + view.clientHeight >= view.scrollHeight - 2) view.scrollTop = 0; }
  fr.sort((a, b) => a - b);
  out.scroll = { avg: +(fr.reduce((a, b) => a + b, 0) / fr.length).toFixed(2), p95: +fr[Math.floor(fr.length * .95)].toFixed(2), max: +fr[fr.length - 1].toFixed(2) };
  out.nodes = document.getElementsByTagName('*').length;
  return out;
})()`;

app.whenReady().then(async () => {
  const res = { light: [], dark: [] };
  for (const theme of ['light', 'dark']) {
    for (let r = 0; r < RUNS; r++) {
      nativeTheme.themeSource = theme;
      const w = new BrowserWindow({ width: 1280, height: 800, show: true, webPreferences: { preload: path.join(__dirname, 'demo-preload.js'), contextIsolation: false, sandbox: false, backgroundThrottling: false } });
      const ready = new Promise(r => w.webContents.once('dom-ready', r)); // not 'load': that waits for every icon
      w.loadFile(path.join(UI, 'index.html'), { query: { theme, upd: 'none' } }).catch(() => {});
      await ready;
      w.focus();
      res[theme].push(await w.webContents.executeJavaScript(MEASURE));
      w.destroy(); await wait(300);
    }
  }
  const sum = {};
  for (const theme of ['light', 'dark']) {
    const L = res[theme];
    sum[theme] = { firstCardMs: med(L.map(x => x.firstCard)), switchMs: med(L.map(x => Object.values(x.switches).reduce((a, b) => a + b, 0) / 6)).toFixed(1), switchMaxMs: med(L.map(x => Math.max(...Object.values(x.switches)))), scrollAvgMs: med(L.map(x => x.scroll.avg)), scrollP95Ms: med(L.map(x => x.scroll.p95)), scrollMaxMs: med(L.map(x => x.scroll.max)), domNodes: med(L.map(x => x.nodes)) };
  }
  console.log('PERF ' + JSON.stringify(sum));
  if (process.env.GRAB_PERF_OUT) fs.writeFileSync(process.env.GRAB_PERF_OUT, JSON.stringify({ sum, res }, null, 1));
  app.quit();
});
