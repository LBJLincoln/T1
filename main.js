/*
 * LUMEN — a living digital organism.
 *
 * One WebGL2 canvas, two render passes, zero libraries.
 *
 * The organism is a GPU particle simulation: positions and velocities live in
 * float textures and are advanced entirely on the GPU by a fragment shader
 * (spring toward a morph target + divergence-free curl noise + cursor field +
 * click shockwaves). The CPU only decides *which body* the organism should
 * have: each scroll scene uploads a new target-position texture, and every
 * simulation parameter is continuously blended between scenes, so transitions
 * are physical — the creature swims to its next shape, it never cuts.
 *
 * Everything degrades deliberately: no WebGL2 → a readable dark document;
 * prefers-reduced-motion → no idle animation, no custom cursor, instant
 * reveals; weak GPU → the engine steps its own fidelity down (resolution,
 * then particle count) until the frame time behaves.
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
// Frame-rate-independent exponential approach: k is "per second" strength.
const ease = (cur, target, k, dt) => cur + (target - cur) * (1 - Math.exp(-k * dt));

// ---------------------------------------------------------------------------
// Scenes — the organism's five bodies and everything that differs between them
// ---------------------------------------------------------------------------

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);

// yaw: the camera angle each body is composed for (text must face the lens).
// shift: pushes the body right of centre on wide screens so copy stays clear.
const SCENES = [
  { name: 'nebula', root: 110.0, yaw: 0.35, shift: 0.5, shiftY: 0,
    spring: 1.9, noiseAmp: 0.55, noiseScale: 1.6, flow: 0.25, damp: 2.6,
    pForce: 2.4, pRad: 3.5, size: 2.5, alpha: 0.8, breathA: 0.05, breathR: 0.55,
    colA: hex('#6ee7ff'), colB: hex('#8b5cf6'), bgA: hex('#050914'), bgB: hex('#0b1030') },
  { name: 'pulse', root: 98.0, yaw: 0.2, shift: 0.55, shiftY: 0,
    spring: 4.4, noiseAmp: 0.16, noiseScale: 2.2, flow: 0.55, damp: 4.0,
    pForce: 2.8, pRad: 5.0, size: 2.2, alpha: 0.6,  breathA: 0.06, breathR: 1.2,
    colA: hex('#34f5c5'), colB: hex('#0ea5e9'), bgA: hex('#04120f'), bgB: hex('#062a24') },
  { name: 'helix', root: 123.47, yaw: 0.55, shift: 0.55, shiftY: 0,
    spring: 5.2, noiseAmp: 0.11, noiseScale: 3.0, flow: 0.85, damp: 4.4,
    pForce: 2.6, pRad: 5.0, size: 2.1, alpha: 0.6,  breathA: 0.04, breathR: 0.8,
    colA: hex('#f0abfc'), colB: hex('#f59e0b'), bgA: hex('#12041a'), bgB: hex('#26063a') },
  { name: 'word', root: 87.31, yaw: 0.0, shift: 0.45, shiftY: -0.42,
    spring: 7.2, noiseAmp: 0.07, noiseScale: 2.5, flow: 0.4,  damp: 4.4,
    pForce: 2.2, pRad: 5.0, size: 2.0, alpha: 0.8,  breathA: 0.02, breathR: 0.6,
    colA: hex('#ffffff'), colB: hex('#fbbf24'), bgA: hex('#030304'), bgB: hex('#121420') },
  { name: 'galaxy', root: 130.81, yaw: 0.3, shift: 0.42, shiftY: 0,
    spring: 1.6, noiseAmp: 0.3, noiseScale: 1.2, flow: 0.6, damp: 2.4,
    // Negative pointer force: in the final scene the organism is drawn to you.
    pForce: -3.2, pRad: 0.9, size: 2.4, alpha: 0.65, breathA: 0.05, breathR: 0.7,
    colA: hex('#fda4af'), colB: hex('#fb923c'), bgA: hex('#140406'), bgB: hex('#2a0a10') },
];

/** Interpolate every numeric/colour field between two scenes. */
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
// Target-shape generation (CPU, once per scene, cached)
// ---------------------------------------------------------------------------

