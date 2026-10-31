import { createGL } from './gl.js';

/* =========================================================================
   PAS HIER DE GEGEVENS AAN
   ========================================================================= */
const CONFIG = {
  naam: 'Mama',
  voorstelling: 'Harry Potter',
  ondertitel: 'en het Vervloekte Kind',
  theater: 'AFAS Circustheater',
  plaats: 'Scheveningen',

  // Datum en aanvangstijd van JULLIE voorstelling, als 'JJJJ-MM-DDTUU:MM'.
  // Voorbeeld: '2026-11-21T19:30'. Laat op null zolang je het nog niet weet.
  datum: null,
  duurMinuten: 180,

  rij: null,        // bijvoorbeeld '7'
  stoelen: [],      // bijvoorbeeld ['12', '13']

  // Het geheime spel. Draai de ring als een kluisslot: negatief = linksom, positief = rechtsom,
  // in hele rondjes. [-3, 2, -1] is 3 keer links, 2 keer rechts en 1 keer links.
  geheim: [-3, 2, -1],
};

// Met ?demo achter de link zie je hoe het eruitziet met ingevulde gegevens.
const DEMO = { datum: '2026-11-21T19:30', rij: '7', stoelen: ['12', '13'] };

/* =========================================================================
   Basis
   ========================================================================= */
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const TAU = Math.PI * 2;
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const rand = (a = 1, b) => (b === undefined ? Math.random() * a : a + Math.random() * (b - a));
const pick = (arr) => arr[(Math.random() * arr.length) | 0];
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const vib = (p) => { try { navigator.vibrate && navigator.vibrate(p); } catch (e) {} };

const store = {
  get(k) { try { return localStorage.getItem('tv-' + k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem('tv-' + k, v); } catch (e) {} },
  del(k) { try { localStorage.removeItem('tv-' + k); } catch (e) {} },
};

const params = new URLSearchParams(location.search);
if (params.has('demo')) Object.assign(CONFIG, DEMO);
if (params.has('reset')) ['start', 'best'].forEach(store.del);

const SHOW = (() => {
  if (!CONFIG.datum) return null;
  const d = new Date(CONFIG.datum);
  return isNaN(d) ? null : d;
})();
const SHOW_END = SHOW ? new Date(SHOW.getTime() + CONFIG.duurMinuten * 60000) : null;

const fmt = {
  long: (d) => d.toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
  day: (d) => d.toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', year: 'numeric' }),
  short: (d) => d.toLocaleDateString('nl-NL', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).replace(/\./g, '').toUpperCase(),
  time: (d) => d.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' }),
};
const seatText = () => (CONFIG.stoelen.length ? CONFIG.stoelen.join(' & ') : null);

/* De gravure rond de ring: hier staat het kaartje in */
function engravingText() {
  const parts = [CONFIG.theater, CONFIG.plaats];
  if (SHOW) parts.push(fmt.short(SHOW), fmt.time(SHOW));
  if (CONFIG.rij) parts.push('RIJ ' + CONFIG.rij);
  if (seatText()) parts.push((CONFIG.stoelen.length > 1 ? 'STOELEN ' : 'STOEL ') + seatText());
  if (!SHOW) parts.push(CONFIG.voorstelling + ' ' + CONFIG.ondertitel);
  return parts.join('  ·  ').toUpperCase() + '  ·  ';
}
const INTRO_ENGRAVING = 'DRAAI DRIE KEER  ·  DE TIJD WACHT OP NIEMAND  ·  ';

/* Teksten invullen */
$$('[data-bind]').forEach((el) => { el.textContent = CONFIG[el.dataset.bind] ?? ''; });

/* =========================================================================
   Geluid: alles live gesynthetiseerd, met galm
   ========================================================================= */
const Sound = {
  ctx: null, muted: store.get('muted') === '1', mood: 'off', boxTimer: null, boxIdx: 3,
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const c = (this.ctx = new AC());
    this.master = c.createGain();
    this.master.gain.value = this.muted ? 0 : 0.9;
    this.master.connect(c.destination);

    const len = c.sampleRate * 3.2, ir = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.8);
    }
    this.verb = c.createConvolver(); this.verb.buffer = ir;
    const wet = c.createGain(); wet.gain.value = 0.5;
    this.verb.connect(wet).connect(this.master);

    this.noise = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const nd = this.noise.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

    // Drone: E en B, laag en warm, met een langzame ademhaling
    this.drone = c.createGain(); this.drone.gain.value = 0;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 520;
    [[82.41, 'sine', 1], [123.47, 'sine', 0.7], [164.81, 'triangle', 0.25], [165.3, 'triangle', 0.25]].forEach(([f, type, v]) => {
      const o = c.createOscillator(), g = c.createGain();
      o.type = type; o.frequency.value = f; g.gain.value = v;
      o.connect(g).connect(lp); o.start();
    });
    // Spanning voor het spel: een kille kleine secunde erbij
    this.tense = c.createGain(); this.tense.gain.value = 0;
    [87.31, 61.74].forEach((f) => {
      const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
      const f2 = c.createBiquadFilter(); f2.type = 'lowpass'; f2.frequency.value = 260;
      o.connect(f2).connect(this.tense); o.start();
    });
    this.tense.connect(lp);
    lp.connect(this.drone);
    const lfo = c.createOscillator(), lfoG = c.createGain();
    lfo.frequency.value = 0.07; lfoG.gain.value = 0.018;
    lfo.connect(lfoG).connect(this.drone.gain); lfo.start();
    this.out(this.drone, 0.8, 0.7);

    this.setMood(this.mood, true);
  },
  out(node, dry = 1, wet = 0.4) {
    const c = this.ctx;
    const d = c.createGain(); d.gain.value = dry; node.connect(d).connect(this.master);
    const w = c.createGain(); w.gain.value = wet; node.connect(w).connect(this.verb);
  },
  env(g, t, peak, attack, decay) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  },
  bell(f, delay = 0, dur = 2.6, vol = 0.1) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime + delay, g = c.createGain();
    [[1, 1], [2.76, 0.42], [5.4, 0.2], [8.93, 0.08]].forEach(([m, a]) => {
      const o = c.createOscillator(), og = c.createGain();
      o.frequency.value = f * m; og.gain.value = a;
      o.connect(og).connect(g); o.start(t); o.stop(t + dur + 0.1);
    });
    this.env(g, t, vol, 0.004, dur);
    this.out(g, 0.8, 0.8);
  },
  box(f, delay = 0, vol = 0.05) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime + delay, g = c.createGain();
    [[1, 1], [3.01, 0.25], [6.2, 0.06]].forEach(([m, a]) => {
      const o = c.createOscillator(), og = c.createGain();
      o.frequency.value = f * m; og.gain.value = a;
      o.connect(og).connect(g); o.start(t); o.stop(t + 1.6);
    });
    this.env(g, t, vol, 0.003, 1.4);
    this.out(g, 0.6, 1);
  },
  noiseNode() { const s = this.ctx.createBufferSource(); s.buffer = this.noise; s.loop = true; return s; },
  tick(vol = 0.06) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const n = this.noiseNode(), hp = c.createBiquadFilter(), g = c.createGain();
    hp.type = 'bandpass'; hp.frequency.value = 3800 + Math.random() * 800; hp.Q.value = 3;
    n.connect(hp).connect(g); this.env(g, t, vol, 0.001, 0.035);
    n.start(t); n.stop(t + 0.06);
    const o = c.createOscillator(), og = c.createGain();
    o.frequency.value = 2400; o.connect(og); this.env(og, t, vol * 0.4, 0.001, 0.03);
    o.start(t); o.stop(t + 0.05);
    this.out(g, 1, 0.15); this.out(og, 1, 0.1);
  },
  whoosh(dur = 0.8, f0 = 300, f1 = 2400, vol = 0.18, delay = 0) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime + delay;
    const n = this.noiseNode(), bp = c.createBiquadFilter(), g = c.createGain();
    bp.type = 'bandpass'; bp.Q.value = 1.4;
    bp.frequency.setValueAtTime(f0, t); bp.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + dur * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    n.connect(bp).connect(g); n.start(t); n.stop(t + dur + 0.1);
    this.out(g, 0.9, 0.5);
  },
  rumble(dur = 3, vol = 0.3, delay = 0) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime + delay;
    const n = this.noiseNode(), lp = c.createBiquadFilter(), g = c.createGain();
    lp.type = 'lowpass'; lp.frequency.value = 140;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + dur * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    n.connect(lp).connect(g); n.start(t); n.stop(t + dur + 0.1);
    this.out(g, 1, 0.3);
  },
  thud(vol = 0.35) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator(), g = c.createGain();
    o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(32, t + 0.5);
    o.connect(g); this.env(g, t, vol, 0.005, 0.6); o.start(t); o.stop(t + 0.7);
    this.out(g, 1, 0.4);
    this.whoosh(0.7, 2000, 200, 0.12);
  },
  /* Een Dementor ademt: een lange, ratelende inademing */
  breath(vol = 0.14) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const n = this.noiseNode(), bp = c.createBiquadFilter(), g = c.createGain(), am = c.createGain();
    bp.type = 'bandpass'; bp.Q.value = 0.9;
    bp.frequency.setValueAtTime(380, t); bp.frequency.linearRampToValueAtTime(900, t + 1.4); bp.frequency.linearRampToValueAtTime(300, t + 2.4);
    const rattle = c.createOscillator(), rg = c.createGain();
    rattle.frequency.value = 26; rg.gain.value = 0.5; am.gain.value = 0.5;
    rattle.connect(rg).connect(am.gain);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 1.2);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.5);
    n.connect(bp).connect(am).connect(g);
    n.start(t); n.stop(t + 2.6); rattle.start(t); rattle.stop(t + 2.6);
    this.out(g, 0.9, 0.6);
  },
  /* Twee spreuken die tegen elkaar in drukken: een zoemende, knetterende stroom */
  clash() {
    if (!this.ctx) return { heat() {}, stop() {} };
    const c = this.ctx, t = c.currentTime, out = c.createGain();
    out.gain.setValueAtTime(0.0001, t); out.gain.exponentialRampToValueAtTime(0.16, t + 0.3);
    const n = this.noiseNode(), bp = c.createBiquadFilter(), crackle = c.createGain(), mod = c.createOscillator(), modG = c.createGain();
    bp.type = 'bandpass'; bp.frequency.value = 2200; bp.Q.value = 0.8;
    mod.type = 'square'; mod.frequency.value = 23; modG.gain.value = 0.5; crackle.gain.value = 0.5;
    mod.connect(modG).connect(crackle.gain);
    n.connect(bp).connect(crackle).connect(out);
    const hum = c.createGain(); hum.gain.value = 0.35;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
    const oscs = [110, 110.7, 165.2].map((f) => { const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.connect(lp); o.start(t); return o; });
    lp.connect(hum).connect(out);
    n.start(t); mod.start(t);
    this.out(out, 0.9, 0.5);
    return {
      heat: (h) => {
        const now = c.currentTime;
        oscs.forEach((o, i) => o.frequency.setTargetAtTime([110, 110.7, 165.2][i] * (1 + h * 0.6), now, 0.1));
        bp.frequency.setTargetAtTime(2200 + h * 2600, now, 0.1);
        mod.frequency.setTargetAtTime(23 + h * 30, now, 0.1);
      },
      stop: (fade = 0.08) => {
        const now = c.currentTime;
        out.gain.cancelScheduledValues(now); out.gain.setTargetAtTime(0.0001, now, fade);
        [n, mod, ...oscs].forEach((o) => o.stop(now + fade * 8));
      },
    };
  },
  zap(vol = 0.12) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime, o = c.createOscillator(), g = c.createGain();
    o.type = 'sawtooth'; o.frequency.setValueAtTime(1600, t); o.frequency.exponentialRampToValueAtTime(220, t + 0.18);
    o.connect(g); this.env(g, t, vol, 0.003, 0.2); o.start(t); o.stop(t + 0.25);
    this.out(g, 0.8, 0.6);
  },
  boom() {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const n = this.noiseNode(), g = c.createGain(), lp = c.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.setValueAtTime(9000, t); lp.frequency.exponentialRampToValueAtTime(180, t + 1.6);
    this.env(g, t, 0.6, 0.004, 2.2);
    n.connect(lp).connect(g); n.start(t); n.stop(t + 2.4);
    this.out(g, 1, 0.9);
    this.thud(0.6); this.rumble(3.4, 0.45); this.whoosh(2.6, 2400, 90, 0.2, 0.15);
  },
  chord(notes, spread = 0.07, vol = 0.07) { notes.forEach((f, i) => this.bell(f, i * spread, 2.4, vol)); },
  setMood(m, force) {
    this.mood = m;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const drone = { off: 0.0001, calm: 0.05, magic: 0.075, tense: 0.06 }[m] ?? 0.0001;
    this.drone.gain.cancelScheduledValues(t);
    this.drone.gain.setTargetAtTime(drone, t, force ? 0.1 : 1.2);
    this.tense.gain.setTargetAtTime(m === 'tense' ? 0.22 : 0, t, 1.5);
    clearInterval(this.boxTimer);
    if (m === 'calm' || m === 'magic') {
      // Een speeldoos in e-klein die zachtjes voor zich uit improviseert
      const scale = [493.88, 587.33, 659.26, 739.99, 783.99, 987.77, 1174.66, 1318.51, 1567.98];
      this.boxTimer = setInterval(() => {
        if (Math.random() < (m === 'magic' ? 0.6 : 0.42)) {
          this.boxIdx = clamp(this.boxIdx + pick([-2, -1, -1, 1, 1, 2, 0]), 0, scale.length - 1) | 0;
          this.box(scale[this.boxIdx], 0, 0.045);
          if (Math.random() < 0.18) this.box(scale[Math.max(0, this.boxIdx - 2)], 0.2, 0.03);
        }
      }, 430);
    }
  },
  setMuted(m) {
    this.muted = m; store.set('muted', m ? '1' : '0');
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.08);
  },
};
document.addEventListener('visibilitychange', () => {
  if (!Sound.ctx) return;
  if (document.hidden) Sound.ctx.suspend(); else Sound.ctx.resume();
});
// Een telefoon hervat een app vaak waar hij was. Was hij langer dan een minuut weg, dan begint hij weer in het donker.
let hiddenAt = 0;
const restart = () => { if (sceneName && sceneName !== 'dark' && !params.get('scene')) go('dark'); };
document.addEventListener('visibilitychange', () => {
  if (document.hidden) hiddenAt = Date.now();
  else if (hiddenAt && Date.now() - hiddenAt > 60000) restart();
});
addEventListener('pageshow', (e) => { if (e.persisted) restart(); });
addEventListener('pointerdown', () => Sound.init(), { capture: true });
// Volledig scherm zodra het mag: browsers staan dat pas toe bij de eerste aanraking
addEventListener('pointerdown', () => goFullscreen(), { capture: true });

const soundBtn = $('#sound');
const setSoundIcon = () => { soundBtn.querySelector('.wave').style.opacity = Sound.muted ? 0.12 : 1; };
setSoundIcon();
soundBtn.addEventListener('click', () => { Sound.setMuted(!Sound.muted); setSoundIcon(); if (!Sound.muted) Sound.bell(1318.5, 0, 1.5, 0.05); });

/* =========================================================================
   Canvas-lagen: achtergrond, 3D, voorgrond, toverstof
   ========================================================================= */
const bgEl = $('#bg'), bg = bgEl.getContext('2d');
const stage = $('#stage'), ov = stage.getContext('2d');
const fxc = $('#fx'), fctx = fxc.getContext('2d');
let GLR = null;
try { GLR = createGL($('#gl')); } catch (e) { GLR = null; }
if (!GLR) $('#gl').hidden = true;
let W = 0, H = 0, DPR = 1;

function makeLayer() {
  const c = document.createElement('canvas');
  c.width = Math.round(W * DPR); c.height = Math.round(H * DPR);
  const g = c.getContext('2d'); g.setTransform(DPR, 0, 0, DPR, 0, 0);
  return [c, g];
}

const tilt = { x: 0, y: 0, tx: 0, ty: 0 };
addEventListener('deviceorientation', (e) => {
  if (e.gamma == null) return;
  tilt.tx = clamp(e.gamma / 35, -1, 1);
  tilt.ty = clamp((e.beta - 50) / 35, -1, 1);
});

const Stars = {
  list: [],
  build() {
    const n = Math.round((W * H) / 2600);
    this.list = Array.from({ length: n }, () => ({ x: rand(W), y: rand(H), r: rand(0.3, 1.4), p: rand(TAU), s: rand(0.4, 1.8) }));
  },
  draw(g, t, alpha = 1) {
    for (const s of this.list) {
      const a = alpha * (0.25 + 0.6 * Math.abs(Math.sin(s.p + t * s.s * (reduced ? 0 : 1))));
      g.fillStyle = `rgba(225,225,255,${a})`;
      g.fillRect(s.x + tilt.x * s.r * 4, s.y + tilt.y * s.r * 4, s.r * 1.3, s.r * 1.3);
    }
  },
};

