/*
 * PERSISTENCE — a computed dream after Salvador Dalí.
 *
 * The LUMEN engine (GPU particle simulation in float textures, morph targets,
 * fixed-substep physics, adaptive fidelity) rebuilt around four ideas from
 * Dalí's visual language:
 *
 *  MELTING  — a force field in the simulation shader sags and drips the
 *             morph targets themselves; near the cursor, matter heats and
 *             runs. The soft watch is not an animation, it is physics.
 *  DOUBLE IMAGE — the paranoiac-critical method, computed: a third target
 *             texture and a view-angle-driven blend mean one cloud of
 *             particles reads as a word face-on and reforms into a clock
 *             as you turn it.
 *  LONG SHADOWS — every particle is drawn twice more: once projected onto
 *             the desert floor along the low sun's slant, dark and soft.
 *             The shadows are what make the plain a place.
 *  THE PLAIN — the background shader is a persistent dreamscape: dusk sky,
 *             a low sun, a horizon, a plain that reflects the light.
 *
 * Everything degrades deliberately: no WebGL2 → a readable page on a painted
 * dusk gradient; prefers-reduced-motion → no idle animation, no custom
 * cursor; weak GPU → fidelity steps down until frame time behaves.
 */
'use strict';

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const doc = document.documentElement;
const reducedMq = matchMedia('(prefers-reduced-motion: reduce)');
const fineMq = matchMedia('(pointer: fine)');
let reduced = reducedMq.matches;
reducedMq.addEventListener?.('change', (e) => { reduced = e.matches; doc.classList.toggle('reduced', reduced); });
doc.classList.toggle('reduced', reduced);
doc.classList.toggle('fine', fineMq.matches);

const $ = (s) => document.querySelector(s);
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (t) => t * t * (3 - 2 * t);
const ease = (cur, target, k, dt) => cur + (target - cur) * (1 - Math.exp(-k * dt));

const GROUND_Y = -1.05; // the desert floor, in world units

// ---------------------------------------------------------------------------
// Scenes — five plates of the dream
// ---------------------------------------------------------------------------

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);

// pForce: radial cursor force (+repel −attract). pHeat: cursor-melt strength.
// melt: ambient sag/drip of the body itself. yaw: composed camera angle.
const SCENES = [
  { name: 'desert', root: 92.5, yaw: 0.3, shift: 0.35, shiftY: 0,
    spring: 2.2, noiseAmp: 0.22, noiseScale: 1.7, flow: 0.2, damp: 2.8,
    pForce: 1.6, pHeat: 0, pRad: 3.0, melt: 0.03, size: 2.2, alpha: 0.6, halo: 1.0,
    breathA: 0.02, breathR: 0.4,
    colA: hex('#ffd9a0'), colB: hex('#7cc7e8'),
    skyTop: hex('#16304f'), skyHz: hex('#e3aa5e'), plainA: hex('#a8743e'), plainB: hex('#472817'), sunI: 1.0, sunX: 0.74 },
  { name: 'watch', root: 82.41, yaw: 0.05, shift: 0.42, shiftY: -0.08,
    spring: 5.0, noiseAmp: 0.08, noiseScale: 2.4, flow: 0.35, damp: 4.2,
    pForce: 0.5, pHeat: 5.5, pRad: 5.0, melt: 0.34, size: 2.1, alpha: 0.7, halo: 0.8,
    breathA: 0.015, breathR: 0.5,
    colA: hex('#ffcf6e'), colB: hex('#ff9e58'),
    skyTop: hex('#1b2f4a'), skyHz: hex('#e8b96b'), plainA: hex('#b07a42'), plainB: hex('#4a2a18'), sunI: 1.0, sunX: 0.2 },
  { name: 'elephants', root: 73.42, yaw: 0.42, shift: 0.3, shiftY: 0,
    spring: 4.6, noiseAmp: 0.09, noiseScale: 2.8, flow: 0.5, damp: 4.2,
    pForce: 2.6, pHeat: 0, pRad: 4.5, melt: 0.05, size: 2.0, alpha: 0.66, halo: 0.9,
    breathA: 0.02, breathR: 0.35,
    colA: hex('#d98a5b'), colB: hex('#e8b4a0'),
    skyTop: hex('#142a45'), skyHz: hex('#d89a52'), plainA: hex('#9c6a3a'), plainB: hex('#3f2413'), sunI: 0.9, sunX: 0.76 },
  { name: 'double', root: 110.0, yaw: 0.0, shift: 0.5, shiftY: -0.16,
    spring: 11.0, noiseAmp: 0.03, noiseScale: 2.4, flow: 0.35, damp: 6.0,
    pForce: 0.3, pHeat: 0, pRad: 9.0, melt: 0.015, size: 1.9, alpha: 0.6, halo: 0.3,
    breathA: 0.012, breathR: 0.5,
    colA: hex('#f5ead6'), colB: hex('#8fc3e8'),
    skyTop: hex('#10233c'), skyHz: hex('#c9a06a'), plainA: hex('#8a5c34'), plainB: hex('#37200f'), sunI: 0.55, sunX: 0.22 },
  { name: 'galatea', root: 87.31, yaw: 0.25, shift: 0.35, shiftY: -0.14,
    spring: 3.2, noiseAmp: 0.11, noiseScale: 1.5, flow: 0.4, damp: 3.0,
    pForce: -1.4, pHeat: 0, pRad: 1.6, melt: 0.03, size: 2.3, alpha: 0.62, halo: 1.0,
    breathA: 0.04, breathR: 0.45,
    colA: hex('#ffb8c4'), colB: hex('#f2e2c4'),
    skyTop: hex('#1a2c4e'), skyHz: hex('#d9a570'), plainA: hex('#9c6a4a'), plainB: hex('#40241a'), sunI: 0.75, sunX: 0.7 },
];

function blendScenes(a, b, t) {
  const out = {};
  for (const k of Object.keys(a)) {
    const va = a[k];
    if (typeof va === 'number') out[k] = lerp(va, b[k], t);
    else if (Array.isArray(va)) out[k] = va.map((v, i) => lerp(v, b[k][i], t));
    else out[k] = t < 0.5 ? va : b[k];
  }
  return out;
}

// ---------------------------------------------------------------------------
// Target-shape generation
// ---------------------------------------------------------------------------

const gauss = (rand) => {
  let u = 0, v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};

function mulberry(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Sample lit pixels of a 2D-canvas drawing into particle targets. */
function sampleCanvas(draw, n, out, rand, { width = 1024, height = 1024, scale = 2.2, cx = 0, cy = 0, zJitter = 0.035 } = {}) {
  const c = document.createElement('canvas');
  c.width = width; c.height = height;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.fillStyle = '#000'; g.fillRect(0, 0, width, height);
  g.fillStyle = '#fff'; g.strokeStyle = '#fff';
  draw(g, width, height);
  const img = g.getImageData(0, 0, width, height).data;
  const pts = [];
  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      if (img[(y * width + x) * 4] > 128) pts.push(x, y);
    }
  }
  const k = scale / width;
  for (let i = 0; i < n; i++) {
    const p = (Math.floor(rand() * (pts.length / 2))) * 2;
    out.push(
      (pts[p] - width / 2) * k + cx + gauss(rand) * 0.004,
      -(pts[p + 1] - height / 2) * k + cy + gauss(rand) * 0.004,
      gauss(rand) * zJitter
    );
  }
}

