import * as THREE from 'three';
import { RoomEnvironment } from './vendor/RoomEnvironment.js';

/* =========================================================================
   De 3D-laag: de Tijdverdrijver in echt metaal en glas, de stenen muur
   onder het licht van de toverstok, en het fluwelen toneeldoek.
   ========================================================================= */

const NOISE = /* glsl */ `
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
`;

const QUAD_VERT = /* glsl */ `void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }`;

/* Muur, één keer gebakken: kleur in rgb, hoogte in alpha */
const WALL_BAKE = /* glsl */ `
uniform vec2 uRes; uniform float uDpr;
${NOISE}
void main() {
  vec2 p = gl_FragCoord.xy / uDpr; p.y = uRes.y - p.y;
  vec2 q = p + (vec2(fbm(p * 0.015), fbm(p * 0.015 + 7.3)) - 0.5) * 22.0;
  float bh = 54.0;
  float row = floor(q.y / bh);
  float off = hash(vec2(row, 3.1)) * 140.0;
  float bw = 118.0 + hash(vec2(row, 8.7)) * 64.0;
  float col = floor((q.x + off) / bw);
  vec2 id = vec2(col, row);
  vec2 l = vec2(mod(q.x + off, bw), mod(q.y, bh));
  float e = min(min(l.x, bw - l.x), min(l.y, bh - l.y));
  e -= fbm(p * 0.06 + id * 3.7) * 7.0;
  float mortar = 1.0 - smoothstep(1.0, 4.5, e);
  float bulge = smoothstep(0.0, 20.0, e);
  float h = bulge * (0.55 + 0.45 * fbm(p * 0.03 + id * 11.0)) + noise(p * 0.75) * 0.07 + fbm(p * 0.16) * 0.14;
  h = mix(h, 0.04 * noise(p * 0.9), mortar);
  vec3 alb = mix(vec3(0.29, 0.26, 0.23), vec3(0.48, 0.43, 0.37), hash(id + 0.5));
  alb *= 0.72 + 0.56 * fbm(p * 0.02 + id);
  alb *= 0.9 + 0.2 * noise(p * 0.5);
  alb = mix(alb, vec3(0.11, 0.10, 0.09), mortar);
  alb *= 1.0 - 0.42 * smoothstep(0.5, 0.75, fbm(p * 0.004 + 3.0));
  alb = mix(alb, alb * vec3(0.82, 0.95, 0.78), smoothstep(0.55, 0.8, fbm(p * 0.01 + 9.0)) * 0.6);
  gl_FragColor = vec4(alb, clamp(h, 0.0, 1.0));
}`;

/* Muur, elk beeld: belicht door de toverstok, onzichtbare inkt gloeit op */
const WALL_LIGHT = /* glsl */ `
uniform sampler2D tWall; uniform sampler2D tInk;
uniform vec2 uRes; uniform float uDpr; uniform float uTime; uniform float uFlood;
uniform vec4 uL[8];
void main() {
  vec2 q = gl_FragCoord.xy / uDpr;
  vec2 uv = q / uRes;
  float I = 0.0;
  for (int i = 0; i < 8; i++) {
    vec4 l = uL[i];
    if (l.z < 1.0) continue;
    float d = length(q - vec2(l.x, uRes.y - l.y)) / l.z;
    I += l.w * pow(clamp(1.0 - d, 0.0, 1.0), 1.7);
  }
  if (I + uFlood < 0.003) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  vec2 tx = vec2(uDpr) / (uRes * uDpr);
  vec4 c0 = texture2D(tWall, uv);
  float hx = texture2D(tWall, uv + vec2(tx.x, 0.0)).a;
  float hy = texture2D(tWall, uv + vec2(0.0, tx.y)).a;
  vec3 n = normalize(vec3(-(hx - c0.a) * 9.0, -(hy - c0.a) * 9.0, 1.0));
  vec2 lp = vec2(uL[0].x, uRes.y - uL[0].y);
  vec3 Ld = normalize(vec3(lp - q, 150.0));
  vec3 warm = vec3(1.0, 0.80, 0.56);
  float diff = max(dot(n, Ld), 0.0);
  float spec = pow(max(dot(reflect(-Ld, n), vec3(0.0, 0.0, 1.0)), 0.0), 26.0);
  vec3 col = c0.rgb * I * (0.2 + 2.3 * diff) * warm + spec * 0.18 * I * warm;
  vec3 Lf = normalize(vec3(-0.35, 0.55, 0.75));
  col += c0.rgb * uFlood * (0.3 + 0.95 * max(dot(n, Lf), 0.0)) * vec3(1.0, 0.88, 0.72);
  float ink = texture2D(tInk, uv).a;
  float sh = 0.8 + 0.2 * sin(uTime * 1.7 + (q.x - q.y) * 0.02);
  float lit = clamp(I * 1.6 + uFlood, 0.0, 1.6);
  col += vec3(1.0, 0.70, 0.30) * ink * lit * sh * 1.05;
  col += vec3(1.0, 0.95, 0.82) * pow(ink, 4.0) * lit * 0.85;
  col *= 1.0 - 0.38 * length(uv - 0.5);
  gl_FragColor = vec4(col, 1.0);
}`;

