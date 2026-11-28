'use strict';
// UI checks with sample data (scripts/demo-preload.js), light and dark:
//  1. the flow hover never hides a label: on every screen, every flow control is hovered (DevTools protocol), and its
//     label, icons and key caps must contrast at least 3:1 with the colour that flowed in (faint tints are skipped);
//  2. the 2.2 quality-of-life features behave: right-click menu, Undo, shortcut sheet, recent searches, sort, filters,
//     dropping a link, Enter opening the first visible result, the update row in Settings, no console errors.
// Run: xvfb-run -a npx electron scripts/ui-test.js --no-sandbox   (prints PASS/FAIL lines, exits 1 on any FAIL)
const { app, BrowserWindow, ipcMain, nativeTheme } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'grab-ui-')));
app.on('window-all-closed', () => {});
ipcMain.handle('appearance', (_e, m) => { nativeTheme.themeSource = m; });
const wait = (ms) => new Promise(r => setTimeout(r, ms));
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const FLOW = '.btn, .chip, .seg-b, .nav-btn, .clear, .ctx-i';

const PROBE = `(() => {
  const cv = document.createElement('canvas').getContext('2d');
  window.__rgba = c => { const m = String(c).match(/^color\\(srgb ([\\d.e-]+) ([\\d.e-]+) ([\\d.e-]+)(?: \\/ ([\\d.]+))?\\)/); if (m) return [m[1] * 255, m[2] * 255, m[3] * 255, m[4] === undefined ? 1 : +m[4]];
    const n = String(c).match(/rgba?\\(([^)]+)\\)/); if (n) { const p = n[1].split(/[ ,/]+/).filter(Boolean).map(parseFloat); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; }
    cv.fillStyle = '#000'; cv.fillStyle = c; const h = cv.fillStyle; if (h[0] === '#') return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16), 1]; return window.__rgba(h); };
  window.__lum = ([r, g, b]) => { const f = v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }; return .2126 * f(r) + .7152 * f(g) + .0722 * f(b); };
  window.__cr = (a, b) => { const x = __lum(a), y = __lum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
  if (!document.getElementById('__still')) { const s = document.createElement('style'); s.id = '__still'; s.textContent = 'html:root body *, html:root body *::before, html:root body *::after { transition-duration: 0s !important; transition-delay: 0s !important; animation-duration: 0s !important; animation-delay: 0s !important; }'; document.head.appendChild(s); }
  return true; })()`;
const CHECK = (i) => `(() => {
  const e = document.querySelector('[data-fi="${i}"]'); if (!e) return null;
  const f = __rgba(getComputedStyle(e, '::before').backgroundColor); if (f[3] < .5) return { skip: true };
  const name = '.' + String(e.className).trim().split(/\\s+/).join('.') + ' "' + (e.textContent || e.title || '').trim().slice(0, 24) + '"';
  const bad = [];
  const look = (el, what) => { const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return;
    const r = el.getBoundingClientRect(); if (!r.width || !r.height) return;
    const c = __rgba(cs.color); if (c[3] < .3) return;
    let bg = f; for (let n = el; n && n !== e; n = n.parentElement) { const b = __rgba(getComputedStyle(n).backgroundColor); if (b[3] >= .5) { bg = b; break; } } // a badge sits on its own fill
    const cr = __cr(c, bg); if (cr < 3) bad.push(what + ' ' + cr.toFixed(2)); };
  if ([...e.childNodes].some(n => n.nodeType === 3 && n.data.trim())) look(e, 'label');
  e.querySelectorAll('span, b, kbd, svg, small, em, i').forEach(k => { if (k.closest('svg') && k.tagName.toLowerCase() !== 'svg') return; if (k.classList.contains('fill')) return; if (k.tagName.toLowerCase() === 'svg' || [...k.childNodes].some(n => n.nodeType === 3 && n.data.trim())) look(k, k.tagName.toLowerCase()); });
  return { name, bad }; })()`;