const gauss = (rand) => {
  // Box–Muller. Two uniforms in, one normal out.
  let u = 0, v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};

/** Deterministic RNG so the organism's body is identical on every visit. */
function mulberry(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeTargets(scene, n) {
  const rand = mulberry(1000 + scene * 7919);
  const out = new Float32Array(n * 4);
  const TAU = Math.PI * 2;

  if (scene === 3) return makeTextTargets(n, out, rand);

  for (let i = 0; i < n; i++) {
    let x = 0, y = 0, z = 0;
    const u = rand();

    if (scene === 0) {
      // Nebula: clumpy gaussian cloud. A few gravity centres give it anatomy.
      const cl = (i % 7) / 7;
      const ca = cl * TAU * 2.4, cr = 0.28 + 0.34 * cl;
      x = Math.cos(ca) * cr + gauss(rand) * 0.34;
      y = Math.sin(ca * 1.7) * cr * 0.6 + gauss(rand) * 0.3;
      z = Math.sin(ca) * cr + gauss(rand) * 0.34;
    } else if (scene === 1) {
      // (2,3) torus knot with a fuzzy tube.
      const t = u * TAU;
      const r = Math.cos(3 * t) + 2;
      x = r * Math.cos(2 * t) * 0.3;
      y = -Math.sin(3 * t) * 0.42;
      z = r * Math.sin(2 * t) * 0.3;
      x += gauss(rand) * 0.03; y += gauss(rand) * 0.03; z += gauss(rand) * 0.03;
    } else if (scene === 2) {
      // Double helix with rungs.
      const kind = rand();
      const s = u;
      const ang = s * Math.PI * 6;
      const yy = (s - 0.5) * 2.3;
      if (kind < 0.92) {
        const side = kind < 0.46 ? 0 : Math.PI;
        x = Math.cos(ang + side) * 0.48;
        z = Math.sin(ang + side) * 0.48;
        y = yy;
      } else {
        const rung = Math.floor(rand() * 22) / 22;
        const ra = rung * Math.PI * 6;
        const m = rand() * 2 - 1;
        x = Math.cos(ra) * 0.48 * m;
        z = Math.sin(ra) * 0.48 * m;
        y = (rung - 0.5) * 2.3;
      }
      x += gauss(rand) * 0.025; y += gauss(rand) * 0.025; z += gauss(rand) * 0.025;
    } else {
      // Tilted spiral galaxy, three arms.
      const arm = i % 3;
      const r = Math.pow(u, 0.62) * 1.3 + 0.04;
      const ang = arm * (TAU / 3) + r * 2.7 + gauss(rand) * 0.16;
      x = Math.cos(ang) * r;
      z = Math.sin(ang) * r;
      y = gauss(rand) * 0.05 * (1.3 - r * 0.6);
      // Tilt so the disc reads as a disc from the camera.
      const tilt = 0.9, cy = Math.cos(tilt), sy = Math.sin(tilt);
      const y2 = y * cy - z * sy, z2 = y * sy + z * cy;
      y = y2; z = z2;
    }

    out[i * 4] = x; out[i * 4 + 1] = y; out[i * 4 + 2] = z; out[i * 4 + 3] = 1;
  }
  return out;
}

/** Sample the word LUMEN off a 2D canvas into particle targets. */
function makeTextTargets(n, out, rand) {
  const c = document.createElement('canvas');
  c.width = 1200; c.height = 300;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#fff';
  g.font = '900 205px ui-sans-serif, system-ui, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('LUMEN', c.width / 2, c.height / 2 + 10);

  const img = g.getImageData(0, 0, c.width, c.height).data;
  const pts = [];
  for (let y = 0; y < c.height; y += 2) {
    for (let x = 0; x < c.width; x += 2) {
      if (img[(y * c.width + x) * 4] > 128) pts.push(x, y);
    }
  }
  const scale = 2.15 / c.width;
  for (let i = 0; i < n; i++) {
    const p = (Math.floor(rand() * (pts.length / 2))) * 2;
    out[i * 4]     = (pts[p] - c.width / 2) * scale + gauss(rand) * 0.006;
    out[i * 4 + 1] = -(pts[p + 1] - c.height / 2) * scale + gauss(rand) * 0.006;
    out[i * 4 + 2] = gauss(rand) * 0.03;
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
/* Divergence-free curl of a 3-component noise field. Runs once per particle
   per frame on a small offscreen pass, so 12 noise evaluations are cheap. */
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
  // Fullscreen triangle from gl_VertexID — no buffers.
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
  // Birth: a vast, thin shell far outside the frame. The first thing the
  // visitor sees is the organism condensing out of the dark.
  float th = r1 * 6.28318, ph = acos(r2 * 2.0 - 1.0);
  float rad = 3.4 + r3 * 1.8;
  oPos = vec4(sin(ph)*cos(th)*rad, cos(ph)*rad, sin(ph)*sin(th)*rad, r4);
  oVel = vec4(0.0, 0.0, 0.0, r5);
}`;

const SIM_STEP_FS = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D uPos, uVel, uTargetA, uTargetB;
uniform float uMorph, uDt, uTime, uSpring, uNoiseAmp, uNoiseScale, uFlow, uDamp, uBreathA, uBreathR;
uniform vec3 uShiftV;
uniform vec3 uPointer;
uniform float uPointerForce, uPointerRad;
uniform vec4 uShock; // xyz origin, w seconds since click
layout(location=0) out vec4 oPos;
layout(location=1) out vec4 oVel;
${'{NOISE}'}
void main(){
  ivec2 uv = ivec2(gl_FragCoord.xy);
  vec4 P = texelFetch(uPos, uv, 0);
  vec4 V = texelFetch(uVel, uv, 0);
  vec3 pos = P.xyz, vel = V.xyz;

  float breath = 1.0 + uBreathA * sin(uTime * uBreathR * 6.2831853);
  vec3 target = mix(texelFetch(uTargetA, uv, 0).xyz,
                    texelFetch(uTargetB, uv, 0).xyz, uMorph) * breath + uShiftV;

  vec3 acc = (target - pos) * uSpring;
  acc += curl(pos * uNoiseScale + vec3(0.0, 0.0, uTime * uFlow)) * uNoiseAmp;

  // Cursor field: positive repels (the organism keeps a wary distance),
  // negative attracts (the final scene, where it comes to you).
  vec3 dp = pos - uPointer;
  float d2 = dot(dp, dp);
  acc += (dp / (sqrt(d2) + 0.04)) * uPointerForce * exp(-d2 * uPointerRad);

  // Click shockwave: an expanding spherical band that decays in ~1.5s.
  if (uShock.w < 2.0) {
    vec3 ds = pos - uShock.xyz;
    float r = length(ds);
    float w = exp(-pow(r - 2.3 * uShock.w, 2.0) * 26.0) * exp(-uShock.w * 3.0);
    acc += (ds / max(r, 0.05)) * w * 9.0;
  }

  vel = (vel + acc * uDt) * exp(-uDamp * uDt);
  pos += vel * uDt;
  oPos = vec4(pos, P.w);
  oVel = vec4(vel, V.w);
}`.replace('{NOISE}', NOISE_GLSL);

const POINTS_VS = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D uPos, uVel;
uniform mat4 uView, uProj;
uniform int uSimSize;
uniform float uPointSize, uDpr;
out float vHue;
out float vSpeed;
out float vFade;
void main(){
  ivec2 uv = ivec2(gl_VertexID % uSimSize, gl_VertexID / uSimSize);
  vec4 P = texelFetch(uPos, uv, 0);
  vec4 V = texelFetch(uVel, uv, 0);
  vec4 viewPos = uView * vec4(P.xyz, 1.0);
  gl_Position = uProj * viewPos;
  float dist = max(0.3, -viewPos.z);
  gl_PointSize = clamp(uPointSize * uDpr / dist, 1.25 * uDpr, 56.0 * uDpr);
  vHue = fract(P.w + V.w * 0.37);
  vSpeed = length(V.xyz);
  vFade = smoothstep(7.0, 2.2, dist);
}`;

const POINTS_FS = /* glsl */`#version 300 es
precision highp float;
uniform vec3 uColA, uColB;
uniform float uAlpha, uCore;
in float vHue;
in float vSpeed;
in float vFade;
out vec4 frag;
void main(){
  float d = length(gl_PointCoord - 0.5) * 2.0;
  if (d > 1.0) discard;
  float a = (1.0 - d) * (1.0 - d);
  vec3 col = mix(uColA, uColB, clamp(vHue + vSpeed * 0.35, 0.0, 1.0));
  col += vec3(0.6) * pow(1.0 - d, 6.0) * uCore;   // hot core
  frag = vec4(col * a * uAlpha * vFade, 1.0);      // additive
}`;

const BG_FS = /* glsl */`#version 300 es
precision highp float;
uniform vec2 uRes;
uniform vec3 uBgA, uBgB, uGlow;
uniform vec2 uPointerNdc;
uniform float uTime;
out vec4 frag;
float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)))*43758.5453); }
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 p = uv * 2.0 - 1.0;
  p.x *= uRes.x / uRes.y;
  float g = smoothstep(1.7, -0.4, length(p - vec2(0.35, 0.5)));
  vec3 col = mix(uBgA, uBgB, g);
  // A faint light that lives under the visitor's cursor.
  vec2 m = uPointerNdc; m.x *= uRes.x / uRes.y;
  col += uGlow * 0.16 * exp(-dot(p - m, p - m) * 2.2);
  // Vignette + animated grain (kills banding on the dark gradients).
  col *= 1.0 - 0.42 * dot(uv - 0.5, uv - 0.5) * 4.0 * 0.55;
  col += (hash(gl_FragCoord.xy + fract(uTime) * 61.7) - 0.5) * 0.028;
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
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      throw new Error('shader: ' + gl.getShaderInfoLog(s));
    }
    return s;
  };
  const program = (vs, fs) => {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error('link: ' + gl.getProgramInfoLog(p));
    }
    const uniforms = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(p, i);
      uniforms[info.name] = gl.getUniformLocation(p, info.name);
    }
    return { p, u: uniforms };
  };

  // Particle count: chosen by hardware hints, then adapted live by frame time.
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
    // Sampled-only float textures are core WebGL2 — safe even where
    // renderable-float is not.
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
    // Seed positions on the GPU.
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

  // Matrices — column-major, hand-rolled; the camera is only ever
  // perspective * translate * rotX * rotY.
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
    // R = Rx * Ry, then translate -dist along z.
    view.set([
      cy,        sx * sy,  -cx * sy, 0,
      0,         cx,        sx,      0,
      sy,       -sx * cy,   cx * cy, 0,
      0,         0,        -dist,    1,
    ]);
  };

  let dpr = 1;
  const resize = (maxDpr) => {
    dpr = clamp(devicePixelRatio || 1, 1, maxDpr);
    const w = Math.round(canvas.clientWidth * dpr);
    const h = Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w; canvas.height = h;
    }
  };

  return {
    gl,
    get simSize() { return simSize; },
    get particleCount() { return simSize * simSize; },
    resize,
    uploadTargets(i, j) {
      uploadTarget(state.targetA, i);
      uploadTarget(state.targetB, j);
    },
    /** One simulation step + full frame render. */
    frame(o) {
      // --- simulate ---------------------------------------------------
      // Fixed substeps: identical dynamics at any frame rate. A slow GPU gets
      // slow motion, never different physics or exploded springs.
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
      gl.uniform1f(su.uMorph, o.morph);
      gl.uniform1f(su.uDt, H);
      gl.uniform1f(su.uSpring, o.p.spring);
      gl.uniform1f(su.uNoiseAmp, o.calm ? 0.0 : o.p.noiseAmp);
      gl.uniform1f(su.uNoiseScale, o.p.noiseScale);
      gl.uniform1f(su.uFlow, o.p.flow);
      gl.uniform1f(su.uDamp, o.p.damp);
      gl.uniform1f(su.uBreathA, o.breathA);
      gl.uniform1f(su.uBreathR, o.breathR);
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

      // --- render ------------------------------------------------------
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvas.width, canvas.height);

      gl.useProgram(progBg.p);
      const bu = progBg.u;
      gl.uniform2f(bu.uRes, canvas.width, canvas.height);
      gl.uniform3fv(bu.uBgA, o.p.bgA);
      gl.uniform3fv(bu.uBgB, o.p.bgB);
      gl.uniform3fv(bu.uGlow, o.p.colA);
      gl.uniform2fv(bu.uPointerNdc, o.pointerNdc);
      gl.uniform1f(bu.uTime, o.time);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      setProj(0.87, canvas.width / canvas.height, 0.1, 30);
      setView(o.yaw, o.pitch, o.dist);

      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.useProgram(progPts.p);
      const pu = progPts.u;
      bind(0, state.texA.pos, pu.uPos);
      bind(1, state.texA.vel, pu.uVel);
      gl.uniformMatrix4fv(pu.uView, false, view);
      gl.uniformMatrix4fv(pu.uProj, false, proj);
      gl.uniform1i(pu.uSimSize, simSize);
      gl.uniform1f(pu.uDpr, dpr);
      gl.uniform3fv(pu.uColA, o.p.colA);
      gl.uniform3fv(pu.uColB, o.p.colB);

      const count = Math.floor(simSize * simSize * o.drawFraction);
      // Halo pass first: the same particles, huge and faint, become the
      // organism's volumetric glow. Then the sharp pass on top.
      gl.uniform1f(pu.uPointSize, o.p.size * 4.5);
      gl.uniform1f(pu.uAlpha, o.p.alpha * 0.035);
      gl.uniform1f(pu.uCore, 0.0);
      gl.drawArrays(gl.POINTS, 0, Math.floor(count / 3));

      gl.uniform1f(pu.uPointSize, o.p.size);
      gl.uniform1f(pu.uAlpha, o.p.alpha);
      gl.uniform1f(pu.uCore, 0.55);
      gl.drawArrays(gl.POINTS, 0, count);
    },
  };
}