/* Het toneel: fluwelen gordijnen, draperie met franje, spot door de rook */
const STAGE = /* glsl */ `
uniform vec2 uRes; uniform float uDpr; uniform float uTime; uniform float uOpen;
${NOISE}
vec3 velvetShade(vec3 n, vec3 L, float h, vec2 p) {
  float diff = max(dot(n, L), 0.0);
  float sheen = pow(1.0 - abs(n.z), 1.6);
  float ao = 0.42 + 0.58 * (0.5 + 0.5 * h);
  float pile = 0.88 + 0.12 * noise(p * vec2(1.1, 0.12));
  vec3 base = vec3(0.30, 0.018, 0.035);
  return base * (0.22 + 1.25 * diff) * ao * pile + vec3(0.95, 0.30, 0.32) * sheen * 0.32 * ao;
}
vec3 curtain(float u, vec2 p, float side) {
  float H = uRes.y;
  float sway = (uOpen > 0.01 && uOpen < 0.99) ? 1.0 : 0.25;
  float bunch = 1.0 + uOpen * 1.6;
  float ph = u * 7.0 * 6.2831 + 0.55 * sin(p.y * 0.005 + u * 3.0) + 0.35 * sin(uTime * 0.9 + u * 5.0) * sway;
  float h = sin(ph);
  vec3 n = normalize(vec3(-cos(ph) * 0.95 * bunch * side, 0.0, 1.0));
  vec3 L = normalize(vec3(side * 0.35, 0.35, 0.85));
  vec3 c = velvetShade(n, L, h, p);
  c *= 0.75 + 0.55 * u * uOpen;
  c *= mix(0.45, 1.0, smoothstep(0.0, H * 0.28, p.y)) * mix(1.0, 0.55, smoothstep(H * 0.75, H, p.y));
  c *= mix(1.0, 0.45, smoothstep(0.94, 1.0, u));
  return c;
}
vec3 valance(vec2 p, vec3 col) {
  float W = uRes.x, H = uRes.y;
  float vh = max(70.0, H * 0.09);
  float n = max(3.0, floor(W / 135.0));
  float sw = W / n;
  float fx = fract(p.x / sw);
  float sag = 1.0 - pow(2.0 * fx - 1.0, 2.0);
  float edge = vh * 0.58 + vh * 0.42 * sag;
  float fringe = 13.0 + 3.0 * noise(vec2(p.x * 0.4, 1.0));
  if (p.y > edge + fringe + 10.0) return col;
  if (p.y > edge + fringe) return col * mix(0.5, 1.0, (p.y - edge - fringe) / 10.0);
  if (p.y > edge) {
    float strand = 0.5 + 0.5 * sin(p.x * 1.9 + noise(vec2(p.x * 0.3, 0.0)) * 3.0);
    float k = (p.y - edge) / fringe;
    return vec3(0.86, 0.62, 0.26) * (0.35 + 0.75 * strand) * (1.0 - k * 0.55);
  }
  float v = p.y / edge;
  float ph = v * 4.5 * 6.2831 - sag * 1.5;
  float h = sin(ph);
  vec3 nrm = normalize(vec3(0.0, cos(ph) * 0.85, 1.0));
  vec3 c = velvetShade(nrm, normalize(vec3(0.0, 0.45, 0.85)), h, p * vec2(0.12, 1.0));
  c *= 0.85 + 0.25 * v;
  float rope = 1.0 - smoothstep(1.5, 3.5, abs(p.y - edge + 2.5));
  vec3 gold = vec3(0.95, 0.74, 0.36) * (0.6 + 0.4 * sin((p.x + p.y * 1.5) * 0.9));
  c = mix(c, gold, rope);
  float topRope = 1.0 - smoothstep(1.5, 3.5, abs(p.y - 4.0));
  c = mix(c, gold, topRope);
  return c;
}
void main() {
  vec2 p = gl_FragCoord.xy / uDpr; p.y = uRes.y - p.y;
  float W = uRes.x, H = uRes.y, open = uOpen;
  vec3 col = vec3(0.010, 0.009, 0.014);
  float floorY = H * 0.8;
  if (p.y > floorY) {
    float k = (p.y - floorY) / (H - floorY);
    float plankW = 46.0 + k * 70.0;
    float px = (p.x - W * 0.5) / (0.6 + k * 0.8);
    float seam = smoothstep(0.93, 0.98, fract(px / plankW));
    vec3 wood = vec3(0.16, 0.09, 0.05) * (0.6 + 0.5 * fbm(vec2(px * 0.02, p.y * 0.4)));
    col = wood * (1.0 - seam * 0.6) * (0.35 + 0.4 * k);
  }
  float cx = W * 0.5, t = clamp(p.y / H, 0.0, 1.0);
  float halfW = mix(W * 0.07, W * 0.46, t);
  float cone = 1.0 - smoothstep(halfW * 0.6, halfW, abs(p.x - cx));
  float haze = fbm(vec2(p.x * 0.005, p.y * 0.004 - uTime * 0.06));
  col += vec3(1.0, 0.85, 0.6) * cone * (0.06 + 0.2 * haze) * open * (1.0 - t * 0.35);
  float pool = 1.0 - smoothstep(0.0, 1.0, length((p - vec2(cx, H * 0.88)) / vec2(W * 0.4, H * 0.07)));
  col += vec3(1.0, 0.8, 0.52) * pool * 0.32 * open;
  col += vec3(0.55, 0.5, 0.65) * 0.05 * fbm(p * 0.004 + vec2(uTime * 0.03, 0.0)) * open;
  float hw = W * 0.5 + 4.0;
  float cw = hw * (1.0 - open * 0.84) + 12.0;
  if (p.x < cw) col = curtain(p.x / cw, p, 1.0);
  else if (p.x > W - cw) col = curtain((W - p.x) / cw, p, -1.0);
  else {
    float shL = smoothstep(cw + 40.0, cw, p.x), shR = smoothstep(W - cw - 40.0, W - cw, p.x);
    col *= 1.0 - 0.6 * max(shL, shR);
  }
  col = valance(p, col);
  gl_FragColor = vec4(col, 1.0);
}`;

