/**
 * Statistical core: the machinery every other RIGOR module stands on.
 *
 * Everything here is deterministic given a seed, dependency-free, and tested
 * against properties that must hold by construction — not against "looks
 * right". A confidence-interval routine that has never had its coverage
 * measured is a decoration, not a statistic; test/rigor-calibration.test.mjs
 * measures coverage, p-value uniformity under the null, and error control of
 * the multiple-comparison procedure by simulation on known ground truth.
 */
'use strict';

// ---------------------------------------------------------------------------
// Deterministic RNG
// ---------------------------------------------------------------------------

/** splitmix64-flavoured 32-bit PRNG. Same seed → same analysis, always. */
export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x9e3779b9) >>> 0;
    let t = s ^ (s >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t = t ^ (t >>> 15);
    t = Math.imul(t, 0x735a2d97);
    t = t ^ (t >>> 15);
    return (t >>> 0) / 4294967296;
  };
}

/** Standard normal draw via Box–Muller. */
export function gaussian(rand) {
  let u = 0, v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// ---------------------------------------------------------------------------
// Normal distribution
// ---------------------------------------------------------------------------

/** Standard normal CDF via Abramowitz & Stegun 7.1.26 (|error| < 1.5e-7). */
export function phi(x) {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * ax);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-ax * ax);
  return 0.5 * (1 + sign * y);
}

/**
 * Inverse standard normal CDF, Acklam's rational approximation
 * (relative error < 1.15e-9 over the full open interval).
 */
export function phiInv(p) {
  if (p <= 0 || p >= 1) throw new RangeError(`phiInv requires p in (0,1), got ${p}`);
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02,
             1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02,
             6.680131188771972e+01, -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00,
             -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00,
             3.754408661907416e+00];
  const pLow = 0.02425, pHigh = 1 - pLow;
  let q, r, x;
  if (p < pLow) {
    q = Math.sqrt(-2 * Math.log(p));
    x = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
        ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  } else if (p <= pHigh) {
    q = p - 0.5; r = q * q;
    x = (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
        (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  } else {
    q = Math.sqrt(-2 * Math.log(1 - p));
    x = -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
         ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  // No refinement against phi(): our phi is the A&S approximation (abs err
  // ~7e-8), and Newton/Halley steps toward ITS root would degrade Acklam by
  // orders of magnitude in the tails. Raw Acklam already meets the bound above.
  return x;
}

// ---------------------------------------------------------------------------
// Descriptive
// ---------------------------------------------------------------------------

export const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

export function sd(xs) {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) * (x - m), 0) / (xs.length - 1));
}

/** Quantile with linear interpolation (type 7, the R default). */
export function quantile(sorted, q) {
  const n = sorted.length;
  if (n === 0) return NaN;
  if (n === 1) return sorted[0];
  const h = (n - 1) * q;
  const lo = Math.floor(h), hi = Math.ceil(h);
  return sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo]);
}

// ---------------------------------------------------------------------------
// Bootstrap confidence intervals (BCa)
// ---------------------------------------------------------------------------

/**
 * Bias-corrected and accelerated bootstrap CI for statistic `stat` of `xs`.
 *
 * BCa rather than the naive percentile method because eval-score distributions
 * are routinely skewed (ceilings at 100, floors at 0), where the percentile
 * interval under-covers. The acceleration constant comes from the jackknife;
 * the bias correction from the fraction of bootstrap replicates below the
 * point estimate. Degenerate cases (constant data, statistic invariant under
 * resampling) fall back to the percentile interval, which is then exact.
 *
 * @returns {{est:number, lo:number, hi:number, reps:number}}
 */
export function bcaInterval(xs, stat, { level = 0.95, B = 2000, seed = 1 } = {}) {
  const n = xs.length;
  if (n === 0) throw new RangeError('bcaInterval: empty sample');
  const est = stat(xs);
  // A single observation has no resampling variability to estimate: the only
  // honest degenerate interval is the point itself (n=1 previously produced
  // NaN bounds via an empty jackknife sample).
  if (n === 1) return { est, lo: est, hi: est, reps: 0 };
  const rand = rng(seed);

  const reps = new Array(B);
  const resample = new Array(n);
  for (let b = 0; b < B; b++) {
    for (let i = 0; i < n; i++) resample[i] = xs[(rand() * n) | 0];
    reps[b] = stat(resample);
  }
  reps.sort((a, b) => a - b);

  const alpha = (1 - level) / 2;

  // Bias correction: proportion of replicates strictly below the estimate,
  // counting ties as half so a symmetric discrete statistic stays centred.
  let below = 0, ties = 0;
  for (const r of reps) { if (r < est) below++; else if (r === est) ties++; }
  const propBelow = (below + ties / 2) / B;
  if (propBelow <= 0 || propBelow >= 1) {
    // All replicates on one side (constant statistic): percentile fallback.
    return { est, lo: quantile(reps, alpha), hi: quantile(reps, 1 - alpha), reps: B };
  }
  const z0 = phiInv(propBelow);

  // Acceleration via jackknife.
  const jack = new Array(n);
  const loo = xs.slice(1);
  for (let i = 0; i < n; i++) {
    if (i > 0) loo[i - 1] = xs[i - 1]; // restore the previously removed element
    jack[i] = stat(loo);
  }
  const jm = mean(jack);
  let num = 0, den = 0;
  for (const j of jack) {
    const d = jm - j;
    num += d * d * d;
    den += d * d;
  }
  const a = den === 0 ? 0 : num / (6 * Math.pow(den, 1.5));

  const adjust = (z) => {
    const w = z0 + z;
    const q = phi(z0 + w / (1 - a * w));
    return Math.min(Math.max(q, 0.5 / B), 1 - 0.5 / B);
  };
  return {
    est,
    lo: quantile(reps, adjust(phiInv(alpha))),
    hi: quantile(reps, adjust(phiInv(1 - alpha))),
    reps: B,
  };
}

