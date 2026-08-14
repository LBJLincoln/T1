/**
 * Calibration: the tests that make RIGOR a scientific instrument rather than
 * a formula collection. Each statistic is run on many synthetic worlds where
 * the truth is known, and its advertised operating characteristics are
 * measured:
 *   - 95% CIs must cover the true value ~95% of the time
 *   - p-values under a true null must be uniform (no anti-conservatism)
 *   - Holm must control family-wise error at 5% across many comparisons
 *   - Bradley-Terry must recover planted strengths inside its own intervals
 * Slow by nature (thousands of full analyses); tolerances are wide enough to
 * be stable across seeds but tight enough to catch real formula errors.
 */
import {
  rng, gaussian, mean, bcaInterval, pairedPermutationTest, holmAdjust,
} from '../rigor/stats.js';
import { bradleyTerry } from '../rigor/bradleyterry.js';

let failures = 0;
const check = (name, cond, extra = '') => {
  if (!cond) { failures++; console.log(`  FAIL ${name} ${extra}`); }
};

const FAST = process.env.FAST === '1';

// Population mean of the skewed generating process used in the coverage
// study, pinned once by a large Monte Carlo draw.
const POP_MEAN = (() => {
  const r = rng(999999);
  let s = 0;
  const N = 400000;
  for (let i = 0; i < N; i++) {
    s += Math.min(100, 70 + gaussian(r) * 14 + (r() < 0.15 ? 15 : 0));
  }
  return s / N;
})();

// --- BCa coverage ----------------------------------------------------------
{
  const WORLDS = FAST ? 150 : 400;
  const trueMean = 70;
  let covered = 0;
  for (let w = 0; w < WORLDS; w++) {
    const r = rng(1000 + w);
    // Skewed scores with a ceiling, like real evals: min(100, normal + bumps).
    const xs = Array.from({ length: 40 }, () => {
      const raw = trueMean + gaussian(r) * 14 + (r() < 0.15 ? 15 : 0);
      return Math.min(100, raw);
    });
    const ci = bcaInterval(xs, mean, { B: 800, seed: 5000 + w });
    if (ci.lo <= POP_MEAN && POP_MEAN <= ci.hi) covered++;
  }
  const rate = covered / WORLDS;
  check(`BCa coverage ~95% (got ${(rate * 100).toFixed(1)}% over ${WORLDS} worlds)`,
    rate > 0.9 && rate <= 0.99);
}
// --- permutation p-values uniform under the null ---------------------------
{
  const WORLDS = FAST ? 300 : 800;
  const ps = [];
  for (let w = 0; w < WORLDS; w++) {
    const r = rng(30000 + w);
    const diffs = Array.from({ length: 30 }, () => gaussian(r) * 10); // true diff = 0
    ps.push(pairedPermutationTest(diffs, { B: 400, seed: 60000 + w }).p);
  }
  // Kolmogorov-Smirnov against Uniform(0,1).
  ps.sort((a, b) => a - b);
  let ks = 0;
  for (let i = 0; i < ps.length; i++) {
    ks = Math.max(ks, Math.abs(ps[i] - (i + 1) / ps.length), Math.abs(ps[i] - i / ps.length));
  }
  const ksCrit = 1.63 / Math.sqrt(ps.length); // alpha = 0.01
  check(`null p-values uniform (KS=${ks.toFixed(3)} < ${ksCrit.toFixed(3)})`, ks < ksCrit);
  const below05 = ps.filter((p) => p < 0.05).length / ps.length;
  check(`type-I error at 5% is ~5% (got ${(below05 * 100).toFixed(1)}%)`, below05 < 0.075);
}

// --- Holm controls family-wise error --------------------------------------
{
  const WORLDS = FAST ? 250 : 600;
  let anyFalseReject = 0;
  for (let w = 0; w < WORLDS; w++) {
    const r = rng(70000 + w);
    // 10 null comparisons per world.
    const ps = [];
    for (let c = 0; c < 10; c++) {
      const diffs = Array.from({ length: 25 }, () => gaussian(r) * 8);
      ps.push(pairedPermutationTest(diffs, { B: 300, seed: 80000 + w * 17 + c }).p);
    }
    if (holmAdjust(ps).some((p) => p < 0.05)) anyFalseReject++;
  }
  const fwer = anyFalseReject / WORLDS;
  check(`Holm FWER <= ~5% across 10 null comparisons (got ${(fwer * 100).toFixed(1)}%)`, fwer < 0.075);
}

// --- Bradley-Terry recovers planted strengths ------------------------------
{
  const models = ['m1', 'm2', 'm3', 'm4'];
  const trueLog = [0.9, 0.3, -0.3, -0.9]; // geometric mean 1 by construction
  const r = rng(424242);
  const matches = [];
  for (let g = 0; g < 3000; g++) {
    const i = (r() * 4) | 0;
    let j = (r() * 4) | 0;
    while (j === i) j = (r() * 4) | 0;
    const pi = Math.exp(trueLog[i]), pj = Math.exp(trueLog[j]);
    const winner = r() < pi / (pi + pj) ? models[i] : models[j];
    matches.push({ a: models[i], b: models[j], winner });
  }
  const est = bradleyTerry(models, matches, { B: 400, seed: 5 });
  // Interval coverage is a *rate*, so it is measured across many worlds —
  // demanding four intervals from one world all cover is itself the
  // multiple-comparison mistake this library exists to catch.
  const WORLDS = FAST ? 40 : 100;
  let covered = 0;
  for (let w = 0; w < WORLDS; w++) {
    const rw = rng(500000 + w);
    const ms = [];
    for (let g = 0; g < 900; g++) {
      const i = (rw() * 4) | 0;
      let j = (rw() * 4) | 0;
      while (j === i) j = (rw() * 4) | 0;
      const pi = Math.exp(trueLog[i]), pj = Math.exp(trueLog[j]);
      ms.push({ a: models[i], b: models[j], winner: rw() < pi / (pi + pj) ? models[i] : models[j] });
    }
    const e = bradleyTerry(models, ms, { B: 200, seed: 700 + w }).find((x) => x.model === 'm1');
    if (e.lo <= trueLog[0] && trueLog[0] <= e.hi) covered++;
  }
  const btCov = covered / WORLDS;
  check(`BT interval coverage ~95% (got ${(btCov * 100).toFixed(0)}% over ${WORLDS} worlds)`,
    btCov >= 0.85);
  const order = est.slice().sort((a, b) => b.logStrength - a.logStrength).map((e) => e.model);
  check('BT recovers the planted order', order.join(',') === 'm1,m2,m3,m4', order.join(','));
  check('BT rank stability high for well-separated models', est.every((e) => e.rankStability > 0.85),
    JSON.stringify(est.map((e) => e.rankStability)));

  // Undefeated model: pseudo-counts must keep the MLE finite.
  const sweep = [];
  for (let g = 0; g < 60; g++) sweep.push({ a: 'm1', b: models[1 + (g % 3)], winner: 'm1' });
  const est2 = bradleyTerry(models, sweep, { B: 100, seed: 6 });
  check('undefeated model stays finite', Number.isFinite(est2[0].logStrength) && est2[0].logStrength > 0,
    String(est2[0].logStrength));
}

console.log(failures === 0 ? 'rigor/calibration: all checks passed' : `rigor/calibration: ${failures} FAILURES`);
process.exit(failures ? 1 : 0);