/** Draw a pocket-watch face: ring, ticks, roman numerals, hands, crown. */
function drawClock(g, w, h) {
  const cx = w / 2, cy = h / 2, R = w * 0.4;
  g.lineWidth = w * 0.028;
  g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.stroke();
  g.lineWidth = w * 0.008;
  g.beginPath(); g.arc(cx, cy, R * 0.86, 0, Math.PI * 2); g.stroke();
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const r1 = R * 0.88, r2 = R * 0.96;
    g.lineWidth = w * (i % 3 === 0 ? 0.014 : 0.007);
    g.beginPath();
    g.moveTo(cx + Math.sin(a) * r1, cy - Math.cos(a) * r1);
    g.lineTo(cx + Math.sin(a) * r2, cy - Math.cos(a) * r2);
    g.stroke();
  }
  g.font = `italic ${Math.round(w * 0.11)}px Georgia, serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const nums = [['XII', 0], ['III', 0.25], ['VI', 0.5], ['IX', 0.75]];
  for (const [txt, f] of nums) {
    const a = f * Math.PI * 2;
    g.fillText(txt, cx + Math.sin(a) * R * 0.7, cy - Math.cos(a) * R * 0.7);
  }
  // Hands at Dalí's drooping afternoon; minute long, hour short, both tapered.
  const hand = (angle, len, wd) => {
    g.save();
    g.translate(cx, cy); g.rotate(angle);
    g.beginPath();
    g.moveTo(-wd * w, 0); g.lineTo(0, -len * R); g.lineTo(wd * w, 0);
    g.closePath(); g.fill();
    g.restore();
  };
  hand(Math.PI * 0.97, 0.62, 0.012);       // hour toward VI
  hand(Math.PI * 1.63, 0.8, 0.008);        // minute toward IX-ish
  g.beginPath(); g.arc(cx, cy, w * 0.02, 0, Math.PI * 2); g.fill();
  // Winding crown at XII.
  g.beginPath(); g.arc(cx, cy - R * 1.09, w * 0.035, 0, Math.PI * 2); g.stroke();
}

/** A spindly-legged elephant, Dalí proportions: tiny body, endless legs. */
function pushElephant(out, rand, { ox = 0, oz = 0, scale = 1, mirror = 1, share } = {}) {
  const P = (x, y, z, jitter = 0.02) => out.push(
    ox + mirror * x * scale + gauss(rand) * jitter,
    y * scale + GROUND_Y + (1.05 + GROUND_Y) * 0 + gauss(rand) * jitter, // y already absolute below
    oz + z * scale + gauss(rand) * jitter
  );
  // Everything in a local frame where the ground is y = GROUND_Y.
  const gy = GROUND_Y;
  const bodyC = { x: 0, y: gy + 2.05 * scale, z: 0 };
  const n = share;
  for (let i = 0; i < n; i++) {
    const u = rand();
    if (u < 0.3) {
      // Body: small ellipsoid held absurdly high.
      const th = rand() * Math.PI * 2, ph = Math.acos(rand() * 2 - 1);
      const r = Math.cbrt(rand());
      out.push(
        ox + mirror * (Math.sin(ph) * Math.cos(th) * 0.4 * r) * scale + gauss(rand) * 0.012,
        bodyC.y + (Math.cos(ph) * 0.23 * r) * scale,
        oz + (Math.sin(ph) * Math.sin(th) * 0.26 * r) * scale
      );
    } else if (u < 0.42) {
      // Head + brow.
      const th = rand() * Math.PI * 2, ph = Math.acos(rand() * 2 - 1);
      out.push(
        ox + mirror * (0.42 + Math.sin(ph) * Math.cos(th) * 0.13) * scale,
        bodyC.y + (0.07 + Math.cos(ph) * 0.12) * scale,
        oz + (Math.sin(ph) * Math.sin(th) * 0.11) * scale
      );
    } else if (u < 0.5) {
      // Trunk: quadratic bezier drooping forward.
      const t = rand();
      const bx = (1 - t) * (1 - t) * 0.52 + 2 * (1 - t) * t * 0.78 + t * t * 0.62;
      const by = (1 - t) * (1 - t) * (bodyC.y + 0.02 * scale) + 2 * (1 - t) * t * (bodyC.y - 0.5 * scale) + t * t * (gy + 0.75 * scale);
      out.push(
        ox + mirror * bx * scale + gauss(rand) * 0.018,
        by + gauss(rand) * 0.018,
        oz + gauss(rand) * 0.018
      );
    } else if (u < 0.56) {
      // Ears: two thin discs.
      const side = rand() < 0.5 ? 1 : -1;
      const a = rand() * Math.PI * 2, r = Math.sqrt(rand()) * 0.15;
      out.push(
        ox + mirror * (0.33 + Math.cos(a) * r * 0.4) * scale,
        bodyC.y + (0.1 + Math.sin(a) * r) * scale,
        oz + side * (0.13 + r * 0.25) * scale
      );
    } else if (u < 0.985) {
      // Four legs: hip → knee → splayed foot, each a tapered polyline. The
      // legs are the whole joke: two and a half units of leg for a quarter
      // unit of elephant.
      const leg = (rand() * 4) | 0;
      const sx = leg % 2 ? 1 : -1, sz = leg < 2 ? 1 : -1;
      const hip = { x: sx * 0.22, y: bodyC.y - 0.18 * scale, z: sz * 0.15 };
      const knee = { x: sx * 0.34, y: gy + (bodyC.y - gy) * 0.5, z: sz * 0.3 };
      const foot = { x: sx * 0.52, y: gy + 0.015, z: sz * 0.46 };
      const t = rand();
      const seg = t < 0.5 ? [hip, knee, t * 2] : [knee, foot, (t - 0.5) * 2];
      const [A, B, f] = seg;
      const taper = 0.02 * (1 - t * 0.65) * scale;
      out.push(
        ox + mirror * (A.x + (B.x - A.x) * f) * scale + gauss(rand) * taper,
        (A.y + (B.y - A.y) * f) + gauss(rand) * taper,
        oz + (A.z + (B.z - A.z) * f) * scale + gauss(rand) * taper
      );
    } else {
      // Tail.
      const t = rand();
      out.push(
        ox + mirror * (-0.42 - t * 0.1) * scale,
        bodyC.y - t * 0.28 * scale,
        oz + gauss(rand) * 0.015
      );
    }
  }
  void P;
}

function makeTargets(scene, n) {
  const rand = mulberry(4000 + scene * 7919);
  const pts = [];
  const TAU = Math.PI * 2;

  if (scene === 0) {
    // The plain, an egg where the horizon should be, and dust.
    for (let i = 0; i < n; i++) {
      const u = rand();
      if (u < 0.58) {
        const x = (rand() * 2 - 1) * 2.3;
        const z = (rand() * 2 - 1) * 1.5 - 0.2;
        const ripple = Math.sin(x * 2.1 + z * 1.3) * 0.02 + Math.sin(x * 5.7) * 0.008;
        pts.push(x, GROUND_Y + 0.01 + ripple + rand() * 0.015, z);
      } else if (u < 0.82) {
        // The egg, floating.
        const th = rand() * TAU, ph = Math.acos(rand() * 2 - 1);
        const r = 0.92 + rand() * 0.08; // shell, slightly thick
        const ey = 1.28; // egg elongation
        pts.push(
          0.62 + Math.sin(ph) * Math.cos(th) * 0.3 * r,
          0.28 + Math.cos(ph) * 0.3 * ey * r,
          Math.sin(ph) * Math.sin(th) * 0.3 * r
        );
      } else if (u < 0.9) {
        // A thin obelisk keeping the egg company.
        const t = rand();
        pts.push(
          -0.85 + gauss(rand) * 0.03,
          GROUND_Y + t * 1.15,
          -0.5 + gauss(rand) * 0.03
        );
      } else {
        pts.push((rand() * 2 - 1) * 2.2, GROUND_Y + rand() * 2.4, (rand() * 2 - 1) * 1.4);
      }
    }
  } else if (scene === 1) {
    // The soft watch: a full pocket-watch face; the melting is done live by
    // the simulation shader, so the shape itself is drawn crisp.
    sampleCanvas(drawClock, n, pts, rand, { scale: 1.55, cx: 0, cy: 0.18, zJitter: 0.035 });
  } else if (scene === 2) {
    const each = Math.floor(n / 2);
    pushElephant(pts, rand, { ox: 0.55, oz: -0.1, scale: 1.0, mirror: 1, share: each });
    pushElephant(pts, rand, { ox: -0.9, oz: -0.55, scale: 0.82, mirror: -1, share: n - each });
  } else if (scene === 3) {
    // Double image, face A: the word. (Face C, the clock, is its own texture.)
    // Stroked, not filled: an outline reads as letterforms in additive light,
    // where a filled glyph is just a bright blot. Two stroke weights give the
    // wire a beaded edge.
    sampleCanvas((g, w, h) => {
      g.font = `italic 700 ${Math.round(w * 0.27)}px Georgia, "Times New Roman", serif`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.lineWidth = w * 0.014;
      g.strokeText('TIME', w / 2, h / 2);
      g.lineWidth = w * 0.004;
      g.strokeText('TIME', w / 2, h / 2);
    }, n, pts, rand, { width: 1400, height: 560, scale: 2.2, cx: 0, cy: -0.02, zJitter: 0.015 });
  } else if (scene === 4) {
    // Galatea: a dome of small spheres, concentric rings, held apart.
    const rings = [];
    for (let ring = 0; ring < 7; ring++) {
      const phi = 0.18 * Math.PI + (ring / 7) * 0.42 * Math.PI;
      const count = 3 + ring * 2;
      for (let c = 0; c < count; c++) {
        const th = (c / count) * TAU + ring * 0.35;
        rings.push([
          Math.sin(phi) * Math.cos(th) * 1.0,
          0.32 + Math.cos(phi) * 1.0,
          Math.sin(phi) * Math.sin(th) * 0.55 + 0.1,
        ]);
      }
    }
    // Inner shell, sparser.
    for (let ring = 0; ring < 4; ring++) {
      const phi = 0.22 * Math.PI + (ring / 4) * 0.36 * Math.PI;
      const count = 2 + ring * 2;
      for (let c = 0; c < count; c++) {
        const th = (c / count) * TAU + ring * 0.9 + 0.4;
        rings.push([
          Math.sin(phi) * Math.cos(th) * 0.62,
          0.32 + Math.cos(phi) * 0.62,
          Math.sin(phi) * Math.sin(th) * 0.36 + 0.1,
        ]);
      }
    }
    for (let i = 0; i < n; i++) {
      const c = rings[(rand() * rings.length) | 0];
      const th = rand() * TAU, ph = Math.acos(rand() * 2 - 1);
      const r = 0.07 * Math.cbrt(rand());
      pts.push(
        c[0] + Math.sin(ph) * Math.cos(th) * r,
        c[1] + Math.cos(ph) * r,
        c[2] + Math.sin(ph) * Math.sin(th) * r
      );
    }
  } else if (scene === 5) {
    // Face C of the double image: a crisp clock in the same footprint as TIME.
    sampleCanvas(drawClock, n, pts, rand, { scale: 1.4, cx: 0, cy: -0.02, zJitter: 0.02 });
  }

  const out = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    out[i * 4] = pts[i * 3] ?? 0;
    out[i * 4 + 1] = pts[i * 3 + 1] ?? 0;
    out[i * 4 + 2] = pts[i * 3 + 2] ?? 0;
    out[i * 4 + 3] = 1;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Shaders
// ---------------------------------------------------------------------------

const NOISE_GLSL = /* glsl */`
vec3 mod289(vec3 x){return x - floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x - floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159 - 0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C = vec2(1.0/6.0, 1.0/3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(
      i.z + vec4(0.0, i1.z, i2.z, 1.0))
    + i.y + vec4(0.0, i1.y, i2.y, 1.0))
    + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0)*2.0 + 1.0;
  vec4 s1 = floor(b1)*2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m*m;
  return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}