/* Stofjes die in het licht dwarrelen */
const Motes = {
  list: [],
  draw(g, dt, cx, cy, spread, n = 40) {
    while (this.list.length < n) this.list.push({ x: cx + rand(-spread, spread), y: cy + rand(-spread, spread), vx: rand(-6, 6), vy: rand(-14, -4), life: rand(4, 9), age: 0, r: rand(0.6, 1.8) });
    g.globalCompositeOperation = 'lighter';
    for (let i = this.list.length - 1; i >= 0; i--) {
      const m = this.list[i];
      m.age += dt; m.x += (m.vx + Math.sin(m.age * 1.3) * 5) * dt; m.y += m.vy * dt;
      const a = Math.sin((m.age / m.life) * Math.PI) * 0.8;
      if (m.age > m.life) { this.list.splice(i, 1); continue; }
      g.fillStyle = `rgba(255,214,140,${a})`;
      g.beginPath(); g.arc(m.x, m.y, m.r, 0, TAU); g.fill();
    }
    g.globalCompositeOperation = 'source-over';
  },
};

/* Toverstof, flitsen en schokken bovenop alles */
const FX = {
  parts: [], flash: 0, flashRGB: '255,244,220', shake: 0,
  colors: ['255,241,196', '255,207,122', '255,255,255', '216,176,98'],
  emit(x, y, n = 2, spread = 1, colors = this.colors) {
    if (reduced) n = Math.min(n, 4);
    for (let i = 0; i < n; i++) {
      const a = rand(TAU), v = rand(0.3, 2.3) * spread;
      this.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 0.3, life: 1, decay: rand(0.012, 0.03), r: rand(1.2, 3.4), c: pick(colors), star: Math.random() < 0.35 });
    }
  },
  burst(x, y, n = 60, colors) { this.emit(x, y, n, 3.3, colors); },
  draw(g) {
    g.clearRect(0, 0, W, H);
    g.globalCompositeOperation = 'lighter';
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.x += p.vx; p.y += p.vy; p.vy += 0.035; p.vx *= 0.98; p.life -= p.decay;
      if (p.life <= 0) { this.parts.splice(i, 1); continue; }
      g.fillStyle = `rgba(${p.c},${p.life})`;
      if (p.star) { starPath(g, p.x, p.y, p.r * 2.5 * p.life + 1); g.fill(); }
      else { g.beginPath(); g.arc(p.x, p.y, p.r * p.life, 0, TAU); g.fill(); }
    }
    g.globalCompositeOperation = 'source-over';
    if (this.flash > 0.003) {
      g.fillStyle = `rgba(${this.flashRGB},${this.flash})`; g.fillRect(0, 0, W, H);
      this.flash *= 0.92;
    }
  },
};

function starPath(g, x, y, r) {
  g.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4, rr = i % 2 ? r * 0.26 : r;
    g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  g.closePath();
}

function warmGlow(g, x, y, R, strength = 1) {
  if (strength <= 0) return;
  const gl = g.createRadialGradient(x, y, R * 0.1, x, y, R * 2.1);
  gl.addColorStop(0, `rgba(255,196,110,${0.3 * strength})`); gl.addColorStop(0.5, `rgba(255,170,80,${0.08 * strength})`); gl.addColorStop(1, 'rgba(255,170,80,0)');
  g.fillStyle = gl; g.beginPath(); g.arc(x, y, R * 2.1, 0, TAU); g.fill();
}

/* =========================================================================
   De Tijdverdrijver. In 3D via gl.js; zonder WebGL een 2D-tekening.
   ========================================================================= */
function showTT(p, t) {
  const full = { tiltX: tilt.x, tiltY: tilt.y, ...p.st, ...p };
  if (GLR) GLR.showTT(full);
  else drawTimeTurner2D(ov, p.x, p.y, p.R, p.st, t, { chain: p.chainTop != null, chainTop: p.chainTop, dim: p.env ?? 1 });
}

function strokeGold(g, path, w, dim = 1) {
  g.lineCap = 'round'; g.lineJoin = 'round';
  g.strokeStyle = `rgba(60,40,10,${0.6 * dim})`; g.lineWidth = w + 1.2; g.stroke(path);
  g.strokeStyle = dim < 1 ? '#8a6524' : '#c7973c'; g.lineWidth = w; g.stroke(path);
  g.save(); g.translate(-w * 0.14, -w * 0.14);
  g.strokeStyle = `rgba(255,240,196,${0.8 * dim})`; g.lineWidth = Math.max(0.8, w * 0.3); g.stroke(path);
  g.restore();
}
function ring3D(R, axis, ang, front) {
  const p = new Path2D(), N = 80, ca = Math.cos(ang), sa = Math.sin(ang);
  let pen = false;
  for (let i = 0; i <= N; i++) {
    const th = (i / N) * TAU, c = Math.cos(th), s = Math.sin(th);
    let x, y, z;
    if (axis === 'v') { x = R * c * ca; y = R * s; z = R * c * sa; }
    else { x = R * c; y = R * s * ca; z = R * s * sa; }
    if (front ? z >= -0.01 : z <= 0.01) { pen ? p.lineTo(x, y) : p.moveTo(x, y); pen = true; }
    else pen = false;
  }
  return p;
}
function drawTimeTurner2D(g, cx, cy, R, st, t, o = {}) {
  g.save(); g.translate(cx, cy); g.globalAlpha = clamp(o.dim ?? 1, 0.15, 1);
  if (o.chain) {
    for (let y = -R - 4, i = 0; y > (o.chainTop ?? 0) - cy; y -= 8, i++) {
      g.strokeStyle = '#c7973c'; g.lineWidth = 1.6; g.beginPath();
      if (i % 2) g.ellipse(0, y, 2.6, 5.6, 0, 0, TAU); else { g.moveTo(0, y - 5); g.lineTo(0, y + 5); }
      g.stroke();
    }
  }
  const r0 = R * 0.8, rA = R * 0.71, rB = R * 0.59;
  strokeGold(g, ring3D(rA, 'v', st.a, false), R * 0.055, 0.5);
  strokeGold(g, ring3D(rB, 'h', st.b, false), R * 0.045, 0.5);
  g.fillStyle = 'rgba(200,220,255,.12)'; g.fillRect(-R * 0.16, -R * 0.38, R * 0.32, R * 0.76);
  strokeGold(g, ring3D(rB, 'h', st.b, true), R * 0.045);
  strokeGold(g, ring3D(rA, 'v', st.a, true), R * 0.055);
  g.beginPath(); g.arc(0, 0, R, 0, TAU); g.arc(0, 0, r0, 0, TAU, true);
  const fill = g.createLinearGradient(-R, -R, R, R);
  fill.addColorStop(0, '#f6dc94'); fill.addColorStop(0.5, '#a17428'); fill.addColorStop(1, '#ecc872');
  g.fillStyle = fill; g.fill('evenodd');
  g.restore();
}

/* =========================================================================
   Scènes
   ========================================================================= */
let scene = null, sceneName = '';
function go(name, arg) {
  if (scene && scene.exit) scene.exit();
  sceneName = name; scene = Scenes[name];
  document.body.dataset.scene = name;
  if (scene.enter) scene.enter(arg);
}
const Scenes = {};
const pt = (e) => ({ x: e.clientX, y: e.clientY });

/* ---------- 1. Duisternis: zoek met je toverstok ---------- */
Scenes.dark = {
  enter() {
    this.light = { x: W / 2, y: H / 2, tx: W / 2, ty: H / 2, r: 0, on: false };
    this.trail = []; this.time = 0; this.touchedAt = null; this.found = false; this.flood = 0; this.hintStep = 0;
    // Elke keer een andere schuilplek, altijd ergens in een hoek
    this.spot = { right: Math.random() < 0.5, bottom: Math.random() < 0.5, u: Math.random(), v: Math.random() };
    this.build();
    $('#dark-hint').textContent = 'Het is hier aardedonker.';
    $('#dark-sub').textContent = 'Raak het scherm aan.';
    Sound.setMood('off');
  },
  resize() { this.build(); },
  writeInk(g, glow) {
    const top = H * 0.2, s = Math.min(W, 520);
    g.save(); g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    g.shadowColor = glow; g.shadowBlur = 22; g.fillStyle = glow;
    g.font = `${s * 0.12}px "Pinyon Script", cursive`; g.fillText('Gefeliciteerd,', W / 2, top + s * 0.1);
    g.font = `${s * 0.16}px "Pinyon Script", cursive`; g.fillText('lieve ' + CONFIG.naam, W / 2, top + s * 0.27);
    g.shadowBlur = 12;
    g.font = `italic ${s * 0.052}px "Cormorant Garamond", Georgia, serif`;
    g.fillText('Ergens in dit donker ligt je cadeau verstopt.', W / 2, top + s * 0.39);
    g.restore();
  },
  build() {
    const R = Math.min(W, H) * 0.1;
    const S = this.spot;
    const x = lerp(R * 1.5, Math.max(R * 1.5, W * 0.3), S.u);
    // Boven: tussen de knoppen en de inkttekst. Onder: boven de hinttekst.
    const y = S.bottom
      ? lerp(H * 0.63, H * 0.76 - R * 0.3, S.v)
      : lerp(Math.max(R * 1.4, 84), Math.max(R * 1.4, 84, H * 0.2 - R * 0.6), S.v);
    this.tt = { x: S.right ? W - x : x, y, R };
    if (GLR) {
      const [c, g] = makeLayer();
      this.writeInk(g, 'rgba(255,255,255,1)');
      GLR.setInk(c);
      return;
    }
    // Zonder WebGL: een geschilderde muur met een masker van licht
    const [c, g] = makeLayer(); this.wall = c;
    [this.mask, this.mctx] = makeLayer();
    [this.comp, this.cctx] = makeLayer();
    this.cctx.setTransform(1, 0, 0, 1, 0, 0);
    this.mctx.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#16120f'; g.fillRect(0, 0, W, H);
    const bh = Math.max(32, H / 19), bw = bh * 2.35;
    let row = 0;
    for (let y = -bh * 0.3; y < H; y += bh, row++) {
      for (let x = -((row % 2) * bw) / 2 - rand(10); x < W; x += bw) {
        const s = rand(52, 88);
        g.fillStyle = `rgb(${s + 22},${s + 12},${s})`;
        g.fillRect(x + 2, y + 2, bw - 4, bh - 4);
      }
    }
    this.writeInk(g, '#ffd98a');
    drawTimeTurner2D(g, this.tt.x, this.tt.y, R, { ring: 0.4, a: 0.9, b: 0.5, sand: 0.35 }, 0, {});
  },
  down(p) {
    if (this.found) return;
    if (!this.touchedAt) {
      this.touchedAt = this.time;
      this.light.x = p.x; this.light.y = p.y;
      Sound.whoosh(1.2, 200, 1800, 0.12);
      Sound.setMood('calm');
      $('#dark-hint').textContent = 'Lumos.';
      $('#dark-sub').textContent = 'Beweeg je toverstok door het donker.';
    }
    this.light.on = true; this.light.tx = p.x; this.light.ty = p.y;
    if (dist(p, this.tt) < this.tt.R * 1.5) this.find();
  },
  move(p, e) {
    if (this.found) return;
    if (this.light.on || e.pointerType === 'mouse') {
      this.light.tx = p.x; this.light.ty = p.y;
      if (e.pointerType === 'mouse' && this.touchedAt !== null) this.light.on = true;
    }
  },
  up() { this.light.on = false; },
  find() {
    this.found = true; this.foundAt = this.time;
    FX.burst(this.tt.x, this.tt.y, 110);
    Sound.chord([659.26, 987.77, 1318.51, 1975.5], 0.09, 0.08); vib([30, 60, 90]);
    $('#dark-hint').textContent = ''; $('#dark-sub').textContent = '';
    setTimeout(() => go('turner', { ...this.tt }), 1600);
  },
  update(dt) {
    this.time += dt;
    const L = this.light;
    L.x = lerp(L.x, L.tx, 0.3); L.y = lerp(L.y, L.ty, 0.3);
    const target = L.on ? Math.min(W, H) * 0.36 : 0;
    L.r = lerp(L.r, target, L.on ? 0.15 : 0.05);
    if (L.on && this.time % 0.05 < dt) this.trail.push({ x: L.x, y: L.y, r: L.r * 0.8, life: 1 });
    for (let i = this.trail.length - 1; i >= 0; i--) { this.trail[i].life -= dt * 0.55; if (this.trail[i].life <= 0) this.trail.splice(i, 1); }
    if (this.found) this.flood = clamp((this.time - this.foundAt) / 1.1);
    if (this.touchedAt !== null && !this.found) {
      const since = this.time - this.touchedAt;
      if (since > 7 && this.hintStep < 1) { this.hintStep = 1; $('#dark-hint').textContent = 'Blijf zoeken…'; $('#dark-sub').textContent = 'Tik erop als je het gevonden hebt.'; }
    }
  },
  drawBg(g, t) {
    const L = this.light, flicker = 1 + Math.sin(t * 13) * 0.025 + Math.sin(t * 7.3) * 0.03;
    if (GLR) {
      const lights = [{ x: L.x, y: L.y, r: L.r * flicker, s: 1 }];
      const n = this.trail.length;
      for (let k = 0; k < 7 && n; k++) { const tr = this.trail[Math.floor((k / 7) * n)]; lights.push({ x: tr.x, y: tr.y, r: tr.r, s: tr.life * 0.3 }); }
      GLR.showWall(lights, this.flood);
      const prox = L.r > 4 ? clamp(1 - dist(L, this.tt) / (L.r * 1.05)) : 0;
      const env = Math.max(Math.pow(prox, 1.3), this.flood);
      showTT({ x: this.tt.x, y: this.tt.y, R: this.tt.R, st: { ring: 0.4 + t * 0.02, a: 0.9, b: 0.5, sand: 0.35, flowing: false }, text: INTRO_ENGRAVING, env, key: env * 0.8, wand: { x: L.x, y: L.y, s: prox } }, t);
      return;
    }
    g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
    const m = this.mctx, s = DPR;
    m.clearRect(0, 0, this.mask.width, this.mask.height);
    m.globalCompositeOperation = 'lighter';
    const blob = (x, y, r, a) => {
      if (r < 2 || a <= 0) return;
      const gr = m.createRadialGradient(x * s, y * s, 0, x * s, y * s, r * s);
      gr.addColorStop(0, `rgba(0,0,0,${a})`); gr.addColorStop(0.45, `rgba(0,0,0,${a * 0.8})`); gr.addColorStop(1, 'rgba(0,0,0,0)');
      m.fillStyle = gr; m.fillRect((x - r) * s, (y - r) * s, r * 2 * s, r * 2 * s);
    };
    for (const tr of this.trail) blob(tr.x, tr.y, tr.r, tr.life * 0.35);
    blob(L.x, L.y, L.r * flicker, 1);
    if (this.flood > 0) { m.fillStyle = `rgba(0,0,0,${this.flood})`; m.fillRect(0, 0, this.mask.width, this.mask.height); }
    m.globalCompositeOperation = 'source-over';
    const c = this.cctx;
    c.clearRect(0, 0, this.comp.width, this.comp.height);
    c.drawImage(this.wall, 0, 0);
    c.globalCompositeOperation = 'destination-in'; c.drawImage(this.mask, 0, 0);
    c.globalCompositeOperation = 'source-over';
    g.drawImage(this.comp, 0, 0, W, H);
  },
  draw(g, t) {
    const L = this.light;
    if (L.r > 4) {
      g.globalCompositeOperation = 'lighter';
      const wg = g.createRadialGradient(L.x, L.y, 0, L.x, L.y, L.r * 0.8);
      wg.addColorStop(0, 'rgba(255,190,110,.10)'); wg.addColorStop(1, 'rgba(255,190,110,0)');
      g.fillStyle = wg; g.fillRect(L.x - L.r, L.y - L.r, L.r * 2, L.r * 2);
      if (L.on) {
        const core = g.createRadialGradient(L.x, L.y, 0, L.x, L.y, 22);
        core.addColorStop(0, 'rgba(255,255,255,.95)'); core.addColorStop(0.25, 'rgba(255,240,205,.55)'); core.addColorStop(1, 'rgba(255,240,205,0)');
        g.fillStyle = core; g.fillRect(L.x - 22, L.y - 22, 44, 44);
      }
      g.globalCompositeOperation = 'source-over';
    }
  },
};

