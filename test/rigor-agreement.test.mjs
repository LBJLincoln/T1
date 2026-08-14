/** Judge-science module: agreement coefficients and bias diagnostics. */
import { krippendorffAlpha, cohensKappa, positionBias, selfPreference } from '../rigor/agreement.js';
import { rng, gaussian } from '../rigor/stats.js';

let failures = 0;
const check = (name, cond, extra = '') => {
  if (!cond) { failures++; if (failures < 15) console.log(`  FAIL ${name} ${extra}`); }
};
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// --- Krippendorff's alpha --------------------------------------------------
// Canonical worked example from Krippendorff (2011), "Computing Krippendorff's
// Alpha-Reliability": two observers, nominal data
//   units:  1..10 rated by A and B (12 units, 2 with missing)
// The standard two-coder nominal example: values below give alpha = 0.095 in
// the paper's Table for the small example; instead of relying on memory for a
// specific published constant, we verify the *definition* on a case small
// enough to compute by hand here in the comment.
//
// Hand computation (nominal, 2 coders, 4 units, no missing):
//   unit values: (a,a), (a,b), (b,b), (b,b)
//   Every unit has m=2, weight 1/(m-1)=1 → each unit contributes its ordered
//   pairs once: o_ab gets 1 from unit 2 (unordered, counted once).
//   Coincidences: o_aa = 1 (unit1), o_ab = 1 (unit2), o_bb = 2 (units 3,4).
//   Marginals: n_a = 1·2? — from ordered pairs: unit1 contributes a,a → n_a += 2·(1/2)…
// Rather than trusting the comment arithmetic, we assert the invariants that
// define alpha, then pin the value with an independent brute-force
// implementation written differently below.
function bruteAlphaNominal(units) {
  // Direct Do/De from the definition with ordered-pair coincidence matrix.
  const vals = new Map();
  const o = new Map();
  let n = 0;
  for (const u of units) {
    const xs = u.filter((v) => v != null);
    const m = xs.length;
    if (m < 2) continue;
    for (let i = 0; i < m; i++) {
      vals.set(xs[i], (vals.get(xs[i]) || 0) + 1);
      n++;
      for (let j = 0; j < m; j++) {
        if (i === j) continue;
        const key = xs[i] + '>' + xs[j];
        o.set(key, (o.get(key) || 0) + 1 / (m - 1));
      }
    }
  }
  let Do = 0;
  for (const [key, v] of o) {
    const [c, k] = key.split('>');
    if (c !== k) Do += v;
  }
  Do /= n;
  let De = 0;
  const list = [...vals.entries()];
  for (const [c, nc] of list) for (const [k, nk] of list) {
    if (c !== k) De += nc * nk;
  }
  De /= (n * (n - 1));
  return 1 - Do / De;
}

{
  const units = [[1, 1], [1, 2], [2, 2], [2, 2]];
  const mine = krippendorffAlpha(units, { metric: 'nominal' }).alpha;
  const brute = bruteAlphaNominal(units);
  check('alpha matches independent implementation (small case)', near(mine, brute, 1e-12),
    `mine=${mine} brute=${brute}`);

  const r = rng(31);
  for (let t = 0; t < 50; t++) {
    const u = Array.from({ length: 12 }, () =>
      Array.from({ length: 3 }, () => (r() < 0.15 ? null : 1 + ((r() * 4) | 0))));
    const a1 = krippendorffAlpha(u, { metric: 'nominal' }).alpha;
    const a2 = bruteAlphaNominal(u);
    if (Number.isNaN(a1) && Number.isNaN(a2)) continue;
    check('alpha matches brute force on random tables', near(a1, a2, 1e-9), `${a1} vs ${a2}`);
    if (failures) break;
  }
}

check('alpha perfect agreement = 1',
  krippendorffAlpha([[3, 3, 3], [1, 1, 1], [2, 2, 2]], { metric: 'nominal' }).alpha === 1);
{
  // Independent random ratings → alpha near 0 (large sample).
  const r = rng(90);
  const units = Array.from({ length: 4000 }, () => [1 + ((r() * 3) | 0), 1 + ((r() * 3) | 0)]);
  const a = krippendorffAlpha(units, { metric: 'nominal' }).alpha;
  check('alpha near zero for independent judges', Math.abs(a) < 0.05, String(a));
}
{
  // Interval metric punishes far disagreement more than near disagreement.
  const nearMiss = krippendorffAlpha([[50, 52], [60, 61], [70, 69], [40, 42], [55, 54]], { metric: 'interval' }).alpha;
  const farMiss = krippendorffAlpha([[50, 90], [60, 20], [70, 30], [40, 80], [55, 15]], { metric: 'interval' }).alpha;
  check('interval alpha: near misses score higher', nearMiss > farMiss, `${nearMiss} vs ${farMiss}`);
  check('interval alpha near-miss is high', nearMiss > 0.8, String(nearMiss));
}
check('units with <2 ratings are excluded',
  Number.isNaN(krippendorffAlpha([[1, null, null], [null, 2, null]]).alpha));