vec3 curl(vec3 p){
  const float e = 0.14;
  vec3 ox = vec3(e,0.,0.), oy = vec3(0.,e,0.), oz = vec3(0.,0.,e);
  vec3 o2 = vec3(41.3,-27.7,13.1), o3 = vec3(-19.4,63.2,-41.9);
  float p3y = snoise(p+o3+oy)-snoise(p+o3-oy);
  float p2z = snoise(p+o2+oz)-snoise(p+o2-oz);
  float p1z = snoise(p+oz)-snoise(p-oz);
  float p3x = snoise(p+o3+ox)-snoise(p+o3-ox);
  float p2x = snoise(p+o2+ox)-snoise(p+o2-ox);
  float p1y = snoise(p+oy)-snoise(p-oy);
  return vec3(p3y-p2z, p1z-p3x, p2x-p1y) / (2.0*e);
}`;

const FULLSCREEN_VS = /* glsl */`#version 300 es
void main(){
  vec2 p = vec2((gl_VertexID<<1 & 2), (gl_VertexID & 2));
  gl_Position = vec4(p*2.0-1.0, 0.0, 1.0);
}`;

const SIM_INIT_FS = /* glsl */`#version 300 es
precision highp float;
layout(location=0) out vec4 oPos;
layout(location=1) out vec4 oVel;
float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
void main(){
  vec2 uv = gl_FragCoord.xy;
  float r1=h(uv), r2=h(uv+13.1), r3=h(uv+71.7), r4=h(uv+29.3), r5=h(uv+5.5);
  // Birth as wind-borne sand: a wide sheet above the plain.
  oPos = vec4((r1*2.0-1.0)*4.5, 1.5 + r2*3.0, (r3*2.0-1.0)*3.0, r4);
  oVel = vec4(0.0, 0.0, 0.0, r5);
}`;

const SIM_STEP_FS = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D uPos, uVel, uTargetA, uTargetB, uTargetC;
uniform float uMorph, uDouble, uDoubleSlot, uDoubleYaw, uDt, uTime, uSpring, uNoiseAmp, uNoiseScale, uFlow, uDamp, uBreathA, uBreathR;
uniform float uMelt, uHeat, uGroundY;
uniform vec3 uShiftV;
uniform vec3 uPointer;
uniform float uPointerForce, uPointerRad;
uniform vec4 uShock;
layout(location=0) out vec4 oPos;
layout(location=1) out vec4 oVel;
${'{NOISE}'}
void main(){
  ivec2 uv = ivec2(gl_FragCoord.xy);
  vec4 P = texelFetch(uPos, uv, 0);
  vec4 V = texelFetch(uVel, uv, 0);
  vec3 pos = P.xyz, vel = V.xyz;

  float breath = 1.0 + uBreathA * sin(uTime * uBreathR * 6.2831853);
  // The paranoiac pre-mix: the double image's word melts into its clock as
  // the view turns, BEFORE the scroll morph blends toward the next plate.
  // uDoubleSlot says which scroll slot currently holds plate iv (0 = A,
  // 1 = B, anything else = neither) so the premix never corrupts a
  // neighbouring plate mid-scroll.
  vec3 rawA = texelFetch(uTargetA, uv, 0).xyz;
  vec3 rawB = texelFetch(uTargetB, uv, 0).xyz;
  vec3 rawC = texelFetch(uTargetC, uv, 0).xyz;
  // The second image lives in your angle of view, not in the object: the
  // clock plate counter-rotates with the camera (a lenticular print), so
  // turning collapses the word and turns the clock to face you.
  float cD = cos(uDoubleYaw), sD = sin(uDoubleYaw);
  rawC = vec3(rawC.x * cD - rawC.z * sD, rawC.y, rawC.x * sD + rawC.z * cD);
  vec3 tA = abs(uDoubleSlot - 0.0) < 0.5 ? mix(rawA, rawC, uDouble) : rawA;
  vec3 tB = abs(uDoubleSlot - 1.0) < 0.5 ? mix(rawB, rawC, uDouble) : rawB;
  vec3 target = mix(tA, tB, uMorph);

  // The melting: matter sags from its own shape, waves slowly, oozes
  // sideways. Radius is measured from the shape's own centre of hang.
  float hang = length(vec2(target.x, target.y - 0.18));
  float rim = smoothstep(0.25, 0.85, hang);
  // Below the waist the shape lets go; above it, it merely leans.
  float below = 1.0 - smoothstep(-0.55, 0.25, target.y - 0.18);
  float sagW = rim * (0.18 + 0.82 * below);
  float sag = uMelt * sagW * (0.6 + 0.4 * sin(uTime * 0.42 + target.x * 2.1 + P.w * 2.2));
  target.y -= sag * (1.0 + 1.6 * below);
  target.x += uMelt * 0.1 * sagW * sin(uTime * 0.3 + target.y * 3.1);
  target = target * breath + uShiftV;
  // Nothing rests below the desert floor.
  target.y = max(target.y, uGroundY + 0.005);

  vec3 acc = (target - pos) * uSpring;
  acc += curl(pos * uNoiseScale + vec3(0.0, 0.0, uTime * uFlow)) * uNoiseAmp;

  vec3 dp = pos - uPointer;
  float d2 = dot(dp, dp);
  acc += (dp / (sqrt(d2) + 0.04)) * uPointerForce * exp(-d2 * uPointerRad);
  // Cursor heat: nearby matter loses its grip and runs downward.
  float heatW = uHeat * exp(-d2 * 3.0);
  acc.y -= heatW;
  acc.x += heatW * 0.35 * sin(uTime * 2.0 + P.w * 12.0);

  if (uShock.w < 2.0) {
    vec3 ds = pos - uShock.xyz;
    float r = length(ds);
    float w = exp(-pow(r - 2.3 * uShock.w, 2.0) * 26.0) * exp(-uShock.w * 3.0);
    acc += (ds / max(r, 0.05)) * w * 9.0;
  }

  vel = (vel + acc * uDt) * exp(-uDamp * uDt);
  pos += vel * uDt;
  pos.y = max(pos.y, uGroundY - 0.02);
  oPos = vec4(pos, P.w);
  oVel = vec4(vel, V.w);
}`.replace('{NOISE}', NOISE_GLSL);