/* Het duel: mist in een donkere ruimte, verlicht door de twee spreuken */
const DUEL = /* glsl */ `
uniform vec2 uRes; uniform float uDpr; uniform float uTime;
uniform vec4 uOpp; uniform vec4 uMine; uniform vec4 uI; uniform vec2 uP;
${NOISE}
float seg(vec2 p, vec2 a, vec2 b) {
  vec2 ab = b - a; float h = clamp(dot(p - a, ab) / max(dot(ab, ab), 1.0), 0.0, 1.0);
  return length(p - a - ab * h);
}
void main() {
  vec2 p = gl_FragCoord.xy / uDpr; p.y = uRes.y - p.y;
  float S = min(uRes.x, uRes.y);
  vec2 q = p / S;
  float t = uTime;
  vec2 w = vec2(fbm(q * 2.2 + vec2(t * 0.05, -t * 0.03)), fbm(q * 2.2 + vec2(5.2, 1.3) - t * 0.04));
  float fog = fbm(q * 3.0 + w * 1.6 + vec2(-t * 0.06, t * 0.02));
  float fog2 = fbm(q * 7.0 - w + vec2(t * 0.1, 0.0));
  fog = clamp(fog * 1.25 - 0.15 + fog2 * 0.25, 0.0, 1.0);
  vec3 col = vec3(0.010, 0.012, 0.026) * (0.6 + fog);
  // gloed langs de stralen en rond de punten
  float dO = seg(p, uOpp.xy, uOpp.zw) / S, dM = seg(p, uMine.xy, uMine.zw) / S;
  float gO = uI.x * (exp(-dO * 9.0) * 0.55 + exp(-dO * 40.0) * 0.5);
  float gM = uI.y * (exp(-dM * 9.0) * 0.55 + exp(-dM * 40.0) * 0.5);
  float dP = length(p - uP) / S;
  float gP = uI.z * (exp(-dP * 5.5) * 0.45 + exp(-dP * 18.0) * 0.8);
  float tipO = exp(-length(p - uOpp.xy) / S * 14.0) * (0.25 + uI.x), tipM = exp(-length(p - uMine.xy) / S * 14.0) * (0.25 + uI.y);
  vec3 red = vec3(1.0, 0.16, 0.10), gold = vec3(1.0, 0.68, 0.28), hot = vec3(1.0, 0.92, 0.80);
  vec3 light = red * (gO + tipO * uI.w) + gold * (gM + tipM * uI.w) + hot * gP;
  col += light * (0.04 + 0.55 * fog * fog);
  // vloer van nat steen die het licht weerkaatst
  float floorY = uRes.y * 0.62;
  if (p.y > floorY) {
    float k = (p.y - floorY) / (uRes.y - floorY);
    float ref = exp(-abs(p.x - uP.x) / S * 3.0) * uI.z * (0.35 + 0.65 * noise(vec2(p.x * 0.02, p.y * 0.25 + t)));
    col += hot * ref * 0.12 * (1.0 - k) + vec3(0.02, 0.022, 0.035) * k * fog2;
  }
  float v = length((p - uRes * 0.5) / uRes);
  col *= 1.0 - 0.75 * smoothstep(0.3, 0.75, v);
  gl_FragColor = vec4(col, 1.0);
}`;

/* Rook na de botsing: honderden losse rookwolken, elk een kaartje met een gebakken wolkentextuur */
const PUFF_VERT = /* glsl */ `
attribute vec4 iA; attribute vec4 iB; attribute float iCell;
uniform vec2 uRes;
varying vec2 vUv; varying vec4 vB;
void main() {
  float c = cos(iA.w), s = sin(iA.w);
  vec2 q = mat2(c, -s, s, c) * position.xy * iA.z + iA.xy;
  vUv = (uv + vec2(mod(iCell, 2.0), floor(iCell / 2.0))) * 0.5;
  vB = iB;
  gl_Position = vec4(q.x / uRes.x * 2.0 - 1.0, 1.0 - q.y / uRes.y * 2.0, 0.0, 1.0);
}`;
const PUFF_FRAG = /* glsl */ `
uniform sampler2D tPuff;
varying vec2 vUv; varying vec4 vB; // erosie, dekking, hitte, helderheid
void main() {
  vec4 tx = texture2D(tPuff, vUv);
  float d = tx.a, er = vB.x;
  float a = clamp((d - er) * (1.5 / (1.0 - er * 0.8)), 0.0, 1.0);
  a = a * a * (3.0 - 2.0 * a) * vB.y;
  if (a < 0.003) discard;
  vec3 col = mix(vec3(0.07, 0.075, 0.09), vec3(0.56, 0.55, 0.55), tx.r) * vB.w;
  // gloed van de knal die van binnenuit door de dikke delen schijnt
  col += vec3(1.0, 0.46, 0.14) * vB.z * (0.25 + 1.1 * d * d) + vec3(1.0, 0.85, 0.6) * vB.z * vB.z * 0.5 * d;
  gl_FragColor = vec4(col * a, a);
}`;
const COMPOSITE = /* glsl */ `
uniform sampler2D tSrc; uniform vec2 uRes; uniform float uDpr;
void main() { gl_FragColor = texture2D(tSrc, gl_FragCoord.xy / (uRes * uDpr)); }`;

