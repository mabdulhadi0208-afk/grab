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
    packs: [], pack: null, freeOnly: (() => { try { return localStorage.getItem('grab-free') === '1'; } catch { return false; } })(), scan: null, jobsById: new Map(), jobsByItem: new Map(), items: new Map(), installed: new Set(), removed: new Set(),
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
    tag: '<svg viewBox="0 0 24 24"><path d="M3.5 12.6V5a1.5 1.5 0 0 1 1.5-1.5h7.6L20.5 11.4a1.5 1.5 0 0 1 0 2.1l-7 7a1.5 1.5 0 0 1-2.1 0z"/><circle cx="8" cy="8" r="1.3"/></svg>',
    back: '<svg viewBox="0 0 24 24"><path d="M14.5 6l-6 6 6 6"/></svg>',
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
  const iconMem = (() => { try { return JSON.parse(localStorage.getItem('grab-icons-v4') || '{}'); } catch { return {}; } })();
  let iconMemT = null;
  function iconRemember(id, url) { if (!id || String(url).startsWith('data:')) return; iconMem[id] = url; clearTimeout(iconMemT); iconMemT = setTimeout(() => { try { localStorage.setItem('grab-icons-v4', JSON.stringify(iconMem)); } catch {} }, 800); }
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

  // ---------- living jelly: one underdamped spring engine drives hover, press, pull and every wobble ----------
  // CSS easings sampled from the same spring (damped harmonic oscillator), so entrances wobble the same way.
  function springEasing(stiffness, damping, mass = 1) {
    const w0 = Math.sqrt(stiffness / mass), z = damping / (2 * Math.sqrt(stiffness * mass));
    const wd = w0 * Math.sqrt(Math.max(0, 1 - z * z));
    const x = (t) => z < 1 ? 1 - Math.exp(-z * w0 * t) * (Math.cos(wd * t) + (z * w0 / wd) * Math.sin(wd * t)) : 1 - Math.exp(-w0 * t) * (1 + w0 * t);
    let T = 0; while (T < 6 && !(Math.abs(1 - x(T)) < 0.002 && Math.abs(1 - x(T + 0.05)) < 0.002 && Math.abs(1 - x(T + 0.11)) < 0.002)) T += 0.02;
    const N = 140, pts = []; for (let i = 0; i <= N; i++) pts.push(+x((i / N) * T).toFixed(4));
    pts[N] = 1;
    return { css: `linear(${pts.join(', ')})`, ms: Math.round(T * 1000) };
  }
  const RS = document.documentElement.style;
  const REDUCE = matchMedia('(prefers-reduced-motion: reduce)').matches;
  // JELLY: damping ratio about 0.19, so every move overshoots by roughly half and wobbles five or more times before it settles.
  const LV = {
    chill: { btn: 1.06, card: 1.02, soft: 1.01, tilt: 4, press: 0.94, mag: 0.12, K: 230, C: 17, skew: 1.2, band: 60, mk: 0.5, burst: 'cubic-bezier(.3,1.25,.5,1)' },
    bouncy: { btn: 1.18, card: 1.05, soft: 1.02, tilt: 12, press: 0.82, mag: 0.3, K: 220, C: 9.5, skew: 4, band: 140, mk: 1, burst: 'cubic-bezier(.34,1.56,.64,1)' },
    max: { btn: 1.5, card: 1.12, soft: 1.04, tilt: 25, press: 0.6, mag: 0.5, K: 210, C: 5.6, skew: 15, band: 300, mk: 1.7, burst: 'cubic-bezier(.3,2.4,.5,1)' },
  };
  const SP = { jelly: null, bouncy: null, soft: springEasing(170, 24) };
  let L = LV.max, MK = 1.7, MLEVEL = 'max';
  function setMotion(name) {
    MLEVEL = LV[name] ? name : 'max'; L = LV[MLEVEL]; MK = L.mk;
    const sp = springEasing(L.K, L.C); SP.jelly = SP.bouncy = sp;
    RS.setProperty('--mk', MK); RS.setProperty('--jelly', sp.css); RS.setProperty('--bouncy', sp.css); RS.setProperty('--soft', SP.soft.css);
    RS.setProperty('--jelly-ms', sp.ms + 'ms'); RS.setProperty('--spring', L.burst);
    document.body.dataset.motion = MLEVEL; try { localStorage.setItem('grab-motion', MLEVEL); } catch {}
  }
  setMotion((() => { try { return localStorage.getItem('grab-motion') || 'max'; } catch { return 'max'; } })());

  const J = (() => {
    const act = new Set(); let last = 0, running = false;
    const CH = [['x', 'vx', 'tx'], ['y', 'vy', 'ty'], ['s', 'vs', 'ts'], ['rx', 'vrx', 'trx'], ['ry', 'vry', 'try']];
    const get = (el) => el._j || (el._j = { el, x: 0, y: 0, s: 1, rx: 0, ry: 0, vx: 0, vy: 0, vs: 0, vrx: 0, vry: 0, tx: 0, ty: 0, ts: 1, trx: 0, try: 0 });
    function wake(o) { act.add(o); o.el.classList.add('jx'); if (!running) { running = true; last = performance.now(); requestAnimationFrame(tick); } }
    function to(el, t) { if (REDUCE || !el) return null; const o = get(el); Object.assign(o, t); wake(o); return o; }
    function kick(el, v) { if (REDUCE || !el) return; const o = get(el); for (const k in v) o[k] += v[k]; wake(o); }
    function tick(now) {
      const dt = Math.min(0.034, Math.max(0.001, (now - last) / 1000)); last = now;
      const n = Math.max(1, Math.round(dt / 0.004)), h = dt / n;
      for (const o of act) {
        if (!o.el.isConnected) { act.delete(o); continue; }
        for (let i = 0; i < n; i++) for (const [p, v, t] of CH) { o[v] += (L.K * (o[t] - o[p]) - (o.C || L.C) * o[v]) * h; o[p] += o[v] * h; }
        let rest = true;
        for (const [p, v, t] of CH) { const sc = p === 's' ? 400 : p === 'x' || p === 'y' ? 4 : 8; if (Math.abs(o[t] - o[p]) * sc > 1 || Math.abs(o[v]) * sc > 6) { rest = false; break; } }
        const st = o.el.style;
        if (rest) {
          for (const [p, v, t] of CH) { o[p] = o[t]; o[v] = 0; }
          const idle = o.ts === 1 && !o.tx && !o.ty && !o.trx && !o.try;
          st.scale = o.ts === 1 ? '' : `${o.ts} ${o.ts}`; st.translate = o.tx || o.ty ? `${o.tx}px ${o.ty}px` : '';
          const a0 = Math.hypot(o.trx, o.try); st.transform = a0 > 0.05 ? `perspective(900px) rotateX(${o.trx}deg) rotateY(${o.try}deg)` : '';
          if (idle) o.el.classList.remove('jx');
          act.delete(o); continue;
        }
        // squash and stretch: whatever the size is doing right now, one axis leads and the other lags (up to 40%)
        const d = Math.max(-0.4, Math.min(0.4, o.vs * 0.075));
        st.scale = `${Math.max(0.05, o.s * (1 + d)).toFixed(4)} ${Math.max(0.05, o.s * (1 - d)).toFixed(4)}`;
        st.translate = `${o.x.toFixed(2)}px ${o.y.toFixed(2)}px`;
        const a = Math.hypot(o.rx, o.ry);
        st.transform = a > 0.05 ? `perspective(900px) rotateX(${o.rx.toFixed(2)}deg) rotateY(${o.ry.toFixed(2)}deg)` : '';
      }
      if (act.size) requestAnimationFrame(tick); else running = false;
    }
    return { to, kick, get };
  })();
  // one-shot wobble (state changes, toasts, badges...)
  function jelly(el, k = 1) { J.kick(el, { vs: Math.min(9, 3.2 * k * MK) }); }
  function jellyIn(el) {
    if (!el || REDUCE || !el.animate) return;
    el.animate([{ scale: '.5 .5', opacity: 0 }, { scale: '1 1', opacity: 1 }], { duration: SP.jelly.ms, easing: SP.jelly.css });
  }

  // hover swells and pulls toward the cursor, cards tilt in 3D, pressing squashes, releasing pops
  (() => {
    const BTN = '.btn, .chip, .sw, .seg-b, .clear', CARD = '.card, .pack', SOFT = '.nav-btn, .rowi, .dl, .set, .search, .self-card, .brand';
    const ALL = `${BTN}, ${CARD}, ${SOFT}`;
    const kind = (el) => (el.matches(BTN) ? 'btn' : el.matches(CARD) ? 'card' : 'soft');
    const hov = new Set(); let pressed = null, drag = null;
    const rest = (el) => (hov.has(el) ? L[kind(el)] : 1);
    // a swollen, tilted button drifts under the cursor, so it keeps a generous halo: still hovered, still clickable
    const near = (el, x, y, m) => { const r = el.getBoundingClientRect(); return x >= r.left - m && x <= r.right + m && y >= r.top - m && y <= r.bottom + m; };
    const held = (x, y, t, m) => { for (const el of hov) if (el.isConnected && kind(el) === 'btn' && !el.disabled && (el.contains(t) || near(el, x, y, m))) return el; return null; };
    const unhover = (el) => { hov.delete(el); if (drag && drag.el === el) return; J.to(el, { ts: pressed === el ? L.press : 1, tx: 0, ty: 0, trx: 0, try: 0 }); };
    document.addEventListener('click', (e) => {
      if (!e.isTrusted) return;
      const b = held(e.clientX, e.clientY, e.target, 16);
      if (b && !b.contains(e.target)) { e.stopPropagation(); e.preventDefault(); b.click(); }
    }, true);
    document.addEventListener('pointerover', (e) => {
      if (REDUCE || e.pointerType === 'touch') return;
      for (let el = e.target.closest && e.target.closest(ALL); el; el = el.parentElement && el.parentElement.closest(ALL)) {
        if (hov.has(el)) continue; hov.add(el);
        J.to(el, { ts: pressed === el ? L.press : rest(el) });
      }
    });
    document.addEventListener('pointerout', (e) => {
      for (const el of [...hov]) if (!el.isConnected || (!el.contains(e.relatedTarget) && !(kind(el) === 'btn' && e.relatedTarget && near(el, e.clientX, e.clientY, 24)))) unhover(el);
    });
    document.addEventListener('pointermove', (e) => {
      for (const el of hov) {
        if (!el.isConnected) { hov.delete(el); continue; }
        const k = kind(el); if (k === 'soft') continue;
        if (k === 'btn' && !el.contains(e.target) && !near(el, e.clientX, e.clientY, 24)) { unhover(el); continue; }
        const o = J.get(el), r = el.getBoundingClientRect();
        if (k === 'btn') { J.to(el, { tx: (e.clientX - (r.left + r.width / 2 - o.x)) * L.mag, ty: (e.clientY - (r.top + r.height / 2 - o.y)) * L.mag }); }
        else if (!(drag && drag.el === el)) { const px = (e.clientX - r.left) / r.width - 0.5, py = (e.clientY - r.top) / r.height - 0.5; J.to(el, { trx: -py * 2 * L.tilt, try: px * 2 * L.tilt }); }
      }
      // pull: a pressed card, pack or row follows the cursor like rubber
      if (drag && e.pointerId === drag.id) {
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y, dist = Math.hypot(dx, dy);
        if (!drag.on && dist < 7) return; drag.on = true;
        const f = 0.5 / (1 + dist / 600); J.to(drag.el, { tx: dx * f, ty: dy * f });
      }
    });
    document.addEventListener('pointerdown', (e) => {
      if (REDUCE || e.button !== 0) return;
      const hb = held(e.clientX, e.clientY, e.target, 16);
      const el = hb || (e.target.closest && e.target.closest(ALL)); if (!el) return;
      pressed = el; J.to(el, { ts: L.press, C: 15 }); // the squash itself lands firmly; the release is what bounces
      const c = e.target.closest('.card, .pack, .rowi, .dl'); if (c && !hb && !e.target.closest('button')) drag = { el: c, x: e.clientX, y: e.clientY, id: e.pointerId, on: false };
    });
    const up = () => {
      if (pressed) { const el = pressed; pressed = null; J.to(el, { ts: rest(el), C: 0 }); J.kick(el, { vs: 2.2 * MK }); }
      if (drag) {
        const d = drag; drag = null; J.to(d.el, { tx: 0, ty: 0 });
        if (d.on) { const stop = (ev) => { ev.stopPropagation(); ev.preventDefault(); }; document.addEventListener('click', stop, { capture: true, once: true }); setTimeout(() => document.removeEventListener('click', stop, { capture: true }), 60); }
      }
    };
    document.addEventListener('pointerup', up); document.addEventListener('pointercancel', up);
  })();
  // icons wobble when you hover their card
  document.addEventListener('pointerover', (e) => {
    const c = e.target.closest && e.target.closest('.card, .rowi'); if (!c || c.contains(e.relatedTarget)) return;
    const ic = $('.ic', c); if (!ic || REDUCE || !ic.animate) return;
    ic.animate([{ rotate: '0deg', scale: '1 1' }, { rotate: '-12deg', scale: '1.2 .82' }, { rotate: '10deg', scale: '.86 1.16' }, { rotate: '-6deg', scale: '1.08 .94' }, { rotate: '3deg', scale: '.97 1.03' }, { rotate: '0deg', scale: '1 1' }], { duration: 900, easing: 'ease-out' });
  });
  // headline letters squash, stretch and bounce when the cursor runs over them
  document.addEventListener('pointerover', (e) => { const l = e.target.closest && e.target.closest('.l'); if (l) J.kick(l, { vy: -520 * MK, vs: 4.5 * MK }); });
  $('#q').addEventListener('focus', () => jelly($('#search-wrap'), 0.5));

  // ---------- juice: confetti burst, click ripples, 3D tilt ----------
  function burst(el, n = 14) {
    if (REDUCE || !el || !el.getBoundingClientRect) return;
    const r = el.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const cols = ['#7C5CFF', '#4F7BFF', '#22D3EE', '#34d399', '#f472b6', '#fbbf24'];
    for (let i = 0; i < n; i++) {
      const d = document.createElement('i'); d.className = 'bit';
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.5, dist = 46 + Math.random() * 70, s = 5 + Math.random() * 6;
      d.style.cssText = `left:${cx}px;top:${cy}px;width:${s}px;height:${s}px;background:${cols[i % cols.length]};border-radius:${Math.random() > 0.5 ? '50%' : '2px'}`;
      document.body.appendChild(d);
      d.animate([{ transform: 'translate(-50%,-50%) scale(0)', opacity: 1 }, { transform: `translate(calc(-50% + ${Math.cos(a) * dist}px), calc(-50% + ${Math.sin(a) * dist}px)) scale(1.2) rotate(${Math.random() * 360}deg)`, opacity: 1, offset: 0.55 }, { transform: `translate(calc(-50% + ${Math.cos(a) * dist * 1.15}px), calc(-50% + ${Math.sin(a) * dist * 1.15 + 34}px)) scale(0) rotate(${Math.random() * 720}deg)`, opacity: 0 }], { duration: 850 + Math.random() * 350, easing: 'cubic-bezier(.15,.8,.3,1)' }).onfinish = () => d.remove();
    }
  }
  document.addEventListener('pointerdown', (e) => {
    const b = e.target.closest('.btn, .nav-btn, .pack, .chip.tog'); if (!b || REDUCE) return;
    const r = b.getBoundingClientRect(), w = document.createElement('i'); w.className = 'rip';
    const size = Math.max(r.width, r.height) * 2.2;
    w.style.cssText = `width:${size}px;height:${size}px;left:${e.clientX - r.left - size / 2}px;top:${e.clientY - r.top - size / 2}px`;
    if (getComputedStyle(b).position === 'static') b.style.position = 'relative';
    b.appendChild(w);
    w.animate([{ transform: 'scale(0)', opacity: 0.35 }, { transform: 'scale(1)', opacity: 0 }], { duration: 620, easing: 'cubic-bezier(.2,.7,.2,1)' }).onfinish = () => w.remove();
  });
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && ['1', '2', '3', '4', '5', '6'].includes(e.key)) { e.preventDefault(); const b = $$('.nav-btn')[+e.key - 1]; if (b) { b.click(); jelly(b, 0.8); } }
  });
  $('.brand').addEventListener('click', () => { jelly($('.logo'), 2.5); burst($('.logo'), 18); });

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
    // paid apps: the developer's stated trial if there is one, otherwise Buy (opens the developer's website)
    if (it.price && it.trial) return `<button class="btn btn-get btn-trial${cls}" data-act="${id}" data-do="get" title="${esc(it.trial.note)}">${esc(it.trial.label)}</button>`;
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
    const goo = $$('#goo i'), gp = goo.map(() => ({ x: undefined, y: undefined, vx: 0, vy: 0 }));
    let wave = 0, waveV = 0, waveShown = 0;
    let target = 0, cur = 0, wheeling = false, vel = 0, lastTop = 0, idle = 0, over = 0, overV = 0, overShown = 0;
    const maxScroll = () => Math.max(0, view.scrollHeight - view.clientHeight);
    let pos = 0, sv = 0, lastWheel = 0, lastT = performance.now();
    view.addEventListener('wheel', (e) => {
      if (reduce || e.ctrlKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      e.preventDefault();
      if (!wheeling) { pos = target = view.scrollTop; sv = 0; }
      const d = e.deltaY * (e.deltaMode === 1 ? 32 : e.deltaMode === 2 ? view.clientHeight : 1);
      // the target may run past either end (rubber band); it is pulled back as soon as the wheel stops
      target = Math.max(-L.band, Math.min(maxScroll() + L.band, target + d));
      wheeling = true; lastWheel = performance.now();
    }, { passive: false });
    // keyboard / scrollbar drags take over instantly
    view.addEventListener('pointerdown', (e) => { if (e.target === view) { wheeling = false; over = 0; } });
    addEventListener('keydown', (e) => { if (['PageDown', 'PageUp', 'Home', 'End', 'ArrowDown', 'ArrowUp', ' '].includes(e.key) && document.activeElement !== $('#q')) { wheeling = false; over = 0; } });
    let mx = -999, my = -999, bx = -999, by = -999;
    main.addEventListener('pointermove', (e) => { const r = main.getBoundingClientRect(); mx = e.clientX - r.left; my = e.clientY - r.top; main.classList.add('hov');
      const c = e.target.closest && e.target.closest('.card');
      if (c) { const cr = c.getBoundingClientRect(); c.style.setProperty('--mx', (e.clientX - cr.left) + 'px'); c.style.setProperty('--my', (e.clientY - cr.top) + 'px'); }
    });
    main.addEventListener('pointerleave', () => main.classList.remove('hov'));
    (function loop() {
      requestAnimationFrame(loop);
      const now = performance.now(), dt = Math.min(0.034, Math.max(0.001, (now - lastT) / 1000)); lastT = now;
      if (wheeling) {
        const mxs = maxScroll(), idleW = now - lastWheel > 110;
        if (idleW) target = Math.max(0, Math.min(mxs, target));
        if (MLEVEL === 'max') { // underdamped: overshoots the target and bounces back several times
          const n = Math.max(1, Math.round(dt / 0.004)), h = dt / n;
          for (let i = 0; i < n; i++) { sv += (150 * (target - pos) - 5.4 * sv) * h; pos += sv * h; }
        } else { pos += (target - pos) * (1 - Math.pow(0.86, dt * 60)); sv = 0; }
        const real = Math.max(0, Math.min(mxs, pos));
        view.scrollTop = real;
        over = Math.max(-300, Math.min(300, real - pos));
        if (idleW && Math.abs(target - pos) < 0.4 && Math.abs(sv) < 3) { pos = target; sv = 0; over = 0; wheeling = false; }
      }
      const top = view.scrollTop;
      vel += ((top - lastTop - (over - overShown)) - vel) * 0.2; lastTop = top;
      // past either end the page stretches like rubber instead of stopping
      if (over !== overShown) { overShown = over; const vi = view.firstElementChild; if (vi) { vi.style.translate = over ? `0 ${over.toFixed(2)}px` : ''; vi.style.transformOrigin = over > 0 ? '50% 0' : '50% 100%'; vi.style.scale = over ? `1 ${(1 + Math.abs(over) / 1500).toFixed(4)}` : ''; } }
      const sk = reduce ? 0 : Math.max(-L.skew, Math.min(L.skew, vel * -(L.skew / 40)));
      view.style.setProperty('--sk', sk.toFixed(3) + 'deg');
      // jelly wave: content lags behind the scroll column by column, overshoots, and settles
      const wt = reduce ? 0 : Math.max(-30, Math.min(30, vel * -1.2)) * MK;
      waveV += (wt - wave) * 0.11; waveV *= 0.8; wave += waveV;
      if (Math.abs(wave) < 0.02 && Math.abs(waveV) < 0.02) wave = waveV = 0;
      if (wave !== waveShown) { waveShown = wave; view.style.setProperty('--vy', wave.toFixed(2) + 'px'); view.style.setProperty('--st', (1 + Math.min(0.05, Math.abs(wave) / 900)).toFixed(4)); }
      // gooey cursor trail
      // cursor trail on loose springs: each blob overshoots the cursor and stretches along its direction of travel
      if (goo.length && mx > -999) for (let i = 0; i < gp.length; i++) {
        const g = gp[i];
        if (g.x === undefined || MLEVEL === 'chill') { g.x = g.x === undefined ? mx : g.x + (mx - g.x) * 0.2; g.y = g.y === undefined ? my : g.y + (my - g.y) * 0.2; g.vx = g.vy = 0; }
        else { const K = 70 - i * 11, C = 3.4 - i * 0.3, n = 4, h = dt / n; for (let j = 0; j < n; j++) { g.vx += (K * (mx - g.x) - C * g.vx) * h; g.vy += (K * (my - g.y) - C * g.vy) * h; g.x += g.vx * h; g.y += g.vy * h; } }
        const sp = Math.hypot(g.vx, g.vy), st = 1 + Math.min(1, sp / 1400);
        goo[i].style.transform = `translate(${g.x.toFixed(1)}px, ${g.y.toFixed(1)}px) rotate(${Math.atan2(g.vy, g.vx).toFixed(3)}rad) scale(${st.toFixed(3)}, ${(1 / Math.sqrt(st)).toFixed(3)})`;
      }
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
      for (const el of $$('.card, .rowi, .dl, .urlcard, .pack', root)) { if (reduce) continue; el.classList.add('rv'); io.observe(el); }
      magnet(root);
    }
    function magnet() {} // hover pull is handled by the spring engine now
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
    function jump(y) { wheeling = false; target = pos = y; sv = 0; over = 0; view.scrollTop = y; }
    return { reveal, counters, nav, magnet, jump };
  })();

  // ---------- views ----------
  const PRICE = { paid: ['Paid', 'Costs money. You get the official trial, then buy it from the developer.'], sub: ['Subscription', 'Needs a paid subscription from the developer.'] };
  function priceHTML(it) { const p = PRICE[it.price]; return p ? `<span class="pill price ${it.price}" title="${esc(p[1])}">${I.tag}${p[0]}</span>` : ''; }
  const freeFilter = (list) => (S.freeOnly ? list.filter(it => !it.price) : list);
  function freeToggle() { return `<button class="chip tog${S.freeOnly ? ' on' : ''}" data-free>${I.tag}Free apps only</button>`; }
  function packCardHTML(p, i) {
    const icons = p.items.slice(0, 4).map(iconHTML).join('');
    return `<div class="pack clickable" data-pack="${esc(p.id)}" style="--h:${p.hue};--d:${i * 60}ms"><div class="pack-ic">${icons}</div><div class="pack-t">${esc(p.name)}</div><div class="pack-b">${esc(p.blurb)} · ${p.items.length} apps</div></div>`;
  }
  function renderPack(p) {
    remember(p.items);
    const todo = p.items.filter(it => !isInstalled(it) && !it.price);
    setView(`<div class="hero pack-hero" style="--h:${p.hue}"><button class="btn btn-ghost" data-pack-back>${I.back} Back</button><h1>${esc(p.name)}</h1><p>${esc(p.blurb)}. ${p.items.length} apps, one click.</p>
      <div style="margin-top:16px"><button class="btn btn-solid big" data-pack-all="${esc(p.id)}"${todo.length ? '' : ' disabled'}>${I.dl} ${todo.length ? `Get all ${todo.length}` : 'All installed'}</button></div></div>
      <div class="grid">${p.items.map(cardHTML).join('')}</div>`);
  }
  function cardHTML(it, i) {
    remember([it]);
    const d = Math.min(i, 18) * 22;
    return `<div class="card clickable" data-open="${esc(it.id)}" style="animation-delay:${d}ms">
      ${iconHTML(it)}
      <div class="meta"><div class="name">${esc(it.name)}</div><div class="desc">${esc(subLine(it))}</div>
      <div class="row"><span class="ver">${esc(verLabel(it))}</span>${it.label ? `<span class="pill kindp">${esc(it.label)}</span>` : ''}${priceHTML(it)}${actionHTML(it)}</div></div></div>`;
  }
  function rowHTML(it, i, right) {
    remember([it]);
    return `<div class="rowi clickable" data-open="${esc(it.id)}" style="animation-delay:${Math.min(i, 20) * 18}ms">${iconHTML(it)}
      <div style="min-width:0"><div class="name">${esc(it.name)}</div><div class="desc">${right.sub}</div></div>
      <div class="acts">${right.acts}</div></div>`;
  }
  function setView(html) {
    view.innerHTML = `<div class="view-in">${html}</div>`; hydrateIcons(view); fluid.reveal(view); fluid.counters(view);
    // each column of cards rides the scroll wave a little later than the one before it
    for (const g of $$('.grid, .packs, .list', view)) {
      const kids = [...g.children]; if (!kids.length) continue;
      const top0 = kids[0].offsetTop; let cols = kids.findIndex(k => k.offsetTop !== top0); if (cols < 1) cols = g.classList.contains('list') ? 1 : kids.length;
      kids.forEach((k, i) => { k.style.setProperty('--lag', g.classList.contains('list') ? (0.5 + (i % 3) * 0.25).toFixed(2) : (0.35 + (i % cols) * 0.3).toFixed(2)); k.style.setProperty('--i', i); });
    }
    if (navDir && !REDUCE) { const vi = view.firstElementChild; vi.style.animation = 'none'; vi.animate([{ transform: `translateX(${navDir * 90 * Math.min(1.3, MK)}px) skewX(${navDir * -7}deg) scaleX(1.06)`, opacity: 0, filter: 'blur(8px)' }, { transform: 'none', opacity: 1, filter: 'none' }], { duration: SP.bouncy.ms, easing: SP.bouncy.css }); navDir = 0; }
  }
  let navDir = 0;
  const VIEWS = ['discover', 'updates', 'installed', 'downloads', 'saved', 'settings'];

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
      const shown = freeFilter(S.results);
      if (S.results.length && !shown.length) { setView(`<div class="h2"><h2>Results</h2>${freeToggle()}</div><div class="empty">${I.tag}<div class="big">Only paid apps match "${esc(q)}"</div><div>Turn off "Free apps only" to see them.</div></div>`); return; }
      if (!S.results.length) { setView(`<div class="empty">${I.search}<div class="big">Nothing called "${esc(q)}"</div><div>Try another name, or paste a direct download link.</div></div>`); return; }
      setView(`<div class="h2"><h2>Results <span class="sub">${S.results.length >= 60 ? 'top 60' : shown.length} for "${esc(q)}"</span></h2>${freeToggle()}</div><div class="grid">${shown.map(cardHTML).join('')}</div>`);
      return;
    }
    const hero = `<div class="hero"><h1>${['Get', 'any', 'app.'].map((w, i) => `<span class="w" style="--i:${i}">${[...w].map(c => `<i class="l">${c}</i>`).join('')}</span> `).join('')}<span class="g w" style="--i:3">One click.</span></h1><p>Search, hit Get, done. Every download comes straight from the official source${isMac() ? ' and lands in Applications' : ' and installs silently'}.</p>
      <div class="chips"><span class="chip">${I.shield}${isMac() ? 'Checksums verified' : 'Hash-checked by winget'}</span><span class="chip">${I.bolt}No browser, no fake buttons</span><span class="chip">${I.box}${S.cat.ready ? `<b data-count="${S.cat.count}">0</b>&nbsp;apps` : 'Thousands of apps'}</span></div></div>`;
    if (S.cat.error) { setView(hero + `<div class="empty">${I.globe}<div class="big">Can't reach the catalog</div><div>${esc(S.cat.error)}</div><div style="margin-top:14px"><button class="btn btn-solid" data-retry-cat>Try again</button></div></div>`); return; }
    if (!S.cat.ready) { setView(hero + wingetNote() + `<div class="h2"><h2>Popular</h2></div><div class="grid">${'<div class="skel"></div>'.repeat(12)}</div>`); return; }
    if (S.pack) { const p = S.packs.find(x => x.id === S.pack); if (p) return renderPack(p); S.pack = null; }
    const packs = S.packs.length ? `<div class="h2"><h2>Starter packs</h2><span class="sub">A whole setup in one click</span></div><div class="packs">${S.packs.map(packCardHTML).join('')}</div>` : '';
    setView(hero + wingetNote() + packs + `<div class="h2"><h2>Popular</h2>${freeToggle()}</div><div class="grid">${freeFilter(S.cat.popular).map(cardHTML).join('')}</div>`);
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
    setView(`<div class="hero"><h1>Downloads</h1></div>${list.some(j => ['done', 'error', 'canceled'].includes(j.state)) ? `<div class="h2"><h2></h2><button class="btn btn-ghost" data-clear-done>Clear finished</button></div>` : ''}<div class="list">${list.map((j, i) => { const r = dlRowInner(j); return `<div class="${r.cls}" data-dl="${j.id}" style="animation-delay:${i * 25}ms">${r.html}</div>`; }).join('')}</div>`);
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

  // ---------- saved apps + settings ----------
  const store = { get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };
  S.saved = new Set(store.get('grab-saved', []));
  S.savedItems = null;
  const heart = (on) => `<svg viewBox="0 0 24 24" style="${on ? 'fill:#f472b6;stroke:#f472b6' : ''}"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/></svg>`;
  function saveBtn(id) { const on = S.saved.has(id); return `<button class="btn big${on ? ' saved-on' : ''}" data-save="${esc(id)}">${heart(on)} ${on ? 'Saved' : 'Save'}</button>`; }
  async function renderSaved() {
    if (!S.saved.size) { setView(`<div class="hero"><h1>Saved</h1></div><div class="empty">${heart(false)}<div class="big">Nothing saved yet</div><div>Open any app and hit Save to keep it here for later.</div></div>`); return; }
    if (!S.savedItems) { setView(loadingHTML('Loading your saved apps')); S.savedItems = remember(await G.getMany([...S.saved])); if (S.view !== 'saved') return; }
    const list = S.savedItems.filter(it => S.saved.has(it.id));
    const todo = list.filter(it => !isInstalled(it) && !it.price);
    setView(`<div class="hero"><h1>Saved</h1><p>${list.length} app${list.length === 1 ? '' : 's'} you want to grab later.</p></div>
      <div class="h2"><h2></h2><button class="btn btn-solid" data-saved-all${todo.length ? '' : ' disabled'}>${I.dl} ${todo.length ? `Get all ${todo.length}` : 'All installed'}</button></div>
      <div class="grid">${list.map(cardHTML).join('')}</div>`);
  }
  const THEMES = { violet: ['#7C5CFF', '#4F7BFF', '#22D3EE'], sunset: ['#FF5C8A', '#FF8A4F', '#FBBF24'], mint: ['#10B981', '#22D3EE', '#4F7BFF'], candy: ['#F472B6', '#A855F7', '#60A5FA'], lime: ['#84CC16', '#22C55E', '#14B8A6'] };
  function applyTheme(name) { const t = THEMES[name] || THEMES.violet; ['--a1', '--a2', '--a3'].forEach((k, i) => RS.setProperty(k, t[i])); store.set('grab-theme', name); S.theme = name; }
  applyTheme(store.get('grab-theme', 'violet'));
  function renderSettings() {
    const mod = isMac() ? '⌘' : 'Ctrl ';
    setView(`<div class="hero"><h1>Settings</h1></div>
      <div class="set"><div><b>Colour</b><span>Pick the vibe for the whole app</span></div><div class="swatches">${Object.entries(THEMES).map(([k, c]) => `<button class="sw${S.theme === k ? ' on' : ''}" data-theme="${k}" title="${k}" style="background:linear-gradient(135deg,${c.join(',')})"></button>`).join('')}</div></div>
      <div class="set"><div><b>Motion</b><span>JELLY overshoots and wobbles on everything. Chill keeps it calm.</span></div><div class="seg">${[['chill', 'Chill'], ['bouncy', 'Bouncy'], ['max', 'JELLY']].map(([k, n]) => `<button class="seg-b${MLEVEL === k ? ' on' : ''}" data-motion="${k}">${n}</button>`).join('')}</div></div>
      <div class="set"><div><b>Free apps only</b><span>Hide apps Grab knows cost money</span></div>${freeToggle()}</div>
      <div class="set"><div><b>Grab ${esc(S.info.version || '')}</b><span id="upd-line">Updates install themselves in the background</span></div><button class="btn" data-upd-check>Check for updates</button></div>
      <div class="set"><div><b>Shortcuts</b><span>${mod}K search · ${mod}1 to ${mod}6 switch tabs · Esc close</span></div></div>
      <div class="set"><div><b>About prices</b><span>Grab only downloads official versions from the developer. Paid apps arrive as their normal trial, and you buy them from the developer. Only well-known paid apps are labelled, so an app with no label is not guaranteed to be free.</span></div></div>`);
  }
  function render() {
    $$('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === S.view));
    fluid.nav();
    if (S.view === 'discover') renderDiscover();
    else if (S.view === 'updates') renderUpdates();
    else if (S.view === 'installed') renderInstalled();
    else if (S.view === 'saved') renderSaved();
    else if (S.view === 'settings') renderSettings();
    else renderDownloads();
  }
  function go(v) { if (S.view === v && !S.pack) return; S.pack = null; navDir = Math.sign(VIEWS.indexOf(v) - VIEWS.indexOf(S.view)) || 1; S.view = v; fluid.jump(0); render(); }

  function badges() {
    const nUp = S.scan ? S.scan.filter(s => s.update && !(S.jobsByItem.get(s.id) && S.jobsByItem.get(s.id).state === 'done')).length : 0;
    const bu = $('#badge-updates'); if (bu.textContent !== String(nUp) && nUp) jelly(bu, 2); bu.textContent = nUp; bu.classList.toggle('show', nUp > 0);
    const nDl = [...S.jobsById.values()].filter(j => ['queued', 'downloading', 'installing', 'needs-quit'].includes(j.state)).length;
    const bs = $('#badge-saved'); if (bs) { const n = S.saved ? S.saved.size : 0; bs.textContent = n; bs.classList.toggle('show', n > 0); }
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
      <div class="actions">${actionHTML(it, 'big')}${it.price && it.trial ? `<button class="btn btn-buy big" data-act="${esc(it.id)}" data-do="buy">${I.tag}Buy</button>` : ''}${it.price && !it.trial && !isInstalled(it) && !S.jobsByItem.get(it.id) ? `<button class="btn big" data-act2="${esc(it.id)}">${I.dl} Download</button>` : ''}${saveBtn(it.id)}${it.home ? `<button class="btn big" data-ext="${esc(it.home)}">${I.globe} Website</button>` : ''}${inst ? `<button class="btn btn-ghost big" data-remove="${esc(it.id)}">${I.trash} ${isMac() ? 'Move to Trash' : 'Uninstall'}</button>` : ''}</div>
      ${it.price ? `<div class="paynote">${I.tag}<div><b>${it.price === 'sub' ? 'This app needs a paid subscription.' : 'This app costs money.'}</b> ${it.trial ? esc(it.trial.note) + ' After that, buy it from the developer.' : 'Buy it on the developer\'s website, then use Download to install the official version here.'}</div></div>` : ''}
      <div class="facts">
        <div class="fact"><span>Latest version</span><span>${esc(String(it.ver || '').split(',')[0] || 'n/a')}</span></div>
        ${sc && sc.installedVer ? `<div class="fact"><span>Installed</span><span>${esc(sc.installedVer)}</span></div>` : ''}
        ${isMac() ? `<div class="fact"><span>Downloads from</span><span>${esc(it.host)}</span></div>` : ''}
        <div class="fact"><span>Price</span><span>${it.price === 'paid' ? 'Paid' : it.price === 'sub' ? 'Subscription' : 'No price listed'}</span></div>
        ${it.price ? `<div class="fact"><span>Free trial</span><span>${it.trial ? esc(it.trial.label) : 'None confirmed'}</span></div>` : ''}
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
    sh.classList.remove('on'); back.classList.remove('on'); if (!REDUCE && sh.animate) sh.animate([{ scale: '1 1' }, { scale: '.9 1.06' }, { scale: '1.05 .95' }], { duration: 320, easing: 'ease-in' });
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
      else if (what === 'buy') {
        const it = S.items.get(id) || {};
        let home = it.home || it.mhome;
        if (!home && !isMac()) { const m = await G.meta(id).catch(() => null); home = m && m.home; }
        if (home) { G.external(home); toast(`Opening ${it.name || 'the developer'}'s website`); } else openSheet(id);
      }
    } catch (e) { toast(String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), true); }
  }

  document.addEventListener('click', async (e) => {
    const t = e.target.closest('button, [data-open], [data-pack], [data-ext], .nav-btn');
    if (!t) return;
    if (t.matches('.nav-btn')) { go(t.dataset.view); return; }
    if (t.dataset.act) { e.stopPropagation(); doAct(t.dataset.act, t.dataset.do, t.dataset.job); return; }
    if (t.dataset.ext) { G.external(t.dataset.ext); return; }
    if (t.dataset.act2) { e.stopPropagation(); try { await G.install(t.dataset.act2); t.remove(); toast('Downloading the official version'); } catch (err) { toast(String(err.message || err), true); } return; }
    if (t.dataset.save) {
      const id = t.dataset.save; if (S.saved.has(id)) S.saved.delete(id); else { S.saved.add(id); burst(t, 10); }
      store.set('grab-saved', [...S.saved]); S.savedItems = null;
      const nb = document.createElement('div'); nb.innerHTML = saveBtn(id); t.replaceWith(nb.firstElementChild); jelly($(`[data-save="${sel(id)}"]`), 1.5);
      badges(); if (S.view === 'saved') render(); return;
    }
    if (t.dataset.savedAll != null) { const todo = (S.savedItems || []).filter(it => S.saved.has(it.id) && !isInstalled(S.items.get(it.id) || it) && !it.price); for (const it of todo) { try { await G.install(it.id); } catch {} } burst(t, 22); toast(`Grabbing ${todo.length} app${todo.length === 1 ? '' : 's'}`); t.disabled = true; return; }
    if (t.dataset.motion) { setMotion(t.dataset.motion); render(); const b = $(`[data-motion="${t.dataset.motion}"]`); jelly(b, 2); burst(b, 14); return; }
    if (t.dataset.theme) { applyTheme(t.dataset.theme); render(); burst($(`[data-theme="${t.dataset.theme}"]`), 12); return; }
    if (t.dataset.updCheck != null) { t.disabled = true; t.textContent = 'Checking'; const u = await G.updCheck().catch(() => null); const line = $('#upd-line'); if (line) line.textContent = !u ? 'Could not check right now' : u.status === 'uptodate' ? 'You have the latest version' : ['available', 'downloading', 'unpacking', 'ready'].includes(u.status) ? `Grab ${String(u.latest || '').replace(/^v/, '')} is on its way` : u.error || 'Could not check right now'; t.disabled = false; t.textContent = 'Check for updates'; return; }
    if (t.dataset.free != null) { S.freeOnly = !S.freeOnly; try { localStorage.setItem('grab-free', S.freeOnly ? '1' : '0'); } catch {} render(); return; }
    if (t.dataset.packBack != null) { S.pack = null; fluid.jump(0); render(); return; }
    if (t.dataset.packAll) {
      const p = S.packs.find(x => x.id === t.dataset.packAll); if (!p) return;
      const todo = p.items.filter(it => !isInstalled(S.items.get(it.id) || it) && !it.price);
      for (const it of todo) { try { await G.install(it.id); } catch {} }
      burst(t, 22); toast(`Grabbing ${todo.length} app${todo.length === 1 ? '' : 's'}`); t.disabled = true;
      return;
    }
    if (t.dataset.clearDone != null) { for (const j of [...S.jobsById.values()]) if (['done', 'error', 'canceled'].includes(j.state)) { await G.dismiss(j.id); S.jobsById.delete(j.id); if (S.jobsByItem.get(j.itemId) === j) S.jobsByItem.delete(j.itemId); } renderDownloads(); badges(); return; }
    if (t.dataset.pack) { S.pack = t.dataset.pack; fluid.jump(0); render(); return; }
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
    jelly($('#search-wrap'), 0.22);
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
    if (q) S.pack = null;
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
  G.onCatalog((c) => { S.cat = c; if (c.ready) G.packs().then(p => { S.packs = p || []; for (const x of S.packs) remember(x.items); if (S.view === 'discover' && !S.q) render(); }).catch(() => {}); remember(c.popular); foot(); if (S.view === 'discover') { if (S.q) runSearch(); else render(); } });
  G.onScan((list) => { S.scan = remember(list); S.removed.clear(); for (const s of list) S.installed.add(s.id); badges(); if (S.view === 'updates' || S.view === 'installed') render(); else for (const s of list) refreshActions(s.id); });
  G.onJob((j) => {
    const prev = S.jobsById.get(j.id);
    S.jobsById.set(j.id, j);
    S.jobsByItem.set(j.itemId, j);
    if (j.state === 'done' && (!prev || prev.state !== 'done') && j.verb !== 'uninstall') setTimeout(() => { const b = $(`[data-act="${sel(j.itemId)}"]`); if (b) burst(b, 16); }, 60);
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
    if (S.cat.ready) G.packs().then(p => { S.packs = p || []; for (const x of S.packs) remember(x.items); if (S.view === 'discover' && !S.q) render(); }).catch(() => {});
    G.updState().then(renderUpd).catch(() => {});
    G.ready();
  })().catch(e => { console.error('boot failed', e); G.ready(); });
})();
