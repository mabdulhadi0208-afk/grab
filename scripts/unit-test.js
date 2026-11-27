'use strict';
// Plain-node tests for the pieces that don't need Electron. Run: node scripts/unit-test.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const U = require('../src/util');
const { prepare, search } = require('../src/search');
const mac = require('../src/mac');
const win = require('../src/win');

let pass = 0;
async function t(name, fn) { try { await fn(); pass++; console.log('ok  ', name); } catch (e) { console.error('FAIL', name, '\n', e); process.exitCode = 1; } }

(async () => {
  await t('App Management check', () => {
    assert.strictEqual(mac.appManagement({ platform: 'win32' }), 'allowed');
    assert.strictEqual(mac.appManagement({ platform: 'darwin', major: 21 }), 'allowed');   // before Ventura there is no switch
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'grab-am-'));
    assert.strictEqual(mac.appManagement({ platform: 'darwin', major: 24, dirs: [root] }), 'unknown');   // no app to check with
    const app = path.join(root, 'Notes Plus.app', 'Contents'); fs.mkdirSync(app, { recursive: true });
    assert.strictEqual(mac.appManagement({ platform: 'darwin', major: 24, dirs: [root] }), 'allowed');
    assert.deepStrictEqual(fs.readdirSync(app), [], 'the check leaves the app exactly as it was');
    if (process.getuid && process.getuid() !== 0) {   // a locked app folder reads as not allowed (root ignores the lock)
      fs.chmodSync(app, 0o555);
      assert.strictEqual(mac.appManagement({ platform: 'darwin', major: 24, dirs: [root] }), 'denied');
      fs.chmodSync(app, 0o755);
    }
    fs.rmSync(root, { recursive: true, force: true });
  });

  await t('cmpVer', () => {
    assert.strictEqual(U.cmpVer('1.10.0', '1.9'), 1);
    assert.strictEqual(U.cmpVer('157.0.8103.79', '157.0.8103.79'), 0);
    assert.strictEqual(U.cmpVer('0.0.422', '0.0.430'), -1);
    assert.strictEqual(U.cmpVer('2.3,1234', '2.3'), 0);
  });

  await t('fileNameFor', () => {
    assert.strictEqual(U.fileNameFor('https://x.com/a/Foo%20Bar.dmg?x=1', ''), 'Foo Bar.dmg');
    assert.strictEqual(U.fileNameFor('https://x.com/dl', 'attachment; filename="App-1.2.zip"'), 'App-1.2.zip');
  });

  // a realistic slice of the Homebrew cask JSON
  const RAW = [
    { token: 'google-chrome', name: ['Google Chrome'], desc: 'Web browser', homepage: 'https://www.google.com/chrome/', url: 'https://dl.google.com/chrome/mac/universal/stable/GGRO/googlechrome.dmg', version: '157.0.8103.79', sha256: 'no_check', url_specs: {}, artifacts: [{ app: ['Google Chrome.app'] }, { zap: [{ trash: [] }] }], variations: {} },
    { token: 'google-chrome@beta', name: ['Google Chrome Beta'], desc: 'Web browser', homepage: 'https://www.google.com/chrome/beta/', url: 'https://dl.google.com/chrome/mac/beta/googlechromebeta.dmg', version: '158.0', sha256: 'no_check', artifacts: [{ app: ['Google Chrome Beta.app'] }] },
    { token: 'chrome-remote-desktop-host', name: ['Chrome Remote Desktop'], desc: 'Remote access', homepage: 'https://remotedesktop.google.com/', url: 'https://dl.google.com/crd.dmg', version: '1', sha256: 'no_check', artifacts: [{ pkg: ['crd.pkg'] }] },
    { token: 'google-chrome@dev', name: ['Google Chrome Dev'], desc: 'Web browser', homepage: 'https://www.google.com/chrome/dev/', url: 'https://dl.google.com/dev.dmg', version: '1', sha256: 'no_check', artifacts: [{ app: ['Google Chrome Dev.app'] }] },
    { token: 'chromium', name: ['Chromium'], desc: 'Free and open-source web browser', homepage: 'https://www.chromium.org/', url: 'https://x/chromium.zip', version: '1', sha256: 'a'.repeat(64), artifacts: [{ app: ['chrome-mac/Chromium.app'] }] },
    { token: 'discord', name: ['Discord'], desc: 'Voice and text chat software', homepage: 'https://discord.com/', url: 'https://stable.dl2.discordapp.net/apps/osx/0.0.422/Discord.dmg', version: '0.0.422', sha256: '6fedd6856cbc48656704dfc718d52114e12ffae9ae904d429ae6e1ded2081fa2', artifacts: [{ uninstall: [{}] }, { app: ['Discord.app'] }, { zap: [{}] }], variations: { x86_64_linux: { url: null }, arm64_linux: { url: null } } },
    { token: 'visual-studio-code', name: ['Microsoft Visual Studio Code', 'VS Code'], desc: 'Open-source code editor', homepage: 'https://code.visualstudio.com/', url: 'https://update.code.visualstudio.com/1.0/darwin-arm64/stable', version: '1.0', sha256: 'b'.repeat(64), artifacts: [{ app: ['Visual Studio Code.app'] }, { binary: ['code'] }], variations: { sequoia: { url: 'https://update.code.visualstudio.com/1.0/darwin/stable', sha256: 'c'.repeat(64) } } },
    { token: 'some-suite', name: ['Some Suite'], desc: 'x', homepage: 'https://s.com', url: 'https://s.com/s.zip', version: '1', sha256: 'f'.repeat(64), artifacts: [{ suite: ['Some Suite'] }] },
    { token: 'mytool-cli', name: ['mytool'], desc: 'cli', homepage: 'https://m.com', url: 'https://m.com/m.zip', version: '1', sha256: 'f'.repeat(64), artifacts: [{ binary: ['mytool'] }] },
    { token: 'font-inter', name: ['Inter'], desc: 'font', homepage: 'https://rsms.me/inter', url: 'https://x/inter.zip', version: '4', sha256: 'd'.repeat(64), artifacts: [{ font: ['Inter.ttc'] }] },
    { token: 'renamed', name: ['Renamed'], desc: 'x', homepage: 'https://r.com', url: 'https://r.com/r.zip', version: '1', sha256: 'e'.repeat(64), artifacts: [{ app: ['Weird Name.app', { target: 'Nice Name.app' }] }] },
    { token: 'some-pkg', name: ['Some Pkg'], desc: 'x', homepage: 'https://p.com', url: 'https://p.com/p.pkg', version: '1', sha256: 'f'.repeat(64), artifacts: [{ pkg: ['Some.pkg'] }] },
    { token: 'dead', name: ['Dead'], disabled: true, url: 'https://d', artifacts: [{ app: ['Dead.app'] }] },
  ];

  await t('mac: slim catalog', () => {
    const items = mac.slimAll(RAW, 'arm64');
    const ids = items.map(i => i.id);
    const font = items.find(i => i.id === 'font-inter');
    assert(font && font.kind === 'font' && font.extras[0].dest === 'Inter.ttc', 'fonts kept, go to ~/Library/Fonts');
    assert.strictEqual(items.find(i => i.id === 'some-suite').kind, 'suite');
    assert(!ids.includes('mytool-cli'), 'CLI-only dropped');
    assert(!ids.includes('dead'), 'disabled dropped');
    const r = items.find(i => i.id === 'renamed');
    assert.deepStrictEqual(r.apps, [{ src: 'Weird Name.app', dest: 'Nice Name.app' }]);
    const c = items.find(i => i.id === 'chromium');
    assert.deepStrictEqual(c.apps, [{ src: 'chrome-mac/Chromium.app', dest: 'Chromium.app' }]);
    assert.strictEqual(items.find(i => i.id === 'some-pkg').pkgs[0], 'Some.pkg');
    assert.strictEqual(items.find(i => i.id === 'discord').host, 'stable.dl2.discordapp.net');
    const vsArm = items.find(i => i.id === 'visual-studio-code');
    assert(vsArm.url.includes('darwin-arm64'));
    const vsX = mac.slimAll(RAW, 'x64').find(i => i.id === 'visual-studio-code');
    assert(vsX.url.endsWith('/darwin/stable') && vsX.sha === 'c'.repeat(64), 'intel variation picked');
    const dX = mac.slimAll(RAW, 'x64').find(i => i.id === 'discord');
    assert(dX.url.includes('Discord.dmg'), 'linux variations ignored');
  });

  await t('mac: fetchCatalog caches and falls back', async () => {
    const big = [];
    for (let i = 0; i < 1200; i++) big.push({ token: 'app-' + i, name: ['App ' + i], desc: '', homepage: 'https://a.com', url: 'https://a.com/a.dmg', version: '1', sha256: 'no_check', artifacts: [{ app: [`App ${i}.app`] }] });
    const cache = path.join(os.tmpdir(), 'grab-test-cat.json');
    fs.rmSync(cache, { force: true });
    let calls = 0;
    globalThis.__grabFetch = async () => { calls++; return { ok: true, json: async () => RAW.concat(big) }; };
    const a = await mac.fetchCatalog(cache, 'arm64');
    assert.strictEqual(a.source, 'network');
    const b = await mac.fetchCatalog(cache, 'arm64');
    assert.strictEqual(b.source, 'cache'); assert.strictEqual(calls, 1);
    globalThis.__grabFetch = async () => { throw new Error('offline'); };
    const c = await mac.fetchCatalog(cache, 'arm64', { force: true });
    assert.strictEqual(c.source, 'stale-cache');
    delete globalThis.__grabFetch;
  });

  await t('search ranking', () => {
    const items = prepare(mac.slimAll(RAW, 'arm64'));
    const s = (q) => search(items, q).map(i => i.id);
    assert.strictEqual(s('chrome')[0], 'google-chrome');
    assert.strictEqual(s('Google Chrome')[0], 'google-chrome');
    assert.strictEqual(s('discord')[0], 'discord');
    assert.strictEqual(s('visual studio code')[0], 'visual-studio-code');
    assert.strictEqual(s('vscode')[0], 'visual-studio-code');
    assert.strictEqual(s('code editor')[0], 'visual-studio-code');
    assert.deepStrictEqual(s('zzzzqqq'), []);
  });

  await t('download: progress + sha256 + redirect', async () => {
    const body = crypto.randomBytes(300 * 1024);
    const srv = http.createServer((req, res) => {
      if (req.url === '/r') { res.writeHead(302, { Location: '/f/My%20App.dmg' }); return res.end(); }
      res.writeHead(200, { 'Content-Length': body.length }); res.end(body);
    });
    await new Promise(r => srv.listen(0, r));
    const port = srv.address().port;
    const dest = path.join(os.tmpdir(), 'grab-dl-test');
    let seen = 0;
    const r = await U.download(`http://127.0.0.1:${port}/r`, dest, { onProgress: p => { seen++; assert(p.received <= body.length); } });
    srv.close();
    assert.strictEqual(r.size, body.length);
    assert.strictEqual(r.sha256, crypto.createHash('sha256').update(body).digest('hex'));
    assert(seen >= 1);
    assert.strictEqual(U.fileNameFor(r.finalUrl, r.disposition), 'My App.dmg');
  });

  await t('download: a disk error fails the download instead of crashing or hanging', async () => {
    const body = crypto.randomBytes(200 * 1024);
    const srv = http.createServer((req, res) => { res.writeHead(200, { 'Content-Length': body.length }); res.end(body); });
    await new Promise(r => srv.listen(0, r));
    const dest = path.join(os.tmpdir(), 'grab-no-such-dir-' + process.pid, 'sub', 'file.bin');
    const uncaught = []; const h = (e) => uncaught.push(e); process.on('uncaughtException', h);
    const err = await Promise.race([
      U.download(`http://127.0.0.1:${srv.address().port}/f`, dest, {}).then(() => null, e => e),
      new Promise(r => setTimeout(() => r('HUNG'), 5000)),
    ]);
    process.off('uncaughtException', h); srv.close();
    assert(err && err !== 'HUNG' && /Could not save the download/.test(err.message), 'rejects with a clear message: ' + (err && err.message || err));
    assert.strictEqual(uncaught.length, 0, 'no uncaught exception');
  });

  await t('download: canceling rejects with Canceled', async () => {
    const srv = http.createServer((req, res) => { res.writeHead(200, { 'Content-Length': 10 * 1024 * 1024 }); res.write(Buffer.alloc(64 * 1024)); }); // never finishes
    await new Promise(r => srv.listen(0, r));
    const ac = new AbortController();
    const p = U.download(`http://127.0.0.1:${srv.address().port}/f`, path.join(os.tmpdir(), 'grab-cancel-test'), { signal: ac.signal, onProgress: () => ac.abort() });
    const e = await p.then(() => null, x => x);
    srv.closeAllConnections && srv.closeAllConnections(); srv.close();
    assert(e && /Canceled|abort/i.test(e.message), 'canceled: ' + (e && e.message));
  });

  await t('mac: sniff file types', async () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'grab-sniff-'));
    const w = (n, b) => { const p = path.join(d, n); fs.writeFileSync(p, b); return p; };
    assert.strictEqual(await mac.sniff(w('a', Buffer.from('PK\x03\x04xxxx', 'latin1'))), 'zip');
    assert.strictEqual(await mac.sniff(w('b', Buffer.from('xar!xxxx', 'latin1'))), 'pkg');
    assert.strictEqual(await mac.sniff(w('c', Buffer.from([0x1f, 0x8b, 8, 0, 0, 0, 0, 0]))), 'tgz');
    assert.strictEqual(await mac.sniff(w('d.dmg', Buffer.from('koly....', 'latin1'))), 'dmg');
  });

  await t('win: read V2 index (packages table)', async () => {
    const SQL = await win.initSql();
    const db = new SQL.Database();
    db.run('CREATE TABLE packages (rowid INTEGER PRIMARY KEY, id TEXT, name TEXT, moniker TEXT, latest_version TEXT, arp_min_version TEXT, arp_max_version TEXT, hash BLOB)');
    db.run("INSERT INTO packages (id,name,moniker,latest_version) VALUES ('7zip.7zip','7-Zip','7zip','24.09'),('Google.Chrome','Google Chrome','chrome','131.0'),('Microsoft.VisualStudioCode','Microsoft Visual Studio Code','vscode','1.95')");
    const rows = win.readIndex(SQL, Buffer.from(db.export()));
    db.close();
    assert.strictEqual(rows.length, 3);
    const items = prepare(win.decorate(rows));
    assert.strictEqual(search(items, '7zip')[0].id, '7zip.7zip');
    assert.strictEqual(search(items, 'chrome')[0].id, 'Google.Chrome');
    assert.strictEqual(search(items, 'vscode')[0].id, 'Microsoft.VisualStudioCode');
  });

  await t('win: read V1 index (manifest + ids)', async () => {
    const SQL = await win.initSql();
    const db = new SQL.Database();
    for (const tb of ['ids(id TEXT)', 'names(name TEXT)', 'versions(version TEXT)', 'monikers(moniker TEXT)']) db.run('CREATE TABLE ' + tb);
    db.run('CREATE TABLE manifest (id INT64, name INT64, moniker INT64, version INT64, channel INT64, pathpart INT64)');
    db.run("INSERT INTO ids VALUES ('Mozilla.Firefox')"); db.run("INSERT INTO names VALUES ('Mozilla Firefox')");
    db.run("INSERT INTO versions VALUES ('120.0'),('132.0.1')"); db.run("INSERT INTO monikers VALUES ('firefox')");
    db.run('INSERT INTO manifest VALUES (1,1,1,1,0,0),(1,1,1,2,0,0)');
    const rows = win.readIndex(SQL, Buffer.from(db.export()));
    db.close();
    assert.deepStrictEqual(rows, [{ id: 'Mozilla.Firefox', name: 'Mozilla Firefox', ver: '132.0.1', moniker: 'firefox' }]);
  });

  await t('win: parse winget upgrade table + resolve truncated ids', () => {
    const out = [
      '   - \r   \\ \r',
      'Name                                   Id                           Version      Available    Source',
      '-----------------------------------------------------------------------------------------------------',
      'Google Chrome                          Google.Chrome                130.0.6723   131.0.6778   winget',
      'Microsoft Visual Studio Code (User)    Microsoft.VisualStudioCode   1.94.0       1.95.3       winget',
      'Some Very Long Application Name Here … SomeVendor.SomeVeryLongApp…  1.0          2.0          winget',
      '3 upgrades available.',
      '',
    ].join('\r\n');
    const rows = win.parseTable(out);
    assert.strictEqual(rows.length, 3);
    assert.deepStrictEqual(rows[0], { name: 'Google Chrome', id: 'Google.Chrome', ver: '130.0.6723', avail: '131.0.6778', source: 'winget' });
    const items = win.decorate([{ id: 'Google.Chrome', name: 'Google Chrome' }, { id: 'Microsoft.VisualStudioCode', name: 'VS Code' }, { id: 'SomeVendor.SomeVeryLongApplication', name: 'Some Very Long Application Name Here' }, { id: 'Other.Thing', name: 'Other' }]);
    const byId = new Map(items.map(i => [i.id, i]));
    assert.strictEqual(win.resolveId(rows[2], byId, items), 'SomeVendor.SomeVeryLongApplication');
    assert.strictEqual(win.resolveId(rows[1], byId, items), 'Microsoft.VisualStudioCode');
  });

  await t('ui files parse', () => {
    for (const f of ['app.js', 'jelly.js']) new Function(fs.readFileSync(path.join(__dirname, '../src/ui', f), 'utf8'));
    for (const f of ['main.js', 'preload.js', 'mac.js', 'win.js']) require('vm').createScript ? new (require('vm').Script)(require('module').wrap(fs.readFileSync(path.join(__dirname, '../src', f), 'utf8'))) : 0;
  });

  console.log(`\n${pass} passed${process.exitCode ? ', SOME FAILED' : ''}`);
})();