/* Vier verschillende rookwolken, opgebouwd uit bolletjes en ruis, met licht van linksboven */
function makePuffAtlas() {
  const N = 256, size = N * 2, perm = new Uint8Array(512);
  for (let i = 0; i < 256; i++) perm[i] = i;
  for (let i = 255; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [perm[i], perm[j]] = [perm[j], perm[i]]; }
  for (let i = 0; i < 256; i++) perm[i + 256] = perm[i];
  const h = (x, y) => perm[(perm[x & 255] + y) & 511] / 255;
  const vn = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), d = h(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  const fbm = (x, y) => { let s = 0, a = 0.5; for (let i = 0; i < 5; i++) { s += a * vn(x, y); x *= 2.02; y *= 2.02; a *= 0.5; } return s; };
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = size;
  const g = canvas.getContext('2d'), img = g.createImageData(size, size);
  for (let cell = 0; cell < 4; cell++) {
    const ox = (cell % 2) * N, oy = Math.floor(cell / 2) * N, seed = cell * 17.3;
    const blobs = Array.from({ length: 9 }, () => {
      const r = 0.12 + Math.random() * 0.22, ang = Math.random() * Math.PI * 2, dist = Math.random() * (0.5 - r);
      return [Math.cos(ang) * dist, Math.sin(ang) * dist, r];
    });
    const dens = new Float32Array(N * N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const u = (x + 0.5) / N - 0.5, v = (y + 0.5) / N - 0.5;
      // vervorm de ruimte met ruis zodat de randen kolken
      const wu = u + (fbm(u * 4 + seed, v * 4) - 0.5) * 0.34, wv = v + (fbm(u * 4 + 40 + seed, v * 4 + 9) - 0.5) * 0.34;
      let d = 0;
      for (const [bx, by, br] of blobs) { const q = ((wu - bx) ** 2 + (wv - by) ** 2) / (br * br); d += Math.exp(-q * 1.6); }
      const n = fbm(u * 7 + seed, v * 7 - seed);
      d = d * (0.3 + 1.1 * n * n) * Math.max(0, 1 - Math.hypot(wu, wv) / 0.5) ** 1.3 * Math.max(0, 1 - Math.hypot(u, v) / 0.5) ** 0.5;
      dens[y * N + x] = Math.min(1, d * 0.85);
    }
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const i = y * N + x, d = dens[i];
      // licht van linksboven; dunne randen laten licht door en blijven licht
      const back = dens[Math.max(0, y - 7) * N + Math.max(0, x - 7)];
      const shade = Math.max(0, Math.min(1, 0.6 + (d - back) * 0.5 + (0.35 - d) * 0.15 + (fbm(x * 0.04 + seed, y * 0.04) - 0.5) * 0.45));
      const o = ((oy + y) * size + ox + x) * 4;
      img.data[o] = img.data[o + 1] = img.data[o + 2] = shade * 255;
      img.data[o + 3] = d * 255;
    }
  }
  g.putImageData(img, 0, 0);
  return canvas;
}