async function audit(w, where) {
  const wc = w.webContents;
  await wc.executeJavaScript(PROBE);
  const n = await wc.executeJavaScript(`(() => { let i = 0; document.querySelectorAll('[data-fi]').forEach(x => x.removeAttribute('data-fi')); for (const e of document.querySelectorAll(${JSON.stringify(FLOW)})) { const r = e.getBoundingClientRect(); if (r.width < 4 || r.height < 4 || r.bottom < 0 || r.top > innerHeight) continue; e.setAttribute('data-fi', i++); } return i; })()`);
  const d = wc.debugger; if (!d.isAttached()) d.attach('1.3');
  await d.sendCommand('DOM.enable'); await d.sendCommand('CSS.enable');
  const { root } = await d.sendCommand('DOM.getDocument', { depth: -1 });
  const bad = []; let checked = 0;
  for (let i = 0; i < n; i++) {
    const { nodeId } = await d.sendCommand('DOM.querySelector', { nodeId: root.nodeId, selector: `[data-fi="${i}"]` }); if (!nodeId) continue;
    await d.sendCommand('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: ['hover'] }); await wait(20);
    const r = await wc.executeJavaScript(CHECK(i)).catch(() => null);
    await d.sendCommand('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: [] });
    if (!r || r.skip) continue; checked++;
    if (r.bad.length) bad.push(r.name + ': ' + r.bad.join(', '));
  }
  ok(!bad.length && checked > 0, `${where}: ${checked} flow fills checked, every label and icon contrasts with its fill` + (bad.length ? '\n   ' + bad.join('\n   ') : ''));
}

async function open(theme, q = {}) {
  nativeTheme.themeSource = theme;
  const w = new BrowserWindow({ width: 1440, height: 900, show: true, webPreferences: { preload: path.join(__dirname, 'demo-preload.js'), contextIsolation: false, sandbox: false, backgroundThrottling: false } });
  const errs = [];
  w.webContents.on('console-message', (_e, level, msg) => { if (level >= 3 && !/Failed to load resource|ERR_|net::/.test(msg)) errs.push(msg); });
  const ready = new Promise(r => w.webContents.once('dom-ready', r));
  w.loadFile(path.join(__dirname, '..', 'src', 'ui', 'index.html'), { query: { theme, ...q } }).catch(() => {});
  await ready; await wait(1400); w.focus();
  w.errs = errs;
  w.js = (s) => w.webContents.executeJavaScript(s);
  return w;
}
const click = (s) => `document.querySelector(${JSON.stringify(s)}).click()`;

app.whenReady().then(async () => {
  for (const theme of ['light', 'dark']) {
    const w = await open(theme, { upd: 'ready' });
    const steps = [['Discover', ''], ['search results', `(() => { const q = document.querySelector('#q'); q.value = 'code'; q.dispatchEvent(new Event('input')); })()`], ['Updates', click('[data-view="updates"]')],
      ['Installed', click('[data-view="installed"]')], ['Downloads', click('[data-view="downloads"]')], ['Saved', click('[data-view="saved"]')], ['Settings', click('[data-view="settings"]')],
      ['detail sheet', `${click('[data-view="discover"]')}; document.querySelector('#q').value = ''; document.querySelector('#q').dispatchEvent(new Event('input')); setTimeout(() => document.querySelector('[data-open="figma"]').click(), 300)`],
      ['right-click menu', `document.querySelector('[data-close]') && document.querySelector('[data-close]').click(); setTimeout(() => { const c = document.querySelector('.grid [data-open="discord"]'); const r = c.getBoundingClientRect(); c.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: r.left + 40, clientY: r.top + 40 })); }, 600)`],
      ['shortcut sheet', `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); document.dispatchEvent(new KeyboardEvent('keydown', { key: '?', bubbles: true }))`]];
    for (const [where, s] of steps) { if (s) await w.js(s + ';1'); await wait(1300); await audit(w, `${theme} ${where}`); }
    ok(!w.errs.length, `${theme}: no console errors` + (w.errs.length ? ': ' + w.errs.join(' | ') : ''));
    w.destroy();
  }
  // App Management and the restart screen
  for (const theme of ['light', 'dark']) {
    const w = await open(theme, { access: 'denied' }); await wait(1500);
    ok(await w.js(`!!document.querySelector('.dlg .acc-demo') && document.querySelectorAll('.acc-steps li').length === 2`), `${theme}: App Management asks on open when it is off, with the switch and two steps`);
    await audit(w, `${theme} App Management`);
    w.destroy();
  }

  // ---------- behaviour ----------
  const w = await open('light', { upd: 'ready' });
  const J = w.js;
  // right-click menu
  await J(`(() => { const c = document.querySelector('.grid [data-open="discord"]'); const r = c.getBoundingClientRect(); c.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: r.left + 40, clientY: r.top + 40 })); })()`); await wait(300);
  const items = await J(`[...document.querySelectorAll('.ctx .ctx-i span')].map(x => x.textContent)`);
  ok(items.includes('Details') && items.includes('Open website') && items.includes('Copy name') && items.some(x => /Save for later|Remove from Saved/.test(x)), `right-click menu offers ${items.join(', ')}`);
  await J(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))`);
  ok(await J(`!!document.querySelector('.ctx .ctx-i.kb')`), 'arrow keys move through the menu');
  await J(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`); await wait(100);
  ok(await J(`!document.querySelector('.ctx')`), 'Escape closes the menu');
  // save from the menu, then remove and undo
  await J(`(() => { const c = document.querySelector('.grid [data-open="discord"]'); c.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 300, clientY: 300 })); document.querySelector('[data-ctx="save"]').click(); })()`); await wait(200);
  ok(await J(`JSON.parse(localStorage.getItem('grab-saved')).includes('discord')`), 'Save for later from the menu saves the app');
  await J(`(() => { const c = document.querySelector('.grid [data-open="discord"]'); c.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 300, clientY: 300 })); document.querySelector('[data-ctx="save"]').click(); })()`); await wait(200);
  ok(await J(`!JSON.parse(localStorage.getItem('grab-saved')).includes('discord') && /removed from Saved/.test(document.querySelector('#toasts').textContent)`), 'removing it says so, with Undo');
  await J(`[...document.querySelectorAll('.toast .btn')].pop().click()`); await wait(200);
  ok(await J(`JSON.parse(localStorage.getItem('grab-saved')).includes('discord')`), 'Undo puts it back on the saved list');
  // recent searches: remove one, clear all, undo
  const rc0 = await J(`JSON.parse(localStorage.getItem('grab-recent')).length`);
  await J(`document.querySelector('[data-recent-x]').click()`); await wait(200);
  ok(await J(`JSON.parse(localStorage.getItem('grab-recent')).length`) === rc0 - 1, 'one recent search can be removed on its own');
  await J(`document.querySelector('[data-recent-clear]').click()`); await wait(200);
  ok(await J(`JSON.parse(localStorage.getItem('grab-recent')).length`) === 0, 'Clear empties recent searches');
  await J(`[...document.querySelectorAll('.toast .btn')].pop().click()`); await wait(300);
  ok(await J(`JSON.parse(localStorage.getItem('grab-recent')).length`) === rc0 - 1, 'Undo brings the recent searches back');
  // shortcut sheet
  await J(`document.dispatchEvent(new KeyboardEvent('keydown', { key: '?', bubbles: true }))`); await wait(300);
  ok(await J(`document.querySelectorAll('.dlg .keys div').length >= 12`), '? opens the shortcut sheet');
  await J(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`); await wait(200);
  await J(`document.dispatchEvent(new KeyboardEvent('keydown', { key: ',', metaKey: true, ctrlKey: true, bubbles: true }))`); await wait(400);
  ok(await J(`document.querySelector('.nav-btn.active').dataset.view === 'settings'`), 'Cmd , opens Settings');
  ok(await J(`/Restart to update/.test(document.querySelector('#upd-acts').textContent) && /downloaded and checked/.test(document.querySelector('#upd-line').textContent)`), 'Settings shows a ready update with Restart to update');
  ok(await J(`!document.querySelector('[data-accent]')`), 'the colour picker is gone: one accent');
  // arrow keys through the cards
  await J(click('[data-view="discover"]')); await wait(500);
  await J(`document.activeElement.blur(); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))`);
  const f1 = await J(`document.activeElement.dataset.open || document.activeElement.dataset.pack || ''`);
  await J(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))`);
  const f2 = await J(`document.activeElement.dataset.open || document.activeElement.dataset.pack || ''`);
  ok(f1 && f2 && f1 !== f2, `arrow keys walk the apps (${f1} then ${f2})`);
  // installed: sort and filter with an empty state
  await J(click('[data-view="installed"]')); await wait(500);
  await J(click('[data-inst-sort="updates"]')); await wait(300);
  const firstUp = await J(`!!document.querySelector('#inst-list .rowi .pill.up') && document.querySelector('#inst-list .rowi').contains(document.querySelector('#inst-list .rowi .pill.up'))`);
  ok(firstUp && await J(`localStorage.getItem('grab-inst-sort') === 'updates'`), 'Updates first puts apps with an update on top, and is remembered');
  await J(`(() => { const f = document.querySelector('#inst-filter'); f.value = 'zzzz'; f.dispatchEvent(new Event('input', { bubbles: true })); })()`); await wait(200);
  ok(await J(`!document.querySelector('#inst-none').hidden`), 'a filter with no match says so');
  await J(click('[data-filter-clear]')); await wait(200);
  ok(await J(`document.querySelector('#inst-none').hidden && document.querySelector('#inst-filter').value === ''`), 'Clear the filter brings the list back');
  // saved filter
  await J(click('[data-view="saved"]')); await wait(800);
  await J(`(() => { const f = document.querySelector('#saved-filter'); f.value = 'fig'; f.dispatchEvent(new Event('input', { bubbles: true })); })()`); await wait(200);
  ok(await J(`[...document.querySelectorAll('#saved-grid .card')].filter(c => !c.hidden).length === 1`), 'the saved list filters by name');
  // drop a link
  await J(`(() => { const dt = new DataTransfer(); dt.setData('text/uri-list', 'https://example.com/App-1.2.dmg'); document.body.dispatchEvent(new DragEvent('dragenter', { bubbles: true, dataTransfer: dt })); })()`); await wait(100);
  ok(await J(`!!document.querySelector('.drop-hint')`), 'dragging a link shows where to drop it');
  await J(`(() => { const dt = new DataTransfer(); dt.setData('text/uri-list', 'https://example.com/App-1.2.dmg'); document.body.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt })); })()`); await wait(400);
  ok(await J(`!document.querySelector('.drop-hint') && !!document.querySelector('[data-url="https://example.com/App-1.2.dmg"]')`), 'dropping a link opens the paste-a-link card');
  // Enter opens the first result you can see (Free apps only hides paid ones)
  await J(`(() => { const q = document.querySelector('#q'); q.value = 'bartender'; q.dispatchEvent(new Event('input')); })()`); await wait(400);
  await J(click('[data-free]')); await wait(300);
  ok(await J(`!!document.querySelector('.chip.tog.on') && !document.querySelector('.grid [data-open="bartender"]')`), 'Free apps only hides the paid result');
  await J(`document.querySelector('#q').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`); await wait(600);
  ok(await J(`document.querySelector('#sheet').hidden`), 'Enter does not open a paid app that Free apps only hides');
  // clicking the section you are on scrolls back to the top
  await J(`(() => { const q = document.querySelector('#q'); q.value = ''; q.dispatchEvent(new Event('input')); })()`); await wait(400);
  await J(`document.querySelector('#view').scrollTop = 900`); await wait(100);
  await J(click('[data-view="discover"]')); await wait(900);
  ok(await J(`document.querySelector('#view').scrollTop < 5`), 'clicking the section you are on goes back to its top');
  ok(!w.errs.length, 'no console errors during the feature checks' + (w.errs.length ? ': ' + w.errs.join(' | ') : ''));
  w.destroy();

  console.log(fails ? `FAILED ${fails}` : 'ALL PASS');
  app.exit(fails ? 1 : 0);
}).catch(e => { console.log('FAIL the test itself crashed: ' + (e && e.stack || e)); console.log('FAILED'); app.exit(1); });