const POINTS_VS = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D uPos, uVel;
uniform mat4 uView, uProj;
uniform int uSimSize;
uniform float uPointSize, uDpr;
uniform float uPass;        // 0 = shadow, 1 = body
uniform float uGroundY;
uniform vec2 uSunSlant;     // shadow shear per unit height
out float vHue;
out float vSpeed;
out float vFade;
void main(){
  ivec2 uv = ivec2(gl_VertexID % uSimSize, gl_VertexID / uSimSize);
  vec4 P = texelFetch(uPos, uv, 0);
  vec4 V = texelFetch(uVel, uv, 0);
  vec3 world = P.xyz;
  float h = max(0.0, world.y - uGroundY);
  if (uPass < 0.5) {
    // The long shadow: flatten onto the plain, sheared away from the low sun.
    world = vec3(world.x + h * uSunSlant.x, uGroundY + 0.004, world.z + h * uSunSlant.y);
  }
  vec4 viewPos = uView * vec4(world, 1.0);
  gl_Position = uProj * viewPos;
  float dist = max(0.3, -viewPos.z);
  float sizeMul = uPass < 0.5 ? (1.4 + h * 0.7) : 1.0; // shadows soften with height
  gl_PointSize = clamp(uPointSize * sizeMul * uDpr / dist, 1.25 * uDpr, 56.0 * uDpr);
  vHue = fract(P.w + V.w * 0.37);
  vSpeed = length(V.xyz);
  // Shadows fade as their caster rises; bodies fade with camera distance.
  vFade = uPass < 0.5 ? exp(-h * 0.9) : smoothstep(8.0, 2.4, dist);
}`;

const POINTS_FS = /* glsl */`#version 300 es
precision highp float;
uniform vec3 uColA, uColB;
uniform float uAlpha, uCore, uPass;
in float vHue;
in float vSpeed;
in float vFade;
out vec4 frag;
void main(){
  float d = length(gl_PointCoord - 0.5) * 2.0;
  if (d > 1.0) discard;
  float a = (1.0 - d) * (1.0 - d);
  if (uPass < 0.5) {
    // Shadow pass: flat dark umber, standard alpha blending.
    frag = vec4(0.09, 0.05, 0.03, a * uAlpha * vFade);
    return;
  }
  vec3 col = mix(uColA, uColB, clamp(vHue + vSpeed * 0.35, 0.0, 1.0));
  col += vec3(0.55) * pow(1.0 - d, 6.0) * uCore;
  frag = vec4(col * a * uAlpha * vFade, 1.0);
}`;

const BG_FS = /* glsl */`#version 300 es
precision highp float;
uniform vec2 uRes;
uniform vec3 uSkyTop, uSkyHz, uPlainA, uPlainB, uGlow;
uniform float uSunI, uSunX, uTime;
uniform vec2 uPointerNdc;
out vec4 frag;
float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)))*43758.5453); }
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;      // y up
  float aspect = uRes.x / uRes.y;
  const float HZ = 0.44;                 // horizon height
  vec2 sun = vec2(uSunX, HZ + 0.10);

  vec3 col;
  if (uv.y > HZ) {
    // Sky: horizon amber into dusk blue, banded faintly like a long exposure.
    float t = pow((uv.y - HZ) / (1.0 - HZ), 0.72);
    col = mix(uSkyHz, uSkyTop, t);
    col += vec3(0.05, 0.02, -0.02) * sin(uv.y * 40.0 + uTime * 0.05) * 0.12 * (1.0 - t);
  } else {
    // The plain, falling away to darkness at the near edge.
    float t = pow((HZ - uv.y) / HZ, 0.85);
    col = mix(uPlainA, uPlainB, t);
    // The sun's reflection: a soft column smeared down the wet sand.
    float dx = (uv.x - sun.x) * aspect;
    float refl = exp(-dx * dx * 55.0) * exp(-(HZ - uv.y) * 6.5);
    refl *= 0.75 + 0.25 * sin(uv.y * 220.0 + uTime * 0.6);
    col += uGlow * refl * 0.4 * uSunI;
  }

  // The low sun itself: a core and a wide bloom that crosses the horizon.
  vec2 d = vec2((uv.x - sun.x) * aspect, uv.y - sun.y);
  float dd = dot(d, d);
  col += uGlow * (exp(-dd * 320.0) * 0.9 + exp(-dd * 22.0) * 0.28) * uSunI;

  // A faint gold presence under the cursor.
  vec2 m = vec2((uPointerNdc.x * 0.5 + 0.5 - uv.x) * aspect, (uPointerNdc.y * 0.5 + 0.5) - uv.y);
  col += uGlow * 0.1 * exp(-dot(m, m) * 14.0);

  // Vignette and grain.
  vec2 vc = uv - 0.5;
  col *= 1.0 - dot(vc, vc) * 0.55;
  col += (hash(gl_FragCoord.xy + fract(uTime) * 61.7) - 0.5) * 0.03;
  frag = vec4(col, 1.0);
}`;

// ---------------------------------------------------------------------------
// GL engine
// ---------------------------------------------------------------------------

function createEngine(canvas) {
  const gl = canvas.getContext('webgl2', {
    antialias: false, alpha: false, depth: false, stencil: false,
    powerPreference: 'high-performance',
  });
  if (!gl) return null;

  const floatBuf = gl.getExtension('EXT_color_buffer_float');
  const halfBuf = floatBuf ? null : gl.getExtension('EXT_color_buffer_half_float');
  if (!floatBuf && !halfBuf) return null;
  const simFormat = floatBuf ? gl.RGBA32F : gl.RGBA16F;
  const simType = floatBuf ? gl.FLOAT : gl.HALF_FLOAT;

  const compile = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('shader: ' + gl.getShaderInfoLog(s));
    return s;
  };
  const program = (vs, fs) => {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('link: ' + gl.getProgramInfoLog(p));
    const uniforms = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(p, i);
      uniforms[info.name] = gl.getUniformLocation(p, info.name);
    }
    return { p, u: uniforms };
  };

  const coarse = matchMedia('(pointer: coarse)').matches;
  const cores = navigator.hardwareConcurrency || 4;
  let simSize = coarse ? 256 : cores >= 8 ? 512 : 384;

  const makeSimTex = () => {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, simFormat, simSize, simSize, 0, gl.RGBA, simType, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  };
  const makeTargetTex = () => {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, simSize, simSize, 0, gl.RGBA, gl.FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    return t;
  };

  const state = {};
  const buildSim = () => {
    state.texA = { pos: makeSimTex(), vel: makeSimTex(), fbo: gl.createFramebuffer() };
    state.texB = { pos: makeSimTex(), vel: makeSimTex(), fbo: gl.createFramebuffer() };
    for (const s of [state.texA, state.texB]) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, s.fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, s.pos, 0);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, s.vel, 0);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    }
    state.targetA = makeTargetTex();
    state.targetB = makeTargetTex();
    state.targetC = makeTargetTex();
    gl.bindFramebuffer(gl.FRAMEBUFFER, state.texA.fbo);
    gl.viewport(0, 0, simSize, simSize);
    gl.useProgram(progInit.p);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  const progInit = program(FULLSCREEN_VS, SIM_INIT_FS);
  const progStep = program(FULLSCREEN_VS, SIM_STEP_FS);
  const progPts = program(POINTS_VS, POINTS_FS);
  const progBg = program(FULLSCREEN_VS, BG_FS);

  buildSim();

  const targetCache = new Map();
  const uploadTarget = (tex, sceneIdx) => {
    let data = targetCache.get(sceneIdx + ':' + simSize);
    if (!data) {
      data = makeTargets(sceneIdx, simSize * simSize);
      targetCache.set(sceneIdx + ':' + simSize, data);
    }
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, simSize, simSize, 0, gl.RGBA, gl.FLOAT, data);
  };

  const proj = new Float32Array(16);
  const view = new Float32Array(16);
  const setProj = (fovY, aspect, near, far) => {
    const f = 1 / Math.tan(fovY / 2);
    proj.fill(0);
    proj[0] = f / aspect; proj[5] = f;
    proj[10] = (far + near) / (near - far); proj[11] = -1;
    proj[14] = (2 * far * near) / (near - far);
  };
  const setView = (yaw, pitch, dist) => {
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const cx = Math.cos(pitch), sx = Math.sin(pitch);
    view.set([
      cy, sx * sy, -cx * sy, 0,
      0, cx, sx, 0,
      sy, -sx * cy, cx * cy, 0,
      0, 0, -dist, 1,
    ]);
  };

  let dpr = 1;
  const resize = (maxDpr) => {
    dpr = clamp(devicePixelRatio || 1, 1, maxDpr);
    const w = Math.round(canvas.clientWidth * dpr);
    const h = Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  };

  return {
    gl,
    get particleCount() { return simSize * simSize; },
    resize,
    uploadTargets(i, j) {
      uploadTarget(state.targetA, i);
      uploadTarget(state.targetB, j);
      // Face C (the clock) rides along whenever plate iv is in the pair.
      uploadTarget(state.targetC, i === 3 || j === 3 ? 5 : i);
    },
    frame(o) {
      const H = 1 / 90;
      const steps = clamp(Math.round(o.dt / H), 1, o.turbo ? 14 : 3);
      gl.disable(gl.BLEND);
      gl.viewport(0, 0, simSize, simSize);
      gl.useProgram(progStep.p);
      const su = progStep.u;
      const bind = (unit, tex, loc) => {
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.uniform1i(loc, unit);
      };
      bind(2, state.targetA, su.uTargetA);
      bind(3, state.targetB, su.uTargetB);
      bind(4, state.targetC, su.uTargetC);
      gl.uniform1f(su.uMorph, o.morph);
      gl.uniform1f(su.uDouble, o.double);
      gl.uniform1f(su.uDoubleSlot, o.doubleSlot);
      gl.uniform1f(su.uDoubleYaw, o.doubleYaw);
      gl.uniform1f(su.uDt, H);
      gl.uniform1f(su.uSpring, o.p.spring);
      gl.uniform1f(su.uNoiseAmp, o.calm ? 0.0 : o.p.noiseAmp);
      gl.uniform1f(su.uNoiseScale, o.p.noiseScale);
      gl.uniform1f(su.uFlow, o.p.flow);
      gl.uniform1f(su.uDamp, o.p.damp);
      gl.uniform1f(su.uBreathA, o.breathA);
      gl.uniform1f(su.uBreathR, o.breathR);
      gl.uniform1f(su.uMelt, o.p.melt);
      gl.uniform1f(su.uHeat, o.p.pHeat * o.pointerActive);
      gl.uniform1f(su.uGroundY, GROUND_Y);
      gl.uniform3fv(su.uShiftV, o.shift);
      gl.uniform3fv(su.uPointer, o.pointerWorld);
      gl.uniform1f(su.uPointerForce, o.p.pForce * o.pointerActive);
      gl.uniform1f(su.uPointerRad, o.p.pRad);
      for (let s = 0; s < steps; s++) {
        gl.uniform1f(su.uTime, o.time + s * H);
        gl.uniform4fv(su.uShock, o.shock);
        o.shock[3] += H;
        gl.bindFramebuffer(gl.FRAMEBUFFER, state.texB.fbo);
        bind(0, state.texA.pos, su.uPos);
        bind(1, state.texA.vel, su.uVel);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        const tmp = state.texA; state.texA = state.texB; state.texB = tmp;
      }

      // ---- render ----------------------------------------------------
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvas.width, canvas.height);

      gl.useProgram(progBg.p);
      const bu = progBg.u;
      gl.uniform2f(bu.uRes, canvas.width, canvas.height);
      gl.uniform3fv(bu.uSkyTop, o.p.skyTop);
      gl.uniform3fv(bu.uSkyHz, o.p.skyHz);
      gl.uniform3fv(bu.uPlainA, o.p.plainA);
      gl.uniform3fv(bu.uPlainB, o.p.plainB);
      gl.uniform3fv(bu.uGlow, o.p.skyHz);
      gl.uniform1f(bu.uSunI, o.p.sunI);
      gl.uniform1f(bu.uSunX, o.p.sunX);
      gl.uniform2fv(bu.uPointerNdc, o.pointerNdc);
      gl.uniform1f(bu.uTime, o.time);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      setProj(0.87, canvas.width / canvas.height, 0.1, 30);
      setView(o.yaw, o.pitch, o.dist);

      gl.useProgram(progPts.p);
      const pu = progPts.u;
      bind(0, state.texA.pos, pu.uPos);
      bind(1, state.texA.vel, pu.uVel);
      gl.uniformMatrix4fv(pu.uView, false, view);
      gl.uniformMatrix4fv(pu.uProj, false, proj);
      gl.uniform1i(pu.uSimSize, simSize);
      gl.uniform1f(pu.uDpr, dpr);
      gl.uniform1f(pu.uGroundY, GROUND_Y);
      gl.uniform2f(pu.uSunSlant, -0.55, 0.3);
      gl.uniform3fv(pu.uColA, o.p.colA);
      gl.uniform3fv(pu.uColB, o.p.colB);

      const count = Math.floor(simSize * simSize * o.drawFraction);

      // Pass 1: the long shadows, ordinary alpha blending onto the plain.
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.uniform1f(pu.uPass, 0);
      gl.uniform1f(pu.uPointSize, o.p.size * 2.2);
      gl.uniform1f(pu.uAlpha, 0.05);
      gl.uniform1f(pu.uCore, 0.0);
      gl.drawArrays(gl.POINTS, 0, Math.floor(count / 2));

      // Passes 2 and 3: the glowing body — halo, then sharp core. Additive.
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.uniform1f(pu.uPass, 1);
      gl.uniform1f(pu.uPointSize, o.p.size * 4.5);
      gl.uniform1f(pu.uAlpha, o.p.alpha * 0.035 * o.p.halo);
      gl.drawArrays(gl.POINTS, 0, Math.floor(count / 3));

      gl.uniform1f(pu.uPointSize, o.p.size);
      gl.uniform1f(pu.uAlpha, o.p.alpha);
      gl.uniform1f(pu.uCore, 0.55);
      gl.drawArrays(gl.POINTS, 0, count);
    },
  };
}

// ---------------------------------------------------------------------------
// Audio — a dream drone, silent until asked
// ---------------------------------------------------------------------------

const audio = {
  ctx: null, on: false, master: null, filter: null, oscA: null, oscB: null, oscC: null,

  build() {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(ctx.destination);

    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 360;
    this.filter.Q.value = 1.2;
    this.filter.connect(this.master);

    const mk = (type, freq, gain, detune = 0) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq;
      o.detune.value = detune;
      const g = ctx.createGain();
      g.gain.value = gain;
      o.connect(g); g.connect(this.filter);
      o.start();
      return o;
    };
    this.oscA = mk('triangle', SCENES[0].root, 0.07);
    this.oscB = mk('sawtooth', SCENES[0].root * 1.5, 0.02, 5);
    // A quiet minor third above the root — the unease under the calm.
    this.oscC = mk('sine', SCENES[0].root * 1.189, 0.03, -4);

    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = buf; noise.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 700; bp.Q.value = 0.5;
    const ng = ctx.createGain(); ng.gain.value = 0.012;
    noise.connect(bp); bp.connect(ng); ng.connect(this.master);
    noise.start();

    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.05;
    const lg = ctx.createGain(); lg.gain.value = 90;
    lfo.connect(lg); lg.connect(this.filter.frequency);
    lfo.start();
  },

  toggle() {
    if (!this.ctx) this.build();
    this.ctx.resume();
    this.on = !this.on;
    this.master.gain.setTargetAtTime(this.on ? 0.5 : 0, this.ctx.currentTime, 0.5);
    return this.on;
  },

  setRoot(root) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.oscA.frequency.linearRampToValueAtTime(root, t + 2.4);
    this.oscB.frequency.linearRampToValueAtTime(root * 1.5, t + 2.4);
    this.oscC.frequency.linearRampToValueAtTime(root * 1.189, t + 2.4);
  },

  drive(v) {
    if (!this.ctx || !this.on) return;
    const f = 320 + clamp(v, 0, 1) * 1900;
    this.filter.frequency.setTargetAtTime(f, this.ctx.currentTime, 0.3);
  },

  pluck(root) {
    if (!this.ctx || !this.on) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(root * 4, t);
    // A falling bell: the strike slides down a whole tone as it dies.
    o.frequency.exponentialRampToValueAtTime(root * 3.56, t + 0.9);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.2, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + 1.2);
  },
};

// ---------------------------------------------------------------------------
// Page wiring
// ---------------------------------------------------------------------------

const panels = [...document.querySelectorAll('.panel')];

for (const h of document.querySelectorAll('.panel h2')) {
  const nodes = [...h.childNodes];
  h.setAttribute('aria-label', nodes.map((n) => n.nodeName === 'BR' ? ' ' : n.textContent).join('').replace(/\s+/g, ' ').trim());
  h.textContent = '';
  let i = 0;
  const rr = mulberry(7);
  // Words wrap as words: each one is an atomic inline-block of letter
  // spans, so a line can never break in the middle of "spheres."
  for (const node of nodes) {
    if (node.nodeName === 'BR') { h.appendChild(document.createElement('br')); continue; }
    for (const part of node.textContent.split(/(\s+)/)) {
      if (!part) continue;
      if (/^\s+$/.test(part)) { h.appendChild(document.createTextNode(' ')); continue; }
      const w = document.createElement('span');
      w.className = 'w';
      w.setAttribute('aria-hidden', 'true');
      for (const ch of part) {
        const s = document.createElement('span');
        s.className = 'ch';
        s.textContent = ch;
        s.style.setProperty('--i', i);
        s.style.setProperty('--z', ((i % 3) - 1) * 5);
        s.style.setProperty('--r', ((rr() * 10 - 5)).toFixed(1));
        w.appendChild(s);
        i++;
      }
      h.appendChild(w);
    }
  }
}

const dotsNav = $('#dots');
panels.forEach((p) => {
  const a = document.createElement('a');
  a.href = '#';
  a.setAttribute('aria-label', p.dataset.title);
  a.addEventListener('click', (e) => {
    e.preventDefault();
    p.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' });
  });
  dotsNav.appendChild(a);
});
const dotEls = [...dotsNav.children];

const soundBtn = $('#sound');
const syncSound = (on) => soundBtn.setAttribute('aria-pressed', String(on));
soundBtn.addEventListener('click', () => syncSound(audio.toggle()));
$('#sound2').addEventListener('click', () => syncSound(audio.toggle()));
$('#replay').addEventListener('click', () =>
  window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' }));

const pointer = {
  x: innerWidth / 2, y: innerHeight / 2,
  ex: innerWidth / 2, ey: innerHeight / 2,
  rx: innerWidth / 2, ry: innerHeight / 2,
  nx: 0, ny: 0,
  active: 0, speed: 0, lastT: 0,
};
addEventListener('pointermove', (e) => {
  const dt = Math.max(1, e.timeStamp - pointer.lastT);
  pointer.speed = Math.hypot(e.clientX - pointer.x, e.clientY - pointer.y) / dt;
  pointer.lastT = e.timeStamp;
  pointer.x = e.clientX; pointer.y = e.clientY;
  pointer.active = 1;
  doc.classList.add('cur-on');
}, { passive: true });
addEventListener('pointerleave', () => { pointer.active = 0; doc.classList.remove('cur-on'); });
document.addEventListener('mouseleave', () => { pointer.active = 0; doc.classList.remove('cur-on'); });

const curDot = $('#cursor');
const curRing = $('#cursor-ring');
let magnetEl = null;
for (const el of document.querySelectorAll('[data-magnetic]')) {
  el.addEventListener('pointerenter', () => { magnetEl = el; curRing.classList.add('mag'); });
  el.addEventListener('pointerleave', () => {
    if (magnetEl === el) { magnetEl = null; curRing.classList.remove('mag'); }
    el.style.transform = '';
  });
}

const shock = new Float32Array([0, 0, 0, 99]);
addEventListener('pointerdown', (e) => {
  if (e.target.closest('a, button')) return;
  shock[3] = 0;
  curRing.classList.remove('pulse');
  void curRing.offsetWidth;
  curRing.classList.add('pulse');
  audio.pluck(currentParams.root || 92.5);
});

let scrollY = window.scrollY;
addEventListener('scroll', () => { scrollY = window.scrollY; }, { passive: true });

let centres = [];
const measure = () => { centres = panels.map((p) => p.offsetTop + p.offsetHeight / 2); };
measure();
addEventListener('resize', measure);

function sceneFloatAt(y) {
  const c = y + innerHeight / 2;
  let i = 0;
  while (i < centres.length - 1 && c > centres[i + 1]) i++;
  const a = centres[i], b = centres[Math.min(i + 1, centres.length - 1)];
  const f = b > a ? clamp((c - a) / (b - a), 0, 1) : 0;
  return Math.min(i + f, SCENES.length - 1);
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

const QS = new URLSearchParams(location.search);
const TURBO = QS.has('turbo');
// Debug hooks for automated verification: ?lock=N pins the scene, ?calm
// zeroes the curl noise, so a screenshot shows the pure converged target.
const LOCK = QS.has('lock') ? Number(QS.get('lock')) : null;
let CALM = QS.has('calm');
const canvas = $('#gl');
let engine = null;
try { engine = createEngine(canvas); } catch { engine = null; }
if (!engine) {
  document.body.classList.add('no-gl');
  $('#intro').classList.add('done');
} else {
  canvas.addEventListener('webglcontextlost', () => document.body.classList.add('no-gl'));
  engine.uploadTargets(0, 1);
}

const LADDER = [
  { maxDpr: 1.75, frac: 1 },
  { maxDpr: 1.25, frac: 1 },
  { maxDpr: 1, frac: 0.65 },
  { maxDpr: 1, frac: 0.4 },
];
let quality = 0, qCooldown = 0, emaDt = 16;

let currentParams = SCENES[0];
let pairI = 0;
let sfEase = 0;
let doubleEase = 0;
let time = 0, lastNow = performance.now();
let lastScroll = scrollY, scrollVel = 0;
let running = true;
let firstFrame = false;

const vitals = $('#vitals');
let vitalsTimer = 0;

document.addEventListener('visibilitychange', () => {
  running = !document.hidden;
  if (running) { lastNow = performance.now(); requestAnimationFrame(loop); }
});

function loop(now) {
  if (!running) return;
  requestAnimationFrame(loop);

  const rawDt = clamp((now - lastNow) / 1000, 1 / 240, 1 / 20);
  lastNow = now;
  emaDt = lerp(emaDt, rawDt * 1000, 0.05);
  time += rawDt;

  if (qCooldown > 0) qCooldown--;
  else if (emaDt > 25 && quality < LADDER.length - 1) { quality++; qCooldown = 120; }
  else if (emaDt < 13.5 && quality > 0) { quality--; qCooldown = 600; }

  pointer.ex = reduced ? pointer.x : ease(pointer.ex, pointer.x, 26, rawDt);
  pointer.ey = reduced ? pointer.y : ease(pointer.ey, pointer.y, 26, rawDt);
  pointer.rx = ease(pointer.rx, pointer.x, 11, rawDt);
  pointer.ry = ease(pointer.ry, pointer.y, 11, rawDt);
  pointer.nx = ease(pointer.nx, (pointer.x / innerWidth) * 2 - 1, 5, rawDt);
  pointer.ny = ease(pointer.ny, -((pointer.y / innerHeight) * 2 - 1), 5, rawDt);
  if (!reduced) {
    doc.style.setProperty('--mx', pointer.nx.toFixed(4));
    doc.style.setProperty('--my', pointer.ny.toFixed(4));
    if (fineMq.matches) {
      curDot.style.transform = `translate(${pointer.ex - 3.5}px, ${pointer.ey - 3.5}px)`;
      let rx = pointer.rx, ry = pointer.ry;
      if (magnetEl) {
        const r = magnetEl.getBoundingClientRect();
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        rx = lerp(rx, cx, 0.55); ry = lerp(ry, cy, 0.55);
        const pull = 0.26;
        magnetEl.style.transform =
          `translate(${clamp((pointer.x - cx) * pull, -10, 10)}px, ${clamp((pointer.y - cy) * pull, -10, 10)}px)`;
      }
      const rs = curRing.classList.contains('mag') ? 29 : 18;
      curRing.style.transform = `translate(${rx - rs}px, ${ry - rs}px)`;
    }
  }

  scrollVel = ease(scrollVel, Math.abs(scrollY - lastScroll) / (innerHeight * rawDt + 1e-4), 6, rawDt);
  lastScroll = scrollY;
  const sf = LOCK !== null ? LOCK : sceneFloatAt(scrollY);
  sfEase = (reduced || LOCK !== null) ? sf : ease(sfEase, sf, 5.5, rawDt);

  const i = clamp(Math.floor(sfEase), 0, SCENES.length - 2);
  if (i !== pairI && engine) {
    pairI = i;
    engine.uploadTargets(i, i + 1);
    audio.setRoot(SCENES[Math.round(sfEase)].root);
  }
  const morph = smooth(clamp(sfEase - pairI, 0, 1));
  currentParams = blendScenes(SCENES[pairI], SCENES[pairI + 1], morph);
  currentParams.root = SCENES[Math.round(sfEase)].root;
  audio.drive(scrollVel * 0.4 + clamp(pointer.speed, 0, 2) * 0.12);

  const [r, g, b] = currentParams.colA;
  doc.style.setProperty('--acc', `rgb(${(r * 255) | 0} ${(g * 255) | 0} ${(b * 255) | 0})`);

  const mid = scrollY + innerHeight / 2;
  panels.forEach((p, idx) => {
    const d = Math.abs(mid - centres[idx]) / innerHeight;
    const vis = clamp(1.15 - d * 1.6, 0, 1);
    p.firstElementChild.style.setProperty('--vis', smooth(vis).toFixed(3));
    p.classList.toggle('on', vis > 0.35);
  });
  let nearest = 0;
  panels.forEach((_, idx) => {
    if (Math.abs(mid - centres[idx]) < Math.abs(mid - centres[nearest])) nearest = idx;
  });
  dotEls.forEach((d, idx) => d.classList.toggle('active', idx === nearest));

  if (engine) {
    engine.resize(LADDER[quality].maxDpr);

    // The paranoiac plate: how present is plate iv right now?
    const w3 = clamp(1 - Math.abs(sfEase - 3), 0, 1);
    // Drag turns the object; turning reveals the second image. Idle, the
    // dream turns it slowly by itself. A wide face-on dead zone keeps the
    // word pure while the cursor merely rests over the copy.
    const dragYaw = pointer.active && !reduced ? pointer.nx * 1.25 : Math.sin(time * 0.3) * 0.9;
    // Reduced motion pins the double image face-on: no autonomous morphing.
    const doubleTarget = (LOCK !== null || reduced) ? 0 : w3 * smooth(clamp((Math.abs(dragYaw) - 0.45) / 0.55, 0, 1));
    doubleEase = ease(doubleEase, doubleTarget, 5, rawDt);

    const sway = reduced ? 0 : Math.sin(time * 0.19) * 0.06;
    const yaw = currentParams.yaw + sway + pointer.nx * (0.1 + w3 * 1.1);
    const pitch = -0.06 + pointer.ny * -0.08;
    const dist = 2.9;

    const aspect = innerWidth / innerHeight;
    const shiftAmt = currentParams.shift * clamp((aspect - 1.05) * 1.6, 0, 1);

    const spreadY = dist * Math.tan(0.87 / 2);
    const spreadX = spreadY * aspect;
    let px = pointer.nx * spreadX, py = pointer.ny * spreadY, pz = 0;
    const cx = Math.cos(-pitch), sx = Math.sin(-pitch);
    let y1 = py * cx - pz * sx, z1 = py * sx + pz * cx;
    const cyw = Math.cos(-yaw), syw = Math.sin(-yaw);
    const wx = px * cyw + z1 * syw, wz = -px * syw + z1 * cyw;
    const shx = shiftAmt * cyw, shz = -shiftAmt * syw;

    if (shock[3] === 0) { shock[0] = wx; shock[1] = y1; shock[2] = wz; }

    engine.frame({
      dt: rawDt, time, morph,
      double: doubleEase,
      doubleSlot: pairI === 3 ? 0 : pairI + 1 === 3 ? 1 : -1,
      doubleYaw: yaw,
      p: currentParams,
      breathA: reduced ? 0 : currentParams.breathA,
      breathR: currentParams.breathR,
      yaw, pitch, dist,
      pointerWorld: [wx, y1, wz],
      shift: [shx, currentParams.shiftY * clamp((aspect - 1.05) * 1.6, 0, 1), shz],
      pointerNdc: [pointer.nx, pointer.ny],
      pointerActive: pointer.active,
      shock,
      drawFraction: LADDER[quality].frac,
      turbo: TURBO,
      calm: CALM,
    });

    if (!firstFrame) {
      firstFrame = true;
      setTimeout(() => $('#intro').classList.add('done'), 700);
    }
  }

  vitalsTimer += rawDt;
  if (vitalsTimer > 0.5) {
    vitalsTimer = 0;
    const fps = Math.round(1000 / emaDt);
    const grains = engine ? Math.round(engine.particleCount * LADDER[quality].frac / 1000) : 0;
    vitals.textContent =
      `PERSISTENCE · sueño\nfps ${String(fps).padStart(3)} · grains ${grains}k · plate ${['i', 'ii', 'iii', 'iv', 'v'][Math.round(clamp(sfEase, 0, 4))]}`;
  }
}
requestAnimationFrame(loop);

window.__persistence = {
  get gl() { return !!engine; },
  get fps() { return Math.round(1000 / emaDt); },
  get scene() { return sfEase; },
  get double() { return doubleEase; },
  get pair() { return pairI; },
  get morph() { return smooth(clamp(sfEase - pairI, 0, 1)); },
  get particles() { return engine ? engine.particleCount : 0; },
  set calm(v) { CALM = !!v; },
  audio,
};