/* ---------- 2. De Tijdverdrijver: draai drie keer ---------- */
Scenes.turner = {
  enter(from) {
    this.from = from || null; this.t = 0;
    this.st = { ring: 0, a: 0.7, b: 1.4, sand: 0.08, flip: 0, flowing: true };
    this.progress = 0; this.turns = 0; this.dir = 0; this.vel = 0; this.drag = null; this.tickAcc = 0;
    this.flipT = -1; this.done = false; this.lastMove = 0; this.auto = false;
    $$('#dots i').forEach((d) => d.classList.remove('on'));
    $('#turn-for-me').hidden = true;
    this.layout();
    Sound.setMood('magic');
  },
  resize() { this.layout(); },
  layout() {
    this.cx = W / 2; this.cy = H * 0.53; this.R = Math.min(W * 0.4, H * 0.26);
    this.chainTop = $('#ui-turner .lead').getBoundingClientRect().bottom + 8;
  },
  angleAt(p) { return Math.atan2(p.y - this.cy, p.x - this.cx); },
  down(p) {
    if (this.done) return;
    if (dist(p, { x: this.cx, y: this.cy }) < this.R * 1.7) { this.drag = { last: this.angleAt(p), lt: performance.now() }; this.vel = 0; }
  },
  move(p) {
    if (!this.drag || this.done) return;
    const a = this.angleAt(p), da = wrapAngle(a - this.drag.last), now = performance.now();
    this.drag.last = a;
    const dtm = Math.max(1, now - this.drag.lt) / 1000; this.drag.lt = now;
    this.vel = lerp(this.vel, da / dtm, 0.5);
    this.spin(da);
    this.turned(da);
  },
  up() { this.drag = null; },
  spin(da) {
    if (!this.dir && Math.abs(da) > 0.02) this.dir = Math.sign(da);
    this.st.ring += da; this.st.a += da * 1.7; this.st.b -= da * 1.15;
    this.progress = Math.max(0, this.progress + da * (this.dir || 1));
    this.lastMove = this.t;
    this.tickAcc += Math.abs(da);
    while (this.tickAcc > TAU / 24) { this.tickAcc -= TAU / 24; Sound.tick(0.05); vib(5); }
    const turns = Math.min(3, Math.floor(this.progress / TAU));
    if (turns > this.turns) { this.turns = turns; this.onTurn(); }
  },
  onTurn() {
    $$('#dots i')[this.turns - 1].classList.add('on');
    Sound.bell([659.26, 783.99, 987.77][this.turns - 1], 0, 2.5, 0.1);
    Sound.whoosh(0.9, 400, 2400, 0.1);
    vib([25, 40, 25]);
    const a = this.st.ring;
    FX.burst(this.cx + Math.cos(a) * this.R, this.cy + Math.sin(a) * this.R, 40);
    this.flipT = 0;
    if (this.turns >= 3) {
      this.done = true;
      Sound.chord([329.63, 493.88, 659.26, 987.77], 0.12, 0.08);
      setTimeout(() => go('travel', { cx: this.cx, cy: this.cy, R: this.R, st: this.st }), 1100);
    }
  },
  update(dt) {
    this.t += dt;
    if (this.auto && !this.done) this.vel = 7 * (this.dir || 1);
    if (this.done) this.vel = lerp(this.vel, 14 * (this.dir || 1), 0.04);
    if (!this.drag && Math.abs(this.vel) > 0.05) { this.spin(this.vel * dt); this.vel *= Math.pow(0.12, dt); }
    if (!this.drag && !this.done && Math.abs(this.vel) <= 0.05) { this.st.a += dt * 0.25; this.st.b -= dt * 0.18; }
    if (this.flipT >= 0) {
      this.flipT += dt / 0.8;
      this.st.flip = ease(clamp(this.flipT)) * Math.PI; this.st.flowing = false;
      if (this.flipT >= 1) { this.flipT = -1; this.st.flip = 0; this.st.sand = 1 - this.st.sand; this.st.flowing = true; }
    } else if (this.st.sand < 0.97) this.st.sand += dt * 0.015;
    if (this.t > 9 && this.turns === 0) $('#turn-for-me').hidden = false;
  },
  pos() {
    if (!this.from) return { x: this.cx, y: this.cy, R: this.R };
    const k = ease(clamp(this.t / 1.6));
    return { x: lerp(this.from.x, this.cx, k), y: lerp(this.from.y, this.cy, k), R: lerp(this.from.R, this.R, k) };
  },
  drawBg(g, t) {
    const { x, y, R } = this.pos();
    const bgr = g.createRadialGradient(x, y, 0, x, y, Math.max(W, H) * 0.8);
    bgr.addColorStop(0, '#1a1426'); bgr.addColorStop(1, '#05060c');
    g.fillStyle = bgr; g.fillRect(0, 0, W, H);
    Stars.draw(g, t, 0.6);
    warmGlow(g, x, y, R, 1 + this.turns * 0.25);
    Motes.draw(g, 1 / 60, x, y, R * 1.4, 36);
    showTT({ x, y, R, st: this.st, text: INTRO_ENGRAVING, chainTop: this.chainTop }, t);
  },
  draw(g, t) {
    const { x: cx, y: cy, R } = this.pos();
    // Een zachte pijl die laat zien dat je moet draaien
    if (this.turns === 0 && !this.drag && this.t > 1.8 && this.t - this.lastMove > 1.2) {
      const a0 = -Math.PI / 2 + ((t * 1.4) % TAU), rr = R * 1.2, alpha = 0.35 + Math.sin(t * 3) * 0.15;
      g.strokeStyle = `rgba(255,223,160,${alpha})`; g.lineWidth = 2; g.lineCap = 'round';
      g.setLineDash([2, 9]); g.beginPath(); g.arc(cx, cy, rr, a0, a0 + 1.6); g.stroke(); g.setLineDash([]);
      const ea = a0 + 1.6, ex = cx + Math.cos(ea) * rr, ey = cy + Math.sin(ea) * rr;
      g.fillStyle = `rgba(255,223,160,${alpha + 0.2})`;
      g.save(); g.translate(ex, ey); g.rotate(ea + Math.PI / 2);
      g.beginPath(); g.moveTo(8, 0); g.lineTo(-4, -6); g.lineTo(-4, 6); g.closePath(); g.fill(); g.restore();
      FX.emit(ex, ey, 1, 0.3);
    }
  },
};
$('#turn-for-me').addEventListener('click', () => {
  const s = Scenes.turner;
  if (sceneName !== 'turner' || s.done) return;
  s.dir = s.dir || 1; s.auto = true;
});

