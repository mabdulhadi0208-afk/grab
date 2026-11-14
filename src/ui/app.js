'use strict';
/* Grab renderer. Talks to the main process only through window.grab (preload). */
(() => {
  const G = window.grab;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const sel = (id) => (window.CSS && CSS.escape ? CSS.escape(id) : String(id).replace(/["\\]/g, '\\$&'));

  const S = {
    info: { platform: 'darwin' }, cat: { ready: false, popular: [], count: 0 }, view: 'discover', q: '', results: [],
    scan: null, jobsById: new Map(), jobsByItem: new Map(), items: new Map(), installed: new Set(), removed: new Set(),
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
    up: '<svg viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 1-2.3-5.6"/><path d="M20 4v5h-5"/></svg>',
    dl: '<svg viewBox="0 0 24 24"><path d="M12 4v11"/><path d="M7.5 10.5L12 15l4.5-4.5"/><path d="M5 19h14"/></svg>',
    search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.6-3.6"/></svg>',
    trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4.8h6V7M6.5 7l1 13h9l1-13"/></svg>',
  };

  // ---------- helpers ----------
  function remember(list) { for (const it of list || []) if (it && it.id) S.items.set(it.id, { ...(S.items.get(it.id) || {}), ...it }); return list || []; }
  function fmtBytes(n) { if (!n) return '0 MB'; const u = ['B', 'KB', 'MB', 'GB']; let i = 0; while (n >= 1024 && i < 3) { n /= 1024; i++; } return (i >= 2 ? n.toFixed(1) : Math.round(n)) + ' ' + u[i]; }
  function hue(s) { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % 360; }
  function isInstalled(it) { if (!it) return false; if (S.removed.has(it.id)) return false; return !!(it.installed || S.installed.has(it.id)); }
  function updateFor(id) { return S.scan && S.scan.find(s => s.id === id && s.update); }
  function verLabel(it) { const v = String(it.ver || '').split(',')[0]; return v && v !== 'latest' ? 'v' + v : ''; }
  function subLine(it) { return isMac() ? (it.desc || it.home || '') : `${it.publisher || ''}${it.publisher ? ' · ' : ''}${it.id}`; }

  // ---------- icons ----------
  const favState = new Map(); // home -> 'ok' | 'bad'
  const realIcons = new Map(); // path -> dataURL
  function iconHTML(it) {
    const name = (it.name || '?').trim();
    const ch = (name.match(/[A-Za-z0-9]/) || [name[0] || '?'])[0].toUpperCase();
    const h = hue(it.id || name);
    return `<div class="ic" data-id="${esc(it.id || '')}" data-icons="${esc((it.icons || []).join('|'))}" data-fav="${esc(it.fav || '')}" data-home="${esc(it.home || '')}" data-path="${esc(it.path || '')}"><div class="letter" style="background:linear-gradient(135deg,hsl(${h} 70% 58%),hsl(${(h + 40) % 360} 75% 45%))">${esc(ch)}</div><img alt=""></div>`;
  }
  // Icon sources, best first: winget's own icon, GitHub owner avatar (for GitHub-hosted apps), Google's favicon service, DuckDuckGo, Google s2.
  const metaCache = new Map();
  const iconMem = (() => { try { return JSON.parse(localStorage.getItem('grab-icons-v3') || '{}'); } catch { return {}; } })();
  let iconMemT = null;
  function iconRemember(id, url) { if (!id) return; iconMem[id] = url; clearTimeout(iconMemT); iconMemT = setTimeout(() => { try { localStorage.setItem('grab-icons-v3', JSON.stringify(iconMem)); } catch {} }, 800); }
  function hostOf(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } }
  // Sources in order: the app's real icon(s), then its own site's logo (main decides if that's allowed and checks it exists).
  function markReal(box, img) { img.classList.add('real'); box.classList.add('has-real'); }
  async function loadChain(box, img, srcs, id) {
    if (!srcs.length) { iconRemember(id, 'none'); return; }
    const src = srcs.shift();
    let u = src.u;
    if (src.fav) { u = await G.fav(src.fav).catch(() => null); if (!u) return loadChain(box, img, srcs, id); }
    img.onload = () => {
      if (img.naturalWidth >= 24) { if (!src.fav) { markReal(box, img); iconRemember(id, u); } img.classList.add('on'); box.classList.add('has-img'); jellyIn(box); }
      else loadChain(box, img, srcs, id);
    };
    img.onerror = () => loadChain(box, img, srcs, id);
    img.src = u;
  }
  function hydrateIcons(root = document) {
    for (const box of $$('.ic:not([data-h])', root)) {
      box.dataset.h = '1';
      const img = $('img', box);
      const p = box.dataset.path, id = box.dataset.id;
      const setReal = (url) => { img.className = 'real on'; img.src = url; box.classList.add('has-img', 'has-real'); };
      if (p) {
        if (realIcons.has(p)) { setReal(realIcons.get(p)); continue; }
        G.icon(p).then(u => { if (u) { realIcons.set(p, u); setReal(u); jellyIn(box); } else start(); });
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
            if (m.desc) { const card = box.closest('[data-open]'); const d = card && $('.desc', card); if (d && !d.dataset.meta) { d.dataset.meta = '1'; d.textContent = m.desc; } const it = S.items.get(id); if (it) { it.mdesc = m.desc; it.mhome = m.home; } }
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

  // ---------- springs & jelly ----------
  // Real spring curves as CSS linear() easings (damped harmonic oscillator, sampled).
  function springEasing(stiffness, damping, mass = 1) {
    const w0 = Math.sqrt(stiffness / mass), z = damping / (2 * Math.sqrt(stiffness * mass));
    const wd = w0 * Math.sqrt(Math.max(0, 1 - z * z));
    const x = (t) => z < 1 ? 1 - Math.exp(-z * w0 * t) * (Math.cos(wd * t) + (z * w0 / wd) * Math.sin(wd * t)) : 1 - Math.exp(-w0 * t) * (1 + w0 * t);
    let T = 0; while (T < 10 && !(Math.abs(1 - x(T)) < 0.001 && Math.abs(1 - x(T + 0.05)) < 0.001)) T += 0.02;
    const pts = []; for (let i = 0; i <= 60; i++) pts.push(+x((i / 60) * T).toFixed(4));
    pts[60] = 1;
    return { css: `linear(${pts.join(', ')})`, ms: Math.round(T * 1000) };
  }
  const SP = { jelly: springEasing(260, 11), bouncy: springEasing(200, 16), soft: springEasing(170, 24) };
  const RS = document.documentElement.style;
  RS.setProperty('--jelly', SP.jelly.css); RS.setProperty('--bouncy', SP.bouncy.css); RS.setProperty('--soft', SP.soft.css);
  const REDUCE = matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Squash-and-stretch wobble using the independent `scale` property, so it never fights transforms (hover, magnet, skew).
  function jelly(el, k = 1) {
    if (!el || REDUCE || !el.animate) return;
    const a = 0.12 * k;
    el.animate([
      { scale: '1 1' }, { scale: `${1 + a} ${1 - a}` }, { scale: `${1 - a * 0.75} ${1 + a * 0.75}` },
      { scale: `${1 + a * 0.4} ${1 - a * 0.4}` }, { scale: `${1 - a * 0.18} ${1 + a * 0.18}` }, { scale: '1 1' },
    ], { duration: 640, easing: 'cubic-bezier(.3,.7,.4,1)' });
  }
  function jellyIn(el) {
    if (!el || REDUCE || !el.animate) return;
    el.animate([{ scale: '.6 .6', opacity: 0 }, { scale: '1 1', opacity: 1 }], { duration: SP.jelly.ms, easing: SP.jelly.css });
  }
  // press = squish, release = wobble back
  const PRESS = '.btn, .card, .rowi, .nav-btn, .chip, .clear, .search, .self-card';
  document.addEventListener('pointerdown', (e) => {
    const el = e.target.closest(PRESS); if (!el || REDUCE || !el.animate) return;
    el._press = el.animate([{ scale: '1 1' }, { scale: el.matches('.btn, .chip, .clear') ? '1.06 .9' : '.975 .965' }], { duration: 140, easing: 'ease-out', fill: 'forwards' });
    const up = () => { removeEventListener('pointerup', up); removeEventListener('pointercancel', up); try { el._press && el._press.cancel(); } catch {} jelly(el, el.matches('.btn, .chip') ? 1.1 : 0.45); };
    addEventListener('pointerup', up); addEventListener('pointercancel', up);
  });
  // icons wobble when you hover their card
  document.addEventListener('pointerover', (e) => {
    const c = e.target.closest('.card, .rowi'); if (!c || c.contains(e.relatedTarget)) return;
    const ic = $('.ic', c); if (!ic || REDUCE || !ic.animate) return;
    ic.animate([{ rotate: '0deg', scale: '1 1' }, { rotate: '-8deg', scale: '1.1 .92' }, { rotate: '6deg', scale: '.95 1.07' }, { rotate: '-3deg', scale: '1.03 .98' }, { rotate: '0deg', scale: '1 1' }], { duration: 700, easing: 'ease-out' });
  });
  $('#q').addEventListener('focus', () => jelly($('#search-wrap'), 0.35));

  // ---------- action button ----------
  function actionHTML(it, extraClass = '') {
    const id = esc(it.id);
    const j = S.jobsByItem.get(it.id);
    const cls = extraClass ? ' ' + extraClass : '';
    if (j && ['queued', 'downloading', 'installing'].includes(j.state)) {
      const pct = j.state === 'downloading' && (j.total || j.pct) ? Math.round(j.pct) : null;
      const label = j.state === 'queued' ? 'Waiting' : j.state === 'installing' ? (j.stage || 'Installing') : pct != null ? pct + '%' : (j.stage || 'Starting');
      return `<button class="btn prog${pct == null ? ' indet' : ''}${cls}" data-act="${id}" data-do="cancel" data-job="${j.id}" title="Click to cancel"><i class="fill" style="width:${pct || 0}%"></i><span>${esc(label)}</span><i class="x">${I.x}</i></button>`;
    }
    if (j && j.state === 'needs-quit') return `<button class="btn btn-warn${cls}" data-act="${id}" data-do="quit" data-job="${j.id}" title="${esc(j.msg)}">Quit &amp; install</button>`;
    if (j && j.state === 'error') return `<button class="btn btn-bad${cls}" data-act="${id}" data-do="${j.verb === 'update' ? 'update' : 'get'}" title="${esc(j.msg)}">Retry</button>`;
    if (updateFor(it.id) && !(j && j.state === 'done' && j.verb !== 'uninstall')) return `<button class="btn btn-solid${cls}" data-act="${id}" data-do="update">Update</button>`;
    if (isInstalled(it)) return isMac() ? `<button class="btn btn-ok${cls}" data-act="${id}" data-do="open">Open</button>` : `<button class="btn btn-ok${cls}" data-act="${id}" data-do="detail">${I.check}Installed</button>`;
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
      // keep the progress fill animating smoothly instead of replacing it
      if (b.classList.contains('prog') && nb.classList.contains('prog') && b.dataset.job === nb.dataset.job) {
        b.className = nb.className; b.title = nb.title;
        $('.fill', b).style.width = $('.fill', nb).style.width;
        $('span', b).textContent = $('span', nb).textContent;
      } else { b.replaceWith(nb); fluid.magnet(nb.parentElement); if (nb.matches('.btn-ok, .btn-warn, .btn-bad')) jelly(nb, 1.5); }
    }
  }

  // ---------- fluid motion: smooth inertial scroll, velocity skew, reveals, magnetic buttons, cursor glow ----------
  const fluid = (() => {
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const main = $('.main'), blob = $('#blob'), glow = $('#sglow');
    let target = 0, cur = 0, wheeling = false, vel = 0, lastTop = 0, idle = 0, over = 0, overV = 0, overShown = 0;
    const maxScroll = () => Math.max(0, view.scrollHeight - view.clientHeight);
    view.addEventListener('wheel', (e) => {
      if (reduce || e.ctrlKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      e.preventDefault();
      if (!wheeling) { cur = target = view.scrollTop; }
      const d = e.deltaY * (e.deltaMode === 1 ? 32 : e.deltaMode === 2 ? view.clientHeight : 1);
      const raw = target + d;
      if (raw < 0 || raw > maxScroll()) over = Math.max(-140, Math.min(140, over + (raw < 0 ? -d : -d) * 0.35 * (1 - Math.abs(over) / 160)));
      target = Math.max(0, Math.min(maxScroll(), raw));
      wheeling = true;
    }, { passive: false });
    // keyboard / scrollbar drags take over instantly
    view.addEventListener('pointerdown', () => { wheeling = false; });
    addEventListener('keydown', (e) => { if (['PageDown', 'PageUp', 'Home', 'End', 'ArrowDown', 'ArrowUp', ' '].includes(e.key) && document.activeElement !== $('#q')) wheeling = false; });
    let mx = -999, my = -999, bx = -999, by = -999;
    main.addEventListener('pointermove', (e) => { const r = main.getBoundingClientRect(); mx = e.clientX - r.left; my = e.clientY - r.top; main.classList.add('hov');
      const c = e.target.closest && e.target.closest('.card');
      if (c) { const cr = c.getBoundingClientRect(); c.style.setProperty('--mx', (e.clientX - cr.left) + 'px'); c.style.setProperty('--my', (e.clientY - cr.top) + 'px'); }
    });
    main.addEventListener('pointerleave', () => main.classList.remove('hov'));
    (function loop() {
      requestAnimationFrame(loop);
      if (wheeling) {
        cur += (target - cur) * 0.14;
        if (Math.abs(target - cur) < 0.4) { cur = target; wheeling = false; }
        view.scrollTop = cur;
      }
      const top = view.scrollTop;
      vel += ((top - lastTop) - vel) * 0.2; lastTop = top;
      // rubber band: overscroll stretches the content, then springs back with a little jiggle
      overV += (-over * 0.12); overV *= 0.68; over += overV;
      if (Math.abs(over) < 0.05 && Math.abs(overV) < 0.05) over = overV = 0;
      if (over !== overShown) { overShown = over; const vi = view.firstElementChild; if (vi) { vi.style.transform = over ? `translateY(${over.toFixed(2)}px)` : ''; vi.style.transformOrigin = over > 0 ? '50% 0' : '50% 100%'; vi.style.scale = over ? `1 ${(1 + Math.abs(over) / 2400).toFixed(4)}` : ''; } }
      const sk = reduce ? 0 : Math.max(-2.2, Math.min(2.2, vel * -0.06));
      view.style.setProperty('--sk', sk.toFixed(3) + 'deg');
      if (Math.abs(vel) > 0.5) { main.classList.add('scrolling'); idle = 0; } else if (++idle > 30) main.classList.remove('scrolling');
      const h = view.clientHeight, sh = view.scrollHeight;
      if (sh > h) { const th = Math.max(30, h * h / sh); glow.style.height = th + 'px'; glow.style.transform = `translateY(${view.offsetTop + (top / (sh - h)) * (h - th)}px)`; }
      if (mx > -999) { bx += (mx - bx) * 0.08; by += (my - by) * 0.08; if (bx < -900) { bx = mx; by = my; } blob.style.transform = `translate(${bx - 260}px, ${by - 260}px)`; }
    })();
    const io = new IntersectionObserver((es) => {
      let k = 0;
      for (const e of es) if (e.isIntersecting) { e.target.style.setProperty('--d', (k++ % 14) * 38 + 'ms'); e.target.classList.add('on'); io.unobserve(e.target); }
    }, { root: view, threshold: 0.06, rootMargin: '0px 0px 40px 0px' });
    function reveal(root) {
      for (const el of $$('.card, .rowi, .dl, .urlcard', root)) { if (reduce) continue; el.classList.add('rv'); io.observe(el); }
      magnet(root);
    }
    function magnet(root) {
      for (const b of $$('.btn-solid, .btn-get, .btn.big', root)) {
        if (b._m) continue; b._m = 1; b.classList.add('mag');
        b.addEventListener('pointermove', (e) => { const r = b.getBoundingClientRect(); b.style.transform = `translate(${(e.clientX - r.left - r.width / 2) * 0.25}px, ${(e.clientY - r.top - r.height / 2) * 0.4}px)`; });
        b.addEventListener('pointerleave', () => { b.style.transform = ''; });
      }
    }
    function counters(root) {
      for (const el of $$('[data-count]', root)) {
        const n = +el.dataset.count, t0 = performance.now();
        (function f(now) { const p = Math.min((now - t0) / 1400, 1), e = 1 - Math.pow(1 - p, 4); el.textContent = Math.round(n * e).toLocaleString(); if (p < 1) requestAnimationFrame(f); })(t0);
      }
    }
    function nav() {
      const a = $('.nav-btn.active'), ind = $('#nav-ind');
      if (a) {
        const prev = ind._y, y = a.offsetTop;
        ind.style.transform = `translateY(${y}px)`; ind.style.height = a.offsetHeight + 'px';
        if (prev != null && prev !== y && ind.animate && !REDUCE) ind.animate([{ scale: '1 1' }, { scale: `.94 ${1 + Math.min(.6, Math.abs(y - prev) / 120)}` }, { scale: '1.04 .9' }, { scale: '1 1' }], { duration: 620, easing: 'ease-out' });
        ind._y = y;
      }
    }
    function jump(y) { wheeling = false; target = cur = y; view.scrollTop = y; }
    return { reveal, counters, nav, magnet, jump };
  })();

  // ---------- views ----------
  function cardHTML(it, i) {
    remember([it]);
    const d = Math.min(i, 18) * 22;
    return `<div class="card clickable" data-open="${esc(it.id)}" style="animation-delay:${d}ms">
      ${iconHTML(it)}
      <div class="meta"><div class="name">${esc(it.name)}</div><div class="desc">${esc(subLine(it))}</div>
      <div class="row"><span class="ver">${esc(verLabel(it))}</span>${it.label ? `<span class="pill kindp">${esc(it.label)}</span>` : ''}${actionHTML(it)}</div></div></div>`;
  }
  function rowHTML(it, i, right) {
    remember([it]);
    return `<div class="rowi clickable" data-open="${esc(it.id)}" style="animation-delay:${Math.min(i, 20) * 18}ms">${iconHTML(it)}
      <div style="min-width:0"><div class="name">${esc(it.name)}</div><div class="desc">${right.sub}</div></div>
      <div class="acts">${right.acts}</div></div>`;
  }
  function setView(html) { view.innerHTML = `<div class="view-in">${html}</div>`; hydrateIcons(view); fluid.reveal(view); fluid.counters(view); }

  function wingetNote() {
    if (isMac() || S.info.winget !== false) return '';
    return `<div class="note"><div><b>One-time setup:</b> Grab installs apps through Microsoft's winget, which is part of "App Installer". Get it from the Microsoft Store, then reopen Grab.</div><button class="btn btn-solid" data-ext="https://apps.microsoft.com/detail/9NBLGGH4NNS1">Get App Installer</button></div>`;
  }

  function renderDiscover() {
    const q = S.q.trim();
    if (/^https?:\/\/\S+$/i.test(q)) {
      let host = '', file = '';
      try { const u = new URL(q); host = u.hostname; file = decodeURIComponent(u.pathname.split('/').pop() || ''); } catch {}
      setView(`${wingetNote()}<div class="urlcard"><div class="ic" style="background:rgba(255,255,255,.08)">${I.link}</div><div class="meta"><div class="t">Download from this link</div><div class="u">${esc(file || host)} · ${esc(host)}</div></div><button class="btn btn-solid big" data-url="${esc(q)}">${I.dl} Download${isMac() ? ' &amp; install' : ''}</button></div>
        <div class="sub" style="color:var(--faint);font-size:12.5px">${isMac() ? 'Disk images, zips and installer packages get installed into Applications automatically. Anything else is saved to Downloads.' : 'Installers (.exe / .msi) open as soon as they finish downloading. Anything else is saved to Downloads.'}</div>`);
      return;
    }
    if (q) {
      if (!S.cat.ready) { setView(loadingHTML()); return; }
      if (!S.results.length) { setView(`<div class="empty">${I.search}<div class="big">Nothing called "${esc(q)}"</div><div>Try another name, or paste a direct download link.</div></div>`); return; }
      setView(`<div class="h2"><h2>Results</h2><span class="sub">${S.results.length >= 60 ? 'Top 60' : S.results.length} for "${esc(q)}"</span></div><div class="grid">${S.results.map(cardHTML).join('')}</div>`);
      return;
    }
    const hero = `<div class="hero"><h1>${['Get', 'any', 'app.'].map((w, i) => `<span class="w" style="--i:${i}">${w}</span> `).join('')}<span class="g w" style="--i:3">One click.</span></h1><p>Search, hit Get, done. Every download comes straight from the official source${isMac() ? ' and lands in Applications' : ' and installs silently'}.</p>
      <div class="chips"><span class="chip">${I.shield}${isMac() ? 'Checksums verified' : 'Hash-checked by winget'}</span><span class="chip">${I.bolt}No browser, no fake buttons</span><span class="chip">${I.box}${S.cat.ready ? `<b data-count="${S.cat.count}">0</b>&nbsp;apps` : 'Thousands of apps'}</span></div></div>`;
    if (S.cat.error) { setView(hero + `<div class="empty">${I.globe}<div class="big">Can't reach the catalog</div><div>${esc(S.cat.error)}</div><div style="margin-top:14px"><button class="btn btn-solid" data-retry-cat>Try again</button></div></div>`); return; }
    if (!S.cat.ready) { setView(hero + wingetNote() + `<div class="h2"><h2>Popular</h2></div><div class="grid">${'<div class="skel"></div>'.repeat(12)}</div>`); return; }
    setView(hero + wingetNote() + `<div class="h2"><h2>Popular</h2><span class="sub">Most grabbed</span></div><div class="grid">${S.cat.popular.map(cardHTML).join('')}</div>`);
  }
  function loadingHTML(t = 'Loading the app catalog') { return `<div class="empty"><div class="spinner"></div><div class="big">${esc(t)}</div><div>First launch takes a few seconds.</div></div>`; }

  function renderUpdates() {
    if (!S.scan) { setView(loadingHTML('Checking your apps')); return; }
    const ups = S.scan.filter(s => s.update);
    if (!ups.length) { setView(`<div class="hero"><h1>Updates</h1></div><div class="empty">${I.check}<div class="big">You're all up to date</div><div>Grab checks your apps against the latest official versions.</div><div style="margin-top:14px"><button class="btn" data-rescan>Check again</button></div></div>`); return; }
    setView(`<div class="hero"><h1>Updates</h1><p>${ups.length} app${ups.length > 1 ? 's have' : ' has'} a newer version.</p></div>
      <div class="h2"><h2>Available</h2><button class="btn btn-solid" data-update-all>${I.up} Update all</button></div>
      <div class="list">${ups.map((s, i) => rowHTML(s, i, { sub: `${esc(s.installedVer || 'installed')} <span style="color:var(--faint)">&rarr;</span> <b style="color:#c9bfff">${esc(s.latest || '')}</b>`, acts: actionHTML(s) })).join('')}</div>`);
  }

  function renderInstalled() {
    if (!S.scan) { setView(loadingHTML('Checking your apps')); return; }
    const list = S.scan.filter(s => !S.removed.has(s.id));
    if (!list.length) { setView(`<div class="hero"><h1>Installed</h1></div><div class="empty">${I.box}<div class="big">No matching apps yet</div><div>Apps you grab show up here.</div></div>`); return; }
    setView(`<div class="hero"><h1>Installed</h1><p>${list.length} app${list.length > 1 ? 's' : ''} Grab can keep updated.</p></div>
      <div class="list">${list.map((s, i) => rowHTML(s, i, {
        sub: `${esc(s.installedVer ? 'v' + s.installedVer : '')}${s.update ? ' <span class="pill up">Update</span>' : ''}`,
        acts: `${actionHTML(s)}<button class="btn btn-ghost" data-remove="${esc(s.id)}" title="${isMac() ? 'Move to Trash' : 'Uninstall'}">${I.trash}</button>`,
      })).join('')}</div>`);
  }

  function dlRowInner(j) {
    const it = S.items.get(j.itemId) || { id: j.itemId, name: j.name, home: j.home };
    const active = ['queued', 'downloading', 'installing'].includes(j.state);
    let st = '';
    if (j.state === 'queued') st = 'Waiting';
    else if (j.state === 'downloading') st = j.total ? `${fmtBytes(j.received)} of ${fmtBytes(j.total)}${j.speed ? ' · ' + fmtBytes(j.speed) + '/s' : ''}` : (j.received ? fmtBytes(j.received) : (j.stage || 'Starting')) + (j.pct && !j.total ? ` · ${Math.round(j.pct)}%` : '');
    else if (j.state === 'installing') st = j.stage || 'Installing';
    else if (j.state === 'needs-quit') st = `${j.msg}. Quit it to finish installing.`;
    else st = j.msg || j.state;
    const indet = active && !(j.state === 'downloading' && (j.total || j.pct));
    let acts = '';
    if (active) acts = `<button class="btn btn-ghost" data-cancel="${j.id}">Cancel</button>`;
    else if (j.state === 'needs-quit') acts = `<button class="btn btn-warn" data-resume="${j.id}">Quit &amp; install</button><button class="btn btn-ghost" data-cancel="${j.id}">Cancel</button>`;
    else if (j.state === 'done') acts = `${j.path && isMac() && j.result === 'installed' ? `<button class="btn btn-ok" data-openpath="${esc(j.path)}">Open</button>` : ''}${j.path && j.result !== 'installed' ? `<button class="btn" data-reveal="${esc(j.path)}">Show</button>` : ''}<button class="btn btn-ghost" data-dismiss="${j.id}">${I.x}</button>`;
    else if (j.state === 'error') acts = `${String(j.itemId).startsWith('url:') ? '' : `<button class="btn btn-bad" data-act="${esc(j.itemId)}" data-do="${j.verb === 'update' ? 'update' : 'get'}">Retry</button>`}<button class="btn btn-ghost" data-dismiss="${j.id}">${I.x}</button>`;
    else acts = `<button class="btn btn-ghost" data-dismiss="${j.id}">${I.x}</button>`;
    const pct = j.state === 'installing' || j.state === 'done' ? 100 : Math.round(j.pct || 0);
    return { cls: `dl${indet ? ' indet' : ''}${j.state === 'error' ? ' err' : ''}${j.state === 'done' ? ' ok' : ''}`, html: `${iconHTML(it)}<div style="min-width:0"><div class="name" style="font-weight:650">${esc(j.verb === 'uninstall' ? 'Removing ' : j.verb === 'update' ? 'Updating ' : '')}${esc(it.name || j.name)}</div><div class="bar"><i style="width:${pct}%"></i></div><div class="st">${esc(st)}</div></div><div class="acts" style="display:flex;gap:8px">${acts}</div>` };
  }
  function renderDownloads() {
    const list = [...S.jobsById.values()].sort((a, b) => b.created - a.created);
    if (!list.length) { setView(`<div class="hero"><h1>Downloads</h1></div><div class="empty">${I.dl}<div class="big">Nothing downloading</div><div>Hit Get on any app and it shows up here.</div></div>`); return; }
    setView(`<div class="hero"><h1>Downloads</h1></div><div class="list">${list.map((j, i) => { const r = dlRowInner(j); return `<div class="${r.cls}" data-dl="${j.id}" style="animation-delay:${i * 25}ms">${r.html}</div>`; }).join('')}</div>`);
  }
  function patchDownloadRow(j) {
    const row = $(`[data-dl="${j.id}"]`);
    if (!row) { renderDownloads(); return; }
    const r = dlRowInner(j);
    row.className = r.cls;
    const bar = $('.bar i', row), st = $('.st', row);
    const tmp = document.createElement('div'); tmp.innerHTML = r.html;
    bar.style.width = $('.bar i', tmp).style.width;
    st.textContent = $('.st', tmp).textContent;
    const acts = $('.acts', row), nacts = $('.acts', tmp);
    if (acts.innerHTML !== nacts.innerHTML) acts.innerHTML = nacts.innerHTML;
  }

  function render() {
    $$('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === S.view));
    fluid.nav();
    if (S.view === 'discover') renderDiscover();
    else if (S.view === 'updates') renderUpdates();
    else if (S.view === 'installed') renderInstalled();
    else renderDownloads();
  }
  function go(v) { if (S.view === v) return; S.view = v; fluid.jump(0); render(); }

  function badges() {
    const nUp = S.scan ? S.scan.filter(s => s.update && !(S.jobsByItem.get(s.id) && S.jobsByItem.get(s.id).state === 'done')).length : 0;
    const bu = $('#badge-updates'); if (bu.textContent !== String(nUp) && nUp) jelly(bu, 2); bu.textContent = nUp; bu.classList.toggle('show', nUp > 0);
    const nDl = [...S.jobsById.values()].filter(j => ['queued', 'downloading', 'installing', 'needs-quit'].includes(j.state)).length;
    const bd = $('#badge-downloads'); if (bd.textContent !== String(nDl) && nDl) jelly(bd, 2); bd.textContent = nDl; bd.classList.toggle('show', nDl > 0);
  }
  function foot() {
    const f = $('#side-foot');
    if (S.cat.error) f.textContent = 'Catalog offline';
    else if (!S.cat.ready) f.textContent = 'Loading catalog';
    else f.textContent = `${S.cat.count.toLocaleString()} apps · v${S.info.version || ''}`;
  }

  // ---------- detail sheet ----------
  async function openSheet(id) {
    let it = S.items.get(id);
    try { const fresh = await G.get(id); if (fresh) it = remember([fresh])[0] && S.items.get(id); } catch {}
    if (!it) return;
    const sc = S.scan && S.scan.find(s => s.id === id);
    if (sc && sc.path && !it.path) it = { ...it, path: sc.path };
    const sh = $('#sheet'), back = $('#sheet-back');
    const inst = isInstalled(it);
    const shield = isMac()
      ? (it.verified ? `Official download from <b>${esc(it.host)}</b>. Grab checks its checksum before installing, so a tampered file gets blocked.` : `Official download from <b>${esc(it.host)}</b>, taken from Homebrew's reviewed catalog. This vendor doesn't publish a fixed checksum.`)
      : `Installed through winget, Microsoft's package manager. The installer comes from the publisher and its hash is checked before it runs.`;
    sh.innerHTML = `<button class="btn btn-ghost close" data-close>${I.x}</button>
      <div class="head">${iconHTML(it)}<div style="min-width:0"><h3>${esc(it.name)}</h3><div class="pub">${esc(isMac() ? (it.host || '') : (it.publisher || ''))}</div></div></div>
      ${isMac() && it.desc ? `<p class="about">${esc(it.desc)}</p>` : ''}
      <div class="actions">${actionHTML(it, 'big')}${it.home ? `<button class="btn big" data-ext="${esc(it.home)}">${I.globe} Website</button>` : ''}${inst ? `<button class="btn btn-ghost big" data-remove="${esc(it.id)}">${I.trash} ${isMac() ? 'Move to Trash' : 'Uninstall'}</button>` : ''}</div>
      <div class="facts">
        <div class="fact"><span>Latest version</span><span>${esc(String(it.ver || '').split(',')[0] || 'n/a')}</span></div>
        ${sc && sc.installedVer ? `<div class="fact"><span>Installed</span><span>${esc(sc.installedVer)}</span></div>` : ''}
        ${isMac() ? `<div class="fact"><span>Downloads from</span><span>${esc(it.host)}</span></div>` : ''}
        <div class="fact"><span>ID</span><span>${esc(it.id)}</span></div>
        ${it.deprecated ? `<div class="fact"><span>Status</span><span style="color:var(--warn)">No longer maintained</span></div>` : ''}
      </div>
      <div class="shield">${I.shield}<div>${shield}</div></div>`;
    sh.dataset.id = id;
    hydrateIcons(sh); fluid.magnet(sh);
    sh.hidden = false; back.hidden = false;
    requestAnimationFrame(() => { sh.classList.add('on'); back.classList.add('on'); });
  }
  function closeSheet() {
    const sh = $('#sheet'), back = $('#sheet-back');
    if (sh.hidden) return;
    sh.classList.remove('on'); back.classList.remove('on');
    setTimeout(() => { sh.hidden = true; back.hidden = true; sh.innerHTML = ''; }, 420);
  }

  // ---------- toasts ----------
  function toast(msg, bad = false) {
    const t = document.createElement('div');
    t.className = 'toast' + (bad ? ' bad' : '');
    t.innerHTML = (bad ? I.x : I.check) + `<span>${esc(msg)}</span>`;
    $('#toasts').appendChild(t); jellyIn(t); setTimeout(() => jelly(t, 0.8), 60);
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 320); }, bad ? 6000 : 3800);
  }

  // ---------- actions ----------
  async function doAct(id, what, jobId) {
    try {
      if (what === 'get') await G.install(id);
      else if (what === 'update') await G.update(id);
      else if (what === 'open') await G.open(id);
      else if (what === 'cancel') await G.cancel(Number(jobId));
      else if (what === 'quit') await G.resume(Number(jobId));
      else if (what === 'detail') openSheet(id);
    } catch (e) { toast(String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), true); }
  }

  document.addEventListener('click', async (e) => {
    const t = e.target.closest('button, [data-open], .nav-btn');
    if (!t) return;
    if (t.matches('.nav-btn')) { go(t.dataset.view); return; }
    if (t.dataset.act) { e.stopPropagation(); doAct(t.dataset.act, t.dataset.do, t.dataset.job); return; }
    if (t.dataset.ext) { G.external(t.dataset.ext); return; }
    if (t.dataset.url != null) { try { await G.installUrl(t.dataset.url); toast('Downloading from link'); go('downloads'); } catch (err) { toast('That link does not look right', true); } return; }
    if (t.dataset.cancel) { G.cancel(Number(t.dataset.cancel)); return; }
    if (t.dataset.resume) { G.resume(Number(t.dataset.resume)); return; }
    if (t.dataset.dismiss) { const id = Number(t.dataset.dismiss); await G.dismiss(id); const j = S.jobsById.get(id); S.jobsById.delete(id); if (j && S.jobsByItem.get(j.itemId) === j) S.jobsByItem.delete(j.itemId); renderDownloads(); badges(); return; }
    if (t.dataset.openpath) { G.openPath(t.dataset.openpath); return; }
    if (t.dataset.reveal) { G.reveal(t.dataset.reveal); return; }
    if (t.dataset.remove) {
      e.stopPropagation();
      const id = t.dataset.remove, it = S.items.get(id);
      try {
        await G.uninstall(id);
        if (isMac()) { S.removed.add(id); S.installed.delete(id); toast(`${it ? it.name : 'App'} moved to Trash`); }
        else { toast(`Removing ${it ? it.name : 'app'}`); }
        closeSheet(); refreshActions(id); if (S.view === 'installed' || S.view === 'updates') render();
      } catch (err) { toast(String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), true); }
      return;
    }
    if (t.dataset.close != null) { closeSheet(); return; }
    if (t.dataset.updateAll != null) {
      const ups = (S.scan || []).filter(s => s.update);
      for (const s of ups) { try { await G.update(s.id); } catch {} }
      toast(`Updating ${ups.length} app${ups.length > 1 ? 's' : ''}`);
      return;
    }
    if (t.dataset.rescan != null) { S.scan = null; render(); S.scan = await G.scan(true); render(); badges(); return; }
    if (t.dataset.retryCat != null) { S.cat.error = null; render(); G.refreshCatalog(); return; }
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
  async function runSearch() {
    const my = ++qSeq;
    const q = S.q.trim();
    if (q && !/^https?:\/\//i.test(q)) S.results = remember(await G.search(q));
    else S.results = [];
    if (my !== qSeq) return;
    if (S.view !== 'discover') S.view = 'discover';
    fluid.jump(0);
    render();
  }
  qEl.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { if (qEl.value) { qEl.value = ''; S.q = ''; $('#clear').hidden = true; runSearch(); } else qEl.blur(); }
    if (e.key === 'Enter') { const b = $('[data-url]'); if (b) b.click(); else if (S.results[0]) openSheet(S.results[0].id); }
  });
  $('#clear').addEventListener('click', (e) => { e.preventDefault(); qEl.value = ''; S.q = ''; $('#clear').hidden = true; runSearch(); qEl.focus(); });
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); qEl.focus(); qEl.select(); }
    else if (e.key === '/' && document.activeElement !== qEl) { e.preventDefault(); qEl.focus(); }
    else if (e.key === 'Escape') closeSheet();
  });

  // ---------- events from main ----------
  G.onCatalog((c) => { S.cat = c; remember(c.popular); foot(); if (S.view === 'discover') { if (S.q) runSearch(); else render(); } });
  G.onScan((list) => { S.scan = remember(list); S.removed.clear(); for (const s of list) S.installed.add(s.id); badges(); if (S.view === 'updates' || S.view === 'installed') render(); else for (const s of list) refreshActions(s.id); });
  G.onJob((j) => {
    const prev = S.jobsById.get(j.id);
    S.jobsById.set(j.id, j);
    S.jobsByItem.set(j.itemId, j);
    if (j.state === 'done' && (!prev || prev.state !== 'done')) {
      if (j.verb === 'uninstall') { S.installed.delete(j.itemId); S.removed.add(j.itemId); toast(`${j.name} removed`); }
      else {
        S.installed.add(j.itemId); S.removed.delete(j.itemId);
        if (S.scan) { const s = S.scan.find(x => x.id === j.itemId); if (s && j.verb !== 'uninstall') s.update = false; }
        toast(j.result === 'pkg-opened' ? `${j.name}: finish in the installer` : j.result === 'saved' ? `${j.name} saved to Downloads` : `${j.name} ${j.verb === 'update' ? 'updated' : 'installed'}`);
      }
    }
    if (j.state === 'error' && (!prev || prev.state !== 'error')) toast(`${j.name}: ${j.msg}`, true);
    if (j.state === 'needs-quit' && (!prev || prev.state !== 'needs-quit')) toast(`${j.msg}. Hit "Quit & install" to finish.`, true);
    refreshActions(j.itemId);
    badges();
    if (S.view === 'downloads') patchDownloadRow(j);
    else if ((S.view === 'updates' || S.view === 'installed') && j.state === 'done' && (!prev || prev.state !== 'done')) render();
  });
  // ---------- auto update card (Surge-style) ----------
  function renderUpd(u) {
    if (!u) return;
    const card = $('#self-card'), btn = $('#self-btn'), title = $('#self-title'), fill = $('#self-fill');
    const show = ['downloading', 'unpacking', 'ready', 'installing'].includes(u.status) || (u.status === 'available');
    if (show && card.hidden) { card.hidden = false; jelly(card, 1.2); }
    if (!show && !card.hidden && u.status !== 'error') card.hidden = true;
    const v = ver => String(ver || '').replace(/^v/, '');
    card.classList.toggle('busy', ['downloading', 'unpacking', 'available'].includes(u.status));
    fill.style.width = (u.status === 'ready' ? 100 : u.progress || 0) + '%';
    if (u.status === 'ready') { title.innerHTML = `Grab ${esc(v(u.latest))} is ready`; btn.textContent = 'Restart to update'; btn.disabled = false; if (!card.dataset.ready) { card.dataset.ready = 1; jelly(btn, 1.4); } }
    else if (u.status === 'installing') { title.textContent = 'Updating'; btn.textContent = 'Restarting'; btn.disabled = true; }
    else if (u.status === 'unpacking') { title.innerHTML = `Getting Grab ${esc(v(u.latest))} ready`; btn.textContent = 'Almost there'; btn.disabled = true; }
    else { title.innerHTML = `Downloading Grab ${esc(v(u.latest))}`; btn.textContent = `${u.progress || 0}%`; btn.disabled = true; }
    if (u.justUpdated && !S.greeted) { S.greeted = true; setTimeout(() => toast(`Updated to Grab ${u.justUpdated}`), 900); }
  }
  G.onUpdater(renderUpd);
  $('#self-btn').addEventListener('click', () => G.updInstall());

  // ---------- boot ----------
  (async () => {
    S.info = await G.info();
    document.body.classList.add(isMac() ? 'mac' : 'win');
    $('#kbd').textContent = isMac() ? '\u2318K' : 'Ctrl K';
    S.cat = await G.catalog();
    remember(S.cat.popular);
    for (const j of await G.jobs()) { S.jobsById.set(j.id, j); S.jobsByItem.set(j.itemId, j); }
    foot(); render(); badges();
    G.scan(false).then(list => { if (list && list.length) { S.scan = remember(list); for (const s of list) S.installed.add(s.id); badges(); if (S.view !== 'discover') render(); else for (const s of list) refreshActions(s.id); } }).catch(() => {});
    G.updState().then(renderUpd).catch(() => {});
    G.ready();
  })().catch(e => { console.error('boot failed', e); G.ready(); });
})();
