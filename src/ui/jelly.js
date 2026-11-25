// Lumen's motion system, copied unchanged from Lumen (ui/jelly.js) so Grab's springs match Lumen 1:1. Do not tune it here.
/* Jelly: the Lumen motion system. Shared by the browser chrome, Lumen's own pages and the website.
 *
 * Everything that is touched moves on a lightly underdamped spring: damping ratio ~0.5, so a motion
 * overshoots by about 15% and wobbles two or three times before it settles.
 *   buttons  hover -> 1.08x, squash and stretch up to 12%, magnetic pull 15% toward the cursor
 *   cards    hover -> 1.04x, 3D tilt up to 8 degrees following the cursor
 *   press    -> 0.92x, release pops to 1.06x with a small overshoot, then settles
 *   objects  kick(el) squashes and stretches up to 15% and bounces once or twice (letters, drops)
 *   trail    a cursor follower that overshoots ~20px and stretches up to 1.2x along its travel
 *   scroll   wheel scrolling is critically damped: it glides to its target, no overshoot, no bounce
 * Modes: 'jelly' (default), 'calm' (heavily damped, almost no overshoot), 'off' (instant).
 */
;(function (global) {
  const CFG = {
    jelly: { k: 300, c: 22 },        // zeta 0.64 -> ~7.5% overshoot, settles in 1-2 wobbles
    bounce: { k: 380, c: 21.4 },     // zeta 0.55 -> squash impulses, one soft bounce
    trail: { k: 170, c: 19.8 },      // zeta 0.60 -> follower overshoots ~20px on a quick flick
    critical: { k: 420, c: 41 },     // zeta 1.00 -> wheel scroll, no overshoot
    calm: { k: 240, c: 25.5 },       // zeta 0.82
  }
  let MODE = 'jelly'
  const reduceMotion = global.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches
  if (reduceMotion) MODE = 'off'

  const live = new Set()
  let raf = 0, last = 0
  function frame(t) {
    const dt = Math.min(0.05, (t - (last || t)) / 1000); last = t
    for (const s of [...live]) s.step(dt)
    if (live.size) raf = requestAnimationFrame(frame); else { raf = 0; last = 0 }
  }
  class S {
    constructor(v, kind, cb) { this.v = v; this.t = v; this.vel = 0; this.kind = kind || 'jelly'; this.cb = cb }
    cfg() { if (this.kind === 'critical') return CFG.critical; return MODE === 'calm' ? CFG.calm : CFG[this.kind] }
    to(t, vel) {
      this.t = t
      if (vel !== undefined) this.vel = vel
      if (MODE === 'off') return this.set(t)
      live.add(this); if (!raf) raf = requestAnimationFrame(frame)
      return this
    }
    set(v) { this.v = this.t = v; this.vel = 0; live.delete(this); this.cb && this.cb(v); return this }
    step(dt) {
      const { k, c } = this.cfg(), n = Math.max(1, Math.ceil(dt * 240)), h = dt / n
      for (let i = 0; i < n; i++) { this.vel += (-k * (this.v - this.t) - c * this.vel) * h; this.v += this.vel * h }
      const eps = this.kind === 'critical' ? 0.3 : 0.0008
      if (Math.abs(this.vel) < eps * 20 && Math.abs(this.v - this.t) < eps) { this.v = this.t; this.vel = 0; live.delete(this) }
      this.cb && this.cb(this.v)
    }
  }
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v))

  // ---------------------------------------------------------------- per-element body
  const bodies = new WeakMap()
  function body(el) {
    let b = bodies.get(el)
    if (b) return b
    let queued = false
    const render = () => {
      queued = false
      const sv = b.s.v
      // squash and stretch: the faster the scale changes, the more it bulges sideways
      const fromScale = clamp(b.s.vel * 0.075, -0.06, 0.06)
      // stretch along the magnetic movement
      const mx = clamp(Math.abs(b.x.vel) * 0.0003, 0, 0.06), my = clamp(Math.abs(b.y.vel) * 0.0003, 0, 0.06)
      const q = clamp(b.q.v + fromScale, -0.075, 0.075)
      const sx = sv * (1 + q + mx - my * 0.5), sy = sv * (1 - q + my - mx * 0.5)
      const tilt = b.rx.v || b.ry.v ? ` perspective(700px) rotateX(${b.rx.v.toFixed(2)}deg) rotateY(${b.ry.v.toFixed(2)}deg)` : ''
      el.style.transform = `translate(${b.x.v.toFixed(2)}px, ${(b.y.v + b.hop.v).toFixed(2)}px)${tilt} scale(${sx.toFixed(4)}, ${sy.toFixed(4)})`
      if (sv === 1 && !q && !b.x.v && !b.y.v && !b.rx.v && !b.ry.v && !b.hop.v && !live.has(b.s)) el.style.transform = ''
    }
    const req = () => { if (!queued) { queued = true; queueMicrotask(render) } }
    b = { s: new S(1, 'jelly', req), x: new S(0, 'jelly', req), y: new S(0, 'jelly', req), rx: new S(0, 'jelly', req), ry: new S(0, 'jelly', req), q: new S(0, 'bounce', req), hop: new S(0, 'bounce', req), hovered: false, pressed: false }
    el.style.willChange = 'transform'
    bodies.set(el, b)
    return b
  }

  // kick: squash (positive = flatter) plus an optional hop, then bounce back once or twice
  function kick(el, strength = 1, hop = 0) {
    if (!el || MODE === 'off') return
    const b = body(el)
    b.q.to(0, 3 * strength)
    if (hop) b.hop.to(0, -hop * 150)
  }

  // ---------------------------------------------------------------- hover / press behaviour
  let opts = { buttons: '', cards: '', press: '' }
  let current = null, kind = null, rect = null
  const kindOf = el => (opts.cards && el.matches(opts.cards)) ? 'card' : (opts.buttons && el.matches(opts.buttons)) ? 'button' : 'press'
  const selector = () => [opts.buttons, opts.cards, opts.press].filter(Boolean).join(',')
  const hoverScale = k => k === 'card' ? 1.02 : k === 'button' ? 1.04 : 1

  function enter(el) {
    current = el; kind = kindOf(el)
    const b = body(el)
    b.hovered = true
    const saved = el.style.transform; el.style.transform = ''
    rect = el.getBoundingClientRect()
    el.style.transform = saved
    if (!b.pressed) b.s.to(hoverScale(kind))
  }
  function leave(el) {
    const b = bodies.get(el); if (!b) return
    b.hovered = false; b.pressed = false
    b.s.to(1); b.x.to(0); b.y.to(0); b.rx.to(0); b.ry.to(0)
    if (current === el) { current = null; rect = null }
  }
  function onMove(e) {
    if (e.pointerType === 'touch') return
    const sel = selector(); if (!sel) return
    const t = e.target && e.target.closest ? e.target.closest(sel) : null
    const target = t && !t.disabled && !t.hasAttribute('data-nojelly') ? t : null
    if (target !== current) { if (current) leave(current); if (target) enter(target) }
    if (!current || !rect) return
    const b = body(current)
    const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2
    if (kind === 'button') {
      b.x.to((e.clientX - cx) * 0.075); b.y.to((e.clientY - cy) * 0.075)
    } else if (kind === 'card') {
      const px = clamp((e.clientX - rect.left) / rect.width, 0, 1), py = clamp((e.clientY - rect.top) / rect.height, 0, 1)
      b.ry.to((px - 0.5) * 8); b.rx.to(-(py - 0.5) * 8)
    }
  }
  function onDown(e) {
    if (e.button !== 0) return
    const sel = selector(); if (!sel) return
    const t = e.target.closest && e.target.closest(sel)
    if (!t || t.disabled) return
    if (t !== current) { if (current) leave(current); enter(t) }
    const b = body(t); b.pressed = true
    b.s.to(kind === 'card' ? 0.98 : 0.96)
  }
  function onUp() {
    if (!current) return
    const b = body(current)
    if (!b.pressed) return
    b.pressed = false
    const el = current, k = kind
    b.s.to(1.03, 1.8)
    setTimeout(() => { const bb = bodies.get(el); if (bb && !bb.pressed) bb.s.to(bb.hovered ? hoverScale(k) : 1) }, 140)
  }

  // ---------------------------------------------------------------- critically damped wheel scrolling
  function smoothScroll(target) {
    const isWin = target === window || target === document.scrollingElement
    const el = isWin ? document.scrollingElement : target
    const area = isWin ? window : target
    let animating = false
    const sp = new S(0, 'critical', v => { animating = true; el.scrollTop = v; if (!live.has(sp)) animating = false })
    area.addEventListener('scroll', () => { if (!live.has(sp)) { sp.v = sp.t = el.scrollTop; sp.vel = 0 } }, { passive: true })
    area.addEventListener('wheel', e => {
      if (e.ctrlKey || e.defaultPrevented || MODE === 'off') return
      // let nested scrollers and horizontal gestures keep native behaviour
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return
      // a trackpad (or Magic Mouse) already glides on its own, with momentum: it scrolls natively, on the compositor,
      // instead of through a spring on the main thread (Chrome reports those with wheelDelta = -3 x delta, in pixels)
      if (e.deltaMode === 0 && e.wheelDeltaY && Math.abs(e.wheelDeltaY + 3 * e.deltaY) < 1 && !live.has(sp)) return
      let n = e.target
      while (n && n !== el && n !== document.body) {
        if (n.scrollHeight > n.clientHeight + 1 && n !== el && /(auto|scroll)/.test(getComputedStyle(n).overflowY)) return
        n = n.parentElement
      }
      const max = el.scrollHeight - el.clientHeight
      if (max <= 0) return
      e.preventDefault()
      const d = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * el.clientHeight : e.deltaY
      if (!live.has(sp)) { sp.v = el.scrollTop; sp.vel = 0 }
      sp.to(clamp(sp.t + d, 0, max))
    }, { passive: false })
    return sp
  }

  // ---------------------------------------------------------------- cursor trail
  function trail(options = {}) {
    if (MODE === 'off' || !matchMedia('(pointer: fine)').matches) return
    const dot = document.createElement('div')
    const size = options.size || 28
    dot.setAttribute('aria-hidden', 'true')
    dot.style.cssText = `position:fixed;left:0;top:0;width:${size}px;height:${size}px;margin:${-size / 2}px 0 0 ${-size / 2}px;border-radius:50%;pointer-events:none;z-index:2147483646;opacity:0;transition:opacity .25s;` + (options.style || 'border:1.5px solid rgba(140,160,255,.75);background:rgba(120,140,255,.10);backdrop-filter:blur(2px)')
    document.body.appendChild(dot)
    let queued = false
    const render = () => {
      queued = false
      const vx = x.vel, vy = y.vel, speed = Math.hypot(vx, vy)
      const st = 1 + clamp(speed / 5200, 0, 0.1)
      const ang = Math.atan2(vy, vx) * 180 / Math.PI
      dot.style.transform = `translate(${x.v}px, ${y.v}px) rotate(${ang}deg) scale(${st}, ${1 / st})`
    }
    const req = () => { if (!queued) { queued = true; queueMicrotask(render) } }
    const x = new S(-100, 'trail', req), y = new S(-100, 'trail', req)
    let seen = false
    addEventListener('pointermove', e => {
      if (e.pointerType === 'touch') return
      if (!seen) { x.set(e.clientX); y.set(e.clientY); seen = true }
      x.to(e.clientX); y.to(e.clientY); dot.style.opacity = '1'
    }, { passive: true })
    document.addEventListener('pointerleave', () => { dot.style.opacity = '0' })
    addEventListener('blur', () => { dot.style.opacity = '0' })
    return dot
  }

  // ---------------------------------------------------------------- jelly letters
  function letters(root) {
    const splitNode = (node, parent) => {
      const frag = document.createDocumentFragment()
      for (const word of node.textContent.split(/(\s+)/)) {
        if (!word) continue
        if (/^\s+$/.test(word)) { frag.appendChild(document.createTextNode(word)); continue }
        const w = document.createElement('span'); w.style.whiteSpace = 'nowrap'; w.style.display = 'inline-block'
        for (const ch of word) {
          const s = document.createElement('span'); s.textContent = ch; s.className = 'jl'; s.style.display = 'inline-block'
          w.appendChild(s)
        }
        frag.appendChild(w)
      }
      parent.replaceChild(frag, node)
    }
    const walk = el => { for (const n of [...el.childNodes]) { if (n.nodeType === 3) splitNode(n, el); else if (n.nodeType === 1) walk(n) } }
    walk(root)
    // keep gradient-clipped text continuous across letters
    const fixGradients = () => root.querySelectorAll('.jl').forEach(s => {
      const p = s.closest('[data-jl-grad]'); if (!p) return
      const pr = p.getBoundingClientRect(), r = s.getBoundingClientRect()
      s.style.backgroundImage = getComputedStyle(p).backgroundImage
      s.style.backgroundSize = pr.width + 'px ' + pr.height + 'px'
      s.style.backgroundPosition = `${pr.left - r.left}px ${pr.top - r.top}px`
      s.style.webkitBackgroundClip = 'text'; s.style.backgroundClip = 'text'; s.style.color = 'transparent'
    })
    requestAnimationFrame(fixGradients); addEventListener('resize', fixGradients)
    if (document.fonts) document.fonts.ready.then(fixGradients)
    const ls = [...root.querySelectorAll('.jl')]
    ls.forEach((s, i) => {
      s.addEventListener('pointerenter', () => {
        kick(s, 1, 1)
        if (ls[i - 1]) kick(ls[i - 1], 0.45, 0.4)
        if (ls[i + 1]) kick(ls[i + 1], 0.45, 0.4)
      })
    })
    return ls
  }

  // entrance helper: element is visible at rest; when it first scrolls into view it pops in
  function entrances(sel) {
    if (MODE === 'off' || !('IntersectionObserver' in global)) return
    const io = new IntersectionObserver(es => es.forEach(en => {
      if (!en.isIntersecting) return
      io.unobserve(en.target)
      en.target.animate([{ transform: 'translateY(18px) scale(.96)' }, { transform: 'none' }], { duration: 720, easing: 'cubic-bezier(.3,1.4,.5,1)' })
    }), { threshold: 0.12 })
    document.querySelectorAll(sel).forEach(el => { const r = el.getBoundingClientRect(); if (r.top > innerHeight) io.observe(el) })
  }

  function init(o) {
    opts = { ...opts, ...o }
    if (init.done) return
    init.done = true
    document.addEventListener('pointermove', onMove, { passive: true })
    document.addEventListener('pointerover', onMove, { passive: true })
    document.addEventListener('pointerdown', onDown, { passive: true })
    document.addEventListener('pointerup', onUp, { passive: true })
    document.addEventListener('pointercancel', onUp, { passive: true })
    document.documentElement.addEventListener('pointerleave', () => { if (current) leave(current) })
    addEventListener('blur', () => { if (current) leave(current) })
  }

  global.Jelly = {
    init, kick, trail, letters, smoothScroll, entrances, Spring: S, CFG,
    setMode(m) { MODE = reduceMotion ? 'off' : (m || 'jelly') }, getMode: () => MODE,
    EASE: 'cubic-bezier(.3,1.4,.5,1)',
  }
})(window)
