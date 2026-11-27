'use strict';
// A stand-in for src/preload.js with sample data, so every screen can be shown (and screenshotted) without the
// network or a real catalog. Used only by scripts/shots.js; never shipped (the build only packs src/).
const { ipcRenderer } = require('electron');
const P = new URLSearchParams(location.search);
if (P.get('theme')) { // seed this profile like someone who has used Grab for a while
  localStorage.setItem('grab-seen-2.0', 'true');
  localStorage.setItem('grab-saved', JSON.stringify(['raycast', 'figma', 'obsidian', 'blender', 'arc', 'bartender', 'iina']));
  localStorage.setItem('grab-recent', JSON.stringify(['blender', 'video player', 'vlc']));
  localStorage.setItem('grab-appearance', JSON.stringify(P.get('theme')));
}
const cask = (t) => `https://github.com/App-Fair/appcasks/releases/download/cask-${t}/AppIcon.png`;
const lib = (t) => `https://raw.githubusercontent.com/homarr-labs/dashboard-icons/main/png/${t}.png`;
const A = (id, name, desc, ver, host, extra = {}) => ({ id, name, desc, ver, home: 'https://' + host, host, publisher: '', verified: true, installed: false, path: null, deprecated: false, label: '', icons: [cask(id), lib(extra.lib || id)], fav: '', price: '', trial: null, ...extra });
const ALL = [
  A('google-chrome', 'Google Chrome', 'Web browser', '142.0.7444.60', 'dl.google.com'),
  A('discord', 'Discord', 'Voice and text chat software', '0.0.364', 'discord.com'),
  A('spotify', 'Spotify', 'Music streaming service', '1.2.74.477', 'download.scdn.co'),
  A('visual-studio-code', 'Visual Studio Code', 'Open-source code editor', '1.106.2', 'update.code.visualstudio.com'),
  A('whatsapp', 'WhatsApp', 'Native desktop client for WhatsApp', '2.25.31.75', 'web.whatsapp.com'),
  A('zoom', 'Zoom', 'Video communication and virtual meeting platform', '6.6.6.67310', 'cdn.zoom.us'),
  A('firefox', 'Mozilla Firefox', 'Web browser', '145.0.1', 'download-installer.cdn.mozilla.net'),
  A('notion', 'Notion', 'App to write, plan, collaborate, and get organised', '6.1.0', 'desktop-release.notion-static.com'),
  A('vlc', 'VLC media player', 'Multimedia player', '3.0.21', 'get.videolan.org'),
  A('obs', 'OBS', 'Open-source software for live streaming and screen recording', '32.0.2', 'cdn-fastly.obsproject.com', { lib: 'obs-studio' }),
  A('telegram', 'Telegram', 'Messaging app with a focus on speed and security', '12.1.1', 'osx.telegram.org'),
  A('steam', 'Steam', 'Video game digital distribution service', '4.0', 'cdn.akamai.steamstatic.com'),
  A('brave-browser', 'Brave', 'Web browser focusing on privacy', '1.84.139', 'updates-cdn.bravesoftware.com', { lib: 'brave' }),
  A('arc', 'Arc', 'Chromium based browser', '1.122.0', 'releases.arc.net'),
  A('chatgpt', 'ChatGPT', "OpenAI's official ChatGPT desktop app", '1.2025.316', 'persistent.oaistatic.com'),
  A('claude', 'Claude', "Anthropic's official Claude AI desktop app", '1.0.1217', 'downloads.claude.ai'),
  A('raycast', 'Raycast', 'Control your tools with a few keystrokes', '1.104.0', 'releases.raycast.com'),
  A('rectangle', 'Rectangle', 'Move and resize windows using keyboard shortcuts or snap areas', '0.91', 'github.com'),
  A('slack', 'Slack', 'Team communication and collaboration software', '4.47.65', 'downloads.slack-edge.com'),
  A('figma', 'Figma', 'Collaborative team software', '125.10.8', 'desktop.figma.com'),
  A('iina', 'IINA', 'Free and open-source media player', '1.4.1', 'dl-portal.iina.io'),
  A('the-unarchiver', 'The Unarchiver', 'Unpacks archive files', '4.3.9', 'dl.devmate.com'),
  A('appcleaner', 'AppCleaner', 'Application uninstaller', '3.6.8', 'freemacsoft.net'),
  A('iterm2', 'iTerm2', 'Terminal emulator as alternative to Apple\'s Terminal app', '3.6.6', 'iterm2.com'),
  A('docker-desktop', 'Docker Desktop', 'App to build and share containerised applications', '4.51.0', 'desktop.docker.com', { lib: 'docker' }),
  A('obsidian', 'Obsidian', 'Knowledge base that works on top of a local folder of plain text Markdown files', '1.10.3', 'github.com'),
  A('blender', 'Blender', '3D creation suite', '4.5.4', 'download.blender.org'),
  A('cursor', 'Cursor', 'Write, edit, and chat about your code with AI', '2.1.32', 'downloads.cursor.com'),
  A('audacity', 'Audacity', 'Cross-platform audio software', '3.7.5', 'muse-cdn.com'),
  A('1password', '1Password', 'Password manager that keeps all passwords secure in one place', '8.11.18', 'downloads.1password.com', { price: 'sub' }),
  A('bartender', 'Bartender', 'Menu bar icon organiser', '6.1.0', 'macbartender.com', { price: 'paid', trial: { label: '4-week trial', note: 'The developer offers a free 4-week trial.' } }),
  A('signal', 'Signal', 'Instant messaging application focusing on security', '7.79.0', 'updates.signal.org'),
  A('zed', 'Zed', 'Multiplayer code editor', '0.213.4', 'zed.dev'),
  A('handbrake-app', 'HandBrake', 'Open-source video transcoder', '1.10.2', 'github.com', { lib: 'handbrake' }),
  A('font-fira-code', 'Fira Code', 'Monospaced font with programming ligatures', '6.2', 'github.com', { label: 'Font', icons: [] }),
];
const byId = new Map(ALL.map(a => [a.id, a]));
const pick = (ids) => ids.map(i => byId.get(i)).filter(Boolean);
const POP = ['google-chrome', 'discord', 'spotify', 'visual-studio-code', 'whatsapp', 'zoom', 'firefox', 'notion', 'vlc', 'obs', 'telegram', 'steam', 'brave-browser', 'arc', 'chatgpt', 'claude', 'raycast', 'rectangle', 'slack', 'figma', 'bartender', '1password', 'iina', 'appcleaner'];
const PACKS = [
  { id: 'dev', name: 'Developer', blurb: 'Editors, terminals and containers', hue: 220, items: pick(['visual-studio-code', 'iterm2', 'docker-desktop', 'cursor', 'zed']) },
  { id: 'create', name: 'Creator', blurb: 'Record, edit and design', hue: 330, items: pick(['obs', 'figma', 'blender', 'audacity', 'handbrake-app']) },
  { id: 'chat', name: 'Stay in touch', blurb: 'Every chat app, one click', hue: 160, items: pick(['discord', 'whatsapp', 'telegram', 'slack', 'signal', 'zoom']) },
  { id: 'ai', name: 'AI desk', blurb: 'The assistants everyone uses', hue: 270, items: pick(['chatgpt', 'claude', 'cursor', 'raycast']) },
];
const inst = (id, v, latest) => ({ ...byId.get(id), installed: true, path: null, installedVer: v, update: !!latest, latest: latest || byId.get(id).ver });
const SCAN = [inst('google-chrome', '141.0.7390.123', '142.0.7444.60'), inst('slack', '4.46.101', '4.47.65'), inst('visual-studio-code', '1.105.1', '1.106.2'), inst('obsidian', '1.9.14', '1.10.3'),
  inst('discord', '0.0.364'), inst('spotify', '1.2.74.477'), inst('raycast', '1.104.0'), inst('rectangle', '0.91'), inst('iina', '1.4.1'), inst('the-unarchiver', '4.3.9'), inst('zoom', '6.6.6.67310'), inst('figma', '125.10.8')];