/* ---------- 3. Tijdreis ---------- */
const NUMERALS = ['XII', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'];
Scenes.travel = {
  enter(from) {
    this.t = 0; this.dur = 4.8; this.from = from; this.flashed = false;
    this.parts = Array.from({ length: reduced ? 120 : 420 }, () => this.spawn(rand(0.1, 1.6)));
    this.startDate = new Date();
    this.lastShown = '';
    $('#date-roll').textContent = fmt.day(this.startDate);
    Sound.setMood('off');
    Sound.whoosh(this.dur * 0.95, 120, 3200, 0.22);
    Sound.rumble(this.dur, 0.35);
    for (let i = 0; i < 40; i++) setTimeout(() => Sound.tick(0.04), this.dur * 900 * Math.pow(i / 40, 0.6));
    vib([80, 60, 100, 50, 140, 40, 200, 40, 400]);
  },
  spawn(z) { return { a: rand(TAU), z, sp: rand(0.6, 1.4), c: Math.random() < 0.7 ? '255,214,140' : '235,240,255', px: null, py: null }; },
  update(dt) {
    this.t += dt;
    const p = this.t / this.dur;
    const v = 0.12 + 2.4 * Math.pow(Math.sin(Math.PI * clamp(p)), 2);
    for (const q of this.parts) {
      q.z -= v * dt * q.sp;
      q.a += dt * (0.6 + v * 1.2) * (0.35 / (q.z + 0.25));
      if (q.z < 0.03) Object.assign(q, this.spawn(rand(1.2, 1.7)));
    }
    const k = clamp((p - 0.12) / 0.7);
    let shown;
    if (SHOW) shown = fmt.day(new Date(lerp(this.startDate.getTime(), SHOW.getTime(), ease(k))));
    else shown = k >= 0.99 ? 'Ergens in de toekomst…' : fmt.day(new Date(this.startDate.getTime() + Math.sin(k * Math.PI) * 86400000 * 400));
    if (shown !== this.lastShown) { $('#date-roll').textContent = shown; this.lastShown = shown; }
    if (p > 0.86 && !this.flashed) { this.flashed = true; Sound.chord([659.26, 987.77, 1318.51, 1975.5, 2637], 0.05, 0.08); }
    if (p > 0.9) FX.flash = Math.max(FX.flash, clamp((p - 0.9) / 0.1));
    if (this.t >= this.dur) { FX.flash = 1; go('duel'); }
  },
  drawBg(g, t) {
    const p = this.t / this.dur, cx = W / 2, cy = H / 2;
    g.fillStyle = `rgba(5,6,12,${this.t < 0.1 ? 1 : 0.3})`; g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = 'lighter';
    const core = g.createRadialGradient(cx, cy, 0, cx, cy, Math.min(W, H) * 0.45);
    core.addColorStop(0, `rgba(255,220,160,${0.2 + p * 0.3})`); core.addColorStop(1, 'rgba(255,220,160,0)');
    g.fillStyle = core; g.fillRect(0, 0, W, H);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    for (let k = 0; k < 3; k++) {
      const s = (p * 2.4 + k / 3) % 1;
      const rr = Math.pow(s, 1.6) * Math.max(W, H) * 0.95 + 20;
      const a = Math.sin(Math.PI * s) * 0.5, rot = t * (k % 2 ? 1.6 : -1.2);
      g.fillStyle = `rgba(255,226,160,${a})`;
      g.font = `600 ${Math.max(8, rr * 0.11)}px Cinzel, Georgia, serif`;
      for (let i = 0; i < 12; i++) {
        const ang = rot + (i / 12) * TAU;
        g.save(); g.translate(cx + Math.cos(ang) * rr, cy + Math.sin(ang) * rr); g.rotate(ang + Math.PI / 2);
        g.fillText(NUMERALS[i], 0, 0); g.restore();
      }
      g.strokeStyle = `rgba(255,226,160,${a * 0.4})`; g.lineWidth = 1;
      g.beginPath(); g.arc(cx, cy, rr * 0.86, 0, TAU); g.stroke();
    }
    const focal = Math.min(W, H) * 0.1;
    for (const q of this.parts) {
      const r = focal / q.z, x = cx + Math.cos(q.a) * r, y = cy + Math.sin(q.a) * r;
      if (q.px !== null && r < Math.max(W, H)) {
        g.strokeStyle = `rgba(${q.c},${clamp(1.4 - q.z) * 0.9})`; g.lineWidth = clamp(1.6 / q.z, 0.5, 4);
        g.beginPath(); g.moveTo(q.px, q.py); g.lineTo(x, y); g.stroke();
      }
      q.px = x; q.py = y;
    }
    g.globalCompositeOperation = 'source-over';
    if (this.from && p < 0.45) {
      const k = clamp(p / 0.45), st = this.from.st;
      st.a += 0.45; st.b -= 0.35; st.ring += 0.25;
      showTT({ x: cx, y: cy, R: lerp(this.from.R, 2, ease(k)), st, text: INTRO_ENGRAVING, env: 1.3 }, t);
    }
  },
};

/* ---------- 3b. Het duel: twee spreuken botsen, alles verdwijnt in rook ---------- */
function drawWand(g, tip, butt, w, glowRGB, glow, alpha = 1) {
  const dx = butt.x - tip.x, dy = butt.y - tip.y, L = Math.hypot(dx, dy), ux = dx / L, uy = dy / L, nx = -uy, ny = ux;
  const at = (k, half) => [tip.x + dx * k + nx * half, tip.y + dy * k + ny * half];
  const width = (k) => (k < 0.62 ? lerp(w * 0.3, w * 0.72, k / 0.62) : k < 0.66 ? w * 0.95 : lerp(w * 0.85, w, (k - 0.66) / 0.34));
  const N = 24, path = new Path2D();
  for (let i = 0; i <= N; i++) { const k = i / N, [x, y] = at(k, width(k) / 2); i ? path.lineTo(x, y) : path.moveTo(x, y); }
  for (let i = N; i >= 0; i--) { const k = i / N, [x, y] = at(k, -width(k) / 2); path.lineTo(x, y); }
  path.closePath();
  g.save(); g.globalAlpha = alpha;
  // rond hout: donker aan de randen, glans aan één kant
  const mx = tip.x + dx * 0.5, my = tip.y + dy * 0.5;
  const across = g.createLinearGradient(mx - nx * w * 0.5, my - ny * w * 0.5, mx + nx * w * 0.5, my + ny * w * 0.5);
  across.addColorStop(0, '#0d0704'); across.addColorStop(0.3, '#3d2416'); across.addColorStop(0.42, '#6b4529'); across.addColorStop(0.6, '#2c190e'); across.addColorStop(1, '#080402');
  g.fillStyle = across; g.fill(path);
  // houtnerf
  g.clip(path);
  g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 0.7;
  for (let i = -2; i <= 2; i++) {
    g.beginPath();
    for (let k = 0; k <= 1.001; k += 0.05) { const [x, y] = at(k, (i / 5) * width(k) + Math.sin(k * 40 + i) * 0.6); k ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.stroke();
  }
  // het handvat: ringen
  for (const k of [0.64, 0.7, 0.8, 0.92]) {
    const [x1, y1] = at(k, width(k) / 2), [x2, y2] = at(k, -width(k) / 2);
    g.strokeStyle = 'rgba(0,0,0,.6)'; g.lineWidth = 2.2; g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
    g.strokeStyle = 'rgba(170,120,70,.35)'; g.lineWidth = 0.8; g.beginPath(); g.moveTo(x1 + ux, y1 + uy); g.lineTo(x2 + ux, y2 + uy); g.stroke();
  }
  // licht van de punt dat over het hout strijkt
  if (glow > 0) {
    const lg = g.createRadialGradient(tip.x, tip.y, 0, tip.x, tip.y, L * 0.3);
    lg.addColorStop(0, `rgba(${glowRGB},${0.75 * glow})`); lg.addColorStop(1, `rgba(${glowRGB},0)`);
    g.globalCompositeOperation = 'lighter'; g.fillStyle = lg; g.fill(path);
  }
  g.restore();
  if (glow > 0) {
    g.save(); g.globalCompositeOperation = 'lighter';
    const r = w * (1.3 + glow * 1.5);
    const tg = g.createRadialGradient(tip.x, tip.y, 0, tip.x, tip.y, r);
    tg.addColorStop(0, `rgba(255,255,255,${glow})`); tg.addColorStop(0.18, `rgba(${glowRGB},${0.8 * glow})`); tg.addColorStop(1, `rgba(${glowRGB},0)`);
    g.fillStyle = tg; g.beginPath(); g.arc(tip.x, tip.y, r, 0, TAU); g.fill();
    g.restore();
  }
}

/* Een spreukstraal: kolkend, met een witte kern en losse slierten eromheen */
function drawBeam(g, a, b, rgb, t, power = 1, seed = 0) {
  const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy);
  if (L < 2) return;
  const nx = -dy / L, ny = dx / L, N = Math.max(8, Math.round(L / 9));
  const line = (amp, ph, freq) => {
    const p = new Path2D();
    for (let i = 0; i <= N; i++) {
      const k = i / N, env = Math.sin(Math.PI * k) * (0.35 + 0.65 * k);
      const off = env * amp * (Math.sin(k * freq + t * 17 + ph) * 0.6 + Math.sin(k * freq * 2.3 - t * 23 + ph * 2) * 0.4);
      const x = a.x + dx * k + nx * off, y = a.y + dy * k + ny * off;
      i ? p.lineTo(x, y) : p.moveTo(x, y);
    }
    return p;
  };
  g.save(); g.globalCompositeOperation = 'lighter'; g.lineCap = 'round'; g.lineJoin = 'round';
  const main = line(5 * power, seed, 9);
  g.strokeStyle = `rgba(${rgb},${0.10 * power})`; g.lineWidth = 34 * power; g.stroke(main);
  g.strokeStyle = `rgba(${rgb},${0.28 * power})`; g.lineWidth = 13 * power; g.stroke(main);
  for (let j = 0; j < 3; j++) {
    g.strokeStyle = `rgba(${rgb},${0.55 * power})`; g.lineWidth = 1.6;
    g.stroke(line(16 * power, seed + j * 2.1 + t * 3, 13 + j * 4));
  }
  g.strokeStyle = `rgba(${rgb},${0.9 * power})`; g.lineWidth = 5 * power; g.stroke(main);
  g.strokeStyle = `rgba(255,255,245,${0.95 * power})`; g.lineWidth = 2 * power; g.stroke(main);
  g.restore();
}

function lightning(g, x, y, len, ang, rgb, a) {
  g.beginPath(); g.moveTo(x, y);
  let px = x, py = y;
  for (let i = 1; i <= 6; i++) {
    const k = i / 6, aa = ang + rand(-0.6, 0.6);
    px += Math.cos(aa) * len / 6; py += Math.sin(aa) * len / 6;
    g.lineTo(px, py);
  }
  g.strokeStyle = `rgba(${rgb},${a})`; g.lineWidth = 1.3; g.stroke();
}

const RED = '255,70,52', GOLD = '255,196,96';
Scenes.duel = {
  enter() {
    this.t = 0; this.phase = 'arrive'; this.s = 0.5; this.front = 0; this.mine = 0; this.heat = 0;
    this.clashT = 0; this.boomT = 0; this.taps = 0; this.shake = 0; this.swipe = null; this.hum = null;
    this.ring = 0; this.smoke = { spread: 0, dens: 0, glow: 0 };
    this.say('', '');
    Sound.setMood('off');
    Sound.rumble(2.5, 0.2);
  },
  exit() { if (this.hum) { this.hum.stop(0.3); this.hum = null; } },
  say(a, b, urgent) {
    const h = $('#duel-hint'), sub = $('#duel-sub');
    h.textContent = a; sub.textContent = b; h.classList.toggle('urgent', !!urgent);
  },
  geo() {
    const S = Math.min(W, H);
    return {
      A: { x: W * 0.56, y: H * 0.22 }, Abutt: { x: W * 0.56 - S * 0.62, y: H * 0.22 - S * 0.36 },
      B: { x: W * 0.43, y: H * 0.66 }, Bbutt: { x: W * 0.43 + S * 1.0, y: H * 0.66 + S * 0.46 },
      wA: S * 0.034, wB: S * 0.068,
    };
  },
  point() {
    const { A, B } = this.geo(), k = this.s;
    const x = lerp(A.x, B.x, k), y = lerp(A.y, B.y, k);
    const wob = Math.sin(this.t * 3.1) * 7 + Math.sin(this.t * 7.7) * 3;
    return { x: x + wob, y: y + Math.sin(this.t * 2.3) * 4 };
  },
  cast() {
    if (this.phase !== 'incoming') return;
    this.phase = 'cast'; this.castT = 0;
    Sound.zap(0.16); Sound.whoosh(0.5, 600, 3200, 0.16); vib([40, 30, 60]);
    this.say('', '');
  },
  down(p) {
    this.swipe = { x: p.x, y: p.y, t: this.t };
    if (this.phase === 'incoming' && this.t - this.incomingAt > 6) this.cast();
    if (this.phase === 'clash') this.push(1);
  },
  move(p) {
    if (!this.swipe) return;
    const dy = p.y - this.swipe.y;
    if (dy < -45) {
      if (this.phase === 'incoming') this.cast();
      else if (this.phase === 'clash') this.push(0.8);
      this.swipe = { x: p.x, y: p.y, t: this.t };
    }
  },
  up() { this.swipe = null; },
  push(k) {
    this.s = Math.max(0, this.s - 0.024 * k);
    this.taps++; this.heat = Math.min(1, this.heat + 0.05);
    vib(12);
    const P = this.point();
    FX.emit(P.x, P.y, 10, 2.2, ['255,255,255', '255,214,140', '255,196,96']);
    if (this.taps === 6) this.say('Ja! Harder!', 'Tik, tik, tik!', true);
  },
  update(dt) {
    this.t += dt;
    const { A, B } = this.geo();
    if (this.phase === 'arrive') {
      if (this.t > 0.9 && !this.said1) { this.said1 = true; this.say('Je bent niet alleen…', ''); Sound.whoosh(1.4, 200, 900, 0.08); }
      if (this.t > 3.2) {
        this.phase = 'incoming'; this.incomingAt = this.t;
        this.say('Een spreuk komt op je af!', 'Veeg met je vinger omhoog om terug te vuren.', true);
        Sound.zap(0.12); Sound.whoosh(0.9, 3000, 400, 0.14);
        this.hum = Sound.clash(); this.hum.heat(0);
        vib(60);
      }
    }
    if (this.phase === 'incoming') {
      const k = this.t - this.incomingAt;
      // de rode straal schiet naar beneden en kruipt dan dreigend verder
      this.front = Math.min(0.62, k < 0.5 ? ease(k / 0.5) * 0.5 : 0.5 + (k - 0.5) * 0.02);
      if (k > 6 && !this.said2) { this.said2 = true; this.say('Snel! Verdedig je!', 'Veeg omhoog, of tik op het scherm.', true); }
    }
    if (this.phase === 'cast') {
      this.castT += dt;
      this.mine = clamp(this.castT / 0.22);
      if (this.mine >= 1) {
        this.phase = 'clash'; this.s = clamp(this.front, 0.45, 0.62); this.clashT = 0; this.heat = 0.3;
        const P = this.point();
        FX.flash = 0.5; FX.flashRGB = '255,236,200'; this.shake = 1;
        FX.burst(P.x, P.y, 90, ['255,255,255', '255,214,140', '255,90,70']);
        Sound.thud(0.35); vib([80, 40, 120]);
        this.say('Duw de spreuk terug!', 'Tik zo snel als je kunt.', true);
      }
    }
    if (this.phase === 'clash') {
      this.clashT += dt;
      // de tegenstander drukt terug, maar wordt moe; winnen lukt altijd
      const opp = 0.075 * Math.max(0, 1 - this.clashT / 11) * (this.s > 0.82 ? 0 : 1);
      this.s = clamp(this.s + opp * dt - (this.clashT > 12 ? 0.05 * dt : 0), 0, 0.95);
      this.heat = clamp(lerp(this.heat, 0.25 + (1 - this.s / 0.62) * 0.75, 0.05));
      if (this.hum) this.hum.heat(this.heat);
      if (this.s > 0.8 && !this.saidHold) { this.saidHold = true; this.say('Houd vol!', 'Blijf tikken!', true); }
      if (this.s < 0.6) this.saidHold = false;
      const P = this.point();
      if (Math.random() < 0.6) FX.emit(P.x, P.y, 2, 1.8, ['255,255,255', '255,214,140', '255,120,90']);
      if (this.s <= 0.1) this.explode();
    }
    if (this.phase === 'boom') {
      const k = this.t - this.boomT;
      this.ring += dt;
      this.smoke.spread = 2.8 * ease(clamp(k / 1.3));
      this.smoke.dens = clamp(k / 0.7);
      this.smoke.glow = Math.max(0, 1 - k / 1.8); this.smoke.age = k;
      if (k > 2.5) go('reveal', { smoke: { ...this.smoke, x: this.boomP.x, y: this.boomP.y } });
    }
    this.shake *= 0.9;
  },
  explode() {
    this.phase = 'boom'; this.boomT = this.t; this.ring = 0;
    const P = (this.boomP = this.point());
    if (this.hum) { this.hum.stop(0.05); this.hum = null; }
    Sound.boom(); vib([250, 60, 400]);
    if (GLR) GLR.smokeBurst(P.x, P.y);
    FX.flash = 1; FX.flashRGB = '255,250,240'; this.shake = 2.2;
    FX.burst(P.x, P.y, 220, ['255,255,255', '255,214,140', '255,196,96', '255,90,70']);
    this.say('', '');
  },
  drawBg(g, t) {
    const { A, B } = this.geo();
    const appear = clamp((this.t - 0.8) / 1.6);
    const opp = this.phase === 'arrive' ? 0 : this.phase === 'boom' ? 0 : 1;
    const Fo = this.frontPoint(), P = this.point();
    const mineOn = this.phase === 'clash' || this.phase === 'cast' ? 1 : 0;
    const Mf = this.phase === 'cast' ? { x: lerp(B.x, Fo.x, this.mine), y: lerp(B.y, Fo.y, this.mine) } : P;
    const heat = this.phase === 'clash' ? this.heat : this.phase === 'boom' ? Math.max(0, 1.5 - (this.t - this.boomT)) : 0;
    if (GLR) {
      GLR.showDuel({
        opp: [A.x, A.y, Fo.x, Fo.y], mine: [B.x, B.y, Mf.x, Mf.y], p: [P.x, P.y],
        oppOn: opp, mineOn, heat, tips: appear * (0.6 + 0.4 * Math.sin(t * 5)),
      });
      return;
    }
    g.fillStyle = '#04050b'; g.fillRect(0, 0, W, H);
    if (heat > 0) {
      const gr = g.createRadialGradient(P.x, P.y, 0, P.x, P.y, Math.min(W, H) * 0.6);
      gr.addColorStop(0, `rgba(255,220,170,${0.3 * heat})`); gr.addColorStop(1, 'rgba(255,220,170,0)');
      g.fillStyle = gr; g.fillRect(0, 0, W, H);
    }
    if (this.phase === 'boom') { g.fillStyle = `rgba(120,118,124,${this.smoke.dens * 0.97})`; g.fillRect(0, 0, W, H); }
  },
  frontPoint() {
    const { A, B } = this.geo();
    const k = this.phase === 'incoming' ? this.front : this.s;
    return this.phase === 'incoming' ? { x: lerp(A.x, B.x, k), y: lerp(A.y, B.y, k) } : this.point();
  },
  draw(g, t) {
    const { A, B, Abutt, Bbutt, wA, wB } = this.geo();
    const sh = this.shake > 0.02 ? this.shake * 6 : 0;
    g.save(); if (sh) g.translate(rand(-sh, sh), rand(-sh, sh));
    const fade = this.phase === 'boom' ? Math.max(0, 1 - (this.t - this.boomT) / 0.5) : 1;
    const appear = clamp((this.t - 0.8) / 1.6), mineIn = ease(clamp((this.t - 0.3) / 1.2));
    // de wand van de tegenstander, half in de mist
    drawWand(g, A, Abutt, wA, RED, (this.phase === 'arrive' ? appear * 0.5 : 0.9) * fade, appear * fade);
    // je eigen wand, van rechtsonder het beeld in
    const off = (1 - mineIn) * Math.min(W, H) * 0.5;
    const Bm = { x: B.x + off, y: B.y + off * 0.45 }, Bb = { x: Bbutt.x + off, y: Bbutt.y + off * 0.45 };
    const ready = this.phase === 'incoming' ? 0.5 + 0.4 * Math.sin(t * 6) : this.phase === 'clash' || this.phase === 'cast' ? 1 : 0.2;
    drawWand(g, Bm, Bb, wB, GOLD, ready * mineIn * fade, mineIn * fade);
    if (this.phase === 'incoming') drawBeam(g, A, this.frontPoint(), RED, t, 0.9, 1);
    if (this.phase === 'cast') {
      const F = this.frontPoint();
      drawBeam(g, A, F, RED, t, 0.9, 1);
      drawBeam(g, B, { x: lerp(B.x, F.x, this.mine), y: lerp(B.y, F.y, this.mine) }, GOLD, t, 1, 4);
    }
    if (this.phase === 'clash' || (this.phase === 'boom' && fade > 0)) {
      const P = this.phase === 'boom' ? this.boomP : this.point();
      const pw = (0.7 + this.heat * 0.5) * fade;
      drawBeam(g, A, P, RED, t, pw * (0.5 + this.s), 1);
      drawBeam(g, B, P, GOLD, t, pw * (1.4 - this.s * 0.6), 4);
      // de vuurbal waar ze elkaar raken
      g.save(); g.globalCompositeOperation = 'lighter';
      const r = (22 + this.heat * 26 + Math.sin(t * 31) * 4) * (1 + (1 - fade) * 3);
      const gr = g.createRadialGradient(P.x, P.y, 0, P.x, P.y, r * 2.4);
      gr.addColorStop(0, `rgba(255,255,255,${fade})`); gr.addColorStop(0.2, `rgba(255,240,210,${0.9 * fade})`);
      gr.addColorStop(0.45, `rgba(255,170,90,${0.4 * fade})`); gr.addColorStop(1, 'rgba(255,120,60,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(P.x, P.y, r * 2.4, 0, TAU); g.fill();
      for (let i = 0; i < 3 + this.heat * 5; i++) lightning(g, P.x, P.y, r * rand(1.2, 3), rand(TAU), Math.random() < 0.5 ? '255,240,220' : RED, 0.7 * fade);
      g.restore();
    }
    // schokgolf
    if (this.phase === 'boom' && this.ring < 1.2) {
      const P = this.boomP, k = this.ring / 1.2, R = ease(k) * Math.max(W, H) * 1.1;
      g.save(); g.globalCompositeOperation = 'lighter';
      g.strokeStyle = `rgba(255,236,200,${0.8 * (1 - k)})`; g.lineWidth = 24 * (1 - k) + 2;
      g.beginPath(); g.arc(P.x, P.y, R, 0, TAU); g.stroke();
      g.strokeStyle = `rgba(255,255,255,${0.6 * (1 - k)})`; g.lineWidth = 3;
      g.beginPath(); g.arc(P.x, P.y, R * 0.92, 0, TAU); g.stroke();
      g.restore();
    }
    g.restore();
  },
};

/* ---------- 4. Het doek gaat op ---------- */
function drawCurtain2D(g, side, open) {
  const cw = (W / 2 + 4) * (1 - open * 0.86) + 10, x0 = side < 0 ? 0 : W - cw, folds = 7, fw = cw / folds;
  for (let i = 0; i < folds; i++) {
    const x = x0 + i * fw, gr = g.createLinearGradient(x, 0, x + fw, 0);
    gr.addColorStop(0, '#22030a'); gr.addColorStop(0.5, '#8e1520'); gr.addColorStop(1, '#22030a');
    g.fillStyle = gr; g.fillRect(x - 0.5, 0, fw + 1.5, H);
  }
}
Scenes.reveal = {
  enter(arg) {
    this.t = 0;
    this.smoke = arg && arg.smoke ? arg.smoke : null;
    this.delay = this.smoke ? 1.2 : 0;
    $('#rv-date').textContent = SHOW ? 'Op ' + fmt.long(SHOW) : 'Binnenkort';
    $$('.reveal-lines > *').forEach((el) => { el.style.animation = 'none'; void el.offsetWidth; el.style.animation = ''; });
    Sound.setMood('magic');
    setTimeout(() => { if (sceneName === 'reveal') Sound.chord([329.63, 415.3, 493.88, 659.26, 830.6], 0.18, 0.07); }, 900);
    setTimeout(() => { if (sceneName === 'reveal') { Sound.chord([659.26, 987.77, 1318.51], 0.1, 0.06); vib([20, 30, 20]); } }, 5200);
    setTimeout(() => {
      if (sceneName !== 'reveal') return;
      const el = $('.reveal-lines .r6').getBoundingClientRect();
      FX.burst(el.left + el.width / 2, el.top + el.height / 2, 90);
      Sound.chord([987.77, 1318.51, 1567.98, 1975.5], 0.08, 0.06); vib([30, 50, 30]);
    }, 8600);
  },
  update(dt) { this.t += dt; },
  open() { return ease(clamp((this.t - 0.6 - this.delay) / 3)); },
  smokeNow() {
    if (!this.smoke) return null;
    const k = clamp(this.t / 4.2);
    return { ...this.smoke, spread: 2.8, dens: 1 - ease(k), glow: 0, age: this.smoke.age + this.t };
  },
  drawBg(g) {
    const sm = this.smokeNow();
    if (GLR) { GLR.showStage(this.open()); return; }
    g.fillStyle = '#07060b'; g.fillRect(0, 0, W, H);
    drawCurtain2D(g, -1, this.open()); drawCurtain2D(g, 1, this.open());
    if (sm) { g.fillStyle = `rgba(120,118,124,${sm.dens * 0.97})`; g.fillRect(0, 0, W, H); }
  },
  draw(g) {
    if (this.open() > 0.05) Motes.draw(g, 1 / 60, W / 2, H * 0.55, W * 0.4, 46);
  },
};
$('#to-hub').addEventListener('click', (e) => {
  FX.burst(e.clientX, e.clientY, 60); Sound.whoosh(0.8, 300, 2000, 0.1);
  go('hub');
});

/* ---------- 5. Thuis: de Tijdverdrijver als toegangsbewijs ---------- */
Scenes.hub = {
  enter() {
    if (!store.get('start')) store.set('start', String(Date.now()));
    this.start = +store.get('start') || Date.now();
    this.st = { ring: 0, a: 0.6, b: 1.2, sand: this.sandFrac(), flip: 0, flowing: true };
    this.vel = 0.12; this.drag = null; this.tickAcc = 0; this.factIdx = 0; this.lastCd = '';
    this.combo = { segs: [], cur: null, rev: 0, at: 0 }; this.counting = false; this.unlocking = false;
    this.text = engravingText();
    this.R = 0;
    requestAnimationFrame(() => this.layout());
    Sound.setMood('calm');
    this.renderCountdown(true);
  },
  resize() { this.layout(); },
  layout() {
    const head = $('#hub-head').getBoundingClientRect();
    const cdH = 120, top = head.bottom + 24, bottom = H - 40 - cdH;
    const avail = Math.max(120, bottom - top);
    this.R = Math.min(W * 0.38, avail / 2.35, 220);
    const extra = Math.max(0, avail - this.R * 2.35);
    this.cx = W / 2;
    this.cy = top + extra * 0.5 + this.R * 1.12;
    this.chainTop = head.bottom + 6;
    document.body.style.setProperty('--cd-top', `${this.cy + this.R * 1.18 + 8}px`);
    document.body.style.setProperty('--toast-top', `${this.cy}px`);
  },
  sandFrac() {
    if (!SHOW) return 0.5;
    const now = Date.now(), s = Math.min(this.start ?? now, SHOW.getTime() - 86400000);
    return clamp((now - s) / (SHOW.getTime() - s));
  },
  facts() {
    const f = [];
    if (SHOW) { f.push(fmt.short(SHOW)); f.push('Aanvang ' + fmt.time(SHOW)); }
    if (CONFIG.rij) f.push('Rij ' + CONFIG.rij + (seatText() ? ' · Stoel ' + seatText() : ''));
    f.push(CONFIG.theater);
    if (SHOW && Date.now() < SHOW.getTime()) {
      const nights = Math.ceil((new Date(SHOW).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / 86400000);
      if (nights > 0) f.push(nights === 1 ? 'Nog één nachtje slapen' : `Nog ${nights} nachtjes slapen`);
    }
    return f;
  },
  down(p) {
    if (dist(p, { x: this.cx, y: this.cy }) < this.R * 1.4) {
      this.drag = { last: Math.atan2(p.y - this.cy, p.x - this.cx), lt: performance.now(), moved: 0 }; this.vel = 0; this.counting = true;
    }
  },
  move(p) {
    if (!this.drag) return;
    const a = Math.atan2(p.y - this.cy, p.x - this.cx), da = wrapAngle(a - this.drag.last), now = performance.now();
    this.drag.last = a; this.drag.moved += Math.abs(da);
    const dtm = Math.max(1, now - this.drag.lt) / 1000; this.drag.lt = now;
    this.vel = lerp(this.vel, da / dtm, 0.5);
    this.spin(da);
    this.turned(da);
  },
  up() {
    if (this.drag && this.drag.moved < 0.08) this.tapTurner();
    this.drag = null;
  },
  spin(da) {
    this.st.ring += da; this.st.a += da * 1.6; this.st.b -= da * 1.1;
    this.tickAcc += Math.abs(da);
    while (this.tickAcc > TAU / 24) { this.tickAcc -= TAU / 24; Sound.tick(0.035); vib(4); }
  },
  tapTurner() {
    const f = this.facts(), toast = $('#toast');
    toast.textContent = f[this.factIdx % f.length]; this.factIdx++;
    toast.classList.add('show');
    clearTimeout(this.toastT); this.toastT = setTimeout(() => toast.classList.remove('show'), 2200);
    Sound.bell(pick([987.77, 1174.66, 1318.51]), 0, 2, 0.06); vib(15);
    FX.burst(this.cx, this.cy, 30);
    this.vel = 6; this.counting = false;
  },
  /* Het kluisslot: houd bij hoeveel hele rondjes er links- en rechtsom gedraaid worden */
  turned(da) {
    if (this.unlocking || !da) return;
    const c = this.combo, now = performance.now(), dir = Math.sign(da);
    if (now - c.at > 7000) { c.segs = []; c.cur = null; c.rev = 0; }
    c.at = now;
    if (!c.cur) c.cur = { dir, acc: 0 };
    if (dir === c.cur.dir) { c.cur.acc += Math.abs(da); c.rev = 0; }
    else {
      // een klein beetje terugdraaien telt niet; pas bij een echte ommekeer begint een nieuwe reeks
      c.rev += Math.abs(da);
      if (c.rev > 0.6) {
        if (Math.round(c.cur.acc / TAU) >= 1) c.segs.push(c.cur);
        const last = c.segs[c.segs.length - 1];
        c.cur = last && last.dir === dir ? c.segs.pop() : { dir, acc: 0 };
        c.cur.acc += c.rev; c.rev = 0;
        if (c.segs.length > 8) c.segs.shift();
      }
    }
    const code = CONFIG.geheim, n = code.length;
    if (!n || c.segs.length < n - 1) return;
    const prev = c.segs.slice(-(n - 1)).map((g) => g.dir * Math.round(g.acc / TAU));
    const fin = code[n - 1];
    if (prev.every((v, i) => v === code[i]) && c.cur.dir === Math.sign(fin) && c.cur.acc >= (Math.abs(fin) - 0.2) * TAU) this.unlock();
  },
  unlock() {
    this.unlocking = true; this.drag = null; this.vel = 22; this.counting = false;
    FX.flashRGB = '200,220,255'; FX.flash = 0.7;
    FX.burst(this.cx, this.cy, 140, ['235,242,255', '200,220,255', '255,255,255']);
    Sound.chord([493.88, 587.33, 739.99, 987.77, 1174.66], 0.09, 0.07);
    setTimeout(() => Sound.breath(0.16), 500);
    vib([40, 60, 40, 60, 200]);
    setTimeout(() => { if (sceneName === 'hub') go('game'); }, 1600);
  },
  renderCountdown(force) {
    const el = $('#countdown'), now = Date.now();
    let key, html;
    if (!SHOW) {
      key = 'secret';
      html = `<div class="cd-big">Kan je 12 november?</div>`;
    } else if (now < SHOW.getTime()) {
      let s = Math.floor((SHOW.getTime() - now) / 1000);
      const d = Math.floor(s / 86400); s -= d * 86400;
      const h = Math.floor(s / 3600); s -= h * 3600;
      const m = Math.floor(s / 60); s -= m * 60;
      const pad = (n) => String(n).padStart(2, '0');
      const today = new Date().toDateString() === SHOW.toDateString();
      key = `${d}:${h}:${m}:${s}`;
      html = `<div class="cd-grid">
          <div><b>${d}</b><span>${d === 1 ? 'dag' : 'dagen'}</span></div>
          <div><b>${pad(h)}</b><span>uur</span></div>
          <div><b>${pad(m)}</b><span>min</span></div>
          <div><b>${pad(s)}</b><span>sec</span></div>
        </div>
        <p class="cd-cap">${today ? 'Vandaag is het zover! Nog even en het doek gaat op.' : 'tot het doek opgaat in het ' + CONFIG.theater}</p>`;
    } else if (now < SHOW_END.getTime()) {
      key = 'during';
      html = `<div class="cd-big">Het doek is op</div><p class="cd-cap">Telefoon weg, ogen open. Geniet ervan!</p>`;
    } else {
      key = 'after';
      html = `<div class="cd-big">Wat een avond</div><p class="cd-cap">Het zand is doorgelopen, maar deze herinnering blijft. Draai de Tijdverdrijver om hem opnieuw te beleven.</p>`;
    }
    if (force || key !== this.lastCd) { el.innerHTML = html; this.lastCd = key; }
  },
  update(dt) {
    if (!this.drag) {
      if (Math.abs(this.vel) > 0.12) { this.spin(this.vel * dt); if (this.counting) this.turned(this.vel * dt); this.vel *= Math.pow(0.25, dt); }
      else { this.vel = 0; this.st.ring += dt * 0.04; this.st.a += dt * 0.22; this.st.b -= dt * 0.15; }
    }
    this.cdT = (this.cdT || 0) + dt;
    if (this.cdT > 0.25) { this.cdT = 0; this.renderCountdown(); this.st.sand = this.sandFrac(); }
  },
  drawBg(g, t) {
    if (!this.R) this.layout();
    const bgr = g.createRadialGradient(this.cx, this.cy, 0, this.cx, this.cy, Math.max(W, H) * 0.75);
    bgr.addColorStop(0, '#191324'); bgr.addColorStop(1, '#05060c');
    g.fillStyle = bgr; g.fillRect(0, 0, W, H);
    Stars.draw(g, t, 0.55);
    warmGlow(g, this.cx, this.cy, this.R, 0.9);
    Motes.draw(g, 1 / 60, this.cx, this.cy, this.R * 1.5, 34);
    showTT({ x: this.cx + tilt.x * 6, y: this.cy + tilt.y * 4, R: this.R, st: this.st, text: this.text, chainTop: this.chainTop }, t);
  },
};
$('#replay').addEventListener('click', () => { Sound.whoosh(1, 2000, 200, 0.12); go('dark'); });

/* =========================================================================
   6. Spel: Verjaag de Dementors
   ========================================================================= */
const GLYPHS = ['h', 'v', 'V', 'A', 'O', 'Z'];
function glyphPath(sym, s) {
  const p = new Path2D(), h = s / 2;
  if (sym === 'h') { p.moveTo(-h, 0); p.lineTo(h, 0); }
  else if (sym === 'v') { p.moveTo(0, -h); p.lineTo(0, h); }
  else if (sym === 'V') { p.moveTo(-h, -h); p.lineTo(0, h); p.lineTo(h, -h); }
  else if (sym === 'A') { p.moveTo(-h, h); p.lineTo(0, -h); p.lineTo(h, h); }
  else if (sym === 'Z') { p.moveTo(h * 0.4, -h); p.lineTo(-h * 0.3, h * 0.08); p.lineTo(h * 0.3, -h * 0.08); p.lineTo(-h * 0.4, h); }
  else p.arc(0, 0, h, 0, TAU);
  return p;
}
function drawGlyph(g, sym, x, y, s, bright) {
  g.save(); g.translate(x, y);
  const p = glyphPath(sym, s);
  g.lineCap = 'round'; g.lineJoin = 'round';
  if (bright) {
    g.strokeStyle = 'rgba(255,190,90,.35)'; g.lineWidth = 9; g.stroke(p);
    g.strokeStyle = '#fff0c4'; g.lineWidth = 3; g.stroke(p);
  } else {
    g.strokeStyle = 'rgba(216,176,98,.5)'; g.lineWidth = 2.2; g.stroke(p);
  }
  g.restore();
}

/* Vereenvoudig een lijn tot de punten die ertoe doen (Douglas-Peucker) */
function simplify(pts, eps) {
  if (pts.length < 3) return pts.slice();
  const a = pts[0], b = pts[pts.length - 1], dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1;
  let far = 0, idx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = L > 1 ? Math.abs((pts[i].x - a.x) * dy - (pts[i].y - a.y) * dx) / L : dist(pts[i], a);
    if (d > far) { far = d; idx = i; }
  }
  if (far <= eps) return [a, b];
  return simplify(pts.slice(0, idx + 1), eps).slice(0, -1).concat(simplify(pts.slice(idx), eps));
}

/* Herken een getekend teken: streep, staaf, V, dakje, cirkel of bliksemschicht */
function recognize(pts) {
  if (pts.length < 4) return null;
  let len = 0, minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (i) len += dist(p, pts[i - 1]);
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  const bw = maxX - minX, bh = maxY - minY, size = Math.max(bw, bh);
  if (size < 34) return null;
  const a = pts[0], b = pts[pts.length - 1], chord = dist(a, b);
  // Cirkel: vriendelijk voor vingers. Een open rondje, een ei of een rondje met uitschieter telt ook,
  // zolang de lijn gelijkmatig één kant op blijft draaien (geen scherpe punt zoals bij V of A).
  if (Math.min(bw, bh) / size > 0.3) {
    // eerst het gebibber van de vinger gladstrijken, dan in gelijke stappen bemonsteren
    const sm = pts.map((_, i) => {
      let x = 0, y = 0, n = 0;
      for (let j = Math.max(0, i - 3); j <= Math.min(pts.length - 1, i + 3); j++) { x += pts[j].x; y += pts[j].y; n++; }
      return { x: x / n, y: y / n };
    });
    const step = Math.max(6, size / 11), rs = [sm[0]];
    for (const p of sm) if (dist(p, rs[rs.length - 1]) >= step) rs.push(p);
    if (rs.length >= 7) {
      let turn = 0, absTurn = 0, maxStep = 0;
      for (let i = 2; i < rs.length; i++) {
        const a1 = Math.atan2(rs[i - 1].y - rs[i - 2].y, rs[i - 1].x - rs[i - 2].x);
        const a2 = Math.atan2(rs[i].y - rs[i - 1].y, rs[i].x - rs[i - 1].x);
        const d = wrapAngle(a2 - a1);
        turn += d; absTurn += Math.abs(d); maxStep = Math.max(maxStep, Math.abs(d));
      }
      const T = Math.abs(turn);
      if (T > Math.PI * 1.15 && T / absTurn > 0.7 && maxStep < 1.95 && (chord < 0.8 * size || T > Math.PI * 1.6)) return 'O';
    }
  }
  if (chord / len > 0.86) {
    const deg = (Math.abs(Math.atan2(b.y - a.y, b.x - a.x)) * 180) / Math.PI;
    if (deg < 28 || deg > 152) return 'h';
    if (deg > 62 && deg < 118) return 'v';
    return null;
  }
  // Bliksemschicht: vereenvoudig de lijn tot zijn hoofdpunten. Een bliksem heeft drie stukken die
  // om en om naar links en rechts gaan, terwijl de lijn de hele tijd dezelfde kant op omlaag (of omhoog)
  // blijft gaan. Een V of dakje heeft er twee en keert halverwege om.
  if (bh > 0.45 * size) {
    const key = simplify(pts, size * 0.07);
    if (key.length >= 4 && key.length <= 5) {
      const down = b.y > a.y;
      let ext = a.y, back = 0, flips = 0, lastSx = 0;
      for (const p of key) { ext = down ? Math.max(ext, p.y) : Math.min(ext, p.y); back = Math.max(back, Math.abs(p.y - ext)); }
      for (let i = 1; i < key.length; i++) {
        const dx = key[i].x - key[i - 1].x;
        if (Math.abs(dx) < size * 0.08) continue;
        const sx = Math.sign(dx);
        if (lastSx && sx !== lastSx) flips++;
        lastSx = sx;
      }
      if (flips >= 2 && Math.abs(b.y - a.y) > 0.6 * bh && back < 0.22 * bh) return 'Z';
    }
  }
  if (bw > 0.3 * size && bh > 0.3 * size) {
    let iMax = 0, iMin = 0;
    pts.forEach((p, i) => { if (p.y > pts[iMax].y) iMax = i; if (p.y < pts[iMin].y) iMin = i; });
    const n = pts.length - 1, tMax = iMax / n, tMin = iMin / n;
    if (tMax > 0.18 && tMax < 0.82 && a.y < maxY - 0.5 * bh && b.y < maxY - 0.5 * bh) return 'V';
    if (tMin > 0.18 && tMin < 0.82 && a.y > minY + 0.5 * bh && b.y > minY + 0.5 * bh) return 'A';
  }
  return null;
}

/* Een Dementor: gescheurde mantel, lege kap, benige handen */
function drawDementor(g, d, t) {
  const S = d.size, k = d.dying ? clamp(1 - d.dying) : 1;
  const sway = Math.sin(t * 1.1 + d.phase) * 0.07;
  g.save(); g.translate(d.x, d.y); g.rotate(sway); g.globalAlpha = k;

  // Kille aura en een sleep van zwarte nevel
  const aura = g.createRadialGradient(0, 0, S * 0.2, 0, 0, S * 1.8);
  aura.addColorStop(0, 'rgba(110,140,210,.16)'); aura.addColorStop(1, 'rgba(110,140,210,0)');
  g.fillStyle = aura; g.fillRect(-S * 1.8, -S * 1.8, S * 3.6, S * 3.6);
  for (let i = 0; i < 5; i++) {
    const yy = -S * (1.0 + i * 0.5), xx = Math.sin(t * 1.4 + d.phase + i * 1.3) * S * 0.3, r = S * (0.8 - i * 0.11);
    const mg = g.createRadialGradient(xx, yy, 0, xx, yy, r);
    mg.addColorStop(0, `rgba(8,9,15,${0.5 - i * 0.08})`); mg.addColorStop(1, 'rgba(8,9,15,0)');
    g.fillStyle = mg; g.fillRect(xx - r, yy - r, r * 2, r * 2);
  }

  // Rafelige slierten mantel
  const rags = 13;
  for (let i = 0; i < rags; i++) {
    const u = i / (rags - 1) - 0.5, seed = d.seeds[i];
    const x0 = u * S * 0.85, y0 = -S * 0.42 + Math.abs(u) * S * 0.3;
    const len = S * (1.15 + seed * 0.75), w = S * (0.13 + seed * 0.07);
    const gr = g.createLinearGradient(0, y0, 0, y0 + len);
    gr.addColorStop(0, 'rgba(5,6,10,.97)'); gr.addColorStop(0.55, 'rgba(12,14,22,.8)'); gr.addColorStop(1, 'rgba(24,28,42,0)');
    g.fillStyle = gr;
    g.beginPath();
    const segs = 7;
    const X = (f, sgn) => x0 + u * S * 0.7 * f + Math.sin(t * 3 + d.phase + i * 1.7 - f * 3) * S * 0.14 * f + sgn * w * (1 - f) * 0.5;
    for (let s = 0; s <= segs; s++) { const f = s / segs, x = X(f, -1), y = y0 + f * len; s ? g.lineTo(x, y) : g.moveTo(x, y); }
    for (let s = segs; s >= 0; s--) { const f = s / segs; g.lineTo(X(f, 1), y0 + f * len); }
    g.closePath(); g.fill();
  }

  // Lichaam
  g.fillStyle = 'rgba(4,5,9,.96)';
  g.beginPath(); g.ellipse(0, -S * 0.2, S * 0.36, S * 0.5, 0, 0, TAU); g.fill();

  // Armen die naar het licht reiken, met benige vingers
  for (const side of [-1, 1]) {
    const reach = 0.5 + 0.5 * Math.sin(t * 1.6 + d.phase + side);
    const sx = side * S * 0.3, sy = -S * 0.32;
    const hx = side * S * (0.62 + reach * 0.12), hy = S * (0.12 + reach * 0.15);
    g.strokeStyle = 'rgba(6,7,12,.95)'; g.lineCap = 'round'; g.lineWidth = S * 0.16;
    g.beginPath(); g.moveTo(sx, sy); g.quadraticCurveTo(side * S * 0.62, -S * 0.2, hx, hy - S * 0.08); g.stroke();
    g.lineWidth = S * 0.08; g.strokeStyle = 'rgba(14,16,26,.8)';
    g.beginPath(); g.moveTo(hx - side * S * 0.05, hy - S * 0.12); g.lineTo(hx + side * S * 0.06, hy + S * 0.02); g.stroke();
    g.strokeStyle = 'rgba(150,158,150,.85)'; g.lineWidth = Math.max(1, S * 0.022);
    for (let f = 0; f < 4; f++) {
      const curl = 0.25 + 0.25 * Math.sin(t * 2.2 + d.phase + f);
      let x = hx, y = hy, ang = Math.PI / 2 + side * (-0.55 + f * 0.32);
      g.beginPath(); g.moveTo(x, y);
      for (let j = 0; j < 3; j++) { const l = S * (0.11 - j * 0.022); x += Math.cos(ang) * l; y += Math.sin(ang) * l; g.lineTo(x, y); ang -= side * curl; }
      g.stroke();
    }
  }

  // De kap: leeg, op een zwart gat na
  const hood = new Path2D();
  hood.moveTo(-S * 0.34, -S * 0.22);
  hood.bezierCurveTo(-S * 0.42, -S * 0.78, -S * 0.12, -S * 1.06, S * 0.06, -S * 1.12);
  hood.bezierCurveTo(S * 0.22, -S * 0.96, S * 0.42, -S * 0.72, S * 0.34, -S * 0.22);
  hood.quadraticCurveTo(0, -S * 0.08, -S * 0.34, -S * 0.22);
  const hg = g.createLinearGradient(-S * 0.4, -S, S * 0.4, -S * 0.2);
  hg.addColorStop(0, 'rgba(38,44,62,.95)'); hg.addColorStop(0.5, 'rgba(10,11,18,.98)'); hg.addColorStop(1, 'rgba(4,5,8,1)');
  g.fillStyle = hg; g.fill(hood);
  g.strokeStyle = 'rgba(140,165,230,.25)'; g.lineWidth = 1.2; g.stroke(hood);
  const vg = g.createRadialGradient(0, -S * 0.55, 0, 0, -S * 0.55, S * 0.24);
  vg.addColorStop(0, '#000'); vg.addColorStop(0.75, 'rgba(0,0,0,.95)'); vg.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = vg; g.beginPath(); g.ellipse(0, -S * 0.55, S * 0.2, S * 0.26, 0, 0, TAU); g.fill();

  if (d.hit > 0) {
    g.globalCompositeOperation = 'lighter';
    const fl = g.createRadialGradient(0, -S * 0.4, 0, 0, -S * 0.4, S * 1.2);
    fl.addColorStop(0, `rgba(235,242,255,${d.hit * 0.6})`); fl.addColorStop(1, 'rgba(235,242,255,0)');
    g.fillStyle = fl; g.fillRect(-S * 1.2, -S * 1.6, S * 2.4, S * 2.4);
    g.globalCompositeOperation = 'source-over';
  }
  g.restore();

  if (!d.dying && d.syms.length) {
    const gs = 22, gap = 9, total = d.syms.length * gs + (d.syms.length - 1) * gap;
    let x = d.x - total / 2 + gs / 2;
    const y = d.y - S * 1.42;
    g.fillStyle = 'rgba(5,6,12,.6)';
    g.beginPath(); g.roundRect ? g.roundRect(x - gs / 2 - 8, y - gs / 2 - 7, total + 16, gs + 14, 10) : g.rect(x - gs / 2 - 8, y - gs / 2 - 7, total + 16, gs + 14); g.fill();
    d.syms.forEach((sym, i) => { drawGlyph(g, sym, x, y, gs, i === 0); x += gs + gap; });
  }
}

/* IJsbloemen die van de randen naar binnen kruipen */
function buildFrost() {
  const [c, g] = makeLayer();
  g.lineCap = 'round';
  const branch = (x, y, ang, len, w, depth) => {
    if (depth <= 0 || len < 3) return;
    const x2 = x + Math.cos(ang) * len, y2 = y + Math.sin(ang) * len;
    g.strokeStyle = `rgba(225,238,255,${0.12 + depth * 0.08})`; g.lineWidth = w;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x2, y2); g.stroke();
    const n = 2 + (Math.random() < 0.4 ? 1 : 0);
    for (let i = 0; i < n; i++) branch(x + (x2 - x) * rand(0.3, 1), y + (y2 - y) * rand(0.3, 1), ang + rand(-0.9, 0.9), len * rand(0.45, 0.7), w * 0.7, depth - 1);
  };
  for (let i = 0; i < 46; i++) {
    const side = i % 4;
    let x, y, ang;
    if (side === 0) { x = rand(W); y = 0; ang = Math.PI / 2; }
    else if (side === 1) { x = W; y = rand(H); ang = Math.PI; }
    else if (side === 2) { x = rand(W); y = H; ang = -Math.PI / 2; }
    else { x = 0; y = rand(H); ang = 0; }
    branch(x, y, ang + rand(-0.6, 0.6), rand(30, 80), 1.6, 4);
  }
  const vg = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.32, W / 2, H / 2, Math.max(W, H) * 0.72);
  vg.addColorStop(0, 'rgba(160,195,255,0)'); vg.addColorStop(1, 'rgba(160,195,255,.42)');
  g.fillStyle = vg; g.fillRect(0, 0, W, H);
  return c;
}