// ---------------------------------------------------------------------------
// Paired inference
// ---------------------------------------------------------------------------

/**
 * Exact-style paired permutation test (sign-flip test) for mean difference.
 *
 * Both models answered the same tasks, so the per-task differences are the
 * data; testing them against sign flips uses that pairing, which point-score
 * tables throw away. The +1 in numerator and denominator makes the p-value
 * valid (never anti-conservative) at any number of permutations.
 *
 * @param diffs per-task score differences (A - B)
 * @returns {{p:number, observed:number, permutations:number}}
 */
export function pairedPermutationTest(diffs, { B = 10000, seed = 2 } = {}) {
  const n = diffs.length;
  if (n === 0) throw new RangeError('pairedPermutationTest: no pairs');
  const observed = mean(diffs);
  const absObs = Math.abs(observed);
  const rand = rng(seed);
  let atLeast = 0;
  for (let b = 0; b < B; b++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += rand() < 0.5 ? diffs[i] : -diffs[i];
    // Tolerance guards float non-associativity from flipping a tie's verdict.
    if (Math.abs(s / n) >= absObs - 1e-12) atLeast++;
  }
  return { p: (atLeast + 1) / (B + 1), observed, permutations: B };
}

/**
 * Cliff's delta: P(a > b) − P(a < b) over all cross pairs.
 * A robust effect size that survives outliers and rescaling; reported next to
 * every p-value because "significant" and "large enough to matter" differ.
 */
export function cliffsDelta(as, bs) {
  let gt = 0, lt = 0;
  for (const a of as) for (const b of bs) {
    if (a > b) gt++;
    else if (a < b) lt++;
  }
  return (gt - lt) / (as.length * bs.length);
}

// ---------------------------------------------------------------------------
// Multiple comparisons
// ---------------------------------------------------------------------------

/**
 * Holm–Bonferroni step-down adjustment.
 *
 * Comparing m model pairs means m chances for a fluke; Holm controls the
 * family-wise error rate at the stated level with no independence assumptions,
 * and strictly dominates plain Bonferroni.
 *
 * @param ps raw p-values
 * @returns adjusted p-values, same order as input
 */
export function holmAdjust(ps) {
  const m = ps.length;
  const order = ps.map((p, i) => [p, i]).sort((a, b) => a[0] - b[0]);
  const adjusted = new Array(m);
  let running = 0;
  for (let k = 0; k < m; k++) {
    const [p, idx] = order[k];
    running = Math.max(running, Math.min(1, (m - k) * p));
    adjusted[idx] = running;
  }
  return adjusted;
}

/** Wilson score interval for a binomial proportion — behaves at 0 and 1. */
export function wilsonInterval(successes, n, { level = 0.95 } = {}) {
  if (n === 0) return { est: NaN, lo: 0, hi: 1 };
  const z = phiInv(1 - (1 - level) / 2);
  const p = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n))) / denom;
  return { est: p, lo: Math.max(0, centre - half), hi: Math.min(1, centre + half) };
}

// ---------------------------------------------------------------------------
// Power analysis
// ---------------------------------------------------------------------------

/**
 * What this benchmark can and cannot detect — the question no leaderboard
 * answers. Based on the paired design: sd_d is the standard deviation of
 * per-task score differences between a model pair (estimated from data).
 *
 * minimumDetectableDifference: the smallest true mean difference a paired
 * test on n tasks detects with the given power at the given alpha.
 * Analytic normal approximation: MDD = (z_{1-α/2} + z_{power}) · sd_d / √n.
 * Validated by simulation in the test suite.
 */
export function minimumDetectableDifference(sdDiff, n, { alpha = 0.05, power = 0.8 } = {}) {
  // Discreteness floor: a two-sided sign-flip test on n pairs cannot produce
  // p below 2/2^n, so when that floor exceeds alpha no difference of ANY size
  // is detectable — the normal approximation would happily return a finite
  // number here, which is exactly the false confidence this library exists
  // to prevent.
  if (n < 2 || 2 / Math.pow(2, n) > alpha) return Infinity;
  return (phiInv(1 - alpha / 2) + phiInv(power)) * sdDiff / Math.sqrt(n);
}

/** Tasks required to detect a true difference `d` with the given power. */
export function requiredTasks(sdDiff, d, { alpha = 0.05, power = 0.8 } = {}) {
  if (d <= 0) return Infinity;
  const z = phiInv(1 - alpha / 2) + phiInv(power);
  // Never report fewer tasks than the sign-flip discreteness floor allows:
  // with n pairs the test cannot reject at alpha unless 2/2^n <= alpha.
  const floor = Math.ceil(Math.log2(2 / alpha));
  return Math.max(floor, Math.ceil((z * sdDiff / d) ** 2));
}

/**
 * Empirical power by simulation: plant a true difference `d` on top of
 * resampled real per-task differences and count how often the actual
 * permutation test detects it. Slower but assumption-free; the test suite
 * uses it to validate the analytic formulas above.
 */
export function simulatedPower(diffs, d, { alpha = 0.05, sims = 300, permB = 800, seed = 3 } = {}) {
  const n = diffs.length;
  const centred = diffs.map((x) => x - mean(diffs));
  const rand = rng(seed);
  let detected = 0;
  const sample = new Array(n);
  for (let s = 0; s < sims; s++) {
    for (let i = 0; i < n; i++) sample[i] = centred[(rand() * n) | 0] + d;
    const { p } = pairedPermutationTest(sample, { B: permB, seed: (seed * 7919 + s) >>> 0 });
    if (p < alpha) detected++;
  }
  return detected / sims;
}
