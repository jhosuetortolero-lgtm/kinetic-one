/**
 * KINETIC ONE — Acoustic Engineering
 * Frame-sequence scrubbing, Neural ANC simulator, finish configurator.
 * Stack: GSAP 3 + ScrollTrigger, Lenis (driven by the GSAP ticker).
 */
const HERO_TOTAL_FRAMES = 94;
const CLOSING_TOTAL_FRAMES = 94;

(() => {
  'use strict';

  /* ------------------------------------------------------------------ *
   * Config
   * ------------------------------------------------------------------ */
  const HERO_DIR = './public/frames-hero/';
  const CLOSING_DIR = './public/frames-closing/';
  const HERO_SCRUB_VH = 2.5;    // 100vh section + 250vh scrub distance = 350vh
  const CLOSING_SCRUB_VH = 2.0; // 100vh section + 200vh scrub distance = 300vh
  const EASE = 'power3.out';
  const DPR_CAP = 2;
  const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Must match the CSS media query used for story layout.
  const WIDE = window.matchMedia('(min-width: 640px) and (min-aspect-ratio: 23/20)');

  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));
  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const framePath = (dir, i) => `${dir}frame_${String(i + 1).padStart(4, '0')}.webp`;
  const expoOut = (t) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t));

  const root = document.documentElement;
  root.classList.remove('no-js');
  root.classList.add('js');

  const preloader = $('#preloader');
  const nav = $('#nav');

  if (!window.gsap || !window.ScrollTrigger) {
    // CDN unavailable: leave a readable, static page.
    preloader && preloader.remove();
    root.classList.remove('is-loading');
    return;
  }

  gsap.registerPlugin(ScrollTrigger);
  gsap.defaults({ ease: EASE });
  // Mobile URL-bar show/hide must not trigger a refresh (it would shift pinned heights).
  ScrollTrigger.config({ ignoreMobileResize: true });

  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  window.scrollTo(0, 0);

  /* ------------------------------------------------------------------ *
   * Frame loading
   * ------------------------------------------------------------------ */
  function loadFrames(dir, into, { concurrency = 6, onProgress } = {}) {
    const total = into.length;
    let next = 0;
    let settled = 0;

    return new Promise((resolve) => {
      const pump = () => {
        if (next >= total) return;
        const index = next++;
        const img = new Image();
        img.decoding = 'async';
        const done = (ok) => {
          img.onload = img.onerror = null;
          if (ok) into[index] = img;
          settled++;
          if (onProgress) onProgress(settled / total, index);
          if (settled === total) resolve(into);
          else pump();
        };
        img.onload = () => done(true);
        img.onerror = () => done(false); // a missing frame never blocks the sequence
        img.src = framePath(dir, index);
      };
      for (let k = 0; k < Math.min(concurrency, total); k++) pump();
    });
  }

  /* ------------------------------------------------------------------ *
   * Canvas frame sequence (DPR-aware, draws only when something changed)
   * ------------------------------------------------------------------ */
  const FADE_STOPS = [[0, 1], [0.25, 0.84], [0.5, 0.5], [0.75, 0.16], [1, 0]];

  function featherEdges(ctx, r, { rgb, x = 0, top = 0, bottom = 0 }) {
    const grad = (x0, y0, x1, y1) => {
      const g = ctx.createLinearGradient(x0, y0, x1, y1);
      for (const [o, a] of FADE_STOPS) g.addColorStop(o, `rgba(${rgb},${a})`);
      return g;
    };
    const { dx, dy, dw, dh } = r;
    if (x) {
      const f = dw * x;
      ctx.fillStyle = grad(dx, 0, dx + f, 0);
      ctx.fillRect(dx - 1, dy - 1, f + 1, dh + 2);
      ctx.fillStyle = grad(dx + dw, 0, dx + dw - f, 0);
      ctx.fillRect(dx + dw - f, dy - 1, f + 1, dh + 2);
    }
    if (top) {
      const f = dh * top;
      ctx.fillStyle = grad(0, dy, 0, dy + f);
      ctx.fillRect(dx - 1, dy - 1, dw + 2, f + 1);
    }
    if (bottom) {
      const f = dh * bottom;
      ctx.fillStyle = grad(0, dy + dh, 0, dy + dh - f);
      ctx.fillRect(dx - 1, dy + dh - f, dw + 2, f + 1);
    }
  }

  class FrameSequence {
    constructor(canvas, images, { fill, place, feather }) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d', { alpha: false });
      this.images = images;
      this.fill = fill;
      this.place = place;
      this.feather = feather;
      this.index = 0;
      this.cam = { x: 0, s: 1 };
      this.w = 0;
      this.h = 0;
      this.dpr = 1;
      this.last = { img: undefined, x: NaN, s: NaN };
    }

    resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP);
      const w = this.canvas.clientWidth;
      const h = this.canvas.clientHeight;
      if (!w || !h) return;
      if (w !== this.w || h !== this.h || dpr !== this.dpr) {
        this.w = w;
        this.h = h;
        this.dpr = dpr;
        this.canvas.width = Math.round(w * dpr);
        this.canvas.height = Math.round(h * dpr);
      }
      this.draw(true);
    }

    frameAt(i) {
      const imgs = this.images;
      if (imgs[i]) return imgs[i];
      for (let d = 1; d < imgs.length; d++) {
        if (imgs[i - d]) return imgs[i - d];
        if (imgs[i + d]) return imgs[i + d];
      }
      return null;
    }

    set(progress, cam) {
      const max = this.images.length - 1;
      this.index = clamp(Math.round(progress * max), 0, max);
      if (cam) this.cam = cam;
      this.draw();
    }

    draw(force = false) {
      if (!this.w) return;
      const img = this.frameAt(this.index);
      const cam = this.cam;
      const last = this.last;
      if (!force && last.img === img && last.x === cam.x && last.s === cam.s) return;
      last.img = img;
      last.x = cam.x;
      last.s = cam.s;

      const { ctx, w, h, dpr } = this;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = this.fill;
      ctx.fillRect(0, 0, w, h);
      if (!img) return;

      const r = this.place(img.naturalWidth, img.naturalHeight, w, h, cam);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, r.dx, r.dy, r.dw, r.dh);
      const feather = this.feather && this.feather();
      if (feather) featherEdges(ctx, r, feather);
    }
  }

  /* Hero: never crop the headphone. Wide screens use "contain"; narrow screens
     fit the product's safe width (~80% of the frame) and lift it above the copy. */
  const HERO_SAFE_WIDTH = 0.8;
  function heroPlace(iw, ih, w, h, cam) {
    const wide = WIDE.matches;
    const base = wide ? Math.min(w / iw, h / ih) : Math.min(w / (iw * HERO_SAFE_WIDTH), h / ih);
    // Narrow: the early close-up never takes more than 55% of the screen height,
    // which keeps it clear of the copy on tablets in portrait.
    const zoom = wide ? cam.s : Math.max(1, Math.min(cam.s, (h * 0.55) / (ih * base)));
    const s = base * zoom;
    const dw = iw * s;
    const dh = ih * s;
    return { dx: (w - dw) / 2 + cam.x * w, dy: (h - dh) / 2 - (wide ? 0 : h * 0.08), dw, dh };
  }
  const HERO_FEATHER = { rgb: '255,255,255', x: 0.12, top: 0.03, bottom: 0.1 };

  /* Closing: full-bleed cover on wide screens; letterboxed band on portrait. */
  function closingPlace(iw, ih, w, h) {
    const cover = Math.max(w / iw, h / ih);
    if (WIDE.matches) {
      const dw = iw * cover;
      const dh = ih * cover;
      return { dx: (w - dw) / 2, dy: (h - dh) / 2, dw, dh };
    }
    const s = Math.min(cover, w / (iw * 0.56));
    const dw = iw * s;
    const dh = ih * s;
    return { dx: (w - dw) / 2, dy: (h - dh) / 2 - h * 0.1, dw, dh };
  }
  const CLOSING_FEATHER = { rgb: '29,29,31', top: 0.2, bottom: 0.24 };

  /* Virtual camera for the hero. Wide screens: moves the product away from the
     side copy (right for block 2, left for block 3, centre at the end).
     Narrow screens: starts closer while the headphone is compact, then pulls back
     as it explodes, so the frame is never cropped.
     Pure function of progress, so it stays exact on resize and reverse scroll. */
  const ease3 = gsap.parseEase(EASE);
  const segment = (p, a, b) => ease3(clamp((p - a) / (b - a), 0, 1));
  function heroCamera(p) {
    if (!WIDE.matches) return { x: 0, s: lerp(1.6, 1, segment(p, 0.3, 0.6)) };
    const SHIFT = 0.16;
    const NEAR = 0.8;
    const k1 = segment(p, 0.22, 0.34);
    const k2 = segment(p, 0.58, 0.7);
    const k3 = segment(p, 0.93, 1);
    let x = lerp(0, SHIFT, k1);
    let s = lerp(1, NEAR, k1);
    x = lerp(x, -SHIFT, k2);
    x = lerp(x, 0, k3);
    s = lerp(s, 0.92, k3);
    return { x, s };
  }

  const heroImages = new Array(HERO_TOTAL_FRAMES).fill(null);
  const closingImages = new Array(CLOSING_TOTAL_FRAMES).fill(null);

  const heroSeq = new FrameSequence($('#hero-canvas'), heroImages, {
    fill: '#FFFFFF',
    place: heroPlace,
    feather: () => HERO_FEATHER,
  });
  const closingSeq = new FrameSequence($('#closing-canvas'), closingImages, {
    fill: '#1D1D1F',
    place: closingPlace,
    feather: () => (WIDE.matches ? null : CLOSING_FEATHER),
  });

  /* Closing frames load silently, once, after the visitor leaves the hero. */
  let closingRequested = false;
  function loadClosingFrames() {
    if (closingRequested) return;
    closingRequested = true;
    loadFrames(CLOSING_DIR, closingImages, {
      concurrency: 4,
      onProgress: () => closingSeq.draw(),
    });
  }

  /* ------------------------------------------------------------------ *
   * Lenis <-> ScrollTrigger
   * One clock: GSAP's ticker drives Lenis, Lenis notifies ScrollTrigger in the
   * same frame. Lenis scrolls the real window, so pinning needs no scrollerProxy.
   * ------------------------------------------------------------------ */
  let lenis = null;
  let menuApi = null;
  function initLenis() {
    if (REDUCED || typeof window.Lenis !== 'function') return;
    lenis = new window.Lenis({
      lerp: 0.085,
      smoothWheel: true,
      wheelMultiplier: 0.9,
      syncTouch: false, // native momentum on touch devices
    });
    lenis.on('scroll', ScrollTrigger.update);
    gsap.ticker.add((time) => lenis.raf(time * 1000));
    gsap.ticker.lagSmoothing(0);
  }

  function initAnchors() {
    $$('a[href^="#"]').forEach((link) => {
      link.addEventListener('click', (event) => {
        const id = link.getAttribute('href');
        if (!id || id.length < 2) return;
        const target = $(id);
        if (!target) return;
        event.preventDefault();
        if (menuApi && menuApi.isOpen()) menuApi.hide({ restoreFocus: false });
        const top = id === '#hero';
        const offset = top ? 0 : -nav.offsetHeight;
        const focusTarget = () => {
          if (top) return;
          if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
          target.focus({ preventScroll: true });
        };
        if (lenis) {
          lenis.scrollTo(top ? 0 : target, { offset, duration: 1.6, easing: expoOut, onComplete: focusTarget });
        } else {
          const y = top ? 0 : target.getBoundingClientRect().top + window.scrollY + offset;
          window.scrollTo({ top: y, behavior: REDUCED ? 'auto' : 'smooth' });
          focusTarget();
        }
      });
    });
  }

  /* ------------------------------------------------------------------ *
   * Hero — 350vh pinned scrub
   * ------------------------------------------------------------------ */
  function buildHero() {
    const s1 = $('.story--1 .story__inner');
    const s2 = $('.story--2 .story__inner');
    const s3 = $('.story--3 .story__inner');
    gsap.set([s2, s3], { autoAlpha: 0, y: 56 });

    const tl = gsap.timeline({
      defaults: { ease: EASE, duration: 0.07 },
      scrollTrigger: {
        id: 'hero',
        trigger: '#hero',
        start: 'top top',
        end: () => `+=${Math.round(window.innerHeight * HERO_SCRUB_VH)}`,
        pin: true,
        scrub: REDUCED ? true : 0.5,
        onLeave: loadClosingFrames,
      },
      onUpdate: () => {
        const p = tl.progress();
        heroSeq.set(p, heroCamera(p));
      },
    });

    // Timeline length is exactly 1, so positions read as scroll progress.
    tl.to({}, { duration: 1, ease: 'none' }, 0)
      .to('.hero__cue', { autoAlpha: 0, duration: 0.04 }, 0)
      .to(s1, { autoAlpha: 0, y: -56 }, 0.18)   // block 1: 0% – 25%
      .to(s2, { autoAlpha: 1, y: 0 }, 0.35)     // block 2: 35% – 60%
      .to(s2, { autoAlpha: 0, y: -56 }, 0.53)
      .to(s3, { autoAlpha: 1, y: 0 }, 0.7)      // block 3: 70% – 95%
      .to(s3, { autoAlpha: 0, y: -56 }, 0.88);

    heroSeq.set(0, heroCamera(0));
  }

  /* ------------------------------------------------------------------ *
   * Closing — 300vh pinned scrub
   * ------------------------------------------------------------------ */
  function buildClosing() {
    const a = $('.story--a .story__inner');
    const b = $('.story--b .story__inner');
    gsap.set([a, b], { autoAlpha: 0, y: 56 });

    const tl = gsap.timeline({
      defaults: { ease: EASE, duration: 0.07 },
      scrollTrigger: {
        id: 'closing',
        trigger: '#closing',
        start: 'top top',
        end: () => `+=${Math.round(window.innerHeight * CLOSING_SCRUB_VH)}`,
        pin: true,
        scrub: REDUCED ? true : 0.5,
        onEnter: loadClosingFrames,
        onEnterBack: loadClosingFrames,
      },
      onUpdate: () => closingSeq.set(tl.progress()),
    });

    tl.to({}, { duration: 1, ease: 'none' }, 0)
      .to(a, { autoAlpha: 1, y: 0 }, 0.1)       // 10% – 45%
      .to(a, { autoAlpha: 0, y: -56 }, 0.38)
      .to(b, { autoAlpha: 1, y: 0 }, 0.55)      // 55% – 90%
      .to(b, { autoAlpha: 0, y: -56 }, 0.9);

    closingSeq.set(0);
  }

  /* Nav turns graphite once the closing section reaches it and stays dark through
     the footer. Read from the pin's measured start, so it follows every refresh. */
  function buildNavTheme() {
    const closing = ScrollTrigger.getById('closing');
    const update = () => {
      nav.classList.toggle('is-dark', window.scrollY >= closing.start - nav.offsetHeight);
    };
    window.addEventListener('scroll', update, { passive: true });
    ScrollTrigger.addEventListener('refresh', update);
    update();
  }

  /* ------------------------------------------------------------------ *
   * Bento
   * ------------------------------------------------------------------ */
  function buildDiagrams() {
    const ticks = $('.dial__ticks');
    if (ticks) {
      let major = '';
      let minor = '';
      for (let i = 0; i < 72; i++) {
        const a = ((i * 5 - 90) * Math.PI) / 180;
        const isMajor = i % 9 === 0;
        const r1 = isMajor ? 82 : 87;
        const r2 = 94;
        const seg = `M${(100 + r1 * Math.cos(a)).toFixed(2)} ${(100 + r1 * Math.sin(a)).toFixed(2)}L${(100 + r2 * Math.cos(a)).toFixed(2)} ${(100 + r2 * Math.sin(a)).toFixed(2)}`;
        if (isMajor) major += seg;
        else minor += seg;
      }
      ticks.innerHTML = `<path class="dial__minor" d="${minor}"/><path class="dial__major" d="${major}"/>`;
    }

    const sampling = $('.sampling');
    if (sampling) {
      const W = 600;
      const MID = 80;
      const A = 58;
      const SAMPLES = 36;
      const LEVELS = 8;
      const f = (x) => Math.sin((x / W) * Math.PI * 3 + 0.3);
      let smooth = '';
      for (let x = 0; x <= W; x += 4) smooth += `${x ? 'L' : 'M'}${x} ${(MID - A * f(x)).toFixed(2)}`;
      let steps = '';
      const step = W / SAMPLES;
      for (let i = 0; i < SAMPLES; i++) {
        const x0 = i * step;
        const y = (MID - A * (Math.round(f(x0) * LEVELS) / LEVELS)).toFixed(2);
        steps += `${i ? 'L' : 'M'}${x0.toFixed(2)} ${y}L${(x0 + step).toFixed(2)} ${y}`;
      }
      $('.sampling__smooth', sampling).setAttribute('d', smooth);
      $('.sampling__steps', sampling).setAttribute('d', steps);
    }
  }

  function buildBento() {
    const grid = $('.bento');
    if (!grid) return;

    if (!REDUCED) {
      gsap.from('.bento .card', {
        autoAlpha: 0,
        y: 48,
        duration: 1.4,
        stagger: 0.1,
        scrollTrigger: { trigger: grid, start: 'top 85%', once: true },
      });
      gsap.from('.battery__fill, .battery__quick', {
        scaleX: 0,
        transformOrigin: '0% 50%',
        duration: 1.8,
        stagger: 0.25,
        scrollTrigger: { trigger: '.battery', start: 'top 90%', once: true },
      });
      gsap.from('.mass__bar > span', {
        scaleX: 0,
        transformOrigin: '0% 50%',
        duration: 1.4,
        stagger: 0.08,
        scrollTrigger: { trigger: '.mass', start: 'top 90%', once: true },
      });
    }

    // Head-tracking dial follows scroll: user-driven, so it also runs with reduced motion.
    const marker = $('.dial__marker');
    const readout = $('[data-azimuth]');
    if (marker && readout) {
      const dial = { a: 312 };
      const paint = () => {
        marker.setAttribute('transform', `rotate(${dial.a.toFixed(2)} 100 100)`);
        const deg = Math.round(((dial.a % 360) + 360) % 360);
        readout.textContent = `${String(deg).padStart(3, '0')}°`;
      };
      gsap.to(dial, {
        a: 480,
        ease: 'none',
        onUpdate: paint,
        scrollTrigger: { trigger: '.card--spatial', start: 'top bottom', end: 'bottom top', scrub: REDUCED ? true : 0.6 },
      });
      paint();
    }
  }

  function buildFooter() {
    if (REDUCED) return;
    gsap.fromTo('.footer__wordmark svg', { yPercent: 35 }, {
      yPercent: 0,
      ease: 'none',
      scrollTrigger: { trigger: '.footer__wordmark', start: 'top bottom', end: 'bottom bottom', scrub: 0.6 },
    });
  }

  /* ------------------------------------------------------------------ *
   * Neural ANC simulator
   * ------------------------------------------------------------------ */
  function initANC() {
    const panel = $('#anc-panel');
    if (!panel) return;
    const canvas = $('#anc-canvas', panel);
    const ctx = canvas.getContext('2d');
    const toggle = $('#anc-switch', panel);
    const status = $('#anc-status');
    const outs = {
      rumble: $('[data-readout="rumble"]', panel),
      wind: $('[data-readout="wind"]', panel),
      att: $('[data-readout="att"]', panel),
    };

    const TAU = Math.PI * 2;
    const COBALT = [0, 102, 204];
    // Index 0 survives as the residual line once ANC is on.
    const LAYERS = [
      { // low-frequency rumble
        rgb: [29, 29, 31], alpha: 0.92, width: 1.5, amp: 0.85,
        fn: (x, t) => 0.7 * Math.sin(TAU * 1.25 * x + t * 0.9) + 0.3 * Math.sin(TAU * 0.5 * x - t * 0.5),
      },
      { // mid-band ambience
        rgb: [84, 104, 128], alpha: 0.75, width: 1.1, amp: 0.42,
        fn: (x, t) => 0.6 * Math.sin(TAU * 3.8 * x + t * 2.1) + 0.4 * Math.sin(TAU * 6.3 * x - t * 1.5),
      },
      { // wind shear
        rgb: [134, 134, 139], alpha: 0.8, width: 1, amp: 0.3,
        fn: (x, t) =>
          (0.55 * Math.sin(TAU * 11 * x + t * 4.2) + 0.3 * Math.sin(TAU * 17.5 * x - t * 6) + 0.15 * Math.sin(TAU * 28 * x + t * 9.5)) *
          (0.6 + 0.4 * Math.sin(TAU * 0.8 * x + t * 0.7)),
      },
    ];

    const state = { mix: 0 };
    let on = false;
    let w = 0;
    let h = 0;
    let dpr = 1;
    let t = 0;
    let ticking = false;
    const shown = {};

    const fmt = (v) => {
      const r = Math.round(v);
      return `${r < 0 ? '−' : ''}${Math.abs(r)} dB`;
    };

    function readouts() {
      const m = state.mix;
      const values = { rumble: 85 - 48 * m, wind: 62 - 41 * m, att: -48 * m };
      for (const key in values) {
        const text = fmt(values[key]);
        if (shown[key] !== text) {
          outs[key].textContent = text;
          shown[key] = text;
        }
      }
    }

    function draw() {
      if (!w || !h) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const mid = h / 2;
      const amp = h * 0.42;
      const m = state.mix;
      const k = 1 - m;

      // Grid: 2 ms divisions, ±50% pressure guides, hairline zero axis.
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(0,0,0,0.05)';
      ctx.beginPath();
      for (let i = 1; i < 10; i++) {
        const x = Math.round((w * i) / 10) + 0.5;
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
      }
      for (const f of [-0.5, 0.5]) {
        const y = Math.round(mid + f * amp) + 0.5;
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
      }
      ctx.stroke();
      ctx.strokeStyle = 'rgba(0,0,0,0.12)';
      ctx.beginPath();
      ctx.moveTo(0, Math.round(mid) + 0.5);
      ctx.lineTo(w, Math.round(mid) + 0.5);
      ctx.stroke();

      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      for (let i = LAYERS.length - 1; i >= 0; i--) {
        const L = LAYERS[i];
        const alpha = lerp(L.alpha, i === 0 ? 1 : 0, m);
        if (alpha < 0.01) continue;
        const rgb = L.rgb.map((c, j) => Math.round(lerp(c, COBALT[j], m)));
        ctx.strokeStyle = `rgba(${rgb.join(',')},${alpha.toFixed(3)})`;
        ctx.lineWidth = lerp(L.width, 2, m);
        ctx.beginPath();
        for (let px = 0; px <= w + 2; px += 2) {
          const x = px / w;
          const y = mid - L.fn(x, t) * L.amp * amp * k - Math.sin(TAU * 1.6 * x + t * 1.2) * 0.8 * m;
          if (px === 0) ctx.moveTo(px, y);
          else ctx.lineTo(px, y);
        }
        ctx.stroke();
      }
    }

    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP);
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      draw();
    }

    const tick = (time, deltaTime) => {
      t += Math.min(deltaTime, 50) / 1000;
      draw();
    };
    function setRunning(run) {
      if (REDUCED) return;
      if (run && !ticking) {
        gsap.ticker.add(tick);
        ticking = true;
      } else if (!run && ticking) {
        gsap.ticker.remove(tick);
        ticking = false;
      }
    }

    function setANC(next) {
      if (next === on) return;
      on = next;
      toggle.setAttribute('aria-checked', String(on));
      panel.dataset.state = on ? 'on' : 'off';
      gsap.to(state, {
        mix: on ? 1 : 0,
        duration: REDUCED ? 0 : on ? 1.8 : 1.2,
        ease: EASE,
        overwrite: true,
        onUpdate: () => {
          readouts();
          if (!ticking) draw();
        },
        onComplete: () => {
          status.textContent = on
            ? 'Neural Isolation on. Low-frequency rumble 37 dB, wind shear 21 dB, attenuation 48 dB.'
            : 'Ambient environment. Low-frequency rumble 85 dB, wind shear 62 dB.';
        },
      });
    }

    toggle.addEventListener('click', () => setANC(!on));
    $$('.anc__opt', panel).forEach((el) => el.addEventListener('click', () => setANC(el.dataset.set === 'on')));

    new ResizeObserver(resize).observe(canvas);
    new IntersectionObserver(([entry]) => setRunning(entry.isIntersecting), { rootMargin: '120px 0px' }).observe(panel);
    readouts();
  }

  /* ------------------------------------------------------------------ *
   * Sound: frequency response chart with three on-board profiles
   * ------------------------------------------------------------------ */
  function initSound() {
    const section = $('#sound');
    if (!section) return;

    const FREQS = [20, 40, 80, 150, 300, 600, 1000, 2000, 3000, 5000, 8000, 12000, 20000];
    const PROFILES = {
      reference: {
        desc: 'Flat to the KINETIC target curve. For mixing, mastering and critical listening.',
        db: [0.4, 0.3, 0.1, 0, -0.2, 0, 0.2, -0.3, 0.4, -0.5, 0.3, -0.6, -1.5],
      },
      studio: {
        desc: 'A gentle low shelf that keeps long sessions full at lower volumes.',
        db: [3.2, 3.0, 2.4, 1.4, 0.4, 0, 0, -0.2, -0.6, -0.8, -0.4, -0.8, -2.0],
      },
      transit: {
        desc: 'Restores the low end that cabin noise masks, with softened treble for long flights.',
        db: [6.5, 6.2, 5.2, 3.4, 1.2, 0.2, 0.4, 0.8, 0.6, -1.2, -2.2, -2.8, -4.0],
      },
    };
    const W = 1000;
    const H = 360;
    const RANGE = 12; // ±12 dB
    const fx = (f) => (Math.log10(f / 20) / 3) * W; // 20 Hz – 20 kHz, three decades
    const fy = (db) => H / 2 - (db * (H / 2)) / RANGE;

    // Log-paper grid: 1–9 per decade, ±3 dB divisions.
    let minor = '';
    let major = '';
    for (const decade of [10, 100, 1000, 10000]) {
      for (let m = 1; m <= 9; m++) {
        const f = m * decade;
        if (f < 20 || f > 20000) continue;
        const line = `M${fx(f).toFixed(1)} 0V${H}`;
        if (m === 1 || f === 20 || f === 20000) major += line;
        else minor += line;
      }
    }
    for (let db = -12; db <= 12; db += 3) {
      if (db === 0) continue;
      const line = `M0 ${fy(db).toFixed(1)}H${W}`;
      if (db % 6 === 0) major += line;
      else minor += line;
    }
    $('.fr__grid', section).innerHTML =
      `<path class="fr__minor" d="${minor}"/><path class="fr__major" d="${major}"/><path class="fr__axis" d="M0 ${fy(0)}H${W}"/>`;

    // Catmull-Rom through the measured points, emitted as cubic Béziers.
    const pathFrom = (values) => {
      const pts = FREQS.map((f, i) => [fx(f), fy(values[i])]);
      let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
      for (let i = 0; i < pts.length - 1; i++) {
        const p0 = pts[i - 1] || pts[i];
        const p1 = pts[i];
        const p2 = pts[i + 1];
        const p3 = pts[i + 2] || p2;
        const c1x = p1[0] + (p2[0] - p0[0]) / 6;
        const c1y = p1[1] + (p2[1] - p0[1]) / 6;
        const c2x = p2[0] - (p3[0] - p1[0]) / 6;
        const c2y = p2[1] - (p3[1] - p1[1]) / 6;
        d += `C${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
      }
      return d;
    };

    const curve = $('.fr__curve', section);
    const desc = $('.fr__desc', section);
    const group = $('.segmented', section);
    const options = $$('[role="radio"]', group);
    const out = {
      low: $('[data-fr="low"]', section),
      mid: $('[data-fr="mid"]', section),
      air: $('[data-fr="air"]', section),
    };
    const fmtDb = (v) => {
      const r = Math.round(v * 10) / 10;
      const sign = r > 0 ? '+' : r < 0 ? '−' : '±';
      return `${sign}${Math.abs(r).toFixed(1)} dB`;
    };

    // Tween a flat object (v0…v12) so GSAP interpolates every point together.
    const state = {};
    PROFILES.reference.db.forEach((v, i) => { state[`v${i}`] = v; });
    const values = () => FREQS.map((_, i) => state[`v${i}`]);
    const render = () => {
      const v = values();
      curve.setAttribute('d', pathFrom(v));
      out.low.textContent = fmtDb(v[2]);
      out.mid.textContent = fmtDb(v[8]);
      out.air.textContent = fmtDb(v[11]);
    };

    function select(index, focus = false) {
      const btn = options[index];
      const profile = PROFILES[btn.dataset.profile];
      options.forEach((o, i) => {
        o.setAttribute('aria-checked', String(i === index));
        o.tabIndex = i === index ? 0 : -1;
      });
      group.style.setProperty('--i', index);
      if (focus) btn.focus();
      const target = {};
      profile.db.forEach((v, i) => { target[`v${i}`] = v; });
      gsap.to(state, { ...target, duration: REDUCED ? 0 : 1.2, ease: EASE, overwrite: true, onUpdate: render });
      desc.textContent = profile.desc;
      if (!REDUCED) gsap.fromTo(desc, { autoAlpha: 0, y: 6 }, { autoAlpha: 1, y: 0, duration: 0.8 });
    }

    options.forEach((btn, i) => btn.addEventListener('click', () => select(i)));
    group.addEventListener('keydown', (event) => {
      const current = options.findIndex((o) => o.getAttribute('aria-checked') === 'true');
      const last = options.length - 1;
      let next = null;
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = current === last ? 0 : current + 1;
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = current === 0 ? last : current - 1;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = last;
      if (next !== null) {
        event.preventDefault();
        select(next, true);
      }
    });

    render();
  }

  /* ------------------------------------------------------------------ *
   * FAQ accordion
   * Opening an answer changes the height above the closing pin. A
   * ResizeObserver waits for the section to stop changing size, then
   * re-measures every trigger once, so the pin start stays exact.
   * ------------------------------------------------------------------ */
  function initFAQ() {
    $$('.faq__item').forEach((item) => {
      const button = $('.faq__q', item);
      button.addEventListener('click', () => {
        const open = button.getAttribute('aria-expanded') !== 'true';
        button.setAttribute('aria-expanded', String(open));
        item.classList.toggle('is-open', open);
      });
    });

    const support = $('#support');
    if (!support || !('ResizeObserver' in window)) return;
    let timer = null;
    let lastHeight = 0;
    new ResizeObserver(([entry]) => {
      const height = Math.round(entry.contentRect.height);
      if (height === lastHeight) return;
      lastHeight = height;
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (ScrollTrigger.getAll().length) ScrollTrigger.refresh();
      }, 180);
    }).observe(support);
  }

  /* ------------------------------------------------------------------ *
   * Mobile / tablet menu
   * ------------------------------------------------------------------ */
  function initMenu() {
    const button = $('.nav__menu-btn');
    const menu = $('#mobile-menu');
    if (!button || !menu) return null;
    const items = $$('.menu__links li, .menu__foot', menu);
    let open = false;

    function show() {
      if (open) return;
      open = true;
      menu.hidden = false;
      button.setAttribute('aria-expanded', 'true');
      button.setAttribute('aria-label', 'Close menu');
      nav.classList.add('menu-open');
      if (lenis) lenis.stop();
      else root.classList.add('scroll-locked');
      gsap.fromTo(menu, { clipPath: 'inset(0 0 100% 0)' }, { clipPath: 'inset(0 0 0% 0)', duration: REDUCED ? 0 : 0.8 });
      if (!REDUCED) gsap.fromTo(items, { autoAlpha: 0, y: 16 }, { autoAlpha: 1, y: 0, duration: 0.9, stagger: 0.04, delay: 0.1 });
      const first = $('a', menu);
      if (first) requestAnimationFrame(() => first.focus({ preventScroll: true }));
    }

    function hide({ restoreFocus = true } = {}) {
      if (!open) return;
      open = false;
      button.setAttribute('aria-expanded', 'false');
      button.setAttribute('aria-label', 'Open menu');
      nav.classList.remove('menu-open');
      if (lenis) lenis.start();
      else root.classList.remove('scroll-locked');
      gsap.to(menu, {
        clipPath: 'inset(0 0 100% 0)',
        duration: REDUCED ? 0 : 0.6,
        onComplete: () => { if (!open) menu.hidden = true; },
      });
      if (restoreFocus) button.focus({ preventScroll: true });
    }

    button.addEventListener('click', () => (open ? hide() : show()));
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && open) hide();
    });
    window.matchMedia('(min-width: 1024px)').addEventListener('change', (event) => {
      if (event.matches) hide({ restoreFocus: false });
    });

    return { hide, isOpen: () => open };
  }

  /* Nav links follow the section in view (desktop links and mobile menu). */
  function buildScrollspy() {
    const links = $$('.nav__links a, .menu__links a');
    const ids = [...new Set(links.map((a) => a.getAttribute('href')))];
    ids.forEach((id) => {
      const section = $(id);
      if (!section) return;
      const group = links.filter((a) => a.getAttribute('href') === id);
      ScrollTrigger.create({
        trigger: section,
        start: 'top 50%',
        end: 'bottom 50%',
        onToggle: (self) => {
          group.forEach((a) => {
            a.classList.toggle('is-active', self.isActive);
            if (self.isActive) a.setAttribute('aria-current', 'location');
            else a.removeAttribute('aria-current');
          });
        },
      });
    });
  }

  /* ------------------------------------------------------------------ *
   * Configurator drawer
   * ------------------------------------------------------------------ */
  function initConfigurator() {
    const shell = $('#configurator');
    if (!shell) return;
    const panel = $('.drawer', shell);
    const scrim = $('.drawer__scrim', shell);
    const form = $('#reserve-form', shell);
    const success = $('.drawer__success', shell);
    const preview = $('.drawer__preview', shell);
    const email = $('#reserve-email', shell);
    const emailError = $('#reserve-email-error', shell);
    const caseLine = $('[data-case-line]', shell);
    const totals = $$('[data-total]', shell);
    const reserveLabel = $('[data-reserve-label]', shell);
    const finishNames = $$('[data-finish-name]', shell);
    const background = [nav, $('#mobile-menu'), $('#main'), $('#footer')];

    const BASE = 549;
    const CASE = 49;
    const FINISHES = {
      silver: { name: 'Silver Titanium', body: '#D8D9DD', cushion: '#B4B5BB' },
      graphite: { name: 'Anodized Graphite', body: '#2C2C2E', cushion: '#1A1A1C' },
      sand: { name: 'Nordic Sand', body: '#DFD7CD', cushion: '#C4B9AA' },
    };
    const money = (n) => `$${n.toLocaleString('en-US')}`;
    let isOpen = false;
    let returnFocus = null;

    function current() {
      const finish = FINISHES[form.elements.finish.value] || FINISHES.silver;
      const withCase = form.elements.case.checked;
      return { finish, withCase, total: BASE + (withCase ? CASE : 0) };
    }

    function sync() {
      const { finish, withCase, total } = current();
      preview.style.setProperty('--body', finish.body);
      preview.style.setProperty('--cushion', finish.cushion);
      finishNames.forEach((el) => { el.textContent = finish.name; });
      caseLine.hidden = !withCase;
      totals.forEach((el) => { el.textContent = money(total); });
      reserveLabel.textContent = `Reserve — ${money(total)}`;
    }

    function open(event) {
      if (isOpen) return;
      isOpen = true;
      // Finish chips in the Design section open the drawer with that finish selected.
      const preset = event && event.currentTarget && event.currentTarget.dataset.finish;
      if (preset && !form.hidden) {
        const radio = form.querySelector(`input[name="finish"][value="${preset}"]`);
        if (radio) {
          radio.checked = true;
          sync();
        }
      }
      returnFocus = document.activeElement;
      if (menuApi && menuApi.isOpen()) {
        menuApi.hide({ restoreFocus: false });
        returnFocus = $('.nav__menu-btn');
      }
      shell.hidden = false;
      background.forEach((el) => { if (el) el.inert = true; });
      if (lenis) lenis.stop();
      else root.classList.add('scroll-locked');
      gsap.fromTo(scrim, { autoAlpha: 0 }, { autoAlpha: 1, duration: REDUCED ? 0 : 0.6 });
      gsap.fromTo(panel, { xPercent: 100 }, { xPercent: 0, duration: REDUCED ? 0 : 0.9 });
      const target = success.hidden ? form.querySelector('input[name="finish"]:checked') : success;
      requestAnimationFrame(() => target.focus({ preventScroll: true }));
    }

    function close() {
      if (!isOpen) return;
      isOpen = false;
      gsap.to(scrim, { autoAlpha: 0, duration: REDUCED ? 0 : 0.5 });
      gsap.to(panel, {
        xPercent: 100,
        duration: REDUCED ? 0 : 0.7,
        onComplete: () => { if (!isOpen) shell.hidden = true; },
      });
      background.forEach((el) => { if (el) el.inert = false; });
      if (lenis) lenis.start();
      else root.classList.remove('scroll-locked');
      if (returnFocus && returnFocus.focus) returnFocus.focus({ preventScroll: true });
    }

    function trapTab(event) {
      const focusable = $$('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])', panel)
        .filter((el) => !el.disabled && !el.closest('[hidden]') && (el.type !== 'radio' || el.checked));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    function showError(show) {
      emailError.hidden = !show;
      if (show) email.setAttribute('aria-invalid', 'true');
      else email.removeAttribute('aria-invalid');
    }

    form.addEventListener('change', sync);
    email.addEventListener('input', () => {
      if (email.hasAttribute('aria-invalid') && email.checkValidity()) showError(false);
    });

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (!email.value.trim() || !email.checkValidity()) {
        showError(true);
        email.focus();
        return;
      }
      showError(false);
      const { finish, withCase, total } = current();
      $('[data-s-finish]', success).textContent = finish.name;
      $('[data-s-case]', success).textContent = withCase ? ', with Molded Travel Case' : '';
      $('[data-s-total]', success).textContent = money(total);
      $('[data-s-ref]', success).textContent = `KN1-${Math.floor(10000 + Math.random() * 90000)}`;
      $('[data-s-email]', success).textContent = email.value.trim();
      form.hidden = true;
      success.hidden = false;
      if (!REDUCED) gsap.from(success.children, { autoAlpha: 0, y: 16, duration: 0.9, stagger: 0.06 });
      success.focus({ preventScroll: true });
    });

    $('[data-reset-configurator]', shell).addEventListener('click', () => {
      form.reset();
      showError(false);
      sync();
      success.hidden = true;
      form.hidden = false;
      form.querySelector('input[name="finish"]:checked').focus({ preventScroll: true });
    });

    $$('[data-open-configurator]').forEach((btn) => btn.addEventListener('click', open));
    $$('[data-close-configurator]', shell).forEach((btn) => btn.addEventListener('click', close));
    shell.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      } else if (event.key === 'Tab') {
        trapTab(event);
      }
    });

    sync();
  }

  /* ------------------------------------------------------------------ *
   * Preloader -> reveal
   * ------------------------------------------------------------------ */
  const meterFill = $('.preloader__fill');
  const meterCount = $('[data-count]');
  const meter = { v: 0 };
  const paintMeter = () => {
    const pct = Math.round(meter.v * 100);
    meterFill.style.transform = `scaleX(${meter.v.toFixed(4)})`;
    meterCount.textContent = String(pct).padStart(3, '0');
    preloader.setAttribute('aria-valuenow', String(pct));
  };
  const toMeter = (v, duration) =>
    new Promise((resolve) => {
      gsap.to(meter, { v, duration, ease: EASE, overwrite: true, onUpdate: paintMeter, onComplete: resolve });
    });

  function intro() {
    const tl = gsap.timeline({ defaults: { ease: EASE }, onComplete: () => preloader.remove() });
    if (REDUCED) {
      tl.to(preloader, { autoAlpha: 0, duration: 0.3 });
      return;
    }
    tl.to('.preloader__inner, .preloader__label', { autoAlpha: 0, y: -10, duration: 0.6 })
      .to(preloader, { autoAlpha: 0, duration: 0.9 }, 0.25)
      .from('#hero-canvas', { autoAlpha: 0, scale: 1.035, duration: 2.2, clearProps: 'opacity,visibility,transform' }, 0.25)
      .from(nav, { autoAlpha: 0, y: -12, duration: 1.2, clearProps: 'opacity,visibility,transform' }, 0.6)
      .from('.story--1 .reveal-line > span', { yPercent: 105, duration: 1.4, stagger: 0.1 }, 0.55)
      .from('.story--1 .reveal-fade', { autoAlpha: 0, y: 14, duration: 1.2, stagger: 0.12 }, 0.75)
      .from('.hero__cue', { autoAlpha: 0, duration: 1 }, 1.1);
  }

  function reveal() {
    root.classList.remove('is-loading');
    initLenis();
    initAnchors();
    heroSeq.resize();
    closingSeq.resize();

    // Create triggers top-to-bottom so each pin-spacer is measured before the next.
    buildHero();
    buildBento();
    buildClosing();
    buildScrollspy(); // after both pins, so sections below them measure correctly
    buildNavTheme();
    buildFooter();

    ScrollTrigger.addEventListener('refresh', () => {
      heroSeq.resize();
      closingSeq.resize();
    });
    ScrollTrigger.refresh();
    if (lenis) lenis.resize();
    intro();
  }

  // Independent of frame loading.
  buildDiagrams();
  initANC();
  initSound();
  initFAQ();
  menuApi = initMenu();
  initConfigurator();

  const heroLoaded = loadFrames(HERO_DIR, heroImages, {
    concurrency: 8,
    onProgress: (p) => { toMeter(p * 0.98, 0.5); },
  });
  const fontsReady = document.fonts ? document.fonts.ready.catch(() => {}) : Promise.resolve();
  const minimumDisplay = new Promise((resolve) => setTimeout(resolve, 900));
  const safetyTimeout = new Promise((resolve) => setTimeout(resolve, 20000));

  Promise.all([Promise.race([heroLoaded, safetyTimeout]), fontsReady, minimumDisplay])
    .then(() => toMeter(1, 0.45))
    .then(reveal);
})();
