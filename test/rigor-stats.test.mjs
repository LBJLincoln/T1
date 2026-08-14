/** Unit-level properties of the statistical core. */
import {
  rng, gaussian, phi, phiInv, mean, sd, quantile, bcaInterval,
  pairedPermutationTest, cliffsDelta, holmAdjust, wilsonInterval,
  minimumDetectableDifference, requiredTasks, simulatedPower,
} from '../rigor/stats.js';

let failures = 0;
const check = (name, cond, extra = '') => {
  if (!cond) { failures++; if (failures < 15) console.log(`  FAIL ${name} ${extra}`); }
};
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// --- normal functions against known values ---------------------------------
check('phi(0)=0.5', near(phi(0), 0.5, 1e-7));
check('phi(1.959964)=0.975', near(phi(1.959964), 0.975, 1e-5), String(phi(1.959964)));
check('phi(-1)=0.158655', near(phi(-1), 0.1586553, 1e-5));
check('phiInv(0.975)=1.959964', near(phiInv(0.975), 1.959964, 1e-5), String(phiInv(0.975)));
check('phiInv(0.5)=0', near(phiInv(0.5), 0, 1e-8));
check('phiInv round-trips phi', [-3, -1.2, 0, 0.7, 2.5].every((x) => near(phiInv(phi(x)), x, 1e-5)));
let threw = false; try { phiInv(0); } catch { threw = true; }
check('phiInv rejects 0', threw);

// --- descriptive -----------------------------------------------------------
check('mean', mean([1, 2, 3, 4]) === 2.5);
check('sd of known sample', near(sd([2, 4, 4, 4, 5, 5, 7, 9]), 2.138, 0.001), String(sd([2,4,4,4,5,5,7,9])));
check('quantile median', quantile([1, 2, 3, 4, 5], 0.5) === 3);
check('quantile interpolates', quantile([10, 20], 0.25) === 12.5);

// --- Holm ------------------------------------------------------------------
{
  const adj = holmAdjust([0.01, 0.04, 0.03, 0.005]);
  check('holm worked example', near(adj[3], 0.02, 1e-12) && near(adj[0], 0.03, 1e-12)
    && near(adj[2], 0.06, 1e-12) && near(adj[1], 0.06, 1e-12), JSON.stringify(adj));
  check('holm is monotone in sorted order', (() => {
    const r = rng(5);
    for (let t = 0; t < 200; t++) {
      const ps = Array.from({ length: 6 }, () => r());
      const adj2 = holmAdjust(ps);
      const order = ps.map((p, i) => i).sort((a, b) => ps[a] - ps[b]);
      for (let i = 1; i < order.length; i++) {
        if (adj2[order[i]] < adj2[order[i - 1]] - 1e-12) return false;
      }
      if (adj2.some((p) => p > 1 || p < 0)) return false;
    }
    return true;
  })());
  check('holm never below raw p', (() => {
    const r = rng(6);
    for (let t = 0; t < 200; t++) {
      const ps = Array.from({ length: 5 }, () => r());
      const adj2 = holmAdjust(ps);
      if (adj2.some((p, i) => p < ps[i] - 1e-12)) return false;
    }
    return true;
  })());
}

// --- Wilson ----------------------------------------------------------------
{
  const w = wilsonInterval(0, 20);
  check('wilson at 0 successes stays in [0,1] and excludes 0.5', w.lo === 0 && w.hi < 0.25, JSON.stringify(w));
  const w2 = wilsonInterval(10, 20);
  check('wilson centred near 0.5', near(w2.est, 0.5, 1e-12) && w2.lo < 0.5 && w2.hi > 0.5);
  check('wilson known value', near(w2.lo, 0.299, 0.005) && near(w2.hi, 0.701, 0.005), JSON.stringify(w2));
}

// --- effect size -----------------------------------------------------------
check('cliffs delta disjoint', cliffsDelta([5, 6, 7], [1, 2, 3]) === 1);
check('cliffs delta identical', cliffsDelta([1, 2, 3], [1, 2, 3]) === 0);
check('cliffs delta sign', cliffsDelta([1, 2], [5, 6]) === -1);

// --- permutation test basics ----------------------------------------------
{
  const clear = pairedPermutationTest([8, 9, 10, 7, 9, 8, 10, 9, 8, 9], { B: 4000, seed: 9 });
  check('clear effect detected', clear.p < 0.01, String(clear.p));
  const noEffect = pairedPermutationTest([1, -1, 2, -2, 0.5, -0.5, 1.5, -1.5], { B: 4000, seed: 10 });
  check('null-ish data not significant', noEffect.p > 0.2, String(noEffect.p));
  check('p is valid (>= 1/(B+1))', clear.p >= 1 / 4001);
}

// --- BCa sanity ------------------------------------------------------------
{
  const r = rng(77);
  const xs = Array.from({ length: 60 }, () => 50 + gaussian(r) * 10);
  const ci = bcaInterval(xs, mean, { B: 1500, seed: 3 });
  check('bca contains the point estimate', ci.lo <= ci.est && ci.est <= ci.hi, JSON.stringify(ci));
  const width = ci.hi - ci.lo;
  check('bca width plausible', width > 3.2 && width < 7.5, String(width));
  const constant = bcaInterval([5, 5, 5, 5, 5], mean, { B: 200, seed: 4 });
  check('bca degenerate: constant data', constant.lo === 5 && constant.hi === 5, JSON.stringify(constant));
}

// --- power formulas agree with simulation ----------------------------------
{
  const r = rng(123);
  const diffs = Array.from({ length: 40 }, () => gaussian(r) * 12);
  const s = sd(diffs);
  const mdd = minimumDetectableDifference(s, diffs.length);
  const p80 = simulatedPower(diffs, mdd, { sims: 250, permB: 600, seed: 55 });
  check('MDD delivers ~80% power', p80 > 0.66 && p80 < 0.92, `power at MDD = ${p80}`);
  const pHalf = simulatedPower(diffs, mdd * 0.4, { sims: 250, permB: 600, seed: 56 });
  check('well below MDD, power collapses', pHalf < 0.5, String(pHalf));
  check('requiredTasks inverts MDD', (() => {
    const n = requiredTasks(s, mdd);
    return n >= diffs.length - 1 && n <= diffs.length + 1;
  })(), String(requiredTasks(s, mdd)));
}

console.log(failures === 0 ? 'rigor/stats: all checks passed' : `rigor/stats: ${failures} FAILURES`);
process.exit(failures ? 1 : 0);