// ---------------------------------------------------------------------------
// Generative audio — silent until the visitor asks for it
// ---------------------------------------------------------------------------

const audio = {
  ctx: null, on: false, master: null, filter: null, oscA: null, oscB: null,

  build() {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(ctx.destination);

    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 420;
    this.filter.Q.value = 1.6;
    this.filter.connect(this.master);

    const mkOsc = (freq, gain) => {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.value = gain;
      o.connect(g); g.connect(this.filter);
      o.start();
      return o;
    };
    this.oscA = mkOsc(SCENES[0].root, 0.05);
    this.oscB = mkOsc(SCENES[0].root * 1.5, 0.032);
    this.oscB.detune.value = 4;

    // Airy noise bed.
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = buf; noise.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 0.6;
    const ng = ctx.createGain(); ng.gain.value = 0.016;
    noise.connect(bp); bp.connect(ng); ng.connect(this.master);
    noise.start();

    // Slow LFO breathing through the filter.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lg = ctx.createGain(); lg.gain.value = 110;
    lfo.connect(lg); lg.connect(this.filter.frequency);
    lfo.start();
  },

  toggle() {
    if (!this.ctx) this.build();
    this.ctx.resume();
    this.on = !this.on;
    this.master.gain.setTargetAtTime(this.on ? 0.55 : 0, this.ctx.currentTime, 0.4);
    return this.on;
  },

  /** Glide the drone to the current scene's chord. */
  setRoot(root) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.oscA.frequency.linearRampToValueAtTime(root, t + 1.8);
    this.oscB.frequency.linearRampToValueAtTime(root * 1.5, t + 1.8);
  },

  /** Scroll speed opens the filter; the page audibly accelerates with you. */
  drive(v) {
    if (!this.ctx || !this.on) return;
    const f = 380 + clamp(v, 0, 1) * 2400;
    this.filter.frequency.setTargetAtTime(f, this.ctx.currentTime, 0.25);
  },

  pluck(root) {
    if (!this.ctx || !this.on) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = root * (Math.random() < 0.5 ? 4 : 6);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.22, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + 0.75);
  },
};