/* De vormloze Patronus: een zilveren nevel die uit de toverstok stroomt */
const SILVER = ['235,242,255', '220,232,255', '200,220,255', '255,255,255'];
function drawMist(g, a, b, prog, life, t, seed) {
  const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1, nx = -dy / L, ny = dx / L;
  const at = (k) => { const w = Math.sin(k * 9 - t * 12 + seed) * 7 * k; return [a.x + dx * k + nx * w, a.y + dy * k + ny * w]; };
  g.save(); g.globalCompositeOperation = 'lighter';
  const n = 24;
  for (let i = 0; i <= n; i++) {
    const k = (i / n) * prog, [x, y] = at(k), r = 12 + k * 48;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, `rgba(235,242,255,${0.24 * life})`); gr.addColorStop(0.5, `rgba(215,228,255,${0.1 * life})`); gr.addColorStop(1, 'rgba(200,220,255,0)');
    g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  if (prog >= 1) {
    // de nevel slaat als een schild open voor de Dementor
    const [x, y] = at(1), r = 64 * (1.4 - life * 0.4);
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, `rgba(240,246,255,${0.5 * life})`); gr.addColorStop(1, 'rgba(200,220,255,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
  }
  g.restore();
}

/* De lijfelijke Patronus: een zilveren hinde in galop. Ze wordt eerst op een eigen canvas getekend
   (zodat overlappende delen niet extra oplichten) en daarna met een gloed over het spel gelegd. */