const t0 = Date.now();
const JOBS = P.get('jobs') === '0' ? [] : [
  { id: 1, itemId: 'blender', name: 'Blender', home: '', verb: 'install', state: 'downloading', pct: 62, received: 249e6, total: 402e6, speed: 18.4e6, stage: 'Downloading', msg: '', created: t0 },
  { id: 2, itemId: 'docker-desktop', name: 'Docker Desktop', verb: 'install', state: 'queued', pct: 0, received: 0, total: 0, speed: 0, stage: '', msg: '', created: t0 - 1000 },
  { id: 3, itemId: 'slack', name: 'Slack', verb: 'update', state: 'installing', pct: 100, received: 0, total: 0, speed: 0, stage: 'Verified', msg: '', created: t0 - 2000 },
  { id: 4, itemId: 'arc', name: 'Arc', verb: 'install', state: 'done', pct: 100, result: 'installed', path: '/Applications/Arc.app', msg: 'Installed', created: t0 - 60000 },
  { id: 5, itemId: 'cursor', name: 'Cursor', verb: 'install', state: 'done', pct: 100, result: 'installed', path: '/Applications/Cursor.app', msg: 'Installed', created: t0 - 90000 },
  { id: 6, itemId: 'zed', name: 'Zed', verb: 'install', state: 'error', pct: 34, msg: 'Download failed (HTTP 503)', created: t0 - 120000 },
];
const UPD = {
  none: { status: 'uptodate', latest: 'v2.0.0', current: '2.0.0' },
  downloading: { status: 'downloading', latest: 'v2.1.0', current: '2.0.0', size: 112e6, bytes: 71e6, progress: 63, speed: 9.2e6 },
  ready: { status: 'ready', latest: 'v2.1.0', current: '2.0.0', progress: 100 },
  installing: { status: 'installing', latest: 'v2.1.0', current: '2.0.0', progress: 100 },
  error: { status: 'error', latest: 'v2.1.0', current: '2.0.0', error: 'GitHub did not answer' },
};
const L = { catalog: [], job: [], scan: [], updater: [] };
const on = (k) => (fn) => { L[k].push(fn); return () => {}; };
const ok = (v) => Promise.resolve(v);
const offline = P.get('offline') === '1';
window.grab = {
  info: () => ok({ platform: 'darwin', arch: 'arm64', version: '2.1.0', winget: null, dark: false }),
  catalog: () => ok(offline ? { ready: false, error: 'Could not load the app catalog. Check your internet connection.', count: 0, popular: [] } : { ready: true, error: null, count: 7412, ts: Date.now(), popular: pick(POP) }),
  refreshCatalog: () => ok({}),
  search: (q) => ok(ALL.filter(a => (a.name + ' ' + a.desc).toLowerCase().includes(String(q).toLowerCase()))),
  get: (id) => ok(byId.get(id) || null), getMany: (ids) => ok(pick(ids)),
  install: (id) => ok(1), update: (id) => ok(1), installUrl: () => ok(1), cancel: () => ok(), resume: () => ok(), dismiss: () => ok(),
  jobs: () => ok(JOBS), scan: () => ok(offline ? [] : SCAN), uninstall: () => ok(true), open: () => ok(''), openPath: () => ok(), reveal: () => ok(), external: () => ok(),
  icon: () => ok(null), meta: () => ok(null), fav: () => ok(null), packs: () => ok(offline ? [] : PACKS),
  updState: () => ok(UPD[P.get('upd') || 'none']), updCheck: () => ok(UPD.none), updInstall: () => ok(), updCancel: () => ok(),
  ready: () => ok(), access: () => ok(P.get('access') || 'allowed'), openAccess: () => ok(), appearance: (m) => ipcRenderer.invoke('appearance', m),
  onCatalog: on('catalog'), onJob: on('job'), onScan: on('scan'), onUpdater: on('updater'),
};
window.__demo = { emit: (k, v) => L[k].forEach(f => f(v)), UPD };