// ---------------------------------------------------------------------------
// Page wiring
// ---------------------------------------------------------------------------

const panels = [...document.querySelectorAll('.panel')];

// Split headings into individually animated letters, keeping them readable
// to assistive tech via an aria-label on the heading itself.
for (const h of document.querySelectorAll('.panel h2')) {
  const nodes = [...h.childNodes];
  h.setAttribute('aria-label', nodes.map((n) => n.nodeName === 'BR' ? ' ' : n.textContent).join('').replace(/\s+/g, ' ').trim());
  h.textContent = '';
  let i = 0;
  for (const node of nodes) {
    if (node.nodeName === 'BR') { h.appendChild(document.createElement('br')); continue; }
    for (const ch of node.textContent) {
      const s = document.createElement('span');
      s.className = 'ch';
      s.setAttribute('aria-hidden', 'true');
      s.textContent = ch;
      s.style.setProperty('--i', i);
      s.style.setProperty('--z', ((i % 3) - 1) * 5);
      h.appendChild(s);
      i++;
    }
  }
}

// Section nav dots.
const dotsNav = $('#dots');
panels.forEach((p, i) => {
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

// Sound toggles (fixed pill + outro button drive the same state).
const soundBtn = $('#sound');
const syncSound = (on) => soundBtn.setAttribute('aria-pressed', String(on));
soundBtn.addEventListener('click', () => syncSound(audio.toggle()));
$('#sound2').addEventListener('click', () => syncSound(audio.toggle()));
$('#replay').addEventListener('click', () =>
  window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' }));

// Pointer state — one source of truth for cursor, tilt, magnetism, and sim.
const pointer = {
  x: innerWidth / 2, y: innerHeight / 2,  // px
  ex: innerWidth / 2, ey: innerHeight / 2, // eased px (cursor dot)
  rx: innerWidth / 2, ry: innerHeight / 2, // slower ease (ring)
  nx: 0, ny: 0,                            // eased NDC for shaders/tilt
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

// Custom cursor + magnetic elements.
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

// Click → shockwave through the organism + cursor pulse + pluck.
const shock = new Float32Array([0, 0, 0, 99]);
addEventListener('pointerdown', (e) => {
  if (e.target.closest('a, button')) return;
  shock[3] = 0; // origin set in the frame loop from pointer world position
  curRing.classList.remove('pulse');
  void curRing.offsetWidth; // restart the CSS animation
  curRing.classList.add('pulse');
  audio.pluck(currentParams.root || 110);
});

// Scroll state.
let scrollY = window.scrollY;
addEventListener('scroll', () => { scrollY = window.scrollY; }, { passive: true });

// Map scroll to a continuous scene position by panel centres, so shapes land
// exactly on their sections no matter what the panel heights are.
let centres = [];
const measure = () => {
  centres = panels.map((p) => p.offsetTop + p.offsetHeight / 2);
};
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
const CALM = QS.has('calm'); // debug: zero curl noise to see pure convergence
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

// Quality ladder, stepped by sustained frame time.
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
  emaDt = lerp(emaDt, rawDt * 1000, 0.05); // per-frame by design: it measures frames
  time += rawDt;

  // Quality adaptation: degrade fast, recover slowly.
  if (qCooldown > 0) qCooldown--;
  else if (emaDt > 25 && quality < LADDER.length - 1) { quality++; qCooldown = 120; }
  else if (emaDt < 13.5 && quality > 0) { quality--; qCooldown = 600; }

  // Eased pointer.
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
        // The ring snaps to the magnetic element; the element leans toward you.
        const r = magnetEl.getBoundingClientRect();
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        rx = lerp(rx, cx, 0.55); ry = lerp(ry, cy, 0.55);
        const pull = 0.26;
        magnetEl.style.transform =
          `translate(${clamp((pointer.x - cx) * pull, -10, 10)}px, ${clamp((pointer.y - cy) * pull, -10, 10)}px)`;
      }
      const rs = curRing.classList.contains('mag') ? 28 : 17;
      curRing.style.transform = `translate(${rx - rs}px, ${ry - rs}px)`;
    }
  }

  // Scroll-driven state.
  scrollVel = ease(scrollVel, Math.abs(scrollY - lastScroll) / (innerHeight * rawDt + 1e-4), 6, rawDt);
  lastScroll = scrollY;
  const sf = sceneFloatAt(scrollY);
  sfEase = reduced ? sf : ease(sfEase, sf, 5.5, rawDt);

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

  // Accent colour follows the organism.
  const [r, g, b] = currentParams.colA;
  doc.style.setProperty('--acc', `rgb(${(r * 255) | 0} ${(g * 255) | 0} ${(b * 255) | 0})`);

  // Section reveals + nav.
  const mid = scrollY + innerHeight / 2;
  panels.forEach((p, idx) => {
    const d = Math.abs(mid - centres[idx]) / innerHeight;
    const vis = clamp(1.15 - d * 1.6, 0, 1);
    const sticky = p.firstElementChild;
    sticky.style.setProperty('--vis', smooth(vis).toFixed(3));
    p.classList.toggle('on', vis > 0.35);
  });
  // Nav highlight: nearest panel centre wins.
  let nearest = 0;
  panels.forEach((_, idx) => {
    if (Math.abs(mid - centres[idx]) < Math.abs(mid - centres[nearest])) nearest = idx;
  });
  dotEls.forEach((d, idx) => d.classList.toggle('active', idx === nearest));

  // Render.
  if (engine) {
    engine.resize(LADDER[quality].maxDpr);

    const sway = reduced ? 0 : Math.sin(time * 0.21) * 0.07;
    const yaw = currentParams.yaw + sway + pointer.nx * 0.12;
    const pitch = -0.08 + pointer.ny * -0.09;
    const dist = 2.6;

    // The body sits right of centre on wide screens; the shift is in *view*
    // space, so rotate it into world space along with the pointer.
    const aspect = innerWidth / innerHeight;
    const shiftAmt = currentParams.shift * clamp((aspect - 1.05) * 1.6, 0, 1);

    // Pointer in world space: invert the camera rotation so the force field
    // sits exactly under the cursor regardless of the current view.
    const spreadY = dist * Math.tan(0.87 / 2);
    const spreadX = spreadY * (innerWidth / innerHeight);
    let px = pointer.nx * spreadX, py = pointer.ny * spreadY, pz = 0;
    const cx = Math.cos(-pitch), sx = Math.sin(-pitch);
    let y1 = py * cx - pz * sx, z1 = py * sx + pz * cx;
    const cyw = Math.cos(-yaw), syw = Math.sin(-yaw);
    const wx = px * cyw + z1 * syw, wz = -px * syw + z1 * cyw;
    const shx = shiftAmt * cyw, shz = -shiftAmt * syw;

    if (shock[3] === 0) { shock[0] = wx; shock[1] = y1; shock[2] = wz; }

    engine.frame({
      dt: rawDt, time, morph,
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
      setTimeout(() => $('#intro').classList.add('done'), 500);
    }
  }

  // Vitals readout.
  vitalsTimer += rawDt;
  if (vitalsTimer > 0.5) {
    vitalsTimer = 0;
    const fps = Math.round(1000 / emaDt);
    const cells = engine ? Math.round(engine.particleCount * LADDER[quality].frac / 1000) : 0;
    vitals.textContent =
      `LUMEN · vitals\nfps ${String(fps).padStart(3)} · cells ${cells}k · scene ${SCENES[Math.round(clamp(sfEase, 0, 4))].name}`;
  }
}
requestAnimationFrame(loop);

// Expose a tiny handle for automated verification.
window.__lumen = {
  get gl() { return !!engine; },
  get fps() { return Math.round(1000 / emaDt); },
  get scene() { return sfEase; },
  get quality() { return quality; },
  get particles() { return engine ? engine.particleCount : 0; },
  audio,
};