const doeCanvas = document.createElement('canvas'), doeCtx = doeCanvas.getContext('2d');
let doeBox = null;
function renderDoe(S, ph) {
  const cw = Math.ceil(S * 1.7), ch = Math.ceil(S * 1.6), ox = S * 0.75, oy = S * 0.85;
  const pw = Math.ceil(cw * DPR), phh = Math.ceil(ch * DPR);
  if (doeCanvas.width !== pw || doeCanvas.height !== phh) { doeCanvas.width = pw; doeCanvas.height = phh; }
  const g = doeCtx;
  g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'source-over'; g.clearRect(0, 0, pw, phh);
  g.setTransform(DPR * S, 0, 0, DPR * S, DPR * ox, DPR * oy);
  g.translate(0, Math.sin(ph * 2) * 0.035); g.rotate(Math.sin(ph * 2 + 0.8) * 0.06);

  const body = new Path2D();
  body.moveTo(-0.40, -0.10);
  body.bezierCurveTo(-0.26, -0.19, 0.04, -0.15, 0.2, -0.15);
  body.bezierCurveTo(0.29, -0.17, 0.35, -0.31, 0.41, -0.43);
  body.quadraticCurveTo(0.33, -0.55, 0.33, -0.63);
  body.quadraticCurveTo(0.42, -0.57, 0.45, -0.48);
  body.quadraticCurveTo(0.43, -0.6, 0.45, -0.66);
  body.quadraticCurveTo(0.51, -0.58, 0.5, -0.48);
  body.bezierCurveTo(0.56, -0.47, 0.63, -0.43, 0.7, -0.37);
  body.quadraticCurveTo(0.72, -0.34, 0.69, -0.33);
  body.bezierCurveTo(0.64, -0.32, 0.57, -0.33, 0.52, -0.34);
  body.bezierCurveTo(0.46, -0.26, 0.41, -0.11, 0.37, -0.01);
  body.bezierCurveTo(0.36, 0.07, 0.3, 0.11, 0.22, 0.11);
  body.bezierCurveTo(0.05, 0.14, -0.15, 0.13, -0.27, 0.1);
  body.bezierCurveTo(-0.39, 0.09, -0.46, 0.02, -0.44, -0.05);
  body.quadraticCurveTo(-0.5, -0.12, -0.47, -0.15);
  body.quadraticCurveTo(-0.43, -0.12, -0.40, -0.10);
  body.closePath();

  // taps toelopende poten met ronde gewrichten en hoefjes
  g.fillStyle = 'rgb(132,160,222)';
  const limb = (ax, ay, bx, by, wa, wb) => {
    const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1, nx = -dy / L, ny = dx / L;
    g.beginPath();
    g.moveTo(ax + nx * wa / 2, ay + ny * wa / 2); g.lineTo(bx + nx * wb / 2, by + ny * wb / 2);
    g.lineTo(bx - nx * wb / 2, by - ny * wb / 2); g.lineTo(ax - nx * wa / 2, ay - ny * wa / 2); g.closePath(); g.fill();
    g.beginPath(); g.arc(bx, by, wb / 2, 0, TAU); g.fill();
  };
  const leg = (hx, hy, l1, l2, a1, a2, w) => {
    const kx = hx + Math.sin(a1) * l1, ky = hy + Math.cos(a1) * l1;
    const fx = kx + Math.sin(a1 + a2) * l2, fy = ky + Math.cos(a1 + a2) * l2;
    limb(hx, hy, kx, ky, w, w * 0.5); limb(kx, ky, fx, fy, w * 0.5, w * 0.32);
  };
  for (const off of [0.45, 0]) {
    const f = ph + off, b = ph + Math.PI + off;
    leg(0.24, 0.02, 0.24, 0.23, 0.65 * Math.sin(f), -1.1 * Math.max(0, Math.sin(f - 1.2)), 0.085);
    leg(-0.3, 0.0, 0.23, 0.27, 0.55 * Math.sin(b) - 0.1, 0.9 * Math.max(0, Math.sin(b + 1.2)) + 0.15, 0.11);
  }
  g.fill(body);

  // licht van binnenuit: een kern, schouder, heup en kop
  g.globalCompositeOperation = 'source-atop';
  const glow = (x, y, r, a) => {
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, `rgba(255,255,255,${a})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
  };
  glow(0.02, -0.06, 0.5, 0.22); glow(0.24, -0.05, 0.17, 0.32); glow(-0.27, -0.05, 0.17, 0.28); glow(0.52, -0.43, 0.15, 0.38);
  glow(0.24, 0.2, 0.2, 0.18); glow(-0.3, 0.2, 0.2, 0.15);
  // stromende zilveren draden door het lichaam
  g.lineCap = 'round'; g.setLineDash([0.09, 0.07]);
  g.lineDashOffset = -ph * 0.06;
  g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 0.014;
  for (const [y0, y1, y2] of [[-0.1, -0.12, -0.08], [0.0, 0.03, 0.02], [0.07, 0.09, 0.06]]) {
    g.beginPath(); g.moveTo(-0.42, y0); g.bezierCurveTo(-0.1, y1, 0.15, y2, 0.36, y0 - 0.04); g.stroke();
  }
  g.beginPath(); g.moveTo(0.26, -0.12); g.bezierCurveTo(0.36, -0.26, 0.42, -0.36, 0.6, -0.4); g.stroke();
  g.setLineDash([]);
  // een heldere rand rond de vorm
  g.globalCompositeOperation = 'source-over';
  g.strokeStyle = 'rgba(235,245,255,.85)'; g.lineWidth = 0.01; g.stroke(body);
  return (doeBox = { cw, ch, ox, oy });
}
function drawDoe(g, x, y, S, face, ph, alpha, reuse) {
  const m = reuse && doeBox ? doeBox : renderDoe(S, ph);
  g.save(); g.translate(x, y); g.scale(face, 1);
  g.globalCompositeOperation = 'lighter';
  g.globalAlpha = clamp(alpha * 0.85);
  if (!reuse) { g.shadowColor = 'rgba(150,180,255,.8)'; g.shadowBlur = 20; }
  g.drawImage(doeCanvas, -m.ox, -m.oy, m.cw, m.ch);
  g.restore();
}

function catmull(pts, u) {
  const n = pts.length - 1, f = clamp(u) * n, i = Math.min(n - 1, Math.floor(f)), k = f - i;
  const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(n, i + 2)];
  const c = (a, b, c2, d) => 0.5 * (2 * b + (-a + c2) * k + (2 * a - 5 * b + 4 * c2 - d) * k * k + (-a + 3 * b - 3 * c2 + d) * k * k * k);
  return { x: c(p0.x, p1.x, p2.x, p3.x), y: c(p0.y, p1.y, p2.y, p3.y) };
}

/* Een Dooddoener: lange zwarte mantel met puntkap, zilveren masker, de toverstok op jou gericht */
function drawDeathEater(g, e, t, aimAt) {
  const S = e.S, vis = e.vis;
  if (vis <= 0.01) return;
  g.save(); g.translate(e.x, e.y + Math.sin(t * 1.3 + e.phase) * 3);
  // zwarte rook waarin hij verschijnt en verdwijnt
  const smoke = Math.max(e.smoke, 0.25);
  for (let i = 0; i < 7; i++) {
    const ang = i * 0.9 + t * 0.6 + e.phase, rr = S * (0.35 + 0.25 * Math.sin(t * 1.7 + i));
    const x = Math.cos(ang) * rr, y = S * 0.35 + Math.sin(ang) * rr * 0.6, r = S * (0.45 + 0.15 * Math.sin(t + i));
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, `rgba(4,4,8,${0.55 * smoke})`); gr.addColorStop(1, 'rgba(4,4,8,0)');
    g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  g.globalAlpha = vis;
  // mantel
  const robe = new Path2D();
  robe.moveTo(0, -S * 0.82);
  robe.bezierCurveTo(S * 0.12, -S * 0.7, S * 0.2, -S * 0.5, S * 0.3, -S * 0.36);
  robe.bezierCurveTo(S * 0.38, -S * 0.1, S * 0.4, S * 0.4, S * 0.46, S * 0.78);
  for (let i = 0; i <= 8; i++) { const u = i / 8; robe.lineTo(S * (0.46 - u * 0.92), S * (0.78 + (i % 2 ? -0.08 : 0.02) + Math.sin(t * 3 + i + e.phase) * 0.03)); }
  robe.bezierCurveTo(-S * 0.4, S * 0.4, -S * 0.38, -S * 0.1, -S * 0.3, -S * 0.36);
  robe.bezierCurveTo(-S * 0.2, -S * 0.5, -S * 0.12, -S * 0.7, 0, -S * 0.82);
  const rg = g.createLinearGradient(-S * 0.4, 0, S * 0.4, 0);
  rg.addColorStop(0, '#050508'); rg.addColorStop(0.45, '#15151d'); rg.addColorStop(1, '#060609');
  g.fillStyle = rg; g.fill(robe);
  g.strokeStyle = 'rgba(120,130,170,.18)'; g.lineWidth = 1; g.stroke(robe);
  // de kap en het zilveren masker
  g.fillStyle = '#020203'; g.beginPath(); g.ellipse(0, -S * 0.46, S * 0.15, S * 0.2, 0, 0, TAU); g.fill();
  const mg = g.createLinearGradient(-S * 0.12, -S * 0.6, S * 0.12, -S * 0.32);
  mg.addColorStop(0, '#f2f4f8'); mg.addColorStop(0.5, '#a9afbd'); mg.addColorStop(1, '#5c6170');
  g.fillStyle = mg; g.beginPath(); g.ellipse(0, -S * 0.46, S * 0.115, S * 0.16, 0, 0, TAU); g.fill();
  g.fillStyle = '#05050a';
  for (const sx of [-1, 1]) { g.beginPath(); g.ellipse(sx * S * 0.048, -S * 0.5, S * 0.034, S * 0.022, sx * 0.35, 0, TAU); g.fill(); }
  g.beginPath(); g.moveTo(0, -S * 0.46); g.lineTo(-S * 0.018, -S * 0.42); g.lineTo(S * 0.018, -S * 0.42); g.fill();
  g.strokeStyle = 'rgba(40,44,58,.7)'; g.lineWidth = 0.8;
  g.beginPath(); g.moveTo(-S * 0.09, -S * 0.56); g.quadraticCurveTo(0, -S * 0.62, S * 0.09, -S * 0.56); g.stroke();
  g.beginPath(); g.moveTo(-S * 0.07, -S * 0.37); g.quadraticCurveTo(0, -S * 0.34, S * 0.07, -S * 0.37); g.stroke();
  // arm met toverstok, gericht op jouw toverstok
  const hand = { x: e.side * S * 0.05, y: -S * 0.1 }, ang = Math.atan2(aimAt.y - (e.y + hand.y), aimAt.x - (e.x + hand.x));
  g.strokeStyle = '#08080c'; g.lineWidth = S * 0.12; g.lineCap = 'round';
  g.beginPath(); g.moveTo(e.side * S * 0.22, -S * 0.3); g.quadraticCurveTo(e.side * S * 0.1, -S * 0.15, hand.x, hand.y); g.stroke();
  g.fillStyle = '#c9c3b8'; g.beginPath(); g.arc(hand.x, hand.y, S * 0.045, 0, TAU); g.fill();
  g.restore();
  if (!e.disarmed) {
    const hx = e.x + hand.x, hy = e.y + hand.y + Math.sin(t * 1.3 + e.phase) * 3;
    e.tip = { x: hx + Math.cos(ang) * S * 0.5, y: hy + Math.sin(ang) * S * 0.5 };
    drawWand(g, e.tip, { x: hx - Math.cos(ang) * S * 0.08, y: hy - Math.sin(ang) * S * 0.08 }, S * 0.05, '255,60,45', e.glow, vis);
  }
}

/* Een chocoladekikker die over het scherm springt */
function drawFrog(g, f, t) {
  const u = f.u, air = f.air;
  g.save(); g.translate(f.x, f.y); g.scale(f.dir * u, u);
  const gl = g.createRadialGradient(0, 0, 0, 0, 0, 40);
  gl.addColorStop(0, 'rgba(255,200,120,.22)'); gl.addColorStop(1, 'rgba(255,200,120,0)');
  g.fillStyle = gl; g.fillRect(-40, -40, 80, 80);
  const choc = g.createLinearGradient(0, -14, 0, 12);
  choc.addColorStop(0, '#8a5530'); choc.addColorStop(1, '#3d2112');
  g.fillStyle = choc;
  // achterpoten: gestrekt in de lucht, gevouwen op de grond
  g.beginPath();
  if (air) { g.ellipse(-16, 8, 14, 4, 0.5, 0, TAU); g.ellipse(-24, 15, 9, 3, 0.2, 0, TAU); }
  else { g.ellipse(-10, 6, 11, 7, 0, 0, TAU); }
  g.fill();
  g.beginPath(); g.ellipse(0, 0, 17, 11, 0, 0, TAU); g.fill();                 // lijf
  g.beginPath(); g.ellipse(13, -4, 9, 7, 0, 0, TAU); g.fill();                 // kop
  g.beginPath(); g.ellipse(8, 9, 3, 6, air ? -0.6 : 0.3, 0, TAU); g.fill();   // voorpootje
  for (const ex of [9, 17]) {                                                    // ogen
    g.fillStyle = '#6b3f22'; g.beginPath(); g.arc(ex, -10, 4, 0, TAU); g.fill();
    g.fillStyle = '#f6e7cf'; g.beginPath(); g.arc(ex + 0.8, -10.6, 1.4, 0, TAU); g.fill();
  }
  g.strokeStyle = 'rgba(255,220,180,.35)'; g.lineWidth = 1.5;                   // glans
  g.beginPath(); g.ellipse(-2, -4, 10, 4, -0.15, Math.PI * 1.1, Math.PI * 1.8); g.stroke();
  g.restore();
}

Scenes.game = {
  enter() {
    this.state = 'intro'; this.reset();
    this.best = +store.get('best') || 0;
    $('#g-best').textContent = this.best;
    $('#g-intro').hidden = false; $('#g-over').hidden = true; $('#g-hud').hidden = true;
    this.layout();
    Sound.setMood('calm');
  },
  reset() {
    Object.assign(this, {
      score: 0, warmth: 3, charge: 0, time: 0, spawnT: 0.4, shades: [], beams: [], stroke: null, fade: [], waves: [],
      banished: 0, cold: 0, chargedSaid: false, doe: null, aim: 0, aimT: 0,
      eaters: [], bolts: [], zaps: [], flying: [], eaterT: 38, frog: null, frogT: 26,
      press: null, shield: 0, shieldOn: false, shieldHit: 0, stun: 0,
    });
  },
  exit() { this.state = 'off'; },
  resize() { this.layout(); },
  layout() {
    this.unit = Math.min(W, H) / 400;
    const L = Math.min(W, H) * 0.5;
    this.wand = { px: W * 0.62, py: H + L * 0.08, L, w: Math.min(W, H) * 0.045 };
    this.frost = buildFrost();
  },
  /* Waar de punt van de toverstok nu is; hij draait mee naar wat je raakt */
  tip() {
    const w = this.wand, a = -Math.PI / 2 - 0.3 + this.aim;
    return { x: w.px + Math.cos(a) * w.L, y: w.py + Math.sin(a) * w.L, a };
  },
  aimAt(p) {
    const w = this.wand, a = Math.atan2(p.y - w.py, p.x - w.px) + Math.PI / 2 + 0.3;
    this.aim = clamp(a, -0.6, 0.75); this.aimT = 0.5;
  },
  start() {
    this.reset(); this.state = 'play';
    $('#g-intro').hidden = true; $('#g-over').hidden = true; $('#g-hud').hidden = false;
    $('#g-score').textContent = 0; $('#g-best').textContent = this.best;
    this.showWarmth();
    Sound.setMood('tense'); Sound.chord([659.26, 987.77, 1318.51], 0.06, 0.06); vib(30);
  },
  showWarmth() {
    $$('#g-flames i').forEach((f, i) => {
      const k = clamp(this.warmth - i);
      f.classList.toggle('out', k <= 0.02);
      f.style.opacity = k > 0.02 ? 0.35 + 0.65 * k : '';
    });
  },
  loseWarmth(n) {
    this.warmth = Math.max(0, this.warmth - n);
    this.showWarmth();
    if (this.warmth <= 0 && this.state === 'play') this.over();
  },
  /* Steeds moeilijker, zonder plafond */
  spawn() {
    const T = this.time;
    const maxSyms = T < 15 ? 1 : T < 35 ? 2 : T < 60 ? 3 : T < 110 ? 4 : 5;
    const n = 1 + Math.floor(Math.pow(Math.random(), 1.4) * maxSyms);
    const pool = T < 20 ? GLYPHS.filter((g) => g !== 'Z') : GLYPHS;
    const syms = this.banished < 3 && T < 12 ? [['h', 'v', 'O'][this.shades.length % 3]] : Array.from({ length: n }, () => pick(pool));
    const u = this.unit, size = (44 + n * 5) * u;
    const speed = (40 + Math.min(T, 150) * 0.42 + Math.max(0, T - 150) * 0.15) * u * (n >= 3 ? 0.8 : 1);
    this.shades.push({
      x: rand(W * 0.2, W * 0.8), y: -size * 0.3, size, vy: speed, syms, phase: rand(10), drift: rand(TAU),
      hit: 0, dying: 0, breathed: false, seeds: Array.from({ length: 13 }, () => Math.random()),
    });
  },
  /* Een teken raakt hooguit twee Dementors: de laagste, dus de gevaarlijkste, eerst */
  cast(sym) {
    const targets = this.shades.filter((s) => !s.dying && s.syms[0] === sym && s.y > -s.size).sort((a, b) => b.y - a.y).slice(0, 2);
    if (!targets.length) { Sound.whoosh(0.3, 800, 300, 0.05); return false; }
    this.aimAt(targets[0]);
    const tip = this.tip();
    let killed = 0;
    for (const s of targets) {
      s.syms.shift(); s.hit = 1; this.score += 10;
      this.beams.push({ a: { x: tip.x, y: tip.y }, x: s.x, y: s.y - s.size * 0.3, life: 1, prog: 0, seed: rand(TAU) });
      if (!s.syms.length) { this.banish(s); killed++; }
    }
    if (killed > 1) { this.score += 25; this.toast('2× tegelijk!'); }
    Sound.whoosh(0.45, 900, 2600, 0.07);
    Sound.chord([987.77, 1318.51].map((f) => f * (1 + targets.length * 0.06)), 0.04, 0.05);
    vib(18);
    $('#g-score').textContent = this.score;
    return true;
  },
  banish(s) {
    s.dying = 0.001; s.vy = -520 * this.unit; this.banished++;
    this.score += 25;
    if (!this.doe) this.charge = Math.min(1, this.charge + 0.075);
    FX.burst(s.x, s.y - s.size * 0.3, 55, SILVER);
    Sound.bell(pick([1318.51, 1567.98, 1975.5]), 0.05, 1.6, 0.05);
    if (this.charge >= 1 && !this.chargedSaid) { this.chargedSaid = true; this.toast('Tik op je toverstok!'); Sound.chord([659.26, 830.6, 987.77, 1318.51], 0.05, 0.05); }
  },
  /* Expecto Patronum: een zilveren hinde springt uit de toverstok en galoppeert door de Dementors.
     Tegen Dooddoeners helpt een Patronus niet: daar rent ze dwars doorheen. */
  patronus() {
    this.charge = 0; this.chargedSaid = false; this.aim = 0;
    const tip = this.tip();
    FX.flash = 0.6; FX.flashRGB = '230,240,255';
    FX.burst(tip.x, tip.y, 120, SILVER);
    this.waves.push({ x: tip.x, y: tip.y, r: 0, life: 1 });
    this.fade.push({ text: 'Expecto Patronum!', life: 2.2, y: H * 0.4, big: true });
    Sound.chord([329.63, 493.88, 659.26, 987.77, 1318.51, 1975.5], 0.05, 0.09); Sound.whoosh(2.2, 300, 2400, 0.1);
    vib([40, 30, 80, 30, 120]);
    const left = this.shades.filter((s) => !s.dying && s.x < W / 2).length >= this.shades.filter((s) => !s.dying && s.x >= W / 2).length;
    const sx = left ? 1 : -1, m = (v) => (sx > 0 ? v : W - v);
    this.doe = {
      t: 0, dur: 3.2, last: { ...tip },
      path: [{ x: tip.x, y: tip.y }, { x: m(W * 0.18), y: H * 0.6 }, { x: m(W * 0.85), y: H * 0.42 }, { x: m(W * 0.18), y: H * 0.24 }, { x: m(W * 0.7), y: H * 0.06 }, { x: m(W * 1.1), y: -H * 0.2 }],
    };
  },
  /* Dooddoeners verschijnen in zwarte rook, richten, en schieten een Paralyseer-spreuk */
  spawnEater() {
    const u = this.unit, side = Math.random() < 0.5 ? -1 : 1;
    this.eaters.push({
      x: side < 0 ? rand(W * 0.14, W * 0.36) : rand(W * 0.64, W * 0.86), y: rand(H * 0.16, H * 0.42), S: 74 * u,
      side: -side, phase: rand(10), state: 'appear', t: 0, vis: 0, smoke: 1, glow: 0, disarmed: false, tip: null,
      aimDur: Math.max(0.9, 1.9 - (this.time - 38) * 0.006),
    });
    Sound.whoosh(0.6, 200, 900, 0.1); Sound.thud(0.15);
  },
  expelliarmus(e) {
    const tip = this.tip();
    this.aimAt(e);
    this.zaps.push({ a: { x: tip.x, y: tip.y }, b: { ...(e.tip || e) }, life: 1 });
    if (e.tip) this.flying.push({ x: e.tip.x, y: e.tip.y, vx: rand(-90, 90) * this.unit, vy: -260 * this.unit, rot: 0, vr: rand(-12, 12), life: 1.4, S: e.S });
    e.disarmed = true; e.state = 'leave'; e.t = 0; e.glow = 0;
    this.score += 50; $('#g-score').textContent = this.score;
    this.fade.push({ text: 'Expelliarmus!', life: 1.2, y: H * 0.36 });
    FX.burst(e.tip ? e.tip.x : e.x, e.tip ? e.tip.y : e.y, 40, ['255,90,70', '255,200,170', '255,255,255']);
    Sound.zap(0.14); Sound.whoosh(0.4, 600, 2600, 0.08); vib([20, 20, 40]);
  },
  eatFrog() {
    const f = this.frog; this.frog = null;
    this.warmth = Math.min(3, this.warmth + 1); this.showWarmth();
    this.fade.push({ text: 'Chocolade! Je warmt weer op', life: 1.5, y: H * 0.5 });
    FX.burst(f.x, f.y, 45, ['255,214,140', '200,140,80', '255,240,210']);
    Sound.chord([659.26, 830.6, 987.77], 0.06, 0.06); vib(25);
  },
  over() {
    this.state = 'over'; this.stroke = null; this.doe = null; this.press = null; this.shieldOn = false;
    const s = this.score, record = s > this.best;
    if (record) { this.best = s; store.set('best', String(s)); }
    $('#g-final').textContent = s;
    $('#g-verdict').textContent =
      s >= 6000 ? 'Een Patronus om op te schrijven' :
      s >= 3000 ? 'De Dementors durven je niet meer te naderen' :
      s >= 1200 ? 'Een vaste hand en een warm hart' :
                  'De Dementors waren je nu nog te snel af';
    $('#g-bestline').textContent = record && s > 0 ? 'Nieuw record!' : `Je record: ${this.best}`;
    $('#g-over').hidden = false; $('#g-hud').hidden = true;
    Sound.setMood('calm');
    setTimeout(() => Sound.chord([493.88, 587.33, 739.99, 987.77], 0.16, 0.06), 300);
  },
  toast(text) { this.fade.push({ text, life: 1.6, y: H * 0.42 }); },
  /* Invoer: tekenen = spreuk, stil vasthouden = Protego, tikken op een Dooddoener = Expelliarmus,
     tikken op de kikker = chocolade, tikken op je opgeladen toverstok = Patronus */
  down(p) {
    if (this.state !== 'play' || this.stun > 0) return;
    this.press = { x: p.x, y: p.y, t: this.time, moved: false };
    this.stroke = [p];
  },
  move(p) {
    if (!this.press) return;
    if (!this.press.moved && dist(p, this.press) > 12) this.press.moved = true;
    if (this.shieldOn || !this.stroke) return;
    if (dist(p, this.stroke[this.stroke.length - 1]) > 3) { this.stroke.push(p); FX.emit(p.x, p.y, 2, 0.6, SILVER); }
  },
  up() {
    this.press = null;
    if (this.shieldOn) { this.shieldOn = false; this.stroke = null; return; }
    if (!this.stroke) return;
    const pts = this.stroke; this.stroke = null;
    let len = 0; for (let i = 1; i < pts.length; i++) len += dist(pts[i], pts[i - 1]);
    if (len < 28) {
      const p = pts[0], u = this.unit;
      if (this.frog && dist(p, this.frog) < 44 * u) return this.eatFrog();
      const e = this.eaters.find((e) => !e.disarmed && e.vis > 0.3 && (dist(p, { x: e.x, y: e.y - e.S * 0.2 }) < e.S * 0.7 || (e.tip && dist(p, e.tip) < 36 * u)));
      if (e) return this.expelliarmus(e);
      const tip = this.tip(), w = this.wand;
      const onWand = dist(p, tip) < 70 * u || (p.y > tip.y - 20 && Math.abs(p.x - lerp(tip.x, w.px, (p.y - tip.y) / (w.py - tip.y))) < 40 * u);
      if (onWand && this.charge >= 1 && !this.doe) this.patronus();
      return;
    }
    this.fade.push({ pts, life: 0.5 });
    const sym = recognize(pts);
    if (sym) { if (this.cast(sym)) this.fade.push({ sym, life: 0.8 }); }
    else Sound.whoosh(0.25, 600, 250, 0.04);
  },
  update(dt) {
    for (const w of this.waves) { w.r += dt * 900 * this.unit; w.life -= dt * 0.9; }
    this.waves = this.waves.filter((w) => w.life > 0);
    this.aimT -= dt; if (this.aimT <= 0) this.aim = lerp(this.aim, 0, 0.06);
    for (const b of this.beams) { if (b.prog < 1) b.prog = Math.min(1, b.prog + dt / 0.16); else b.life -= dt * 2; }
    this.beams = this.beams.filter((b) => b.life > 0);
    for (const z of this.zaps) z.life -= dt * 2.5;
    this.zaps = this.zaps.filter((z) => z.life > 0);
    for (const f of this.flying) { f.vy += 700 * this.unit * dt; f.x += f.vx * dt; f.y += f.vy * dt; f.rot += f.vr * dt; f.life -= dt; }
    this.flying = this.flying.filter((f) => f.life > 0);
    this.shield = lerp(this.shield, this.shieldOn ? 1 : 0, 0.25);
    this.shieldHit = Math.max(0, this.shieldHit - dt * 3);
    if (this.state !== 'play') { this.cold = lerp(this.cold, 0, 0.05); return; }
    this.time += dt;
    const T = this.time, tip = this.tip();
    this.stun = Math.max(0, this.stun - dt);

    // Protego: vinger stil houden
    if (this.press && !this.press.moved && !this.shieldOn && T - this.press.t > 0.28) {
      this.shieldOn = true; this.stroke = null;
      Sound.whoosh(0.4, 1400, 3000, 0.05); Sound.bell(1567.98, 0, 0.8, 0.025); vib(10);
    }

    // de hinde
    const d = this.doe;
    if (d) {
      d.t += dt;
      const u = d.t / d.dur, p = catmull(d.path, ease(Math.min(1, u)) * 0.85 + Math.min(1, u) * 0.15);
      d.face = p.x >= d.last.x ? 1 : -1; d.last = d.pos || p; d.pos = p;
      if (Math.random() < 0.9) FX.emit(p.x, p.y, 3, 0.9, SILVER);
      const S = Math.min(W, H) * 0.32;
      for (const s of this.shades) if (!s.dying && dist(p, s) < S * 0.55 + s.size * 0.6) { this.score += 10 * s.syms.length; s.syms = []; this.banish(s); }
      if (u >= 1) this.doe = null;
      $('#g-score').textContent = this.score;
    }

    // Dementors
    this.spawnT -= dt;
    if (this.spawnT <= 0) { this.spawn(); this.spawnT = Math.max(0.5, 2.4 / (1 + T / 70)) * rand(0.75, 1.25); }
    let cold = 0, drain = 0;
    const zone = H * 0.22;
    for (let i = this.shades.length - 1; i >= 0; i--) {
      const s = this.shades[i];
      if (s.dying) { s.dying += dt * 1.6; s.y += s.vy * dt; if (s.dying >= 1) this.shades.splice(i, 1); continue; }
      s.y += s.vy * dt * (this.doe ? 0.6 : 1);
      s.x = clamp(s.x + Math.sin(T * 0.9 + s.drift) * 14 * dt, s.size, W - s.size);
      s.hit = Math.max(0, s.hit - dt * 3);
      cold = Math.max(cold, clamp((s.y - H * 0.3) / (tip.y - H * 0.3)));
      // dichtbij zuigen ze al warmte weg
      drain += clamp((s.y - (tip.y - zone)) / zone) * 0.1;
      if (!s.breathed && s.y > H * 0.42) { s.breathed = true; Sound.breath(); }
      if (s.y + s.size * 0.4 > tip.y - 10) {
        s.dying = 0.001; s.vy = 0;
        FX.shake = 0.6; FX.flash = 0.45; FX.flashRGB = '170,200,255';
        Sound.thud(); vib([200, 60, 120]);
        this.loseWarmth(1);
        if (this.state !== 'play') return;
      }
    }
    this.cold = lerp(this.cold, cold, 0.05);
    if (drain > 0) this.loseWarmth(drain * dt);
    if (this.state !== 'play') return;

    // Dooddoeners
    this.eaterT -= dt;
    const maxEaters = T < 120 ? 1 : 2;
    if (this.eaterT <= 0) {
      if (this.eaters.filter((e) => !e.disarmed).length < maxEaters) this.spawnEater();
      this.eaterT = Math.max(5, 14 - (T - 38) * 0.05) * rand(0.8, 1.2);
    }
    for (let i = this.eaters.length - 1; i >= 0; i--) {
      const e = this.eaters[i];
      e.t += dt;
      if (e.state === 'appear') { e.vis = clamp(e.t / 0.6); e.smoke = 1 - e.vis * 0.6; if (e.t > 0.7) { e.state = 'aim'; e.t = 0; } }
      else if (e.state === 'aim') {
        e.glow = clamp(e.t / e.aimDur);
        if (e.t >= e.aimDur && e.tip) {
          this.bolts.push({ x: e.tip.x, y: e.tip.y, from: { ...e.tip }, t: 0, dur: Math.max(0.65, 1.05 - (T - 38) * 0.002) });
          Sound.zap(0.1); Sound.whoosh(0.5, 2600, 500, 0.06);
          e.state = 'cool'; e.t = 0; e.glow = 0.15;
        }
      } else if (e.state === 'cool') { if (e.t > 1.5) { e.state = 'aim'; e.t = 0; } }
      else if (e.state === 'leave') { e.vis = clamp(1 - (e.t - 0.25) / 0.6); e.smoke = 1; if (e.t > 0.9) this.eaters.splice(i, 1); }
    }
    // Paralyseer-spreuken die op je afkomen
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      b.t += dt;
      const k = Math.min(1, b.t / b.dur), kk = k * (0.55 + 0.45 * k);
      b.x = lerp(b.from.x, tip.x, kk); b.y = lerp(b.from.y, tip.y, kk);
      const shieldR = 78 * this.unit;
      if (this.shield > 0.6 && dist(b, tip) < shieldR) {
        // Protego kaatst hem terug
        this.bolts.splice(i, 1); this.shieldHit = 1; this.score += 15; $('#g-score').textContent = this.score;
        FX.burst(b.x, b.y, 35, ['255,120,100', '220,232,255', '255,255,255']);
        Sound.bell(1975.5, 0, 0.6, 0.05); Sound.whoosh(0.3, 3000, 900, 0.06); vib(15);
        continue;
      }
      if (k >= 1) {
        this.bolts.splice(i, 1);
        FX.flash = 0.5; FX.flashRGB = '255,80,60'; FX.shake = 0.8;
        FX.burst(tip.x, tip.y, 40, ['255,90,70', '255,180,150']);
        Sound.thud(0.4); vib([120, 40, 160]);
        this.stun = 1.2; this.stroke = null; this.press = null; this.shieldOn = false;
        this.fade.push({ text: 'Verlamd!', life: 1.2, y: H * 0.5 });
        this.loseWarmth(0.5);
        if (this.state !== 'play') return;
      }
    }

    // de chocoladekikker
    this.frogT -= dt;
    if (!this.frog && this.frogT <= 0) {
      const dir = Math.random() < 0.5 ? 1 : -1;
      this.frog = { dir, x: dir > 0 ? -30 : W + 30, base: rand(H * 0.5, H * 0.66), y: 0, hop: 0, u: this.unit * 1.45, air: false };
      this.frogT = (this.warmth < 3 ? rand(20, 32) : rand(38, 50));
    }
    if (this.frog) {
      const f = this.frog;
      f.hop += dt / 0.7;
      const ph = f.hop % 1;
      f.air = ph < 0.6;
      if (f.air) f.x += f.dir * 120 * this.unit * dt;
      f.y = f.base - (f.air ? Math.sin((ph / 0.6) * Math.PI) * 46 * this.unit : 0);
      if (f.x < -50 || f.x > W + 50) this.frog = null;
    }
  },
  drawBg(g, t) {
    const bgr = g.createLinearGradient(0, 0, 0, H);
    bgr.addColorStop(0, '#04050b'); bgr.addColorStop(1, '#141024');
    g.fillStyle = bgr; g.fillRect(0, 0, W, H);
    Stars.draw(g, t, 0.5);
    // de warmte in je: een gloed onderin die afneemt
    const warm = this.state === 'play' ? clamp(this.warmth / 3 - this.cold * 0.2) : 1;
    const lg = g.createRadialGradient(W / 2, H * 1.05, 0, W / 2, H * 1.05, H * 0.75);
    lg.addColorStop(0, `rgba(255,170,90,${0.32 * warm})`); lg.addColorStop(1, 'rgba(255,170,90,0)');
    g.fillStyle = lg; g.fillRect(0, 0, W, H);
  },
  draw(g, t) {
    const sh = FX.shake > 0.01 ? FX.shake * 10 : 0;
    FX.shake *= 0.9;
    g.save(); if (sh) g.translate(rand(-sh, sh), rand(-sh, sh));
    const tip = this.tip(), w = this.wand;
    for (const s of [...this.shades].sort((a, b) => a.y - b.y)) drawDementor(g, s, t);
    for (const e of this.eaters) drawDeathEater(g, e, t, tip);
    for (const f of this.flying) {
      g.save(); g.translate(f.x, f.y); g.rotate(f.rot); g.globalAlpha = clamp(f.life);
      drawWand(g, { x: f.S * 0.25, y: 0 }, { x: -f.S * 0.25, y: 0 }, f.S * 0.05, '255,60,45', 0, 1);
      g.restore();
    }
    if (this.frog) drawFrog(g, this.frog, t);

    for (const b of this.beams) drawMist(g, b.a, b, b.prog, b.life, t, b.seed);
    for (const z of this.zaps) drawBeam(g, z.a, z.b, '255,70,60', t, z.life, 2);
    for (const b of this.bolts) {
      const dx = b.x - b.from.x, dy = b.y - b.from.y, L = Math.hypot(dx, dy) || 1, tail = Math.min(L, 70 * this.unit);
      drawBeam(g, { x: b.x - (dx / L) * tail, y: b.y - (dy / L) * tail }, b, '255,60,45', t, 0.8, 3);
      g.save(); g.globalCompositeOperation = 'lighter';
      const gr = g.createRadialGradient(b.x, b.y, 0, b.x, b.y, 22);
      gr.addColorStop(0, 'rgba(255,240,230,.95)'); gr.addColorStop(0.3, 'rgba(255,80,60,.6)'); gr.addColorStop(1, 'rgba(255,60,45,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(b.x, b.y, 22, 0, TAU); g.fill(); g.restore();
    }
    g.globalCompositeOperation = 'lighter';
    for (const wv of this.waves) {
      g.strokeStyle = `rgba(225,236,255,${wv.life * 0.7})`; g.lineWidth = 4 + wv.life * 14;
      g.beginPath(); g.arc(wv.x, wv.y, wv.r, 0, TAU); g.stroke();
    }
    g.globalCompositeOperation = 'source-over';
    if (this.doe && this.doe.pos) {
      const d = this.doe, u = d.t / d.dur, S = Math.min(W, H) * 0.32;
      const grow = ease(clamp(d.t / 0.5)), alpha = Math.min(clamp(d.t / 0.3), clamp((1 - u) / 0.15));
      drawDoe(g, d.pos.x, d.pos.y, S * (0.4 + 0.6 * grow), d.face, d.t * 11, alpha);
      for (let k = 1; k <= 3; k++) {
        const q = catmull(d.path, clamp(ease(Math.min(1, u)) * 0.85 + Math.min(1, u) * 0.15 - k * 0.025));
        drawDoe(g, q.x, q.y, S * (0.4 + 0.6 * grow), d.face, d.t * 11, alpha * 0.1 * (4 - k), true);
      }
    }

    // de toverstok, van onderen in beeld
    const butt = { x: w.px - Math.cos(tip.a) * w.L * 0.25, y: w.py - Math.sin(tip.a) * w.L * 0.25 };
    const glow = this.state === 'play' ? 0.25 + this.charge * 0.75 * (this.charge >= 1 ? 0.75 + 0.25 * Math.sin(t * 8) : 1) : 0.3;
    drawWand(g, tip, butt, w.w, '215,228,255', glow, 1);
    if (this.state === 'play' && this.charge > 0) {
      const r = 22 * this.unit + 6;
      g.strokeStyle = 'rgba(200,215,255,.18)'; g.lineWidth = 2.5;
      g.beginPath(); g.arc(tip.x, tip.y, r, 0, TAU); g.stroke();
      g.strokeStyle = this.charge >= 1 ? `rgba(240,246,255,${0.7 + Math.sin(t * 8) * 0.3})` : 'rgba(220,232,255,.85)';
      g.beginPath(); g.arc(tip.x, tip.y, r, -Math.PI / 2, -Math.PI / 2 + TAU * this.charge); g.stroke();
    }
    // Protego: een glinsterende koepel voor je toverstok
    if (this.shield > 0.02) {
      const R = 78 * this.unit, a = this.shield;
      g.save(); g.globalCompositeOperation = 'lighter';
      const sg = g.createRadialGradient(tip.x, tip.y, R * 0.55, tip.x, tip.y, R);
      sg.addColorStop(0, 'rgba(170,200,255,0)'); sg.addColorStop(0.85, `rgba(190,215,255,${0.16 * a + this.shieldHit * 0.3})`); sg.addColorStop(1, 'rgba(190,215,255,0)');
      g.fillStyle = sg; g.beginPath(); g.arc(tip.x, tip.y, R, Math.PI, TAU); g.lineTo(tip.x + R, tip.y + R * 0.2); g.lineTo(tip.x - R, tip.y + R * 0.2); g.closePath(); g.fill();
      g.strokeStyle = `rgba(225,238,255,${0.55 * a + this.shieldHit * 0.45})`; g.lineWidth = 1.6 + this.shieldHit * 3;
      g.beginPath(); g.arc(tip.x, tip.y, R + Math.sin(t * 9) * 1.5, Math.PI * 1.03, Math.PI * 1.97); g.stroke();
      g.strokeStyle = `rgba(225,238,255,${0.2 * a})`; g.lineWidth = 1;
      for (let i = 1; i <= 3; i++) { g.beginPath(); g.arc(tip.x, tip.y, R * (0.55 + i * 0.12) + Math.sin(t * 5 + i) * 2, Math.PI * 1.15, Math.PI * 1.85); g.stroke(); }
      g.restore();
    }
    if (this.cold > 0.02) { g.globalAlpha = clamp(this.cold * 1.1); g.drawImage(this.frost, 0, 0, W, H); g.globalAlpha = 1; }
    if (this.stun > 0) { g.fillStyle = `rgba(160,20,20,${0.22 * clamp(this.stun / 0.6)})`; g.fillRect(0, 0, W, H); }

    const drawStroke = (pts, alpha) => {
      if (pts.length < 2) return;
      g.lineCap = 'round'; g.lineJoin = 'round';
      g.beginPath(); g.moveTo(pts[0].x, pts[0].y); for (const p of pts) g.lineTo(p.x, p.y);
      g.strokeStyle = `rgba(190,210,255,${0.3 * alpha})`; g.lineWidth = 14; g.stroke();
      g.strokeStyle = `rgba(245,248,255,${alpha})`; g.lineWidth = 3.5; g.stroke();
    };
    if (this.stroke && !this.shieldOn) drawStroke(this.stroke, 1);
    for (let i = this.fade.length - 1; i >= 0; i--) {
      const f = this.fade[i];
      f.life -= 1 / 60;
      if (f.life <= 0) { this.fade.splice(i, 1); continue; }
      if (f.pts) drawStroke(f.pts, f.life * 2);
      else if (f.sym) { g.globalAlpha = f.life * 0.6; drawGlyph(g, f.sym, W / 2, H * 0.45, 90 + (1 - f.life) * 60, true); g.globalAlpha = 1; }
      else if (f.text) {
        g.globalAlpha = Math.min(1, f.life); g.textAlign = 'center';
        g.fillStyle = f.big ? '#eef3ff' : '#fff0c4';
        g.shadowColor = f.big ? 'rgba(200,220,255,.9)' : 'transparent'; g.shadowBlur = f.big ? 24 : 0;
        g.font = f.big ? `italic 600 ${Math.min(38, W * 0.085)}px "Cormorant Garamond", Georgia, serif` : '600 20px Cinzel, Georgia, serif';
        g.fillText(f.text, W / 2, f.y - (1.6 - f.life) * 30);
        g.shadowBlur = 0; g.globalAlpha = 1;
      }
    }
    g.restore();
  },
};
$('#g-start').addEventListener('click', () => Scenes.game.start());
$('#g-again').addEventListener('click', () => Scenes.game.start());
$$('[data-quit]').forEach((b) => b.addEventListener('click', () => go('hub')));
$('#g-quit').addEventListener('click', () => go('hub'));

/* =========================================================================
   Invoer, volledig scherm en de hoofdlus
   ========================================================================= */
stage.addEventListener('pointerdown', (e) => {
  try { stage.setPointerCapture(e.pointerId); } catch (err) {}
  const p = pt(e);
  if (scene && scene.down) scene.down(p, e);
  if (sceneName !== 'game') FX.emit(p.x, p.y, 8, 1.6);
});
stage.addEventListener('pointermove', (e) => {
  const p = pt(e);
  if (scene && scene.move) scene.move(p, e);
  if (e.buttons && sceneName !== 'game' && sceneName !== 'dark') FX.emit(p.x, p.y, 2, 0.6);
  if (sceneName === 'dark' && Scenes.dark.light.on) FX.emit(p.x, p.y, 1, 0.5);
});
const endPointer = (e) => { if (scene && scene.up) scene.up(pt(e), e); };
stage.addEventListener('pointerup', endPointer);
stage.addEventListener('pointercancel', endPointer);

function goFullscreen() {
  const standalone = matchMedia('(display-mode: fullscreen)').matches || matchMedia('(display-mode: standalone)').matches;
  const el = document.documentElement;
  if (standalone || document.fullscreenElement || !el.requestFullscreen) return;
  el.requestFullscreen({ navigationUI: 'hide' })
    .then(() => screen.orientation && screen.orientation.lock && screen.orientation.lock('portrait').catch(() => {}))
    .catch(() => {});
}

function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  W = innerWidth; H = innerHeight;
  for (const c of [bgEl, stage, fxc]) { c.width = Math.round(W * DPR); c.height = Math.round(H * DPR); }
  for (const g of [bg, ov, fctx]) g.setTransform(DPR, 0, 0, DPR, 0, 0);
  if (GLR) GLR.resize(W, H, DPR);
  Stars.build();
  if (scene && scene.resize) scene.resize();
}
let resizeT;
addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(resize, 120); });

let last = performance.now();
function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.05); last = now;
  const t = now / 1000;
  tilt.x = lerp(tilt.x, tilt.tx, 0.06); tilt.y = lerp(tilt.y, tilt.ty, 0.06);
  ov.clearRect(0, 0, W, H);
  if (GLR) GLR.frame();
  if (scene) {
    if (scene.update) scene.update(dt, t);
    if (scene.drawBg) scene.drawBg(bg, t);
    if (scene.draw) scene.draw(ov, t);
  }
  if (GLR) GLR.render(t);
  FX.draw(fctx);
  requestAnimationFrame(frame);
}

async function boot() {
  resize();
  // Wacht kort op de lettertypen; de onzichtbare inkt en de gravure gebruiken ze
  try {
    await Promise.race([
      Promise.all(['40px "Pinyon Script"', 'italic 20px "Cormorant Garamond"', '600 20px Cinzel'].map((f) => document.fonts.load(f))),
      new Promise((r) => setTimeout(r, 2500)),
    ]);
  } catch (e) {}
  const start = params.get('scene');
  if (start && Scenes[start]) go(start);
  else go('dark'); // altijd beginnen in het donker
  requestAnimationFrame(frame);
}
boot();

// Voor het testen vanuit de console
window.__app = { Scenes, recognize, go, drawDoe };

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