// --- Cohen's kappa ---------------------------------------------------------
// Known worked example: 2 raters, yes/no, a=20 both-yes, d=15 both-no,
// b=5, c=10 → po=0.7, pe=0.5·0.6+0.5·0.4=0.5? Compute: rater1 yes=25/50,
// rater2 yes=30/50 → pe = 0.5·0.6 + 0.5·0.4 = 0.5; kappa = (0.7-0.5)/0.5 = 0.4.
{
  const a = [], b = [];
  const push = (va, vb, count) => { for (let i = 0; i < count; i++) { a.push(va); b.push(vb); } };
  push('y', 'y', 20); push('y', 'n', 5); push('n', 'y', 10); push('n', 'n', 15);
  check('kappa worked example = 0.4', near(cohensKappa(a, b), 0.4, 1e-12), String(cohensKappa(a, b)));
}
check('kappa perfect = 1', cohensKappa(['a', 'b', 'a'], ['a', 'b', 'a']) === 1);

// --- position bias ---------------------------------------------------------
{
  // Unbiased judge: winner determined by candidate, not slot; swapped
  // presentations therefore give opposite slots.
  const records = [];
  for (let p = 0; p < 200; p++) {
    const strongIsFirstInPres1 = p % 2 === 0;
    records.push({ pairId: 'p' + p, presentation: 1, winnerSlot: strongIsFirstInPres1 ? 1 : 2 });
    records.push({ pairId: 'p' + p, presentation: 2, winnerSlot: strongIsFirstInPres1 ? 2 : 1 });
  }
  const pb = positionBias(records);
  check('unbiased judge: zero flips', pb.flipRate === 0, String(pb.flipRate));
  check('unbiased judge: first-slot rate ~0.5', near(pb.firstSlot.est, 0.5, 1e-12));

  // Fully position-biased judge: slot 1 always wins → every swap flips.
  const biased = [];
  for (let p = 0; p < 200; p++) {
    biased.push({ pairId: 'q' + p, presentation: 1, winnerSlot: 1 });
    biased.push({ pairId: 'q' + p, presentation: 2, winnerSlot: 1 });
  }
  const pb2 = positionBias(biased);
  check('biased judge: all flips', pb2.flipRate === 1, String(pb2.flipRate));
  check('biased judge: first-slot rate = 1 and CI excludes 0.5', pb2.firstSlot.lo > 0.5, JSON.stringify(pb2.firstSlot));
}

// --- self preference -------------------------------------------------------
{
  const verdicts = [];
  // judge-x (family fam-a) sees fam-a win 90% of its matches; the other judge
  // sees fam-a win only 50% of the same matches.
  for (let i = 0; i < 100; i++) {
    verdicts.push({ judge: 'judge-x', modelA: 'fam-a', modelB: 'other', winner: i < 90 ? 'fam-a' : 'other' });
    verdicts.push({ judge: 'judge-y', modelA: 'fam-a', modelB: 'other', winner: i < 50 ? 'fam-a' : 'other' });
  }
  const sp = selfPreference(verdicts, { 'judge-x': 'fam-a' });
  check('self-preference detected and flagged', sp.length === 1 && sp[0].flagged && sp[0].gap > 0.3,
    JSON.stringify(sp));
  const spNone = selfPreference(verdicts.filter((v) => v.judge === 'judge-y').concat(
    verdicts.filter((v) => v.judge === 'judge-x').map((v, i) => ({ ...v, winner: i % 2 ? 'fam-a' : 'other' }))
  ), { 'judge-x': 'fam-a' });
  check('no false flag when rates match', spNone.length === 1 && !spNone[0].flagged, JSON.stringify(spNone));
}

console.log(failures === 0 ? 'rigor/agreement: all checks passed' : `rigor/agreement: ${failures} FAILURES`);
process.exit(failures ? 1 : 0);
