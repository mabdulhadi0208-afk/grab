'use strict';
/* Grab renderer. Talks to the main process only through window.grab (preload).
   Grab 2.2: the family's Maison look (paper and ink, Instrument Serif titles, one emerald accent) with the flow hover
   on every button, chip, tab and menu item, and Lumen's jelly press springs (jelly.js, copied from Lumen unchanged).
   Nothing runs while Grab sits idle: no animation frame loop, no timers, no CSS loops except loading indicators. */
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
    scan: null, jobsById: new Map(), jobsByItem: new Map(), items: new Map(), installed: new Set(), removed: new Set(), instFilter: '', savedFilter: '', busy: new Set(),
    instSort: (() => { try { return localStorage.getItem('grab-inst-sort') === 'updates' ? 'updates' : 'name'; } catch { return 'name'; } })(),
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

  // ---------- appearance: light, dark or follow the system (2.2: one accent, the family's emerald) ----------
  const darkMQ = matchMedia('(prefers-color-scheme: dark)');
  const paintScheme = () => document.documentElement.classList.toggle('dark', darkMQ.matches);
  darkMQ.addEventListener('change', paintScheme); paintScheme();
  S.appearance = store.get('grab-appearance', 'system');
  function applyAppearance(m) { S.appearance = ['system', 'light', 'dark'].includes(m) ? m : 'system'; store.set('grab-appearance', S.appearance); if (G.appearance) G.appearance(S.appearance).catch(() => {}); }

  // ---------- motion: Lumen's Jelly (ui/jelly.js), same springs, same selectors as Lumen's pages ----------
  const OLD_MOTION = { chill: 'calm', bouncy: 'jelly', max: 'jelly' };
  function setMotion(m) { S.motion = ['jelly', 'calm', 'off'].includes(m) ? m : 'jelly'; store.set('grab-motion-v3', S.motion); document.body.dataset.motion = S.motion; if (window.Jelly) Jelly.setMode(S.motion); }
  setMotion(store.get('grab-motion-v3', null) || OLD_MOTION[(() => { try { return localStorage.getItem('grab-motion-v2'); } catch { return ''; } })()] || 'jelly');
  // 2.2: only the press springs (a squash on press, a small pop on release); hover is the flow, scrolling is native
  if (window.Jelly) Jelly.init({ press: '.btn, .chip, .seg-b, .nav-btn, .clear, .tg, .ctx-i' });

  // ---------- the flow hover: the fill grows from where the pointer came in and leaves where it went out ----------
  const FLOW = '.btn, .chip, .seg-b, .nav-btn, .clear, .ctx-i';
  const flowAt = (e) => {
    const t = e.target && e.target.closest ? e.target.closest(FLOW) : null;
    if (!t || (e.relatedTarget && t.contains(e.relatedTarget))) return;
    const r = t.getBoundingClientRect();
    t.style.setProperty('--fx', Math.round(e.clientX - r.left) + 'px'); t.style.setProperty('--fy', Math.round(e.clientY - r.top) + 'px');
  };
  document.addEventListener('pointerover', flowAt, { passive: true });
  document.addEventListener('pointerout', flowAt, { passive: true });

  // ---------- section mastheads: an eyebrow, a serif title, a lead; Discover's is a noir cover ----------
  function hero({ glyph, icon, eye, chip, title, lead, extra = '', cls = '', back = false }) {
    return `<div class="hero${back ? ' has-back' : ''}${cls ? ' ' + cls : ''}">${cls.includes('noir') && glyph ? `<span class="hero-art" aria-hidden="true">${glyph}</span>` : ''}${back ? `<button class="btn small back" data-pack-back>${I.back}All apps</button>` : ''}${icon ? `<div class="hero-ic">${icon}</div>` : ''}<div class="hero-tx"><div class="hero-eye"><span>${esc(eye)}</span>${chip != null && chip !== '' ? `<i></i><b>${chip}</b>` : ''}</div><h1>${title}</h1>${lead ? `<p class="lead">${lead}</p>` : ''}${extra}</div></div>`;
  }

  // ---------- helpers ----------
  function remember(list) { for (const it of list || []) if (it && it.id) S.items.set(it.id, { ...(S.items.get(it.id) || {}), ...it }); return list || []; }
  function fmtBytes(n) { if (!n) return '0 MB'; const u = ['B', 'KB', 'MB', 'GB']; let i = 0; while (n >= 1024 && i < 3) { n /= 1024; i++; } return (i >= 2 ? n.toFixed(1) : Math.round(n)) + ' ' + u[i]; }
  function hue(s) { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % 360; }
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
    return `<div class="ic" data-id="${esc(it.id || '')}" data-icons="${esc((it.icons || []).join('|'))}" data-fav="${esc(it.fav || '')}" data-path="${esc(it.path || '')}"><div class="letter">${esc(ch)}</div><img alt=""></div>`;
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
      return `<button class="btn prog${pct == null ? ' indet' : ''}${cls}" data-act="${id}" data-do="cancel" data-job="${j.id}" title="Cancel"><i class="fill" style="transform:scaleX(${(pct || 0) / 100})"></i><span>${esc(label)}</span><i class="x">${I.x}</i></button>`;
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
        $('.fill', b).style.transform = $('.fill', nb).style.transform;
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
    return `<div class="card" data-open="${esc(it.id)}" tabindex="0" style="--i:${i}">
      <div class="c-top">${iconHTML(it)}${tags ? `<div class="c-tags">${tags}</div>` : ''}</div>
      <div><div class="c-name">${esc(it.name)}</div><div class="c-desc">${esc(subLine(it))}</div></div>
      <div class="c-foot"><span class="ver">${esc(verLabel(it))}</span>${actionHTML(it)}</div></div>`;
  }
  function rowHTML(it, i, right) {
    remember([it]);
    return `<div class="rowi" data-open="${esc(it.id)}" tabindex="0" style="--i:${i}">${iconHTML(it)}<div class="r-main"><div class="name">${esc(it.name)}</div><div class="desc">${right.sub}</div></div><div class="acts">${right.acts}</div></div>`;
  }
  function packCardHTML(p, i) {
    return `<div class="pack" data-pack="${esc(p.id)}" tabindex="0" style="--i:${i}"><span class="pack-n">${plural(p.items.length, 'app')}</span><div class="pack-ic">${p.items.slice(0, 4).map(iconHTML).join('')}</div><div class="pack-t">${esc(p.name)}</div><div class="pack-b">${esc(p.blurb)}</div></div>`;
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
    const fid = document.activeElement && ['inst-filter', 'saved-filter'].includes(document.activeElement.id) ? document.activeElement.id : '';
    const filt = fid ? document.activeElement.selectionStart : -1;
    view.innerHTML = `<div class="view-in${fresh ? '' : ' still'}">${html}</div>`;
    const vi = view.firstElementChild;
    [...vi.children].forEach((c, i) => c.style.setProperty('--n', Math.min(i, 8)));
    if (!fresh) { for (const h of $$('.hero.enter', vi)) h.classList.remove('enter'); view.scrollTop = keep; }
    else view.scrollTop = 0;
    hydrateIcons(view);
    if (filt >= 0) { const f = $('#' + fid); if (f) { f.focus(); try { f.setSelectionRange(filt, filt); } catch {} } }
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
    const top = hero({ cls: 'noir', glyph: GLYPH.grab, eye: 'Discover', chip: n ? `${n} apps` : '',
      title: 'Get any app.<br><em>One click.</em>', lead: `Search, hit Get, done. Every download comes straight from the official source${isMac() ? ' and lands in Applications' : ' and installs silently'}.`,
      extra: `<div class="hero-chips"><span class="hchip">${I.shield}${isMac() ? 'Checksums verified' : 'Hash-checked by winget'}</span><span class="hchip">${I.bolt}No browser, no fake buttons</span><span class="hchip">${I.box}<span>${n ? `<b>${n}</b> apps` : 'Thousands of apps'}</span></span></div>` });
    if (S.cat.error && !S.cat.ready) { setView(top + offlineHTML(), 'home-off'); return; }
    if (!S.cat.ready) { setView(top + wingetNote() + `<div class="sec-h"><h2>Popular</h2></div><div class="grid">${'<div class="skel"></div>'.repeat(8)}</div>`, 'home-load'); return; }
    if (S.pack) { const p = S.packs.find(x => x.id === S.pack); if (p) return renderPack(p); S.pack = null; }
    const rc = recents();
    const rec = rc.length ? `<div class="sec-h"><h2>Recent searches</h2><span class="sp"></span><button class="btn btn-ghost small" data-recent-clear>Clear</button></div><div class="chips">${rc.map(x => `<button class="chip" data-recent="${esc(x)}">${I.search}<span>${esc(x)}</span><i class="chip-x" data-recent-x="${esc(x)}" title="Remove">${I.x}</i></button>`).join('')}</div>` : '';
    const packs = S.packs.length ? `<div class="sec-h"><h2>Starter packs</h2><span class="sub">A whole setup in one click</span></div><div class="packs">${S.packs.map(packCardHTML).join('')}</div>` : '';
    setView(top + wingetNote() + rec + packs + `<div class="sec-h"><h2>Popular</h2><span class="sub">What everyone grabs first</span><span class="sp"></span>${freeToggle()}</div><div class="grid">${freeFilter(S.cat.popular).map(cardHTML).join('')}</div>`, 'home');
  }
  function renderPack(p) {
    remember(p.items);
    const todo = p.items.filter(grabbable);
    setView(hero({ glyph: GLYPH.box, icon: I.box, eye: 'Starter pack', chip: plural(p.items.length, 'app'), seed: p.id, back: true,
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
    const gate = scanGate('Updates', null, GLYPH.up, I.up); if (gate) { setView(gate, 'updates-wait'); return; }
    const ups = S.scan.filter(s => s.update);
    const top = hero({ glyph: GLYPH.up, icon: I.up, eye: 'Your apps', chip: ups.length ? plural(ups.length, 'update') : 'All good', seed: 'updates', title: 'Updates',
      lead: ups.length ? `${ups.length === 1 ? 'One app has' : ups.length + ' apps have'} a newer official version. Update one, or all of them at once.` : 'Grab checks your apps against the latest official versions.',
      extra: `<div class="hero-acts">${ups.length ? `<button class="btn btn-solid big" data-update-all${S.busy.has('upall') ? ' disabled' : ''}>${I.up}Update all</button>` : ''}<button class="btn big" data-rescan>Check again</button></div>` });
    if (!ups.length) { setView(top + emptyHTML({ glyph: GLYPH.up, orb: I.check, title: "You're all up to date", text: `${plural(S.scan.length, 'app')} checked. When a developer ships a new version, it shows up here.` }), 'updates'); return; }
    setView(top + `<div class="sec-h"><h2>Available</h2><span class="sub">${plural(ups.length, 'app')}</span></div><div class="list">${ups.map((s, i) => rowHTML(s, i, { sub: `<span class="vfrom">${esc(s.installedVer || 'Installed')}</span>${I.arrow}<span class="vto">${esc(s.latest || '')}</span>`, acts: actionHTML(s) })).join('')}</div>`, 'updates');
  }

  function renderInstalled() {
    const gate = scanGate('Installed', null, GLYPH.grid, I.grid); if (gate) { setView(gate, 'installed-wait'); return; }
    const list = S.scan.filter(s => !S.removed.has(s.id));
    const ups = list.filter(s => s.update).length;
    const top = hero({ glyph: GLYPH.grid, icon: I.grid, eye: 'Your apps', chip: list.length ? plural(list.length, 'app') : '', seed: 'installed', title: 'Installed',
      lead: list.length ? `${list.length === 1 ? 'One app' : list.length + ' apps'} on this ${isMac() ? 'Mac' : 'PC'} that Grab can keep up to date.` : 'Apps you grab show up here.' });
    if (!list.length) { setView(top + emptyHTML({ glyph: GLYPH.grid, orb: I.grid, title: 'No matching apps yet', text: 'Apps you grab, and apps from the catalog that you already have, show up here.', acts: '<button class="btn btn-solid big" data-go="discover">Find apps</button>' }), 'installed'); return; }
    if (S.instSort === 'updates') list.sort((a, b) => (b.update ? 1 : 0) - (a.update ? 1 : 0) || String(a.name).localeCompare(String(b.name)));
    else list.sort((a, b) => String(a.name).localeCompare(String(b.name)));
    const glance = `<div class="glance"><div class="stat"><span class="si">${I.grid}</span><div><b>${list.length}</b><span>Installed apps Grab knows</span></div></div><div class="stat"><span class="si">${I.up}</span><div><b>${ups}</b><span>${ups === 1 ? 'Update' : 'Updates'} waiting</span></div></div><div class="stat"><span class="si">${heart(false)}</span><div><b>${S.saved.size}</b><span>Saved for later</span></div></div></div>`;
    setView(top + glance + `<div class="sec-h"><h2>Your apps</h2><span class="sp"></span><div class="seg">${[['name', 'A to Z'], ['updates', 'Updates first']].map(([k, n]) => `<button class="seg-b${S.instSort === k ? ' on' : ''}" data-inst-sort="${k}">${n}</button>`).join('')}</div><input class="filt" id="inst-filter" placeholder="Filter installed apps" autocomplete="off" spellcheck="false" value="${esc(S.instFilter)}"></div>
      <div class="list" id="inst-list">${list.map((s, i) => rowHTML(s, i, {
        sub: `${s.installedVer ? `<span>v${esc(s.installedVer)}</span>` : ''}${s.update ? ' <span class="pill up">Update</span>' : ''}`,
        acts: `${actionHTML(s)}<button class="btn btn-ghost icon" data-remove="${esc(s.id)}" title="${isMac() ? 'Move to Trash' : 'Uninstall'}">${I.trash}</button>`,
      })).join('')}</div><div class="empty" id="inst-none" hidden><div class="e-title">No app matches</div><div class="e-tx">Nothing installed has that in its name.</div><div class="e-acts"><button class="btn" data-filter-clear>Clear the filter</button></div></div>`, 'installed');
    applyInstFilter();
  }
  function applyInstFilter() {
    const v = S.instFilter.trim().toLowerCase();
    let shown = 0;
    $$('#inst-list .rowi').forEach(r => { r.hidden = !!v && !(($('.name', r) || {}).textContent || '').toLowerCase().includes(v); if (!r.hidden) shown++; });
    const none = $('#inst-none'); if (none) none.hidden = shown > 0;
  }
  document.addEventListener('input', (e) => { if (e.target.id === 'inst-filter') { S.instFilter = e.target.value; applyInstFilter(); } if (e.target.id === 'saved-filter') { S.savedFilter = e.target.value; applySavedFilter(); } });
  function applySavedFilter() {
    const v = (S.savedFilter || '').trim().toLowerCase();
    let shown = 0;
    $$('#saved-grid .card').forEach(c => { c.hidden = !!v && !(($('.c-name', c) || {}).textContent || '').toLowerCase().includes(v); if (!c.hidden) shown++; });
    const none = $('#saved-none'); if (none) none.hidden = shown > 0;
  }

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
      html: `<span class="icw">${iconHTML(it)}<i class="state">${j.state === 'error' ? I.x : I.check}</i></span><div class="r-main"><div class="name">${esc(verb)}${esc(it.name || j.name)}</div><div class="bar"><i style="transform:scaleX(${pct / 100})"></i></div><div class="st">${esc(st)}</div></div><div class="acts">${acts}</div>` };
  }
  function renderDownloads() {
    const list = [...S.jobsById.values()].sort((a, b) => b.created - a.created);
    const live = list.filter(j => ACTIVE.includes(j.state) || j.state === 'needs-quit').length;
    const fin = list.some(j => ['done', 'error', 'canceled'].includes(j.state));
    const top = hero({ glyph: GLYPH.dl, icon: I.dl, eye: 'Activity', chip: live ? `${live} in progress` : list.length ? 'All done' : '', seed: 'downloads', title: 'Downloads',
      lead: 'Everything you grab, as it downloads, gets checked and installs. One at a time, so nothing fights over your disk.',
      extra: fin ? '<div class="hero-acts"><button class="btn big" data-clear-done>Clear finished</button></div>' : '' });
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
    $('.bar i', row).style.transform = $('.bar i', tmp).style.transform;
    $('.st', row).textContent = $('.st', tmp).textContent;
    $('.state', row).innerHTML = $('.state', tmp).innerHTML;
    const acts = $('.acts', row), nacts = $('.acts', tmp);
    if (acts.innerHTML !== nacts.innerHTML) acts.innerHTML = nacts.innerHTML;
    if (was !== row.className && /\b(ok|err)\b/.test(row.className)) kick($('.icw', row), 0.8, 0.6);
    // the hero's counter and Clear finished follow along
    const live = [...S.jobsById.values()].filter(x => ACTIVE.includes(x.state) || x.state === 'needs-quit').length;
    const chip = $('.hero .hero-eye b'); if (chip) chip.textContent = live ? `${live} in progress` : 'All done';
    if (!$('[data-clear-done]') && ['done', 'error', 'canceled'].includes(j.state)) { const tx = $('.hero .hero-tx'); if (tx) tx.insertAdjacentHTML('beforeend', '<div class="hero-acts"><button class="btn big" data-clear-done>Clear finished</button></div>'); }
  }

  // ---------- saved apps + settings ----------
  S.saved = new Set(store.get('grab-saved', []));
  S.savedItems = null;
  const saveBtn = (id) => { const on = S.saved.has(id); return `<button class="btn big${on ? ' saved-on' : ''}" data-save="${esc(id)}">${heart(false)}${on ? 'Saved' : 'Save'}</button>`; };
  let savedSeq = 0;
  async function renderSaved() {
    const top = (n, extra = '') => hero({ glyph: GLYPH.heart, icon: heart(false), eye: 'For later', chip: n ? plural(n, 'app') : '', seed: 'saved', title: 'Saved', lead: 'Apps you want to grab later. Open any app and hit Save to keep it here.', extra });
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
      + `<div class="sec-h"><h2>Your list</h2><span class="sub">${plural(list.length, 'app')}</span><span class="sp"></span>${list.length > 6 ? `<input class="filt" id="saved-filter" placeholder="Filter saved apps" autocomplete="off" spellcheck="false" value="${esc(S.savedFilter)}">` : ''}</div><div class="grid" id="saved-grid">${list.map(cardHTML).join('')}</div><div class="empty" id="saved-none" hidden><div class="e-title">No saved app matches</div><div class="e-tx">Try another name.</div></div>`, 'saved');
    applySavedFilter();
  }
  function renderSettings() {
    const seg = (attr, cur, opts) => `<div class="seg">${opts.map(([k, n]) => `<button class="seg-b${cur === k ? ' on' : ''}" data-${attr}="${k}">${n}</button>`).join('')}</div>`;
    setView(hero({ eye: 'Grab', chip: 'v' + esc(S.info.version || ''), title: 'Settings', lead: 'Light or dark, how lively Grab feels, and everything it keeps for you.' })
      + `<div class="set-card"><h3>Look and feel</h3>
        <div class="set"><div><b>Appearance</b><span>Follow your ${isMac() ? 'Mac' : 'PC'}, or pick light or dark.</span></div>${seg('appearance', S.appearance, [['system', 'Automatic'], ['light', 'Light'], ['dark', 'Dark']])}</div>
        <div class="set"><div><b>Motion</b><span>Jelly gives every press a small spring. Calm barely bounces. Off keeps everything still.</span></div>${seg('motion', S.motion, [['jelly', 'Jelly'], ['calm', 'Calm'], ['off', 'Off']])}</div></div>
      <div class="set-card"><h3>Apps</h3>
        <div class="set"><div><b>Free apps only</b><span>Hide apps Grab knows cost money.</span></div><button class="tg${S.freeOnly ? ' on' : ''}" data-free title="Free apps only"><i></i></button></div>
        <div class="set"><div><b>About prices</b><span>Grab only downloads official versions from the developer. Paid apps arrive as their normal trial, and you buy them from the developer. Only well-known paid apps are labelled, so an app with no label is not guaranteed to be free.</span></div></div></div>
      <div class="set-card"><h3>Your settings</h3>
        <div class="set"><div><b>Export and import</b><span>Save your saved apps, recent searches and settings to a file, and bring them back on another ${isMac() ? 'Mac' : 'PC'}.</span></div><div class="acts"><button class="btn" data-prefs-export>${I.dl}Export</button><button class="btn" data-prefs-import>${I.up}Import</button></div></div>
        <div class="set"><div><b>Keyboard shortcuts</b><span>Every shortcut on one sheet. Press ? anywhere to open it.</span></div><button class="btn" data-keys>${I.spark}Show shortcuts</button></div></div>
      <div class="set-card"><h3>Grab</h3>
        <div class="set"><div><b>Grab ${esc(S.info.version || '')}</b><span id="upd-line">${esc(updLine())}</span></div><div class="acts" id="upd-acts">${updActs()}</div></div>
        ${isMac() ? `<div class="set"><div><b>App Management</b><span>macOS has to allow Grab to update and remove other apps. <span id="acc-line">${accessLine()}</span></span></div><button class="btn" data-access-sheet>${I.shield}${accessState === 'allowed' ? 'How it works' : 'Turn it on'}</button></div>` : ''}
        <div class="set"><div><b>What's new</b><span>See what changed in Grab ${esc(WHATS_NEW.version)}.</span></div><button class="btn" data-whatsnew>${I.spark}What's new</button></div></div>`, 'settings');
  }
  // the update row in Settings follows the updater live
  function updLine() {
    const v = String(U.latest || '').replace(/^v/, '');
    return ({ available: `Grab ${v} is out. It downloads in the background.`, downloading: `Downloading Grab ${v}${U.progress ? `, ${Math.round(U.progress)}%` : ''}.`, unpacking: `Checking Grab ${v}.`,
      ready: `Grab ${v} is downloaded and checked. Restart to switch; it takes a few seconds.`, error: `The last check hit a snag${U.error ? ': ' + String(U.error).slice(0, 80) : ''}.`,
      uptodate: 'You have the latest version. Grab checks for updates by itself.' })[U.status] || 'Updates download in the background and install when you restart.';
  }
  const updActs = () => U.status === 'ready' ? `<button class="btn btn-solid" data-upd-restart>${I.up}Restart to update</button>` : `<button class="btn" data-upd-check>${I.up}Check for updates</button>`;
  function render() {
    $$('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === S.view));
    if (S.view === 'discover') renderDiscover();
    else if (S.view === 'updates') renderUpdates();
    else if (S.view === 'installed') renderInstalled();
    else if (S.view === 'saved') renderSaved();
    else if (S.view === 'settings') renderSettings();
    else renderDownloads();
  }
  function go(v) {
    if (!VIEWS.includes(v)) return;
    if (S.view === v && !S.pack) { view.scrollTo({ top: 0, behavior: S.motion === 'off' ? 'auto' : 'smooth' }); return; }
    S.pack = null; S.view = v; render();
  }

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
    sh.innerHTML = `<div class="hero sh-hero"><button class="btn btn-ghost icon sh-close" data-close title="Close (Esc)">${I.x}</button>${iconHTML(it)}<h3>${esc(it.name)}</h3><div class="pub"><span>${esc(isMac() ? (it.host || '') : (it.publisher || ''))}</span>${tags}</div></div>
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
  function dialog({ icon = '', eye = 'Grab', title, lead = '', body = '', buttons = [{ label: 'OK', cls: 'btn-solid', value: true }], wide = false }) {
    if (dlgDone) dlgDone(null);
    const d = $('#dlg');
    d.innerHTML = `<div class="dlg${wide ? ' wide' : ''}" role="dialog" aria-modal="true">${hero({ icon, eye, title, lead })}${body}<div class="dlg-acts">${buttons.map((b, i) => `<button class="btn big ${b.cls || ''}" data-dlg="${i}">${b.label}</button>`).join('')}</div></div>`;
    d.hidden = false; hydrateIcons(d);
    closeCtx();
    setTimeout(() => { const p = $('.dlg-acts .btn:last-child', d); if (p) p.focus({ preventScroll: true, focusVisible: false }); }, 30);
    return new Promise((resolve) => {
      dlgDone = (v) => { dlgDone = null; d.hidden = true; d.innerHTML = ''; resolve(v); };
      d.onclick = (e) => { const b = e.target.closest('[data-dlg]'); if (b) dlgDone(buttons[+b.dataset.dlg].value); else if (e.target === d) dlgDone(null); };
    });
  }
  // the What's new sheet shows ONLY this version's changes, once, after Grab updates to it (rewrite it every release)
  const WHATS_NEW = { version: '2.2', lead: 'A calmer, faster Grab in the family look, with a lot of small things that save you time.', items: [
    ['A new look', 'Warm paper in light mode, deep ink in dark mode, serif titles and one quiet green. Every button fills with colour from where your pointer comes in.'],
    ['Right-click any app', 'Get, open, update, save, visit the website, copy its link or move it to the Trash, straight from the list.'],
    ['Undo', 'Took an app off your saved list or cleared your recent searches by mistake? Undo is right there in the message.'],
    ['Shortcuts sheet', 'Press ? to see every shortcut. Arrow keys move through apps, Enter opens one, Cmd , opens Settings.'],
    ['Drop a link on Grab', 'Drag a download link from anywhere onto the window to install it.'],
    ['Sort and filter', 'Sort installed apps by name or updates first, filter a long saved list, and remove single recent searches.'],
    ['Export and import', 'Take your saved apps, recent searches and settings to another computer as one small file.'],
    ['Remembers its window', 'Grab opens at the size and place you left it, and the update card and restart screen are clearer.'],
  ] };
  function whatsNew() {
    return dialog({ wide: true, eye: "What's new", title: `Grab ${esc(WHATS_NEW.version)}`, lead: WHATS_NEW.lead,
      body: `<ul class="wn-list">${WHATS_NEW.items.map(([t, d], i) => `<li style="--i:${i}"><i>${String(i + 1).padStart(2, '0')}</i><div><b>${esc(t)}</b>${esc(d)}</div></li>`).join('')}</ul>`,
      buttons: [{ label: "Let's go", cls: 'btn-solid', value: true }] });
  }
  // ---------- App Management (Mac): Grab needs it to update and remove apps ----------
  let accessOpen = false, accessState = 'allowed'
  async function checkAccess() { try { accessState = await G.access() } catch { accessState = 'unknown' } const line = $('#acc-line'); if (line) line.innerHTML = accessLine(); return accessState }
  const accessLine = () => accessState === 'allowed' ? `<span class="acc ok">${I.check}On</span>` : accessState === 'denied' ? `<span class="acc bad">${I.x}Off</span>` : `<span class="acc">Not checked yet</span>`
  async function accessSheet(why, force = false) {
    if (accessOpen || !isMac()) return
    accessOpen = true
    const on = accessState === 'allowed'
    const v = await dialog({ eye: 'One permission', title: on ? 'Grab can update your apps' : 'Let Grab update your apps',
      lead: on ? 'App Management is on, so Grab can update and remove apps in Applications.' : (why || 'macOS asks you to allow apps that update or remove other apps. Grab needs it to install updates.'),
      body: `<div class="acc-demo"><span class="logo"><svg viewBox="0 0 64 64" aria-hidden="true"><use href="#grab-mark"/></svg></span><div class="am-t"><small>Privacy and Security, App Management</small><span>Grab</span></div><span class="tg${on ? ' on' : ''}"><i></i></span></div>
        <ol class="acc-steps"><li style="--i:0"><div><b>Open App Management</b><span>The button below takes you straight there, in System Settings.</span></div></li><li style="--i:1"><div><b>Turn on Grab</b><span>Grab is already in the list. Flip its switch on, then come back. Grab notices by itself.</span></div></li></ol>
        <p class="acc-fine">Grab only uses it to put apps you ask for into Applications, update them and move them to the Trash.</p>`,
      buttons: on ? [{ label: 'Done', cls: 'btn-solid', value: false }] : [{ label: 'Later', cls: 'btn-ghost', value: false }, { label: 'Open System Settings', cls: 'btn-solid', value: true }] })
    accessOpen = false
    if (!force) store.set('grab-access-asked', Date.now())
    if (v) G.openAccess().catch(() => {})
  }
  // back from System Settings: check again, and say so once it is on
  window.addEventListener('focus', async () => {
    if (!isMac() || accessState === 'allowed') return
    const was = accessState
    if (await checkAccess() === 'allowed' && was !== 'allowed') { toast('Grab can update your apps now'); if (accessOpen && dlgDone) dlgDone(false) }
  })


  // ---------- toasts ----------
  function toast(msg, kind = 'ok', action = null) {
    if (kind === true) kind = 'bad';
    const t = document.createElement('div');
    t.className = 'toast ' + kind;
    t.setAttribute('role', 'status');
    t.innerHTML = `<span class="t-orb">${kind === 'bad' ? I.x : kind === 'info' ? I.dl : I.check}</span><span>${esc(msg)}</span>${action ? `<button class="btn small">${esc(action.label)}</button>` : ''}`;
    const box = $('#toasts');
    box.appendChild(t); while (box.children.length > 4) box.firstElementChild.remove();
    kick($('.t-orb', t), 0.8, 0.6);
    let gone = false;
    const out = () => { if (gone) return; gone = true; t.classList.add('out'); setTimeout(() => t.remove(), 320); };
    if (action) $('.btn', t).addEventListener('click', () => { try { action.fn(); } catch {} out(); });
    setTimeout(out, action ? 7000 : kind === 'bad' ? 6000 : 3800);
    return t;
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
      const id = t.dataset.save, on = toggleSaved(id);
      const nb = document.createElement('div'); nb.innerHTML = saveBtn(id); const b = nb.firstElementChild; t.replaceWith(b); kick(b, 1, 0.8);
      if (!on) toastUnsaved(id);
      return;
    }
    if (t.dataset.instSort) { S.instSort = t.dataset.instSort; try { localStorage.setItem('grab-inst-sort', S.instSort); } catch {} render(); return; }
    if (t.dataset.filterClear != null) { S.instFilter = ''; const f = $('#inst-filter'); if (f) { f.value = ''; f.focus(); } applyInstFilter(); return; }
    if (t.dataset.keys != null) { shortcutSheet(); return; }
    if (t.dataset.prefsExport != null) { exportPrefs(); return; }
    if (t.dataset.prefsImport != null) { importPrefs(); return; }
    if (t.dataset.accessSheet != null) { accessSheet('', true); return; }
    if (t.dataset.updRestart != null) { $('#self-btn').click(); return; }
    if (t.dataset.savedAll != null) { const todo = (S.savedItems || []).filter(it => S.saved.has(it.id) && grabbable(it)); t.disabled = true; await getMany(todo.map(x => x.id), 'saved', 'Grabbing'); return; }
    if (t.dataset.motion) { setMotion(t.dataset.motion); render(); kick($(`[data-motion="${t.dataset.motion}"]`), 1, 0.6); return; }
    if (t.dataset.appearance) { applyAppearance(t.dataset.appearance); render(); return; }
    if (t.dataset.whatsnew != null) { whatsNew(); return; }
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
    const x = e.target.closest('[data-recent-x]');
    if (x) { e.stopPropagation(); const q = x.dataset.recentX, was = recents(); store.set('grab-recent', was.filter(r => r !== q)); render(); toast(`Removed "${q}"`, 'ok', { label: 'Undo', fn: () => { store.set('grab-recent', was); if (S.view === 'discover' && !S.q) render(); } }); return; }
    const c = e.target.closest('[data-recent]'); if (c) { qEl.value = c.dataset.recent; S.q = qEl.value; $('#clear').hidden = false; runSearch(); return; }
    if (e.target.closest('[data-recent-clear]')) { const was = recents(); store.set('grab-recent', []); render(); toast('Recent searches cleared', 'ok', { label: 'Undo', fn: () => { store.set('grab-recent', was); if (S.view === 'discover' && !S.q) render(); } }); }
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
      const first = freeFilter(S.results)[0];
      const b = $('[data-url]'); if (b) b.click(); else if (first && S.resultsQ === S.q.trim()) openSheet(first.id);
    }
  });
  $('#clear').addEventListener('click', (e) => { e.preventDefault(); qEl.value = ''; S.q = ''; $('#clear').hidden = true; runSearch(); qEl.focus(); });
  const typing = (el) => el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
  document.addEventListener('keydown', (e) => {
    const mod = e.metaKey || e.ctrlKey, k = e.key;
    if (k === 'Escape') { if (closeCtx()) return; if (dlgDone) dlgDone(null); else closeSheet(); return; }
    if (ctxEl && ['ArrowDown', 'ArrowUp', 'Enter'].includes(k)) { e.preventDefault(); ctxKey(k); return; }
    if (dlgDone) return; // a dialog is open: it owns the keyboard
    if (mod && k.toLowerCase() === 'k') { e.preventDefault(); closeSheet(); qEl.focus(); qEl.select(); }
    else if (mod && /^[1-6]$/.test(k)) { e.preventDefault(); closeSheet(); const b = $$('.nav-btn')[+k - 1]; if (b) { b.click(); kick(b, 0.7, 0.5); } }
    else if (mod && k === ',') { e.preventDefault(); closeSheet(); go('settings'); }
    else if (mod && k === '/') { e.preventDefault(); shortcutSheet(); }
    else if (typing(document.activeElement)) return;
    else if (k === '/') { e.preventDefault(); qEl.focus(); }
    else if (k === '?') { e.preventDefault(); shortcutSheet(); }
    else if (['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(k) && $('#sheet').hidden) { if (moveFocus(k)) e.preventDefault(); }
    else if ((k === 'Enter' || k === ' ') && document.activeElement && document.activeElement.matches('[data-open], [data-pack]')) { e.preventDefault(); document.activeElement.click(); }
  });
  // arrow keys walk the app cards, rows and packs on screen, by rows and columns
  function moveFocus(k) {
    const items = $$('#view [data-open], #view [data-pack]').filter(x => !x.hidden && x.offsetParent);
    if (!items.length) return false;
    const cur = document.activeElement, i = items.indexOf(cur);
    if (i < 0) { items[0].focus(); items[0].scrollIntoView({ block: 'nearest' }); return true; }
    const r = cur.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    let best = null, bd = Infinity;
    for (const x of items) {
      if (x === cur) continue;
      const q = x.getBoundingClientRect(), qx = q.left + q.width / 2, qy = q.top + q.height / 2, dx = qx - cx, dy = qy - cy;
      const ok = k === 'ArrowRight' ? dx > 4 && Math.abs(dy) < r.height / 2 : k === 'ArrowLeft' ? dx < -4 && Math.abs(dy) < r.height / 2 : k === 'ArrowDown' ? dy > 4 : dy < -4;
      if (!ok) continue;
      const d = (k === 'ArrowDown' || k === 'ArrowUp') ? Math.abs(dy) * 1000 + Math.abs(dx) : Math.abs(dx);
      if (d < bd) { bd = d; best = x; }
    }
    if (!best && (k === 'ArrowRight' || k === 'ArrowLeft')) best = items[i + (k === 'ArrowRight' ? 1 : -1)];
    if (best) { best.focus(); best.scrollIntoView({ block: 'nearest' }); }
    return true;
  }

  // ---------- the shortcut sheet ----------
  function shortcutSheet() {
    const m = isMac() ? '\u2318' : 'Ctrl';
    const K = [[[m, 'K'], 'Search'], [['/'], 'Search'], [[m, '1'], 'Discover'], [[m, '2'], 'Updates'], [[m, '3'], 'Installed'], [[m, '4'], 'Downloads'], [[m, '5'], 'Saved'], [[m, '6'], 'Settings'], [[m, ','], 'Settings'],
      [['Enter'], 'Open the first result'], [['\u2190', '\u2192'], 'Move between apps'], [['\u2191', '\u2193'], 'Move between rows'], [['Esc'], 'Close or clear'], [['?'], 'This sheet']];
    return dialog({ wide: true, eye: 'Keyboard', title: 'Shortcuts', lead: 'Grab works without the mouse, too. Right-click any app for everything you can do with it.',
      body: `<div class="keys">${K.map(([ks, t]) => `<div><span>${t}</span><span>${ks.map(x => `<kbd>${esc(x)}</kbd>`).join('')}</span></div>`).join('')}</div>`,
      buttons: [{ label: 'Got it', cls: 'btn-solid', value: true }] });
  }

  // ---------- saved: toggle, with Undo ----------
  function toggleSaved(id, on = !S.saved.has(id)) {
    if (on) S.saved.add(id); else S.saved.delete(id);
    store.set('grab-saved', [...S.saved]); S.savedItems = null;
    for (const b of $$(`[data-save="${sel(id)}"]`)) { const nb = document.createElement('div'); nb.innerHTML = saveBtn(id); b.replaceWith(nb.firstElementChild); }
    badges(); if (S.view === 'saved') render();
    return on;
  }
  function toastUnsaved(id) { const it = S.items.get(id); toast(`${it ? it.name : 'App'} removed from Saved`, 'ok', { label: 'Undo', fn: () => toggleSaved(id, true) }); }

  // ---------- export and import settings ----------
  const PREF_KEYS = { saved: 'grab-saved', recent: 'grab-recent', appearance: 'grab-appearance', motion: 'grab-motion-v3', installedSort: 'grab-inst-sort' };
  async function exportPrefs() {
    const data = { app: 'Grab', version: S.info.version, saved: [...S.saved], recent: recents(), appearance: S.appearance, motion: S.motion, freeOnly: S.freeOnly, installedSort: S.instSort };
    try { const r = await G.exportPrefs(data); if (r) toast('Settings exported'); } catch (e) { toast(`Could not export: ${errText(e)}`, 'bad'); }
  }
  async function importPrefs() {
    let p = null;
    try { p = await G.importPrefs(); } catch (e) { toast(`Could not import: ${errText(e)}`, 'bad'); return; }
    if (!p) return;
    const before = { saved: [...S.saved], recent: recents(), appearance: S.appearance, motion: S.motion, freeOnly: S.freeOnly, installedSort: S.instSort };
    applyPrefs(p);
    toast(`Imported ${plural(p.saved.length, 'saved app')} and your settings`, 'ok', { label: 'Undo', fn: () => applyPrefs(before) });
  }
  function applyPrefs(p) {
    S.saved = new Set(p.saved); store.set('grab-saved', [...S.saved]); S.savedItems = null;
    store.set('grab-recent', p.recent);
    applyAppearance(p.appearance); setMotion(p.motion);
    S.freeOnly = !!p.freeOnly; try { localStorage.setItem('grab-free', S.freeOnly ? '1' : '0'); localStorage.setItem('grab-inst-sort', p.installedSort); } catch {}
    S.instSort = p.installedSort === 'updates' ? 'updates' : 'name';
    badges(); render();
  }

  // ---------- the right-click menu on any app ----------
  let ctxEl = null;
  function closeCtx() { if (!ctxEl) return false; ctxEl.remove(); ctxEl = null; return true; }
  function ctxKey(k) {
    const items = $$('.ctx-i', ctxEl); if (!items.length) return;
    let i = items.findIndex(x => x.classList.contains('kb'));
    if (k === 'Enter') { if (i >= 0) items[i].click(); return; }
    if (i >= 0) items[i].classList.remove('kb');
    i = k === 'ArrowDown' ? (i + 1) % items.length : (i <= 0 ? items.length - 1 : i - 1);
    items[i].classList.add('kb');
  }
  function appMenu(id, x, y) {
    const it = S.items.get(id); if (!it) return;
    const j = S.jobsByItem.get(id), inst = isInstalled(it), up = updateFor(id), busy = j && ACTIVE.includes(j.state);
    const home = it.home || it.mhome || '';
    const rows = [];
    if (busy && j.state !== 'installing') rows.push(['cancel', I.x, 'Cancel download']);
    else if (!busy && up) rows.push(['update', I.up, 'Update']);
    if (!busy && inst && isMac()) rows.push(['open', I.box, 'Open']);
    if (!busy && !inst && !up) rows.push([it.price && !it.trial ? 'buy' : 'get', it.price && !it.trial ? I.tag : I.dl, it.price && !it.trial ? 'Buy from the developer' : it.trial ? `Get the ${it.trial.label}` : 'Get']);
    rows.push(['detail', I.search, 'Details']);
    rows.push(['save', heart(false), S.saved.has(id) ? 'Remove from Saved' : 'Save for later']);
    rows.push('-');
    if (home) { rows.push(['web', I.globe, 'Open website']); rows.push(['copy', I.link, 'Copy website link']); }
    rows.push(['name', I.tag, 'Copy name']);
    if (inst && !busy) { rows.push('-'); rows.push(['remove', I.trash, isMac() ? 'Move to Trash' : 'Uninstall', 'bad']); }
    closeCtx();
    const m = document.createElement('div');
    m.className = 'ctx'; m.setAttribute('role', 'menu');
    m.innerHTML = `<div class="ctx-h">${esc(it.name)}</div>` + rows.map(r => r === '-' ? '<div class="ctx-sep"></div>' : `<button class="ctx-i${r[3] ? ' ' + r[3] : ''}" role="menuitem" data-ctx="${r[0]}">${r[1]}<span>${esc(r[2])}</span></button>`).join('');
    document.body.appendChild(m); ctxEl = m;
    const W = innerWidth, H = innerHeight, mw = m.offsetWidth, mh = m.offsetHeight;
    const left = Math.max(8, Math.min(x, W - mw - 8)), top = Math.max(8, Math.min(y, H - mh - 8));
    m.style.left = left + 'px'; m.style.top = top + 'px';
    m.style.setProperty('--ox', (x - left) + 'px'); m.style.setProperty('--oy', (y - top) + 'px');
    m.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-ctx]'); if (!b) return;
      e.stopPropagation(); closeCtx();
      const a = b.dataset.ctx;
      if (a === 'cancel') doAct(id, 'cancel', j.id);
      else if (['update', 'open', 'get', 'buy', 'detail'].includes(a)) doAct(id, a);
      else if (a === 'save') { if (!toggleSaved(id)) toastUnsaved(id); else toast(`${it.name} saved for later`); }
      else if (a === 'web') G.external(home);
      else if (a === 'copy') copyText(home, 'Website link copied');
      else if (a === 'name') copyText(it.name, 'Name copied');
      else if (a === 'remove') { const rb = document.createElement('button'); rb.dataset.remove = id; rb.hidden = true; document.body.appendChild(rb); rb.click(); rb.remove(); }
    });
  }
  async function copyText(t, done) { try { await navigator.clipboard.writeText(t); toast(done); } catch { toast('Could not copy', 'bad'); } }
  document.addEventListener('contextmenu', (e) => {
    const c = e.target.closest('[data-open]');
    if (c && !e.target.closest('input')) { e.preventDefault(); appMenu(c.dataset.open, e.clientX, e.clientY); return; }
    if (!e.target.closest('input')) e.preventDefault();
    closeCtx();
  });
  document.addEventListener('pointerdown', (e) => { if (ctxEl && !ctxEl.contains(e.target)) closeCtx(); }, true);
  addEventListener('blur', () => closeCtx());
  view.addEventListener('scroll', () => closeCtx(), { passive: true });

  // ---------- drop a download link anywhere on the window ----------
  let dropHint = null, dragDepth = 0;
  const linkFrom = (dt) => { const t = (dt.getData('text/uri-list') || dt.getData('text/plain') || '').split(/\s+/).find(x => /^https?:\/\/\S+$/i.test(x)); return t || ''; };
  const hasLink = (dt) => dt && [...dt.types].some(t => t === 'text/uri-list' || t === 'text/plain');
  document.addEventListener('dragenter', (e) => {
    if (!hasLink(e.dataTransfer)) return;
    e.preventDefault(); dragDepth++;
    if (!dropHint) { dropHint = document.createElement('div'); dropHint.className = 'drop-hint'; dropHint.innerHTML = `<div><b>Drop the link</b><span>Grab downloads it straight from the source${isMac() ? ' and installs it' : ''}.</span></div>`; document.body.appendChild(dropHint); }
  });
  document.addEventListener('dragover', (e) => { if (hasLink(e.dataTransfer)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
  const endDrag = () => { dragDepth = 0; if (dropHint) { dropHint.remove(); dropHint = null; } };
  document.addEventListener('dragleave', () => { if (--dragDepth <= 0) endDrag(); });
  document.addEventListener('drop', (e) => {
    e.preventDefault(); const u = linkFrom(e.dataTransfer); endDrag();
    if (!u) { if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) toast('Drop a download link, not a file', 'bad'); return; }
    closeSheet(); qEl.value = u; S.q = u; $('#clear').hidden = false; S.pack = null; S.view = 'discover'; render();
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
    if (S.view === 'settings') syncUpdRow();
    if (u.justUpdated && !S.greeted) {
      S.greeted = true;
      setTimeout(() => toast(`Updated to Grab ${u.justUpdated}`), 900);
      const vv = String(u.justUpdated).split('.').slice(0, 2).join('.'); if (vv === WHATS_NEW.version && !store.get('grab-seen-' + vv, false)) { store.set('grab-seen-' + vv, true); setTimeout(whatsNew, 1400); }
    }
  }
  G.onUpdater(renderUpd);
  function syncUpdRow() { const l = $('#upd-line'), a = $('#upd-acts'); if (l) l.textContent = updLine(); if (a && a.dataset.s !== U.status) { a.dataset.s = U.status; a.innerHTML = updActs(); } }
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
    const [info, cat, jobs] = await Promise.all([G.info(), G.catalog(), G.jobs()]);
    S.info = info;
    document.body.classList.add(isMac() ? 'mac' : 'win');
    $('#kbd').textContent = isMac() ? '\u2318K' : 'Ctrl K';
    if (S.appearance !== 'system' && G.appearance) G.appearance(S.appearance).catch(() => {});
    S.cat = cat;
    remember(S.cat.popular);
    for (const j of jobs) { S.jobsById.set(j.id, j); S.jobsByItem.set(j.itemId, j); if (j.state === 'done' && j.verb !== 'uninstall' && j.result !== 'saved') S.installed.add(j.itemId); }
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
