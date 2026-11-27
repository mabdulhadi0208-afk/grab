'use strict';
/* Grab renderer. Talks to the main process only through window.grab (preload).
   Grab 2.0: Lumen's design language (Lumen docs/NOVA.md) and Lumen's motion system (jelly.js, copied from Lumen
   unchanged, so every spring matches Lumen 1:1). Nothing runs while Grab sits idle: no animation frame loop, no
   timers; the only CSS loop is the hero banner's drifting dots, which pause whenever Grab is hidden or not in front. */
(() => {
  const G = window.grab;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const sel = (id) => (window.CSS && CSS.escape ? CSS.escape(id) : String(id).replace(/["\\]/g, '\\$&'));
  const errText = (e) => String((e && e.message) || e || '').replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  const RS = document.documentElement.style;
  const kick = (el, s = 0.6, hop = 0.4) => { if (el && window.Jelly) requestAnimationFrame(() => Jelly.kick(el, s, hop)); };

  const store = { get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };
  const S = {
    info: { platform: 'darwin' }, cat: { ready: false, popular: [], count: 0 }, view: 'discover', q: '', results: [], resultsQ: '',
    packs: [], pack: null, freeOnly: (() => { try { return localStorage.getItem('grab-free') === '1'; } catch { return false; } })(),
    scan: null, jobsById: new Map(), jobsByItem: new Map(), items: new Map(), installed: new Set(), removed: new Set(), instFilter: '', busy: new Set(),
  };
  const isMac = () => S.info.platform === 'darwin';
  const view = $('#view');

  const I = {
    check: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    shield: '<svg viewBox="0 0 24 24"><path d="M12 3l7 3v5.5c0 4.4-3 8.2-7 9.5-4-1.3-7-5.1-7-9.5V6z"/><path d="M8.8 12.2l2.2 2.2 4.3-4.6"/></svg>',
    x: '<svg viewBox="0 0 24 24"><path d="M7 7l10 10M17 7L7 17"/></svg>',
    bolt: '<svg viewBox="0 0 24 24"><path d="M13 3L5 13.5h6L10 21l8-10.5h-6z"/></svg>',
    globe: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/></svg>',
    link: '<svg viewBox="0 0 24 24"><path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1"/></svg>',
    box: '<svg viewBox="0 0 24 24"><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9"/></svg>',
    up: '<svg viewBox="0 0 24 24"><path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 4.5v4.8h-4.8"/></svg>',
    dl: '<svg viewBox="0 0 24 24"><path d="M12 4v11"/><path d="M7.5 10.5L12 15l4.5-4.5"/><path d="M5 19.5h14"/></svg>',
    search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.6-3.6"/></svg>',
    tag: '<svg viewBox="0 0 24 24"><path d="M3.5 12.6V5a1.5 1.5 0 0 1 1.5-1.5h7.6L20.5 11.4a1.5 1.5 0 0 1 0 2.1l-7 7a1.5 1.5 0 0 1-2.1 0z"/><circle cx="8" cy="8" r="1.3"/></svg>',
    back: '<svg viewBox="0 0 24 24"><path d="M14.5 6l-6 6 6 6"/></svg>',
    trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4.8h6V7M6.5 7l1 13h9l1-13"/></svg>',
    arrow: '<svg class="varrow" viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
    grid: '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="6.5" height="6.5" rx="1.8"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.8"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.8"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.8"/></svg>',
    compass: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/></svg>',
    sliders: '<svg viewBox="0 0 24 24"><path d="M5 7h9M18 7h1M5 12h2M11 12h8M5 17h7M16 17h3"/><circle cx="16" cy="7" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="14" cy="17" r="2"/></svg>',
    spark: '<svg viewBox="0 0 24 24"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6.3 6.3l2.5 2.5M15.2 15.2l2.5 2.5M6.3 17.7l2.5-2.5M15.2 8.8l2.5-2.5"/></svg>',
    wave: '<svg viewBox="0 0 24 24"><path d="M3 12c2.5-4 5-4 7.5 0s5 4 7.5 0 2.5-2 3-2"/><path d="M3 17c2.5-4 5-4 7.5 0s5 4 7.5 0"/></svg>',
    offline: '<svg viewBox="0 0 24 24"><path d="M3 9.5a14 14 0 0 1 18 0M6.5 13a9 9 0 0 1 11 0M10 16.5a4 4 0 0 1 4 0"/><path d="M4 4l16 16"/></svg>',
  };
  const heart = (on) => `<svg viewBox="0 0 24 24"${on ? ' style="fill:#ec4899;stroke:#ec4899"' : ''}><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/></svg>`;
  const MARK = '<svg class="mark" viewBox="0 0 64 64"><use href="#grab-mark"/></svg>';
  // the giant outline glyph in each hero, drawn on a 24px grid
  const GLYPH = {
    grab: '<svg viewBox="0 0 24 24"><path d="M12 3.5v10"/><path d="M8 9.5l4 4 4-4"/><path d="M5 15.5v1.8A2.2 2.2 0 0 0 7.2 19.5h9.6a2.2 2.2 0 0 0 2.2-2.2v-1.8"/><circle cx="12" cy="12" r="10.5"/></svg>',
    up: I.up, grid: I.grid, dl: I.dl, heart: heart(false), sliders: I.sliders, box: I.box, search: I.search, link: I.link, offline: I.offline, spark: I.spark,
  };
  const SEC = { discover: 'var(--accent)', updates: '#12b886', installed: '#8b5cf6', downloads: '#06b6d4', saved: '#ec4899', settings: '#f59e0b' };

  // ---------- appearance: Lumen's palette, light, dark or follow the system ----------
  const ACCENTS = [['Blue', '#5b8cff'], ['Violet', '#7c5cff'], ['Pink', '#e5487d'], ['Orange', '#f0763b'], ['Gold', '#e8b22c'], ['Green', '#2fb67c'], ['Teal', '#16a3b8'], ['Graphite', '#7a7d87']];
  const OLD_THEMES = { violet: '#5b8cff', sunset: '#f0763b', mint: '#2fb67c', candy: '#e5487d', lime: '#2fb67c' }; // 1.x colour names
  S.accent = store.get('grab-accent', null) || OLD_THEMES[store.get('grab-theme', '')] || '#5b8cff';
  function applyAccent(c) { if (!ACCENTS.some(a => a[1] === c)) c = '#5b8cff'; S.accent = c; RS.setProperty('--accent', c); store.set('grab-accent', c); }
  applyAccent(S.accent);
  const darkMQ = matchMedia('(prefers-color-scheme: dark)');
  const paintScheme = () => document.documentElement.classList.toggle('dark', darkMQ.matches);
  darkMQ.addEventListener('change', paintScheme); paintScheme();
  S.appearance = store.get('grab-appearance', 'system');
  function applyAppearance(m) { S.appearance = ['system', 'light', 'dark'].includes(m) ? m : 'system'; store.set('grab-appearance', S.appearance); if (G.appearance) G.appearance(S.appearance).catch(() => {}); }

  // ---------- motion: Lumen's Jelly (ui/jelly.js), same springs, same selectors as Lumen's pages ----------
  const OLD_MOTION = { chill: 'calm', bouncy: 'jelly', max: 'jelly' };
  function setMotion(m) { S.motion = ['jelly', 'calm', 'off'].includes(m) ? m : 'jelly'; store.set('grab-motion-v3', S.motion); document.body.dataset.motion = S.motion; if (window.Jelly) Jelly.setMode(S.motion); }
  setMotion(store.get('grab-motion-v3', null) || OLD_MOTION[(() => { try { return localStorage.getItem('grab-motion-v2'); } catch { return ''; } })()] || 'jelly');
  if (window.Jelly) {
    Jelly.init({ buttons: '.btn, .chip, .sw, .seg-b, .nav-btn, .clear, .tg, .lnk, .brand', cards: '.card, .pack, .stat, .hero-ic, .e-orb, .urlcard', press: '.rowi, .dl, .fact' });
    Jelly.smoothScroll(view);
  }

  // ---------- hero banners: Lumen's lights (pages/app.js heroBack) with seeded drifting dots ----------
  function heroDots(seed) {
    let h = 2166136261; for (const c of String(seed)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
    const rnd = () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909)) >>> 0) / 4294967296;
    const layer = sets => { const img = [], size = [], pos = [];
      for (const [n, tile, r, col] of sets) { const th = Math.round(tile * (0.8 + rnd() * 0.4)), px = Math.round(rnd() * tile), py = Math.round(rnd() * th);
        for (let i = 0; i < n; i++) { img.push(`radial-gradient(circle at ${(rnd() * 100).toFixed(1)}% ${(rnd() * 100).toFixed(1)}%, ${col} ${r}px, transparent ${r + 1.2}px)`); size.push(`${tile}px ${th}px`); pos.push(`${px}px ${py}px`); } }
      return `background-image:${img.join(',')};background-size:${size.join(',')};background-position:${pos.join(',')}`; };
    const svg = x => `url('data:image/svg+xml,${encodeURIComponent(x)}')`;
    const star = (x, y, r) => `M${x} ${(y - r).toFixed(1)}Q${x} ${y} ${(x + r).toFixed(1)} ${y}Q${x} ${y} ${x} ${(y + r).toFixed(1)}Q${x} ${y} ${(x - r).toFixed(1)} ${y}Q${x} ${y} ${x} ${(y - r).toFixed(1)}Z`;
    let sp = '', specks = '';
    for (let i = 0; i < 3; i++) sp += star(Math.round(20 + rnd() * 340), Math.round(20 + rnd() * 260), 3.5 + rnd() * 4);
    for (let i = 0; i < 4; i++) { const x = Math.round(10 + rnd() * 360), y = Math.round(10 + rnd() * 280); specks += `<circle cx="${x}" cy="${y}" r="5" fill="white" fill-opacity=".12"/><circle cx="${x}" cy="${y}" r="1.7" fill="white"/>`; }
    const bright = `<svg xmlns="http://www.w3.org/2000/svg" width="380" height="300">${specks}<path d="${sp}" fill="white"/></svg>`;
    const pts = []; for (let i = 0; i < 6; i++) pts.push([Math.round(480 + rnd() * 470), Math.round(40 + rnd() * 240)]); pts.sort((a, b) => a[0] - b[0]);
    const cons = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 320" preserveAspectRatio="xMidYMid slice"><path d="M${pts.map(q => q.join(' ')).join('L')}" fill="none" stroke="white" stroke-opacity=".24" stroke-width=".9" stroke-dasharray="2 4"/>${pts.map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="${i % 3 ? 1.5 : 2.4}" fill="white" fill-opacity="${i % 3 ? 0.5 : 0.85}"/>`).join('')}</svg>`;
    return `<span class="dots"><b class="cons" style="background-image:${svg(cons)}"></b><i class="hd1" style="${layer([[9, 150 + Math.round(rnd() * 40), 1, 'var(--hd1)'], [6, 210 + Math.round(rnd() * 60), 1.4, 'var(--hd2)']])}"></i><i class="hd3" style="background-image:${svg(bright)};background-size:380px 300px;background-position:${Math.round(rnd() * 380)}px ${Math.round(rnd() * 300)}px"></i></span>`;
  }
  const heroBg = (glyph, seed, dots = true) => `<span class="hb" aria-hidden="true"><i class="orb a"></i><i class="orb b"></i><i class="orb c"></i><i class="orb d"></i>${dots ? heroDots(seed) : ''}<i class="grain"></i><span class="art glow">${glyph}</span><span class="art depth">${glyph}</span><span class="art">${glyph}</span><i class="glint"></i></span>`;
  function hero({ ic, glyph, icon, eye, chip, title, lead, extra = '', seed, cls = '', back = false }) {
    return `<div class="hero enter${back ? ' has-back' : ''}${cls ? ' ' + cls : ''}" style="--ic:${ic}">${heroBg(glyph, seed || title)}${back ? `<button class="btn onink small back" data-pack-back>${I.back}Back</button>` : ''}${icon ? `<div class="hero-ic">${icon}</div>` : ''}<div class="hero-tx"><div class="hero-eye"><span>${esc(eye)}</span><i></i>${chip != null && chip !== '' ? `<b>${chip}</b>` : ''}</div><h1>${title}</h1>${lead ? `<p class="lead">${lead}</p>` : ''}${extra}</div></div>`;
  }
  // the dots stop when the hero is off screen, and when Grab is hidden or not the app in front (exactly as in Lumen)
  const heroIO = 'IntersectionObserver' in window ? new IntersectionObserver(es => es.forEach(e => e.target.classList.toggle('dots-off', !e.isIntersecting))) : null;
  const vis = () => document.documentElement.classList.toggle('lm-hidden', document.hidden || !document.hasFocus());
  document.addEventListener('visibilitychange', vis); addEventListener('blur', vis); addEventListener('focus', vis); vis();
  function watchHeroes(root) { if (heroIO) for (const h of $$('.hero', root)) heroIO.observe(h); }

  // ---------- helpers ----------
  function remember(list) { for (const it of list || []) if (it && it.id) S.items.set(it.id, { ...(S.items.get(it.id) || {}), ...it }); return list || []; }
  function fmtBytes(n) { if (!n) return '0 MB'; const u = ['B', 'KB', 'MB', 'GB']; let i = 0; while (n >= 1024 && i < 3) { n /= 1024; i++; } return (i >= 2 ? n.toFixed(1) : Math.round(n)) + ' ' + u[i]; }
  function hue(s) { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % 360; }
  const hueColor = (s) => `hsl(${hue(s)} 72% 58%)`;
  function isInstalled(it) { if (!it) return false; if (S.removed.has(it.id)) return false; return !!(it.installed || S.installed.has(it.id)); }
  function updateFor(id) { return S.scan && S.scan.find(s => s.id === id && s.update); }
  function verLabel(it) { const v = String(it.ver || '').split(',')[0]; return v && v !== 'latest' ? 'v' + v : ''; }
  function subLine(it) { return isMac() ? (it.desc || it.home || '') : (it.mdesc || `${it.publisher || ''}${it.publisher ? ' · ' : ''}${it.id}`); }
  const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
  const ACTIVE = ['queued', 'downloading', 'installing'];
  const busyJob = (id) => { const j = S.jobsByItem.get(id); return !!j && (ACTIVE.includes(j.state) || j.state === 'needs-quit'); };
  const grabbable = (it) => !isInstalled(S.items.get(it.id) || it) && !it.price && !busyJob(it.id); // for Get all: skip installed, paid and already running

  // ---------- icons ----------
  const realIcons = new Map(); // path -> dataURL
  function iconHTML(it) {
    const name = (it.name || '?').trim();
    const ch = (name.match(/[A-Za-z0-9]/) || [name[0] || '?'])[0].toUpperCase();
    const h = hue(it.id || name);
    return `<div class="ic" data-id="${esc(it.id || '')}" data-icons="${esc((it.icons || []).join('|'))}" data-fav="${esc(it.fav || '')}" data-path="${esc(it.path || '')}"><div class="letter" style="background:linear-gradient(145deg,hsl(${h} 80% 64%),hsl(${(h + 34) % 360} 74% 46%));--lc:hsl(${h} 70% 45% / .6)">${esc(ch)}</div><img alt=""></div>`;
  }
  const metaCache = new Map();
  const iconMem = (() => { try { return JSON.parse(localStorage.getItem('grab-icons-v4') || '{}'); } catch { return {}; } })();
  let iconMemT = null;
  function iconRemember(id, url) { if (!id || String(url).startsWith('data:')) return; iconMem[id] = url; clearTimeout(iconMemT); iconMemT = setTimeout(() => { try { localStorage.setItem('grab-icons-v4', JSON.stringify(iconMem)); } catch {} }, 800); }
  // Sources in order: the app's real icon(s), then its own site's logo (main decides if that's allowed and checks it exists).
  function markReal(box, img) { img.classList.add('real'); box.classList.add('has-real'); }
  async function loadChain(box, img, srcs, id) {
    if (!srcs.length) { iconRemember(id, 'none'); return; }
    const src = srcs.shift();
    let u = src.u;
    if (src.fav) { u = await G.fav(src.fav).catch(() => null); if (!u) return loadChain(box, img, srcs, id); }
    img.onload = () => {
      if (img.naturalWidth >= 24) { if (!src.fav) { markReal(box, img); iconRemember(id, u); } img.classList.add('on'); box.classList.add('has-img'); }
      else loadChain(box, img, srcs, id);
    };
    img.onerror = () => loadChain(box, img, srcs, id);
    img.src = u;
  }
  function hydrateIcons(root = document) {
    for (const box of $$('.ic:not([data-h])', root)) {
      box.dataset.h = '1';
      const img = $('img', box); if (!img) continue;
      const p = box.dataset.path, id = box.dataset.id;
      const setReal = (url) => { img.className = 'real on'; img.src = url; box.classList.add('has-img', 'has-real'); };
      if (p) {
        if (realIcons.has(p)) { setReal(realIcons.get(p)); continue; }
        G.icon(p).then(u => { if (u) { realIcons.set(p, u); setReal(u); } else start(); }).catch(() => start());
        continue;
      }
      start();
      async function start() {
        let icons = (box.dataset.icons || '').split('|').filter(Boolean), fav = box.dataset.fav || '';
        if (!isMac() && id && !id.startsWith('url:')) {
          let m = metaCache.get(id);
          if (m === undefined) { m = await G.meta(id).catch(() => null); metaCache.set(id, m); }
          if (m) {
            if (m.icon) icons = [m.icon]; fav = m.fav || '';
            if (m.desc) { const card = box.closest('[data-open]'); const d = card && $('.c-desc', card); if (d && !d.dataset.meta) { d.dataset.meta = '1'; d.textContent = m.desc; } const it = S.items.get(id); if (it) { it.mdesc = m.desc; it.mhome = m.home; } }
          }
        }
        // order: real icon, the app's own site logo, then the open icon library (Mac's last entry)
        const lib = icons.filter(u => /dashboard-icons/.test(u)), real = icons.filter(u => !/dashboard-icons/.test(u));
        const chain = [...real.map(u => ({ u })), ...(fav ? [{ fav }] : []), ...lib.map(u => ({ u }))];
        const known = id && iconMem[id];
        if (known === 'none') return;
        if (known) {
          img.onload = () => { markReal(box, img); img.classList.add('on'); box.classList.add('has-img'); };
          img.onerror = () => { delete iconMem[id]; loadChain(box, img, chain, id); };
          img.src = known; return;
        }
        loadChain(box, img, chain, id);
      }
    }
  }

  // ---------- the action button ----------
  function actionHTML(it, extraClass = '') {
    const id = esc(it.id);
    const j = S.jobsByItem.get(it.id);
    const cls = extraClass ? ' ' + extraClass : '';
    if (j && ACTIVE.includes(j.state)) {
      const pct = j.state === 'downloading' && (j.total || j.pct) ? Math.round(j.pct) : null;
      const label = j.state === 'queued' ? 'Waiting' : j.state === 'installing' ? (j.stage || 'Installing') : pct != null ? pct + '%' : (j.stage || 'Starting');
      // an install that is already copying files cannot be stopped halfway, so it offers no cancel
      if (j.state === 'installing') return `<button class="btn prog nox indet${cls}" data-act="${id}" data-do="none" data-job="${j.id}"><i class="fill"></i><span>${esc(label)}</span></button>`;
      return `<button class="btn prog${pct == null ? ' indet' : ''}${cls}" data-act="${id}" data-do="cancel" data-job="${j.id}" title="Cancel"><i class="fill" style="width:${pct || 0}%"></i><span>${esc(label)}</span><i class="x">${I.x}</i></button>`;
    }
    if (j && j.state === 'needs-quit') return `<button class="btn btn-warn${cls}" data-act="${id}" data-do="quit" data-job="${j.id}" title="${esc(j.msg)}">Quit and install</button>`;
    if (j && j.state === 'error') return `<button class="btn btn-bad${cls}" data-act="${id}" data-do="${j.verb === 'update' ? 'update' : 'get'}" title="${esc(j.msg)}">${I.up}Retry</button>`;
    if (updateFor(it.id) && !(j && j.state === 'done' && j.verb !== 'uninstall')) return `<button class="btn btn-solid${cls}" data-act="${id}" data-do="update">${I.up}Update</button>`;
    if (isInstalled(it)) return isMac() ? `<button class="btn btn-ok${cls}" data-act="${id}" data-do="open">Open</button>` : `<button class="btn btn-ok${cls}" data-act="${id}" data-do="detail">${I.check}Installed</button>`;
    // paid apps: the developer's stated trial if there is one, otherwise Buy (opens the developer's website)
    if (it.price && it.trial) return `<button class="btn btn-trial${cls}" data-act="${id}" data-do="get" title="${esc(it.trial.note)}">${esc(it.trial.label)}</button>`;
    if (it.price) return `<button class="btn btn-buy${cls}" data-act="${id}" data-do="buy" title="Opens the developer's website">${I.tag}Buy</button>`;
    return `<button class="btn btn-get${cls}" data-act="${id}" data-do="get">Get</button>`;
  }
  function refreshActions(itemId) {
    for (const b of $$(`[data-act="${sel(itemId)}"]`)) {
      const it = S.items.get(itemId);
      if (!it) continue;
      const big = b.classList.contains('big') ? 'big' : '';
      const t = document.createElement('div');
      t.innerHTML = actionHTML(it, big);
      const nb = t.firstElementChild;
      // keep the progress fill moving smoothly instead of replacing it
      if (b.classList.contains('prog') && nb.classList.contains('prog') && b.dataset.job === nb.dataset.job && !!$('.x', b) === !!$('.x', nb)) {
        b.className = nb.className; b.title = nb.title; b.dataset.do = nb.dataset.do;
        $('.fill', b).style.width = $('.fill', nb).style.width;
        $('span', b).textContent = $('span', nb).textContent;
      } else if (b.className !== nb.className || b.innerHTML !== nb.innerHTML || b.dataset.do !== nb.dataset.do) { b.replaceWith(nb); if (nb.matches('.btn-ok, .btn-warn, .btn-bad')) kick(nb, 0.9, 0.6); }
    }
  }

  // ---------- views ----------
  const PRICE = { paid: ['Paid', 'Costs money. You get the official trial, then buy it from the developer.'], sub: ['Subscription', 'Needs a paid subscription from the developer.'] };
  function priceHTML(it) { const p = PRICE[it.price]; return p ? `<span class="pill price ${it.price}" title="${esc(p[1])}">${I.tag}${p[0]}</span>` : ''; }
  const freeFilter = (list) => (S.freeOnly ? list.filter(it => !it.price) : list);
  const freeToggle = () => `<button class="chip tog${S.freeOnly ? ' on' : ''}" data-free>${I.tag}Free apps only</button>`;
  function cardHTML(it, i) {
    remember([it]);
    const tags = `${it.label ? `<span class="pill">${esc(it.label)}</span>` : ''}${priceHTML(it)}`;
    return `<div class="card" data-open="${esc(it.id)}" style="--i:${i};--hc:${hueColor(it.id || it.name)}">
      <div class="c-top">${iconHTML(it)}${tags ? `<div class="c-tags">${tags}</div>` : ''}</div>
      <div><div class="c-name">${esc(it.name)}</div><div class="c-desc">${esc(subLine(it))}</div></div>
      <div class="c-foot"><span class="ver">${esc(verLabel(it))}</span>${actionHTML(it)}</div></div>`;
  }
  function rowHTML(it, i, right) {
    remember([it]);
    return `<div class="rowi" data-open="${esc(it.id)}" style="--i:${i}">${iconHTML(it)}<div class="r-main"><div class="name">${esc(it.name)}</div><div class="desc">${right.sub}</div></div><div class="acts">${right.acts}</div></div>`;
  }
  function packCardHTML(p, i) {
    return `<div class="pack" data-pack="${esc(p.id)}" style="--h:${Number(p.hue) || 0};--i:${i}"><span class="pack-n">${plural(p.items.length, 'app')}</span><div class="pack-ic">${p.items.slice(0, 4).map(iconHTML).join('')}</div><div class="pack-t">${esc(p.name)}</div><div class="pack-b">${esc(p.blurb)}</div></div>`;
  }
  function emptyHTML({ glyph, title, text, acts = '', orb }) {
    return `<div class="empty"><span class="e-art" aria-hidden="true">${glyph}</span><div class="e-orb">${orb || glyph}</div><div class="e-title">${title}</div><div class="e-tx">${text}</div>${acts ? `<div class="e-acts">${acts}</div>` : ''}</div>`;
  }
  const loadingHTML = (t = 'Loading the app catalog', sub = 'The first launch takes a few seconds.') => emptyHTML({ glyph: GLYPH.box, orb: '<div class="spinner"></div>', title: esc(t), text: esc(sub) });
  const offlineHTML = () => emptyHTML({ glyph: GLYPH.offline, orb: I.offline, title: "Can't reach the catalog", text: esc(S.cat.error || 'Check your internet connection, then try again.'), acts: '<button class="btn btn-solid big" data-retry-cat>Try again</button>' });

  let lastKey = '';
  function setView(html, key) {
    const fresh = key !== lastKey; lastKey = key;
    const keep = fresh ? 0 : view.scrollTop;
    const filt = document.activeElement && document.activeElement.id === 'inst-filter' ? document.activeElement.selectionStart : -1;
    view.innerHTML = `<div class="view-in${fresh ? '' : ' still'}">${html}</div>`;
    const vi = view.firstElementChild;
    [...vi.children].forEach((c, i) => c.style.setProperty('--n', Math.min(i, 8)));
    if (!fresh) { for (const h of $$('.hero.enter', vi)) h.classList.remove('enter'); view.scrollTop = keep; }
    else view.scrollTop = 0;
    hydrateIcons(view); watchHeroes(view);
    if (filt >= 0) { const f = $('#inst-filter'); if (f) { f.focus(); try { f.setSelectionRange(filt, filt); } catch {} } }
  }
  const VIEWS = ['discover', 'updates', 'installed', 'downloads', 'saved', 'settings'];

  function wingetNote() {
    if (isMac() || S.info.winget !== false) return '';
    return `<div class="note"><span class="ni2">${I.box}</span><div><b>One-time setup:</b> Grab installs apps through Microsoft's winget, which is part of "App Installer". Get it from the Microsoft Store, then reopen Grab.</div><button class="btn btn-solid" data-ext="https://apps.microsoft.com/detail/9NBLGGH4NNS1">Get App Installer</button></div>`;
  }

  function renderDiscover() {
    const q = S.q.trim();
    if (/^https?:\/\/\S+$/i.test(q)) {
      let host = '', file = '';
      try { const u = new URL(q); host = u.hostname; file = decodeURIComponent(u.pathname.split('/').pop() || ''); } catch {}
      setView(`${wingetNote()}<div class="sec-h"><h2>Paste a link</h2><span class="sub">Straight from the source, no browser</span></div>
        <div class="urlcard"><div class="ic glyph">${I.link}</div><div class="r-main"><div class="t">Download from this link</div><div class="u">${esc(file || host)} · ${esc(host)}</div></div><button class="btn btn-solid big" data-url="${esc(q)}">${I.dl}Download${isMac() ? ' and install' : ''}</button></div>
        <p class="hint">${isMac() ? 'Disk images, zips and installer packages get installed into Applications automatically. Anything else is saved to Downloads.' : 'Installers (.exe and .msi) open as soon as they finish downloading. Anything else is saved to Downloads.'}</p>`, 'url');
      return;
    }
    if (q) {
      if (S.cat.error && !S.cat.ready) { setView(offlineHTML(), 'q-off'); return; }
      if (!S.cat.ready) { setView(loadingHTML(), 'q-load'); return; }
      const key = 'q|' + S.resultsQ;
      const shown = freeFilter(S.results);
      if (S.results.length && !shown.length) { setView(`<div class="sec-h"><h2>Results</h2><span class="sp"></span>${freeToggle()}</div>${emptyHTML({ glyph: I.tag, title: `Only paid apps match "${esc(q)}"`, text: 'Turn off Free apps only to see them.' })}`, key); return; }
      if (!S.results.length) { setView(emptyHTML({ glyph: GLYPH.search, orb: I.search, title: `Nothing called "${esc(q)}"`, text: 'Try another name, or paste a direct download link.' }), key); return; }
      setView(`<div class="sec-h"><h2>Results</h2><span class="sub">${S.results.length >= 60 ? 'Top 60' : shown.length} for "${esc(q)}"</span><span class="sp"></span>${freeToggle()}</div><div class="grid">${shown.map(cardHTML).join('')}</div>`, key);
      return;
    }
    const n = S.cat.ready ? S.cat.count.toLocaleString() : '';
    const top = hero({ ic: 'var(--accent)', glyph: GLYPH.grab, icon: MARK, eye: 'Discover', chip: n ? `${n} apps` : '', seed: 'discover',
      title: 'Get any app.<br>One click.', lead: `Search, hit Get, done. Every download comes straight from the official source${isMac() ? ' and lands in Applications' : ' and installs silently'}.`,
      extra: `<div class="hero-chips"><span class="hchip">${I.shield}${isMac() ? 'Checksums verified' : 'Hash-checked by winget'}</span><span class="hchip">${I.bolt}No browser, no fake buttons</span><span class="hchip">${I.box}${n ? `<b>${n}</b>&nbsp;apps` : 'Thousands of apps'}</span></div>` });
    if (S.cat.error && !S.cat.ready) { setView(top + offlineHTML(), 'home-off'); return; }
    if (!S.cat.ready) { setView(top + wingetNote() + `<div class="sec-h"><h2>Popular</h2></div><div class="grid">${'<div class="skel"></div>'.repeat(8)}</div>`, 'home-load'); return; }
    if (S.pack) { const p = S.packs.find(x => x.id === S.pack); if (p) return renderPack(p); S.pack = null; }
    const rc = recents();
    const rec = rc.length ? `<div class="sec-h"><h2>Recent searches</h2><span class="sp"></span><button class="btn btn-ghost small" data-recent-clear>Clear</button></div><div class="chips">${rc.map(x => `<button class="chip" data-recent="${esc(x)}">${I.search}${esc(x)}</button>`).join('')}</div>` : '';
    const packs = S.packs.length ? `<div class="sec-h"><h2>Starter packs</h2><span class="sub">A whole setup in one click</span></div><div class="packs">${S.packs.map(packCardHTML).join('')}</div>` : '';
    setView(top + wingetNote() + rec + packs + `<div class="sec-h"><h2>Popular</h2><span class="sub">What everyone grabs first</span><span class="sp"></span>${freeToggle()}</div><div class="grid">${freeFilter(S.cat.popular).map(cardHTML).join('')}</div>`, 'home');
  }
  function renderPack(p) {
    remember(p.items);
    const todo = p.items.filter(grabbable);
    setView(hero({ ic: `hsl(${Number(p.hue) || 0} 78% 56%)`, glyph: GLYPH.box, icon: I.box, eye: 'Starter pack', chip: plural(p.items.length, 'app'), seed: p.id, back: true,
      title: esc(p.name), lead: `${esc(p.blurb)}. Every app straight from its developer, in one click.`,
      extra: `<div class="hero-acts"><button class="btn btn-solid big" data-pack-all="${esc(p.id)}"${todo.length && !S.busy.has('pack:' + p.id) ? '' : ' disabled'}>${I.dl}${todo.length ? `Get all ${todo.length}` : 'All installed'}</button></div>` })
      + `<div class="sec-h"><h2>In this pack</h2></div><div class="grid">${p.items.map(cardHTML).join('')}</div>`, 'pack|' + p.id);
  }

  function scanGate(title, ic, glyph, icon) {
    if (S.scan) return '';
    const top = hero({ ic, glyph, icon, eye: 'Your apps', title, seed: title });
    if (S.cat.error && !S.cat.ready) return top + offlineHTML();
    return top + loadingHTML('Checking your apps', 'Grab compares what you have with the latest official versions.');
  }
  function renderUpdates() {
    const gate = scanGate('Updates', SEC.updates, GLYPH.up, I.up); if (gate) { setView(gate, 'updates-wait'); return; }
    const ups = S.scan.filter(s => s.update);
    const top = hero({ ic: SEC.updates, glyph: GLYPH.up, icon: I.up, eye: 'Your apps', chip: ups.length ? plural(ups.length, 'update') : 'All good', seed: 'updates', title: 'Updates',
      lead: ups.length ? `${ups.length === 1 ? 'One app has' : ups.length + ' apps have'} a newer official version. Update one, or all of them at once.` : 'Grab checks your apps against the latest official versions.',
      extra: `<div class="hero-acts">${ups.length ? `<button class="btn btn-solid big" data-update-all${S.busy.has('upall') ? ' disabled' : ''}>${I.up}Update all</button>` : ''}<button class="btn onink big" data-rescan>Check again</button></div>` });
    if (!ups.length) { setView(top + emptyHTML({ glyph: GLYPH.up, orb: I.check, title: "You're all up to date", text: `${plural(S.scan.length, 'app')} checked. When a developer ships a new version, it shows up here.` }), 'updates'); return; }
    setView(top + `<div class="sec-h"><h2>Available</h2><span class="sub">${plural(ups.length, 'app')}</span></div><div class="list">${ups.map((s, i) => rowHTML(s, i, { sub: `<span class="vfrom">${esc(s.installedVer || 'Installed')}</span>${I.arrow}<span class="vto">${esc(s.latest || '')}</span>`, acts: actionHTML(s) })).join('')}</div>`, 'updates');
  }

  function renderInstalled() {
    const gate = scanGate('Installed', SEC.installed, GLYPH.grid, I.grid); if (gate) { setView(gate, 'installed-wait'); return; }
    const list = S.scan.filter(s => !S.removed.has(s.id));
    const ups = list.filter(s => s.update).length;
    const top = hero({ ic: SEC.installed, glyph: GLYPH.grid, icon: I.grid, eye: 'Your apps', chip: list.length ? plural(list.length, 'app') : '', seed: 'installed', title: 'Installed',
      lead: list.length ? `${list.length === 1 ? 'One app' : list.length + ' apps'} on this ${isMac() ? 'Mac' : 'PC'} that Grab can keep up to date.` : 'Apps you grab show up here.' });
    if (!list.length) { setView(top + emptyHTML({ glyph: GLYPH.grid, orb: I.grid, title: 'No matching apps yet', text: 'Apps you grab, and apps from the catalog that you already have, show up here.', acts: '<button class="btn btn-solid big" data-go="discover">Find apps</button>' }), 'installed'); return; }
    const glance = `<div class="glance"><div class="stat" style="--ic:#8b5cf6"><span class="si">${I.grid}</span><div><b>${list.length}</b><span>Installed apps Grab knows</span></div></div><div class="stat" style="--ic:#12b886"><span class="si">${I.up}</span><div><b>${ups}</b><span>${ups === 1 ? 'Update' : 'Updates'} waiting</span></div></div><div class="stat" style="--ic:#ec4899"><span class="si">${heart(false)}</span><div><b>${S.saved.size}</b><span>Saved for later</span></div></div></div>`;
    setView(top + glance + `<div class="sec-h"><h2>Your apps</h2><span class="sp"></span><input class="filt" id="inst-filter" placeholder="Filter installed apps" autocomplete="off" spellcheck="false" value="${esc(S.instFilter)}"></div>
      <div class="list" id="inst-list">${list.map((s, i) => rowHTML(s, i, {
        sub: `${s.installedVer ? `<span>v${esc(s.installedVer)}</span>` : ''}${s.update ? ' <span class="pill up">Update</span>' : ''}`,
        acts: `${actionHTML(s)}<button class="btn btn-ghost icon" data-remove="${esc(s.id)}" title="${isMac() ? 'Move to Trash' : 'Uninstall'}">${I.trash}</button>`,
      })).join('')}</div>`, 'installed');
    applyInstFilter();
  }
  function applyInstFilter() {
    const v = S.instFilter.trim().toLowerCase();
    $$('#inst-list .rowi').forEach(r => { r.hidden = !!v && !(($('.name', r) || {}).textContent || '').toLowerCase().includes(v); });
  }
  document.addEventListener('input', (e) => { if (e.target.id === 'inst-filter') { S.instFilter = e.target.value; applyInstFilter(); } });

  function dlRowInner(j) {
    const it = S.items.get(j.itemId) || { id: j.itemId, name: j.name, home: j.home };
    const active = ACTIVE.includes(j.state);
    let st = '';
    if (j.state === 'queued') st = 'Waiting for the one before it';
    else if (j.state === 'downloading') st = j.total ? `${fmtBytes(j.received)} of ${fmtBytes(j.total)}${j.speed ? ' · ' + fmtBytes(j.speed) + '/s' : ''}` : (j.received ? fmtBytes(j.received) : (j.stage || 'Starting')) + (j.pct && !j.total ? ` · ${Math.round(j.pct)}%` : '');
    else if (j.state === 'installing') st = j.stage || 'Installing';
    else if (j.state === 'needs-quit') st = `${j.msg}. Quit it to finish installing.`;
    else st = j.msg || j.state;
    const indet = active && !(j.state === 'downloading' && (j.total || j.pct));
    let acts = '';
    if (j.state === 'queued' || j.state === 'downloading') acts = `<button class="btn btn-ghost" data-cancel="${j.id}">Cancel</button>`;
    else if (j.state === 'needs-quit') acts = `<button class="btn btn-warn" data-resume="${j.id}">Quit and install</button><button class="btn btn-ghost" data-cancel="${j.id}">Cancel</button>`;
    else if (j.state === 'done') acts = `${j.path && isMac() && j.result === 'installed' ? `<button class="btn btn-ok" data-openpath="${esc(j.path)}">Open</button>` : ''}${j.path && j.result !== 'installed' ? `<button class="btn" data-reveal="${esc(j.path)}">Show</button>` : ''}<button class="btn btn-ghost icon" data-dismiss="${j.id}" title="Remove from the list">${I.x}</button>`;
    else if (j.state === 'error') acts = `${String(j.itemId).startsWith('url:') ? '' : `<button class="btn btn-bad" data-act="${esc(j.itemId)}" data-do="${j.verb === 'update' ? 'update' : 'get'}">${I.up}Retry</button>`}<button class="btn btn-ghost icon" data-dismiss="${j.id}" title="Remove from the list">${I.x}</button>`;
    else if (!active) acts = `<button class="btn btn-ghost icon" data-dismiss="${j.id}" title="Remove from the list">${I.x}</button>`;
    const pct = j.state === 'installing' || j.state === 'done' ? 100 : j.state === 'error' || j.state === 'canceled' ? Math.max(8, Math.round(j.pct || 0)) : Math.round(j.pct || 0);
    const verb = j.verb === 'uninstall' ? 'Removing ' : j.verb === 'update' ? 'Updating ' : '';
    return { cls: `dl${indet ? ' indet' : ''}${j.state === 'error' ? ' err' : ''}${j.state === 'done' ? ' ok' : ''}${j.state === 'canceled' ? ' cx' : ''}`,
      html: `<span class="icw">${iconHTML(it)}<i class="state">${j.state === 'error' ? I.x : I.check}</i></span><div class="r-main"><div class="name">${esc(verb)}${esc(it.name || j.name)}</div><div class="bar"><i style="width:${pct}%"></i></div><div class="st">${esc(st)}</div></div><div class="acts">${acts}</div>` };
  }
  function renderDownloads() {
    const list = [...S.jobsById.values()].sort((a, b) => b.created - a.created);
    const live = list.filter(j => ACTIVE.includes(j.state) || j.state === 'needs-quit').length;
    const fin = list.some(j => ['done', 'error', 'canceled'].includes(j.state));
    const top = hero({ ic: SEC.downloads, glyph: GLYPH.dl, icon: I.dl, eye: 'Activity', chip: live ? `${live} in progress` : list.length ? 'All done' : '', seed: 'downloads', title: 'Downloads',
      lead: 'Everything you grab, as it downloads, gets checked and installs. One at a time, so nothing fights over your disk.',
      extra: fin ? '<div class="hero-acts"><button class="btn onink big" data-clear-done>Clear finished</button></div>' : '' });
    if (!list.length) { setView(top + emptyHTML({ glyph: GLYPH.dl, orb: I.dl, title: 'Nothing downloading', text: 'Hit Get on any app and it shows up here, with its progress.', acts: '<button class="btn btn-solid big" data-go="discover">Find apps</button>' }), 'downloads'); return; }
    setView(top + `<div class="list" id="dl-list">${list.map((j, i) => { const r = dlRowInner(j); return `<div class="${r.cls}" data-dl="${j.id}" style="--i:${i}">${r.html}</div>`; }).join('')}</div>`, 'downloads');
  }
  function patchDownloadRow(j) {
    const row = $(`[data-dl="${j.id}"]`);
    if (!row) { renderDownloads(); return; }
    const r = dlRowInner(j);
    const was = row.className;
    row.className = r.cls;
    const tmp = document.createElement('div'); tmp.innerHTML = r.html;
    $('.bar i', row).style.width = $('.bar i', tmp).style.width;
    $('.st', row).textContent = $('.st', tmp).textContent;
    $('.state', row).innerHTML = $('.state', tmp).innerHTML;
    const acts = $('.acts', row), nacts = $('.acts', tmp);
    if (acts.innerHTML !== nacts.innerHTML) acts.innerHTML = nacts.innerHTML;
    if (was !== row.className && /\b(ok|err)\b/.test(row.className)) kick($('.icw', row), 0.8, 0.6);
    // the hero's counter and Clear finished follow along
    const live = [...S.jobsById.values()].filter(x => ACTIVE.includes(x.state) || x.state === 'needs-quit').length;
    const chip = $('.hero .hero-eye b'); if (chip) chip.textContent = live ? `${live} in progress` : 'All done';
    if (!$('[data-clear-done]') && ['done', 'error', 'canceled'].includes(j.state)) { const tx = $('.hero .hero-tx'); if (tx) tx.insertAdjacentHTML('beforeend', '<div class="hero-acts"><button class="btn onink big" data-clear-done>Clear finished</button></div>'); }
  }

  // ---------- saved apps + settings ----------
  S.saved = new Set(store.get('grab-saved', []));
  S.savedItems = null;
  const saveBtn = (id) => { const on = S.saved.has(id); return `<button class="btn big${on ? ' saved-on' : ''}" data-save="${esc(id)}">${heart(false)}${on ? 'Saved' : 'Save'}</button>`; };
  let savedSeq = 0;
  async function renderSaved() {
    const top = (n, extra = '') => hero({ ic: SEC.saved, glyph: GLYPH.heart, icon: heart(false), eye: 'For later', chip: n ? plural(n, 'app') : '', seed: 'saved', title: 'Saved', lead: 'Apps you want to grab later. Open any app and hit Save to keep it here.', extra });
    if (!S.saved.size) { setView(top(0) + emptyHTML({ glyph: GLYPH.heart, orb: heart(false), title: 'Nothing saved yet', text: 'Open any app and hit Save to keep it here for later.', acts: '<button class="btn btn-solid big" data-go="discover">Find apps</button>' }), 'saved'); return; }
    if (!S.savedItems) {
      const my = ++savedSeq;
      setView(top(S.saved.size) + loadingHTML('Loading your saved apps', 'One moment.'), 'saved');
      try { S.savedItems = remember(await G.getMany([...S.saved])); } catch { S.savedItems = null; }
      if (my !== savedSeq || S.view !== 'saved') return;
      if (!S.savedItems) { setView(top(S.saved.size) + emptyHTML({ glyph: GLYPH.heart, orb: I.offline, title: "Couldn't load your saved apps", text: 'Try again in a moment.', acts: '<button class="btn btn-solid big" data-go="saved">Try again</button>' }), 'saved'); return; }
    }
    const list = S.savedItems.filter(it => S.saved.has(it.id));
    if (!list.length) { setView(top(S.saved.size) + (S.cat.ready ? emptyHTML({ glyph: GLYPH.heart, orb: heart(false), title: 'Saved apps are not in the catalog', text: 'They may have been renamed or removed by their developer.' }) : loadingHTML()), 'saved'); return; }
    const todo = list.filter(grabbable);
    setView(top(list.length, `<div class="hero-acts"><button class="btn btn-solid big" data-saved-all${todo.length && !S.busy.has('saved') ? '' : ' disabled'}>${I.dl}${todo.length ? `Get all ${todo.length}` : 'All installed'}</button></div>`)
      + `<div class="sec-h"><h2>Your list</h2><span class="sub">${plural(list.length, 'app')}</span></div><div class="grid">${list.map(cardHTML).join('')}</div>`, 'saved');
  }
  function renderSettings() {
    const mod = isMac() ? '\u2318' : 'Ctrl ';
    const seg = (attr, cur, opts) => `<div class="seg">${opts.map(([k, n]) => `<button class="seg-b${cur === k ? ' on' : ''}" data-${attr}="${k}">${n}</button>`).join('')}</div>`;
    setView(hero({ ic: SEC.settings, glyph: GLYPH.sliders, icon: I.sliders, eye: 'Grab', chip: 'v' + esc(S.info.version || ''), seed: 'settings', title: 'Settings', lead: 'Make Grab yours: light or dark, your colour, and how lively it feels.' })
      + `<div class="set-card"><h3>Look and feel</h3>
        <div class="set"><div><b>Appearance</b><span>Follow your ${isMac() ? 'Mac' : 'PC'}, or pick light or dark.</span></div>${seg('appearance', S.appearance, [['system', 'Automatic'], ['light', 'Light'], ['dark', 'Dark']])}</div>
        <div class="set"><div><b>Colour</b><span>The accent for the whole app, from Lumen's palette.</span></div><div class="swatches">${ACCENTS.map(([n, c]) => `<button class="sw${S.accent === c ? ' on' : ''}" data-accent="${c}" title="${n}" style="--c:${c}"></button>`).join('')}</div></div>
        <div class="set"><div><b>Motion</b><span>Jelly is Lumen's springy feel. Calm barely bounces. Off keeps everything still.</span></div>${seg('motion', S.motion, [['jelly', 'Jelly'], ['calm', 'Calm'], ['off', 'Off']])}</div></div>
      <div class="set-card"><h3>Apps</h3>
        <div class="set"><div><b>Free apps only</b><span>Hide apps Grab knows cost money.</span></div><button class="tg${S.freeOnly ? ' on' : ''}" data-free title="Free apps only"><i></i></button></div>
        <div class="set"><div><b>About prices</b><span>Grab only downloads official versions from the developer. Paid apps arrive as their normal trial, and you buy them from the developer. Only well-known paid apps are labelled, so an app with no label is not guaranteed to be free.</span></div></div></div>
      <div class="set-card"><h3>Grab</h3>
        <div class="set"><div><b>Grab ${esc(S.info.version || '')}</b><span id="upd-line">Updates download in the background and install when you restart.</span></div><button class="btn" data-upd-check>${I.up}Check for updates</button></div>
        <div class="set"><div><b>Shortcuts</b><div class="kbds"><span><kbd>${mod}K</kbd> Search</span><span><kbd>/</kbd> Search</span><span><kbd>${mod}1</kbd> to <kbd>${mod}6</kbd> Switch sections</span><span><kbd>Esc</kbd> Close</span></div></div></div>
        ${isMac() ? `<div class="set"><div><b>App Management</b><span>macOS has to allow Grab to update and remove other apps. <span id="acc-line">${accessLine()}</span></span></div><button class="btn" data-access>${I.shield}Open System Settings</button></div>` : ''}
        <div class="set"><div><b>What's new</b><span>See what changed in Grab ${esc(WHATS_NEW.version)}.</span></div><button class="btn" data-whatsnew>${I.spark}What's new</button></div></div>`, 'settings');
  }
  function render() {
    $$('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === S.view));
    RS.setProperty('--sec', SEC[S.view] || 'var(--accent)');
    if (S.view === 'discover') renderDiscover();
    else if (S.view === 'updates') renderUpdates();
    else if (S.view === 'installed') renderInstalled();
    else if (S.view === 'saved') renderSaved();
    else if (S.view === 'settings') renderSettings();
    else renderDownloads();
  }
  function go(v) { if (!VIEWS.includes(v)) return; if (S.view === v && !S.pack) return; S.pack = null; S.view = v; render(); }

  function badges() {
    const setB = (el, n) => { if (!el) return; const was = el.textContent; el.textContent = n; el.classList.toggle('show', n > 0); if (n > 0 && was !== String(n)) kick(el, 0.9, 0.6); };
    setB($('#badge-updates'), S.scan ? S.scan.filter(s => s.update && !(S.jobsByItem.get(s.id) && S.jobsByItem.get(s.id).state === 'done')).length : 0);
    setB($('#badge-downloads'), [...S.jobsById.values()].filter(j => ACTIVE.includes(j.state) || j.state === 'needs-quit').length);
    setB($('#badge-saved'), S.saved ? S.saved.size : 0);
  }
  function foot() {
    const f = $('#side-foot');
    f.classList.toggle('off', !!(S.cat.error && !S.cat.ready)); f.classList.toggle('wait', !S.cat.ready && !S.cat.error);
    if (S.cat.error && !S.cat.ready) f.textContent = 'Catalog offline';
    else if (!S.cat.ready) f.textContent = 'Loading catalog';
    else f.textContent = `${S.cat.count.toLocaleString()} apps · v${S.info.version || ''}`;
  }

  // ---------- the detail sheet ----------
  let sheetTok = 0, sheetT = null;
  async function openSheet(id) {
    const tok = ++sheetTok;
    let it = S.items.get(id);
    try { const fresh = await G.get(id); if (fresh) { remember([fresh]); it = S.items.get(id); } } catch {}
    if (!it || tok !== sheetTok) return;
    const sc = S.scan && S.scan.find(s => s.id === id);
    if (sc && sc.path && !it.path) it = { ...it, path: sc.path };
    const sh = $('#sheet'), back = $('#sheet-back');
    const inst = isInstalled(it);
    const shield = isMac()
      ? (it.verified ? `<b>Official download from ${esc(it.host)}.</b> Grab checks its checksum before installing, so a tampered file gets blocked.` : `<b>Official download from ${esc(it.host)}</b>, taken from Homebrew's reviewed catalog. This vendor does not publish a fixed checksum.`)
      : '<b>Installed through winget</b>, Microsoft\'s package manager. The installer comes from the publisher and its hash is checked before it runs.';
    const about = isMac() ? it.desc : (it.mdesc || '');
    const tags = `${verLabel(it) ? `<span class="pill">${esc(verLabel(it))}</span>` : ''}${it.label ? `<span class="pill">${esc(it.label)}</span>` : ''}${inst ? `<span class="pill">${I.check}Installed</span>` : ''}`;
    clearTimeout(sheetT);
    sh.innerHTML = `<div class="hero sh-hero enter" style="--hc:${hueColor(it.id || it.name)}">${heroBg(GLYPH.box, it.id, false)}<button class="btn icon sh-close" data-close title="Close">${I.x}</button>${iconHTML(it)}<h3>${esc(it.name)}</h3><div class="pub"><span>${esc(isMac() ? (it.host || '') : (it.publisher || ''))}</span>${tags}</div></div>
      ${about ? `<p class="about">${esc(about)}</p>` : ''}
      <div class="actions">${actionHTML(it, 'big')}${it.price && it.trial ? `<button class="btn btn-buy big" data-act="${esc(it.id)}" data-do="buy">${I.tag}Buy</button>` : ''}${it.price && !it.trial && !isInstalled(it) && !S.jobsByItem.get(it.id) ? `<button class="btn big" data-act2="${esc(it.id)}">${I.dl}Download</button>` : ''}${saveBtn(it.id)}${it.home ? `<button class="btn big" data-ext="${esc(it.home)}">${I.globe}Website</button>` : ''}${inst ? `<button class="btn btn-ghost big" data-remove="${esc(it.id)}">${I.trash}${isMac() ? 'Move to Trash' : 'Uninstall'}</button>` : ''}</div>
      ${it.price ? `<div class="paynote">${I.tag}<div><b>${it.price === 'sub' ? 'This app needs a paid subscription.' : 'This app costs money.'}</b> ${it.trial ? esc(it.trial.note) + ' After that, buy it from the developer.' : 'Buy it on the developer\'s website, then use Download to install the official version here.'}</div></div>` : ''}
      <div class="facts">
        <div class="fact"><span>Latest version</span><span>${esc(String(it.ver || '').split(',')[0] || 'n/a')}</span></div>
        ${sc && sc.installedVer ? `<div class="fact"><span>Installed</span><span>${esc(sc.installedVer)}</span></div>` : ''}
        <div class="fact"><span>Price</span><span>${it.price === 'paid' ? 'Paid' : it.price === 'sub' ? 'Subscription' : 'No price listed'}</span></div>
        ${it.price ? `<div class="fact"><span>Free trial</span><span>${it.trial ? esc(it.trial.label) : 'None confirmed'}</span></div>` : ''}
        ${isMac() ? `<div class="fact"><span>Downloads from</span><span>${esc(it.host)}</span></div>` : ''}
        <div class="fact${isMac() ? '' : ' wide'}"><span>ID</span><span>${esc(it.id)}</span></div>
        ${it.deprecated ? '<div class="fact wide warn"><span>Status</span><span>No longer maintained by its developer</span></div>' : ''}
      </div>
      <div class="shield">${I.shield}<div>${shield}</div></div>`;
    sh.dataset.id = id;
    hydrateIcons(sh);
    sh.hidden = false; back.hidden = false; sh.scrollTop = 0;
    requestAnimationFrame(() => { if (tok !== sheetTok) return; sh.classList.add('on'); back.classList.add('on'); });
  }
  function closeSheet() {
    const sh = $('#sheet'), back = $('#sheet-back');
    if (sh.hidden) return false;
    const tok = ++sheetTok; // a sheet opened while this one slides out must not be hidden by it
    sh.classList.remove('on'); back.classList.remove('on');
    clearTimeout(sheetT);
    sheetT = setTimeout(() => { if (tok !== sheetTok) return; sh.hidden = true; back.hidden = true; sh.innerHTML = ''; }, S.motion === 'off' ? 0 : 420);
    return true;
  }

  // ---------- dialogs (Lumen's Nova dialog) ----------
  let dlgDone = null;
  function dialog({ ic = 'var(--accent)', glyph = GLYPH.grab, icon = MARK, eye = 'Grab', title, lead = '', body = '', buttons = [{ label: 'OK', cls: 'btn-solid', value: true }], wide = false }) {
    if (dlgDone) dlgDone(null);
    const d = $('#dlg');
    d.innerHTML = `<div class="dlg${wide ? ' wide' : ''}" role="dialog" aria-modal="true">${hero({ ic, glyph, icon, eye, title, lead, seed: 'dlg' + title })}${body}<div class="dlg-acts">${buttons.map((b, i) => `<button class="btn big ${b.cls || ''}" data-dlg="${i}">${b.label}</button>`).join('')}</div></div>`;
    d.hidden = false; hydrateIcons(d); watchHeroes(d);
    setTimeout(() => { const p = $('.dlg-acts .btn:last-child', d); if (p) p.focus(); }, 30);
    return new Promise((resolve) => {
      dlgDone = (v) => { dlgDone = null; d.hidden = true; d.innerHTML = ''; resolve(v); };
      d.onclick = (e) => { const b = e.target.closest('[data-dlg]'); if (b) dlgDone(buttons[+b.dataset.dlg].value); else if (e.target === d) dlgDone(null); };
    });
  }
  // the What's new sheet shows ONLY this version's changes, once, after Grab updates to it (rewrite it every release)
  const WHATS_NEW = { version: '2.1', lead: 'Grab asks for what it needs to keep your apps up to date.', items: [
    ['#12b886', I.shield, 'Asks for App Management', 'macOS has to let Grab update and remove other apps. Grab now checks when you open it and walks you to the switch in System Settings in two steps.'],
    ['#5b8cff', I.spark, "What's new after every update", 'This sheet now shows up once after each Grab update, with only what changed in that version.'],
    ['#8b5cf6', I.sliders, 'A status line in Settings', 'Settings shows whether App Management is on, with a button straight to it.'],
  ] };
  function whatsNew() {
    return dialog({ wide: true, ic: 'var(--accent)', eye: "What's new", title: `Grab ${esc(WHATS_NEW.version)}`, lead: WHATS_NEW.lead,
      body: `<ul class="wn-list">${WHATS_NEW.items.map(([c, ic, t, d], i) => `<li style="--ic:${c};--i:${i}"><i>${ic}</i><div><b>${t}</b>${d}</div></li>`).join('')}</ul>`,
      buttons: [{ label: "Let's go", cls: 'btn-solid', value: true }] });
  }
  // ---------- App Management (Mac): Grab needs it to update and remove apps ----------
  let accessOpen = false, accessState = 'allowed'
  async function checkAccess() { try { accessState = await G.access() } catch { accessState = 'unknown' } const line = $('#acc-line'); if (line) line.innerHTML = accessLine(); return accessState }
  const accessLine = () => accessState === 'allowed' ? `<span class="acc ok">${I.check}On</span>` : accessState === 'denied' ? `<span class="acc bad">${I.x}Off</span>` : `<span class="acc">Not checked yet</span>`
  async function accessSheet(why) {
    if (accessOpen || !isMac()) return
    accessOpen = true
    const v = await dialog({ ic: '#12b886', glyph: GLYPH.shield || I.shield, icon: I.shield, eye: 'One permission', title: 'Let Grab update your apps',
      lead: why || 'macOS asks you to allow apps that update or remove other apps. Grab needs it to install updates.',
      body: `<ol class="acc-steps"><li style="--i:0"><b>Open App Management</b><span>The button below takes you straight there, in System Settings, Privacy and Security.</span></li><li style="--i:1"><b>Turn on Grab</b><span>Grab is already in the list. Flip its switch on, then come back here.</span></li></ol>`,
      buttons: [{ label: 'Later', cls: '', value: false }, { label: 'Open System Settings', cls: 'btn-solid', value: true }] })
    accessOpen = false
    store.set('grab-access-asked', Date.now())
    if (v) G.openAccess().catch(() => {})
  }
  // back from System Settings: check again, and say so once it is on
  window.addEventListener('focus', async () => {
    if (!isMac() || accessState === 'allowed') return
    const was = accessState
    if (await checkAccess() === 'allowed' && was !== 'allowed') { toast('Grab can update your apps now'); if (accessOpen && dlgDone) dlgDone(false) }
  })


  // ---------- toasts ----------
  function toast(msg, kind = 'ok') {
    if (kind === true) kind = 'bad';
    const t = document.createElement('div');
    t.className = 'toast ' + kind;
    t.innerHTML = `<span class="t-orb">${kind === 'bad' ? I.x : kind === 'info' ? I.dl : I.check}</span><span>${esc(msg)}</span>`;
    const box = $('#toasts');
    box.appendChild(t); while (box.children.length > 4) box.firstElementChild.remove();
    kick($('.t-orb', t), 0.8, 0.6);
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 320); }, kind === 'bad' ? 6000 : 3800);
  }

  // ---------- actions ----------
  async function confirmRemove(id) {
    const it = S.items.get(id) || { id, name: 'this app' };
    return dialog({ ic: '#f0506e', glyph: I.trash, icon: iconHTML(it), eye: isMac() ? 'Move to Trash' : 'Uninstall', title: esc(it.name),
      body: `<p class="dlg-tx">${isMac() ? `Grab moves <b>${esc(it.name)}</b> to the Trash. If it is open, Grab quits it first. You can put it back from the Trash.` : `Grab asks winget to uninstall <b>${esc(it.name)}</b>. Its own uninstaller may ask you a question.`}</p>`,
      buttons: [{ label: 'Cancel', cls: 'btn-ghost', value: false }, { label: isMac() ? 'Move to Trash' : 'Uninstall', cls: 'btn-bad', value: true }] });
  }
  async function doAct(id, what, jobId) {
    try {
      if (what === 'get') await G.install(id);
      else if (what === 'update') await G.update(id);
      else if (what === 'open') { const r = await G.open(id); if (r) toast(`Could not open ${(S.items.get(id) || {}).name || 'the app'}`, 'bad'); }
      else if (what === 'cancel') await G.cancel(Number(jobId));
      else if (what === 'quit') await G.resume(Number(jobId));
      else if (what === 'detail') openSheet(id);
      else if (what === 'buy') {
        const it = S.items.get(id) || {};
        let home = it.home || it.mhome;
        if (!home && !isMac()) { const m = await G.meta(id).catch(() => null); home = m && m.home; }
        if (home) { G.external(home); toast(`Opening ${it.name || 'the developer'}'s website`, 'info'); } else openSheet(id);
      }
    } catch (e) { toast(errText(e), 'bad'); }
  }
  async function getMany(ids, key, label) {
    if (S.busy.has(key)) return 0;
    S.busy.add(key);
    let n = 0;
    try { for (const id of ids) { try { await G.install(id); n++; } catch {} } } finally { S.busy.delete(key); }
    if (n) toast(`${label} ${plural(n, 'app')}`, 'info');
    return n;
  }

  document.addEventListener('click', async (e) => {
    const t = e.target.closest('button, [data-open], [data-pack], [data-ext], .nav-btn');
    if (!t || t.closest('#dlg')) return;
    if (t.matches('.nav-btn')) { go(t.dataset.view); return; }
    if (t.dataset.act) { e.stopPropagation(); if (t.dataset.do !== 'none') doAct(t.dataset.act, t.dataset.do, t.dataset.job); return; }
    if (t.dataset.ext) { G.external(t.dataset.ext); return; }
    if (t.dataset.go) { if (t.dataset.go === 'saved') S.savedItems = null; S.view = ''; go(t.dataset.go); return; }
    if (t.dataset.act2) { e.stopPropagation(); try { await G.install(t.dataset.act2); t.remove(); toast('Downloading the official version', 'info'); } catch (err) { toast(errText(err), 'bad'); } return; }
    if (t.dataset.save) {
      const id = t.dataset.save; if (S.saved.has(id)) S.saved.delete(id); else S.saved.add(id);
      store.set('grab-saved', [...S.saved]); S.savedItems = null;
      const nb = document.createElement('div'); nb.innerHTML = saveBtn(id); const b = nb.firstElementChild; t.replaceWith(b); kick(b, 1, 0.8);
      badges(); if (S.view === 'saved') render(); return;
    }
    if (t.dataset.savedAll != null) { const todo = (S.savedItems || []).filter(it => S.saved.has(it.id) && grabbable(it)); t.disabled = true; await getMany(todo.map(x => x.id), 'saved', 'Grabbing'); return; }
    if (t.dataset.motion) { setMotion(t.dataset.motion); render(); kick($(`[data-motion="${t.dataset.motion}"]`), 1, 0.6); return; }
    if (t.dataset.accent) { applyAccent(t.dataset.accent); render(); kick($(`[data-accent="${sel(t.dataset.accent)}"]`), 1, 0.8); return; }
    if (t.dataset.appearance) { applyAppearance(t.dataset.appearance); render(); return; }
    if (t.dataset.whatsnew != null) { whatsNew(); return; }
    if (t.dataset.access != null) { G.openAccess().catch(() => {}); return; }
    if (t.dataset.updCheck != null) {
      t.disabled = true; const label = t.innerHTML; t.textContent = 'Checking';
      const u = await G.updCheck().catch(() => null); const line = $('#upd-line');
      if (line) line.textContent = !u ? 'Could not check right now. Try again in a moment.' : u.status === 'uptodate' ? `You have the latest version, Grab ${u.current || S.info.version}.` : ['available', 'downloading', 'unpacking', 'ready'].includes(u.status) ? `Grab ${String(u.latest || '').replace(/^v/, '')} is on its way. Watch the card in the side rail.` : (u.error ? `Could not check: ${u.error}` : 'Could not check right now.');
      t.disabled = false; t.innerHTML = label; return;
    }
    if (t.dataset.free != null) { S.freeOnly = !S.freeOnly; try { localStorage.setItem('grab-free', S.freeOnly ? '1' : '0'); } catch {} render(); return; }
    if (t.dataset.packBack != null) { S.pack = null; render(); return; }
    if (t.dataset.packAll) {
      const p = S.packs.find(x => x.id === t.dataset.packAll); if (!p) return;
      const todo = p.items.filter(grabbable);
      t.disabled = true; await getMany(todo.map(x => x.id), 'pack:' + p.id, 'Grabbing');
      return;
    }
    if (t.dataset.clearDone != null) { for (const j of [...S.jobsById.values()]) if (['done', 'error', 'canceled'].includes(j.state)) { await G.dismiss(j.id).catch(() => {}); S.jobsById.delete(j.id); if (S.jobsByItem.get(j.itemId) === j) S.jobsByItem.delete(j.itemId); } if (S.view === 'downloads') renderDownloads(); badges(); return; }
    if (t.dataset.pack) { S.pack = t.dataset.pack; render(); return; }
    if (t.dataset.url != null) { try { await G.installUrl(t.dataset.url); toast('Downloading from the link', 'info'); go('downloads'); } catch { toast('That link does not look right', 'bad'); } return; }
    if (t.dataset.cancel) { G.cancel(Number(t.dataset.cancel)).catch(() => {}); return; }
    if (t.dataset.resume) { G.resume(Number(t.dataset.resume)).catch(() => {}); return; }
    if (t.dataset.dismiss) { const id = Number(t.dataset.dismiss); await G.dismiss(id).catch(() => {}); const j = S.jobsById.get(id); S.jobsById.delete(id); if (j && S.jobsByItem.get(j.itemId) === j) S.jobsByItem.delete(j.itemId); if (S.view === 'downloads') renderDownloads(); badges(); return; }
    if (t.dataset.openpath) { G.openPath(t.dataset.openpath); return; }
    if (t.dataset.reveal) { G.reveal(t.dataset.reveal); return; }
    if (t.dataset.remove) {
      e.stopPropagation();
      const id = t.dataset.remove, it = S.items.get(id);
      if (!(await confirmRemove(id))) return;
      try {
        await G.uninstall(id);
        if (isMac()) { S.removed.add(id); S.installed.delete(id); toast(`${it ? it.name : 'App'} moved to the Trash`); }
        else toast(`Removing ${it ? it.name : 'the app'}`, 'info');
        closeSheet(); refreshActions(id); if (S.view === 'installed' || S.view === 'updates') render();
      } catch (err) { toast(errText(err), 'bad'); }
      return;
    }
    if (t.dataset.close != null) { closeSheet(); return; }
    if (t.dataset.updateAll != null) {
      const ups = (S.scan || []).filter(s => s.update && !ACTIVE.includes((S.jobsByItem.get(s.id) || {}).state));
      t.disabled = true; await getMany(ups.map(s => s.id), 'upall', 'Updating');
      return;
    }
    if (t.dataset.rescan != null) {
      t.disabled = true; S.scan = null; render();
      try { S.scan = remember(await G.scan(true)) || []; } catch (err) { S.scan = S.scan || []; toast(`Could not check your apps: ${errText(err)}`, 'bad'); }
      if (S.view === 'updates' || S.view === 'installed') render(); badges(); return;
    }
    if (t.dataset.retryCat != null) { S.cat.error = null; foot(); render(); G.refreshCatalog().catch(() => {}); return; }
    if (t.dataset.open) { openSheet(t.dataset.open); return; }
  });
  $('#sheet-back').addEventListener('click', closeSheet);

  // ---------- search ----------
  const qEl = $('#q');
  let qTimer = null, qSeq = 0;
  qEl.addEventListener('input', () => {
    S.q = qEl.value;
    $('#clear').hidden = !S.q;
    clearTimeout(qTimer);
    qTimer = setTimeout(runSearch, 90);
  });
  const recents = () => store.get('grab-recent', []);
  function addRecent(q) { q = (q || '').trim(); if (!q || /^https?:/i.test(q) || q.length > 40) return; store.set('grab-recent', [q, ...recents().filter(x => x.toLowerCase() !== q.toLowerCase())].slice(0, 6)); }
  document.addEventListener('click', (e) => {
    const c = e.target.closest('[data-recent]'); if (c) { qEl.value = c.dataset.recent; S.q = qEl.value; $('#clear').hidden = false; runSearch(); return; }
    if (e.target.closest('[data-recent-clear]')) { store.set('grab-recent', []); render(); }
  });
  async function runSearch() {
    clearTimeout(qTimer);
    const my = ++qSeq;
    const q = S.q.trim();
    let res = [];
    if (q && !/^https?:\/\//i.test(q) && S.cat.ready) { try { res = await G.search(q); } catch { res = []; } }
    if (my !== qSeq) return; // a newer search already answered: never let an older one overwrite its results
    S.results = remember(res); S.resultsQ = q;
    if (q) { S.pack = null; if (S.view !== 'discover') S.view = 'discover'; }
    if (S.view === 'discover') render();
  }
  qEl.addEventListener('keydown', async (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); if (qEl.value) { qEl.value = ''; S.q = ''; $('#clear').hidden = true; runSearch(); } else qEl.blur(); }
    if (e.key === 'Enter') {
      addRecent(qEl.value);
      if (S.resultsQ !== S.q.trim()) await runSearch(); // Enter right after typing: wait for this query's results, not the last one's
      const b = $('[data-url]'); if (b) b.click(); else if (S.results[0] && S.resultsQ === S.q.trim()) openSheet(S.results[0].id);
    }
  });
  $('#clear').addEventListener('click', (e) => { e.preventDefault(); qEl.value = ''; S.q = ''; $('#clear').hidden = true; runSearch(); qEl.focus(); });
  const typing = (el) => el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); qEl.focus(); qEl.select(); }
    else if ((e.metaKey || e.ctrlKey) && /^[1-6]$/.test(e.key)) { e.preventDefault(); const b = $$('.nav-btn')[+e.key - 1]; if (b) { b.click(); kick(b, 0.7, 0.5); } }
    else if (e.key === '/' && !typing(document.activeElement)) { e.preventDefault(); qEl.focus(); }
    else if (e.key === 'Escape') { if (dlgDone) dlgDone(null); else closeSheet(); }
  });

  // ---------- events from main ----------
  G.onCatalog((c) => {
    S.cat = c;
    if (c.ready) G.packs().then(p => { S.packs = p || []; for (const x of S.packs) remember(x.items); if (S.view === 'discover' && !S.q) render(); }).catch(() => {});
    remember(c.popular); foot();
    // a background catalog refresh must not pull you out of the screen you are on
    if (S.q && S.view === 'discover') runSearch(); else render();
  });
  G.onScan((list) => {
    S.scan = remember(list || []); S.removed.clear(); for (const s of S.scan) S.installed.add(s.id); badges();
    if (S.view === 'updates' || S.view === 'installed') render(); else for (const s of S.scan) refreshActions(s.id);
  });
  G.onJob((j) => {
    const prev = S.jobsById.get(j.id);
    S.jobsById.set(j.id, j);
    S.jobsByItem.set(j.itemId, j);
    const became = (st) => j.state === st && (!prev || prev.state !== st);
    if (became('error') && /not permitted|EPERM|App Management/i.test(String(j.msg || ''))) { accessState = 'denied'; accessSheet('Grab could not change an app in Applications because macOS has not allowed it yet.') }
    if (became('done')) {
      if (j.verb === 'uninstall') { S.installed.delete(j.itemId); S.removed.add(j.itemId); toast(`${j.name} removed`); }
      else {
        S.installed.add(j.itemId); S.removed.delete(j.itemId);
        if (!document.hasFocus() && j.result !== 'saved') { try { new Notification(j.verb === 'update' ? `${j.name} is up to date` : `${j.name} is ready`, { body: j.result === 'pkg-opened' ? 'Finish in the installer window.' : 'Installed by Grab, straight from the developer.', silent: true }); } catch {} }
        if (S.scan) { const s = S.scan.find(x => x.id === j.itemId); if (s) s.update = false; }
        toast(j.result === 'pkg-opened' ? `${j.name}: finish in the installer` : j.result === 'saved' ? `${j.name} saved to Downloads` : `${j.name} ${j.verb === 'update' ? 'updated' : 'installed'}`);
      }
    }
    if (became('error')) toast(`${j.name}: ${j.msg}`, 'bad');
    if (became('needs-quit')) toast(`${j.msg}. Hit Quit and install to finish.`, 'bad');
    refreshActions(j.itemId);
    badges();
    if (S.view === 'downloads') patchDownloadRow(j);
    else if ((S.view === 'updates' || S.view === 'installed') && became('done')) render();
  });

  // ---------- the update card and the restart screen (Lumen's update poster) ----------
  let U = {};
  function renderUpd(u) {
    if (!u) return;
    U = u;
    const card = $('#self-card'), btn = $('#self-btn'), alt = $('#self-alt');
    const v = String(u.latest || '').replace(/^v/, ''), s = u.status;
    const show = ['available', 'downloading', 'unpacking', 'ready'].includes(s) || (s === 'error' && !card.hidden);
    if (show && card.hidden) { card.hidden = false; card.style.animation = 'none'; void card.offsetWidth; card.style.animation = ''; }
    if (!show && s !== 'installing') card.hidden = true;
    const pct = s === 'ready' || s === 'unpacking' ? 100 : s === 'downloading' ? (u.progress || 0) : 0;
    card.classList.toggle('spin', s === 'unpacking' || (s === 'downloading' && !u.size));
    card.classList.toggle('calm', s === 'available' || s === 'error' || s === 'ready');
    $('#self-fill').style.transform = `scaleX(${pct / 100})`;
    $('#self-arc').style.strokeDashoffset = String(100 - pct);
    const T = {
      available: ['New version', `Grab ${v}`, 'Ready to download in the background.', 'Download', ''],
      downloading: ['Downloading', `Grab ${v}`, u.size ? `${fmtBytes(u.bytes || 0)} of ${fmtBytes(u.size)}${u.speed ? ' · ' + fmtBytes(u.speed) + '/s' : ''}` : 'Starting the download', '', 'Cancel'],
      unpacking: ['Almost there', `Checking ${v}`, 'Unpacking and verifying the download.', '', ''],
      ready: ['Ready to install', `Grab ${v}`, 'Downloaded and checked. Restart to switch; it takes a few seconds.', 'Restart to update', ''],
      installing: ['Updating', 'Restarting Grab', '', '', ''],
      error: ['Update paused', 'The update hit a snag', u.error ? String(u.error).slice(0, 90) : 'Try again in a moment.', 'Try again', ''],
    }[s];
    if (T) {
      $('#self-eye').textContent = T[0]; $('#self-title').textContent = T[1]; $('#self-sub').textContent = T[2];
      btn.textContent = T[3]; btn.hidden = !T[3]; btn.disabled = false; alt.textContent = T[4]; alt.hidden = !T[4];
    }
    if (s === 'ready' && !card.dataset.ready) { card.dataset.ready = '1'; kick(btn, 1, 0.8); }
    const rs = $('#restart');
    if (s === 'installing') { $('#rs-num').textContent = v; $('#rs-sub').textContent = v ? `Back in a few seconds with Grab ${v}` : 'Back in a few seconds'; rs.hidden = false; }
    else rs.hidden = true;
    if (u.justUpdated && !S.greeted) {
      S.greeted = true;
      setTimeout(() => toast(`Updated to Grab ${u.justUpdated}`), 900);
      const vv = String(u.justUpdated).split('.').slice(0, 2).join('.'); if (vv === WHATS_NEW.version && !store.get('grab-seen-' + vv, false)) { store.set('grab-seen-' + vv, true); setTimeout(whatsNew, 1400); }
    }
  }
  G.onUpdater(renderUpd);
  $('#self-btn').addEventListener('click', async () => {
    const s = U.status;
    if (s === 'error') { G.updCheck().catch(() => {}); return; }
    if (s === 'ready') {
      const live = [...S.jobsById.values()].filter(j => ACTIVE.includes(j.state)).length;
      if (live && !(await dialog({ ic: '#f59e0b', glyph: GLYPH.dl, icon: I.dl, eye: 'Restart to update', title: 'Still installing', body: `<p class="dlg-tx">Grab is still working on <b>${plural(live, 'app')}</b>. Restarting now stops ${live === 1 ? 'it' : 'them'}, and you would need to grab ${live === 1 ? 'it' : 'them'} again.</p>`, buttons: [{ label: 'Wait', cls: 'btn-ghost', value: false }, { label: 'Restart anyway', cls: 'btn-warn', value: true }] }))) return;
    }
    $('#self-btn').disabled = true;
    G.updInstall().catch(() => {});
  });
  $('#self-alt').addEventListener('click', () => { if (U.status === 'downloading') G.updCancel().catch(() => {}); });

  // ---------- boot ----------
  (async () => {
    S.info = await G.info();
    document.body.classList.add(isMac() ? 'mac' : 'win');
    $('#kbd').textContent = isMac() ? '\u2318K' : 'Ctrl K';
    if (S.appearance !== 'system' && G.appearance) G.appearance(S.appearance).catch(() => {});
    S.cat = await G.catalog();
    remember(S.cat.popular);
    for (const j of await G.jobs()) { S.jobsById.set(j.id, j); S.jobsByItem.set(j.itemId, j); if (j.state === 'done' && j.verb !== 'uninstall' && j.result !== 'saved') S.installed.add(j.itemId); }
    foot(); render(); badges();
    if (S.cat.ready) {
      G.scan(false).then(list => { if (!list || S.scan) return; S.scan = remember(list); for (const s of list) S.installed.add(s.id); badges(); if (S.view === 'updates' || S.view === 'installed') render(); else for (const s of list) refreshActions(s.id); }).catch(() => {});
      G.packs().then(p => { S.packs = p || []; for (const x of S.packs) remember(x.items); if (S.view === 'discover' && !S.q) render(); }).catch(() => {});
    }
    G.updState().then(renderUpd).catch(() => {});
    // people coming from Grab 1.x see what changed once
    if (!store.get('grab-seen-2.0', false)) { const was1x = store.get('grab-theme', null) != null || store.get('grab-saved', null) != null; store.set('grab-seen-2.0', true); if (was1x && !S.greeted) setTimeout(whatsNew, 900); }
    G.ready();
    // Mac: can Grab update and remove apps? Ask when you open Grab if it cannot (and once, at the start, when unsure)
    if (isMac()) setTimeout(async () => { const st = await checkAccess(); if (st === 'denied' || (st === 'unknown' && !store.get('grab-access-asked', 0))) accessSheet() }, 1600)
  })().catch(e => { console.warn('boot failed', e && e.message); G.ready(); });
})();