export function createGL(canvas) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  } catch (e) { return null; }
  renderer.setClearColor(0x000000, 0);
  renderer.autoClear = false;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();

  let W = 1, H = 1, DPR = 1;
  const scene = new THREE.Scene();
  scene.environment = env;
  const camera = new THREE.PerspectiveCamera(30, 1, 10, 50000);
  const key = new THREE.DirectionalLight(0xffe2b0, 2.4); key.position.set(-0.6, 1, 1.3);
  const rim = new THREE.DirectionalLight(0xa8bcff, 0.7); rim.position.set(1, -0.4, -0.5);
  const wand = new THREE.PointLight(0xffd9a0, 0, 0, 0);
  scene.add(key, rim, wand);

  /* ---------- Materialen ---------- */
  const metal = [];
  const gold = (o = {}) => {
    const m = new THREE.MeshPhysicalMaterial({ color: 0xf2c060, metalness: 1, roughness: 0.24, clearcoat: 0.35, clearcoatRoughness: 0.18, ...o });
    metal.push(m); return m;
  };
  const engraveCanvas = document.createElement('canvas');
  engraveCanvas.width = engraveCanvas.height = 2048;
  const engraveTex = new THREE.CanvasTexture(engraveCanvas);
  engraveTex.colorSpace = THREE.SRGBColorSpace;
  engraveTex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  engraveTex.repeat.set(1 / 2.06, 1 / 2.06);
  engraveTex.offset.set(0.5, 0.5);
  const faceMat = gold({ map: engraveTex, bumpMap: engraveTex, bumpScale: 3 });
  const sideMat = gold({ roughness: 0.3 });
  const ringMat = gold({ roughness: 0.2 });
  const darkGold = gold({ color: 0xd6a24a, roughness: 0.32 });
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, metalness: 0, roughness: 0.03, transparent: true, opacity: 0.12,
    clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 2.2, side: THREE.DoubleSide, depthWrite: false,
  });
  metal.push(glassMat);
  const sandMat = new THREE.MeshStandardMaterial({ color: 0xd8902c, roughness: 0.8, metalness: 0, emissive: 0x7a3e08, emissiveIntensity: 0.7 });
  const streamMat = new THREE.MeshBasicMaterial({ color: 0xffe0a0 });

  // Lichtmasker: in het donker is het model alleen zichtbaar waar het toverstoklicht valt (zelfde falloff als de muur)
  const maskU = {
    uML: { value: Array.from({ length: 8 }, () => new THREE.Vector4()) },
    uMOn: { value: 0 }, uMFlood: { value: 0 }, uMDpr: { value: 1 }, uMRes: { value: new THREE.Vector2(1, 1) },
  };
  const masked = (m) => {
    const prev = m.onBeforeCompile;
    m.onBeforeCompile = (sh, r) => {
      if (prev) prev(sh, r);
      Object.assign(sh.uniforms, maskU);
      sh.fragmentShader = 'uniform vec4 uML[8]; uniform float uMOn, uMFlood, uMDpr; uniform vec2 uMRes;\n' +
        sh.fragmentShader.replace('#include <dithering_fragment>', `#include <dithering_fragment>
        if (uMOn > 0.5) {
          vec2 mq = gl_FragCoord.xy / uMDpr; float mI = 0.0;
          for (int i = 0; i < 8; i++) {
            vec4 l = uML[i];
            if (l.z < 1.0) continue;
            mI += l.w * pow(clamp(1.0 - length(mq - vec2(l.x, uMRes.y - l.y)) / l.z, 0.0, 1.0), 1.7);
          }
          gl_FragColor.rgb *= clamp(mI * 1.8 + uMFlood, 0.0, 1.0);
        }`);
    };
    return m;
  };
  for (const m of [...metal, sandMat, streamMat]) masked(m);

  /* ---------- Het model ---------- */
  const root = new THREE.Group();
  const tiltG = new THREE.Group(); root.add(tiltG);
  scene.add(root);

  const annulus = (r0, r1, depth, bevel) => {
    const s = new THREE.Shape(); s.absarc(0, 0, r1, 0, Math.PI * 2, false);
    const hole = new THREE.Path(); hole.absarc(0, 0, r0, 0, Math.PI * 2, true); s.holes.push(hole);
    const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * 0.8, bevelSegments: 4, curveSegments: 160 });
    g.translate(0, 0, -depth / 2);
    return g;
  };
  const outer = new THREE.Mesh(annulus(0.8, 1.0, 0.07, 0.025), [faceMat, sideMat]);
  tiltG.add(outer);

  const gimA = new THREE.Group(); tiltG.add(gimA);
  gimA.add(new THREE.Mesh(annulus(0.68, 0.73, 0.05, 0.012), ringMat));
  const gimB = new THREE.Group(); gimA.add(gimB);
  gimB.add(new THREE.Mesh(annulus(0.565, 0.61, 0.045, 0.01), ringMat));

  const sphere = new THREE.SphereGeometry(1, 24, 16);
  const rod = new THREE.CylinderGeometry(1, 1, 1, 16);
  const addRod = (parent, x, y, len, axis) => {
    const m = new THREE.Mesh(rod, darkGold);
    m.scale.set(0.018, len, 0.018);
    if (axis === 'x') m.rotation.z = Math.PI / 2;
    m.position.set(x, y, 0); parent.add(m);
    const b = new THREE.Mesh(sphere, ringMat); b.scale.setScalar(0.034);
    b.position.set(axis === 'x' ? x + Math.sign(x) * len * 0.5 : x, axis === 'x' ? y : y + Math.sign(y) * -len * 0.5, 0);
    parent.add(b);
  };
  addRod(tiltG, 0, 0.765, 0.09, 'y'); addRod(tiltG, 0, -0.765, 0.09, 'y');
  addRod(gimA, 0.645, 0, 0.09, 'x'); addRod(gimA, -0.645, 0, 0.09, 'x');

  const loop = new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.014, 12, 32), ringMat);
  loop.position.set(0, 1.06, 0); loop.rotation.y = Math.PI / 2; tiltG.add(loop);

  // Zandloper
  const hg = new THREE.Group(); tiltG.add(hg);
  const HH = 0.36, NECK = 0.02, BULB = 0.15;
  const radiusAt = (y) => {
    const u = Math.min(1, Math.abs(y) / HH);
    if (u < 0.62) return NECK + (BULB - NECK) * Math.pow(Math.sin((u / 0.62) * Math.PI * 0.5), 1.5);
    return BULB - BULB * 0.2 * Math.pow((u - 0.62) / 0.38, 2);
  };
  const glassPts = [];
  for (let i = 0; i <= 60; i++) { const y = -HH + (2 * HH * i) / 60; glassPts.push(new THREE.Vector2(radiusAt(y), y)); }
  const glass = new THREE.Mesh(new THREE.LatheGeometry(glassPts, 64), glassMat);
  glass.renderOrder = 2; hg.add(glass);
  const capGeo = new THREE.CylinderGeometry(0.205, 0.205, 0.032, 64);
  for (const sy of [-1, 1]) {
    const cap = new THREE.Mesh(capGeo, darkGold); cap.position.y = sy * (HH + 0.016); hg.add(cap);
    const lip = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.012, 10, 64), ringMat);
    lip.rotation.x = Math.PI / 2; lip.position.y = sy * (HH + 0.034); hg.add(lip);
  }
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + Math.PI / 2;
    const post = new THREE.Mesh(rod, ringMat);
    post.scale.set(0.013, HH * 2 + 0.03, 0.013);
    post.position.set(Math.cos(a) * 0.178, 0, Math.sin(a) * 0.178); hg.add(post);
  }
  const sandTop = new THREE.Mesh(new THREE.BufferGeometry(), sandMat);
  const sandBot = new THREE.Mesh(new THREE.BufferGeometry(), sandMat);
  const stream = new THREE.Mesh(new THREE.CylinderGeometry(0.0045, 0.0045, 1, 6), streamMat);
  hg.add(sandTop, sandBot, stream);
  let lastSand = -1;
  const buildSand = (sand) => {
    const top = 1 - sand, eps = 0.0008;
    sandTop.visible = top > 0.004; sandBot.visible = sand > 0.004;
    if (sandTop.visible) {
      const yTop = 0.012 + top * HH * 0.8, pts = [new THREE.Vector2(eps, 0.006)];
      for (let i = 0; i <= 16; i++) { const y = 0.006 + ((yTop - 0.006) * i) / 16; pts.push(new THREE.Vector2(radiusAt(y) * 0.93, y)); }
      pts.push(new THREE.Vector2(eps, yTop - Math.min(0.04, yTop * 0.25)));
      sandTop.geometry.dispose(); sandTop.geometry = new THREE.LatheGeometry(pts, 48);
    }
    const base = -HH + 0.004, hb = sand * HH * 0.72;
    if (sandBot.visible) {
      const pts = [new THREE.Vector2(eps, base)];
      for (let i = 0; i <= 10; i++) { const y = base + (hb * 0.4 * i) / 10; pts.push(new THREE.Vector2(radiusAt(y) * 0.93, y)); }
      pts.push(new THREE.Vector2(eps, base + hb));
      sandBot.geometry.dispose(); sandBot.geometry = new THREE.LatheGeometry(pts, 48);
    }
    const yEnd = base + hb;
    stream.scale.y = Math.max(0.001, -yEnd); stream.position.y = yEnd / 2;
  };

  // Ketting: losse schakels die naar boven toe vervagen
  const fade = { uFadeTop: { value: 1e6 }, uFadeLen: { value: 80 } };
  const chainMat = gold({ roughness: 0.28, transparent: true });
  chainMat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, fade);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vChainY;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvChainY = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).y;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vChainY;\nuniform float uFadeTop;\nuniform float uFadeLen;')
      .replace('#include <dithering_fragment>', '#include <dithering_fragment>\ngl_FragColor.a *= clamp((uFadeTop - vChainY) / uFadeLen, 0.0, 1.0);');
  };
  const MAXLINKS = 90;
  const chain = new THREE.InstancedMesh(new THREE.TorusGeometry(0.036, 0.0105, 10, 24), chainMat, MAXLINKS);
  chain.frustumCulled = false;
  const chainG = new THREE.Group(); chainG.add(chain); root.add(chainG);
  const dummy = new THREE.Object3D();
  for (let i = 0; i < MAXLINKS; i++) {
    dummy.position.set(0, 1.135 + i * 0.094, 0);
    dummy.rotation.set(0, i % 2 ? Math.PI / 2 : 0, 0);
    dummy.scale.set(1, 1.6, 1);
    dummy.updateMatrix(); chain.setMatrixAt(i, dummy.matrix);
  }

  /* ---------- Gravure ---------- */
  let engraved = '';
  function setEngraving(text) {
    if (text === engraved) return; engraved = text;
    const S = 2048, g = engraveCanvas.getContext('2d'), k = S / 2.06;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, S, S);
    g.translate(S / 2, S / 2);
    g.strokeStyle = '#8a8a8a'; g.lineWidth = 5;
    for (const r of [0.975, 0.825]) { g.beginPath(); g.arc(0, 0, r * k, 0, Math.PI * 2); g.stroke(); }
    g.lineWidth = 2;
    for (const r of [0.962, 0.838]) { g.beginPath(); g.arc(0, 0, r * k, 0, Math.PI * 2); g.stroke(); }
    const R = 0.9 * k, size = 0.085 * k;
    g.font = `600 ${size}px Cinzel, Georgia, serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const chars = [...text], widths = chars.map((c) => g.measureText(c).width);
    const total = widths.reduce((a, b) => a + b, 0), circ = Math.PI * 2 * R;
    const reps = Math.max(1, Math.floor(circ / total)), sc = circ / (total * reps);
    g.fillStyle = '#4a4036';
    let a = 0;
    for (let r = 0; r < reps; r++) {
      for (let i = 0; i < chars.length; i++) {
        const half = (widths[i] * sc) / 2 / R; a += half;
        if (chars[i] !== ' ') { g.save(); g.rotate(a); g.translate(0, -R); g.fillText(chars[i], 0, 0); g.restore(); }
        a += half;
      }
    }
    engraveTex.needsUpdate = true;
  }

  /* ---------- Schermvullende lagen ---------- */
  const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quadGeo = new THREE.PlaneGeometry(2, 2);
  const common = () => ({ uRes: { value: new THREE.Vector2(1, 1) }, uDpr: { value: 1 }, uTime: { value: 0 } });
  const mkPass = (frag, uniforms) => {
    const m = new THREE.ShaderMaterial({ vertexShader: QUAD_VERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false, toneMapped: false });
    const s = new THREE.Scene(); s.add(new THREE.Mesh(quadGeo, m));
    return { m, s };
  };
  const bake = mkPass(WALL_BAKE, common());
  const wallU = { ...common(), tWall: { value: null }, tInk: { value: null }, uFlood: { value: 0 }, uL: { value: Array.from({ length: 8 }, () => new THREE.Vector4()) } };
  const wall = mkPass(WALL_LIGHT, wallU);
  const stageU = { ...common(), uOpen: { value: 0 } };
  const stage = mkPass(STAGE, stageU);
  const duelU = { ...common(), uOpp: { value: new THREE.Vector4() }, uMine: { value: new THREE.Vector4() }, uI: { value: new THREE.Vector4() }, uP: { value: new THREE.Vector2() } };
  const duel = mkPass(DUEL, duelU);

  /* ---------- Rook: deeltjes op halve resolutie, daarna over het beeld gelegd ---------- */
  const premult = { blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor };
  const MAXPUFF = 280;
  const puffTex = new THREE.CanvasTexture(makePuffAtlas());
  puffTex.generateMipmaps = true; puffTex.minFilter = THREE.LinearMipmapLinearFilter;
  const puffGeo = new THREE.InstancedBufferGeometry();
  const plane = new THREE.PlaneGeometry(1, 1);
  puffGeo.index = plane.index; puffGeo.setAttribute('position', plane.getAttribute('position')); puffGeo.setAttribute('uv', plane.getAttribute('uv'));
  const iA = new THREE.InstancedBufferAttribute(new Float32Array(MAXPUFF * 4), 4).setUsage(THREE.DynamicDrawUsage);
  const iB = new THREE.InstancedBufferAttribute(new Float32Array(MAXPUFF * 4), 4).setUsage(THREE.DynamicDrawUsage);
  const iCell = new THREE.InstancedBufferAttribute(new Float32Array(MAXPUFF), 1).setUsage(THREE.DynamicDrawUsage);
  puffGeo.setAttribute('iA', iA); puffGeo.setAttribute('iB', iB); puffGeo.setAttribute('iCell', iCell);
  puffGeo.instanceCount = 0;
  const puffU = { uRes: { value: new THREE.Vector2(1, 1) }, tPuff: { value: puffTex } };
  const puffMesh = new THREE.Mesh(puffGeo, new THREE.ShaderMaterial({ vertexShader: PUFF_VERT, fragmentShader: PUFF_FRAG, uniforms: puffU, transparent: true, side: THREE.DoubleSide, depthTest: false, depthWrite: false, toneMapped: false, ...premult }));
  puffMesh.frustumCulled = false;
  const puffScene = new THREE.Scene(); puffScene.add(puffMesh);
  const compU = { ...common(), tSrc: { value: null } };
  const comp = mkPass(COMPOSITE, compU);
  Object.assign(comp.m, { transparent: true, ...premult });
  let smokeRT = null, puffs = [], lastT = null;
  const rnd = (a, b) => a + Math.random() * (b - a);
  const addPuff = (x, y, o) => {
    const ang = Math.random() * Math.PI * 2, sp = o.speed * Math.pow(Math.random(), 1.3);
    // het scherm staat rechtop: meer ruimte boven en onder dan opzij
    const sx = Math.min(1, W / H * 1.6), sy = Math.min(1.6, H / W * 0.75);
    puffs.push({
      x: x + Math.cos(ang) * rnd(0, 26), y: y + Math.sin(ang) * rnd(0, 26), vx: Math.cos(ang) * sp * sx, vy: Math.sin(ang) * sp * sy,
      size: rnd(o.s0, o.s1), grow: rnd(o.g0, o.g1), rot: rnd(0, 6.28), vr: rnd(-0.9, 0.9), age: -o.delay(), life: rnd(5.6, 6.8),
      cell: (Math.random() * 4) | 0, shade: rnd(0.75, 1.05), heat: o.heat, op: rnd(0.5, 0.8), ox: x, oy: y,
    });
  };
  function smokeBurst(x, y) {
    puffs = [];
    const S = Math.min(W, H);
    // de knal: snel naar buiten geslingerd, sterk afgeremd
    for (let i = 0; i < 150; i++) addPuff(x, y, { speed: S * 1.9, s0: S * 0.3, s1: S * 0.6, g0: S * 0.22, g1: S * 0.45, heat: 1, delay: () => rnd(0, 0.12) });
    // nawolken die het midden vullen
    for (let i = 0; i < 100; i++) addPuff(x, y, { speed: S * 0.8, s0: S * 0.45, s1: S * 0.8, g0: S * 0.12, g1: S * 0.25, heat: 0.8, delay: () => rnd(0.08, 0.7) });
    // een paar trage, grote flarden die laag blijven hangen
    for (let i = 0; i < 14; i++) addPuff(rnd(0, W), H * rnd(0.6, 0.95), { speed: S * 0.2, s0: S * 0.7, s1: S * 1.1, g0: S * 0.05, g1: S * 0.1, heat: 0, delay: () => rnd(0.3, 1.0) });
  }
  function stepSmoke(dt, t) {
    let n = 0;
    for (const p of puffs) {
      p.age += dt;
      if (p.age < 0) continue;
      const drag = Math.exp(-2.1 * dt);
      p.vx *= drag; p.vy *= drag;
      // wat werveling en warme lucht die opstijgt
      p.vx += Math.sin(p.y * 0.011 + t * 0.7 + p.rot) * 9 * dt;
      p.vy += (Math.cos(p.x * 0.013 - t * 0.6) * 9 - 14) * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.size += p.grow * dt * Math.exp(-p.age * 0.35);
      p.rot += p.vr * dt * Math.exp(-p.age * 0.5);
      if (p.age > p.life || n >= MAXPUFF) continue;
      const fadeIn = Math.min(1, p.age / 0.12);
      const k = Math.max(0, (p.age - 2.6) / (p.life - 2.6));
      const erode = k * k * (3 - 2 * k) * 0.9;
      const heat = p.heat * Math.exp(-p.age * 2.2);
      // dichter bij de knal meer licht, aan de randen koeler en donkerder
      const near = Math.exp(-Math.hypot(p.x - p.ox, p.y - p.oy) / (Math.min(W, H) * 0.9));
      const shade = p.shade * (0.55 + 0.45 * near) * (0.75 + 0.25 * Math.exp(-p.age * 0.5));
      iA.array.set([p.x, p.y, p.size, p.rot], n * 4);
      iB.array.set([erode, p.op * fadeIn * (1 - k) ** 1.2, heat, shade], n * 4);
      iCell.array[n] = p.cell;
      n++;
    }
    puffs = puffs.filter((p) => p.age <= p.life);
    puffGeo.instanceCount = n;
    iA.needsUpdate = iB.needsUpdate = iCell.needsUpdate = true;
    return n;
  }
  let wallRT = null, inkTex = null, wallDirty = true;

  /* ---------- Toestand per beeld ---------- */
  const state = { mode: 'none', tt: null, lights: [], flood: 0, open: 0 };

  return {
    ok: true,
    resize(w, h, dpr) {
      W = w; H = h; DPR = Math.min(dpr, 2);
      renderer.setPixelRatio(DPR); renderer.setSize(W, H, false);
      camera.aspect = W / H; camera.fov = 30;
      camera.position.set(0, 0, H / 2 / Math.tan((15 * Math.PI) / 180));
      camera.updateProjectionMatrix();
      for (const u of [bake.m.uniforms, wallU, stageU, duelU, compU, puffU]) { u.uRes.value.set(W, H); if (u.uDpr) u.uDpr.value = DPR; }
      if (smokeRT) { smokeRT.dispose(); smokeRT = null; }
      wallDirty = true;
    },
    setEngraving,
    setInk(c) { if (inkTex) inkTex.dispose(); inkTex = new THREE.CanvasTexture(c); wallU.tInk.value = inkTex; },
    frame() { state.mode = 'none'; state.tt = null; },
    // d: { opp:[ax,ay,fx,fy], mine:[bx,by,fx,fy], p:[x,y], oppOn, mineOn, heat, tips }
    showDuel(d) { state.mode = 'duel'; state.duel = d; },
    smokeBurst,
    showTT(p) { state.tt = p; },
    showWall(lights, flood) { state.mode = 'wall'; state.lights = lights; state.flood = flood; },
    showStage(open) { state.mode = 'stage'; state.open = open; },
    render(t) {
      renderer.setRenderTarget(null);
      renderer.clear();
      if (state.mode === 'wall') {
        if (wallDirty || !wallRT) {
          if (wallRT) wallRT.dispose();
          wallRT = new THREE.WebGLRenderTarget(Math.round(W * DPR), Math.round(H * DPR), { depthBuffer: false });
          renderer.setRenderTarget(wallRT); renderer.render(bake.s, ortho); renderer.setRenderTarget(null);
          wallU.tWall.value = wallRT.texture; wallDirty = false;
        }
        wallU.uTime.value = t; wallU.uFlood.value = state.flood;
        for (let i = 0; i < 8; i++) {
          const l = state.lights[i];
          wallU.uL.value[i].set(l ? l.x : 0, l ? l.y : 0, l ? l.r : 0, l ? l.s : 0);
        }
        renderer.render(wall.s, ortho);
      } else if (state.mode === 'stage') {
        stageU.uTime.value = t; stageU.uOpen.value = state.open;
        renderer.render(stage.s, ortho);
      } else if (state.mode === 'duel') {
        const d = state.duel;
        duelU.uTime.value = t;
        duelU.uOpp.value.set(...d.opp); duelU.uMine.value.set(...d.mine);
        duelU.uI.value.set(d.oppOn, d.mineOn, d.heat, d.tips); duelU.uP.value.set(...d.p);
        renderer.render(duel.s, ortho);
      }
      const dt = lastT == null ? 0 : Math.min(0.05, Math.max(0, t - lastT)); lastT = t;
      if (puffs.length && stepSmoke(dt, t)) {
        if (!smokeRT) smokeRT = new THREE.WebGLRenderTarget(Math.max(1, Math.round(W * 0.5)), Math.max(1, Math.round(H * 0.5)), { depthBuffer: false });
        renderer.setRenderTarget(smokeRT); renderer.clear();
        renderer.render(puffScene, ortho);
        renderer.setRenderTarget(null);
        compU.tSrc.value = smokeRT.texture;
        renderer.render(comp.s, ortho);
      }
      const p = state.tt;
      if (!p || p.R < 1) return;
      maskU.uMOn.value = state.mode === 'wall' ? 1 : 0;
      if (state.mode === 'wall') {
        maskU.uMFlood.value = state.flood; maskU.uMDpr.value = DPR; maskU.uMRes.value.set(W, H);
        for (let i = 0; i < 8; i++) { const l = state.lights[i]; maskU.uML.value[i].set(l ? l.x : 0, l ? l.y : 0, l ? l.r : 0, l ? l.s : 0); }
      }
      root.position.set(p.x - W / 2, H / 2 - p.y, 0);
      root.scale.setScalar(p.R);
      tiltG.rotation.set(p.tiltY * 0.28, p.tiltX * 0.4, 0);
      outer.rotation.z = -p.ring;
      gimA.rotation.y = p.a; gimB.rotation.x = p.b;
      hg.rotation.z = -(p.flip || 0);
      if (Math.abs(p.sand - lastSand) > 0.003) { buildSand(p.sand); lastSand = p.sand; }
      stream.visible = p.flowing !== false && p.sand > 0.004 && p.sand < 0.996;
      if (p.text) setEngraving(p.text);
      const envI = p.env ?? 1;
      for (const m of metal) m.envMapIntensity = (m === glassMat ? 2.2 : 1) * envI;
      key.intensity = 2.4 * (p.key ?? 1); rim.intensity = 0.7 * (p.key ?? 1);
      sandMat.emissiveIntensity = 0.55 * Math.min(envI, 1.4);
      if (p.wand) { wand.position.set(p.wand.x - W / 2, H / 2 - p.wand.y, 160); wand.intensity = p.wand.s * 6; }
      else wand.intensity = 0;
      if (p.chainTop != null) {
        const topWorld = H / 2 - p.chainTop, rootY = H / 2 - p.y;
        const n = Math.ceil((topWorld - rootY) / p.R / 0.094) + 2;
        chain.count = Math.max(0, Math.min(MAXLINKS, n));
        chainG.rotation.z = -p.tiltX * 0.04;
        fade.uFadeTop.value = topWorld; fade.uFadeLen.value = 70;
        chain.visible = true;
      } else chain.visible = false;
      renderer.render(scene, camera);
    },
  };
}
