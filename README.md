# RIGOR

Statistically honest AI-model evaluation. Zero dependencies, Node.js.

```bash
npm run demo        # analyse the synthetic benchmark → rigor-report.html
npm test            # fast suite (~2 min)
npm run test:full   # full calibration studies
node rigor/cli.js run your-benchmark.json out.html
```

## The argument

Benchmark platforms — including the best custom-eval products — report point
scores: *"Model A scored 60 at $0.18/task."* A point score without uncertainty
is not a measurement; it is an anecdote with digits. The specific failures:

1. **No uncertainty.** A 60 vs a 58 on 40 tasks is usually a coin flip, and
   nothing on the page says so.
2. **Thrown-away pairing.** Every model answered the *same* tasks. Per-task
   differences are far more sensitive than comparing two means — leaderboards
   discard this for free power.
3. **No multiple-comparison control.** Five models is ten pairwise claims;
   at 5% each, the chance of at least one fluke "A beats B" approaches 40%.
4. **Unexamined judges.** LLM judges have measured position bias and
   self-preference. Averaging their scores without diagnostics launders bias
   into rankings.
5. **No statement of resolution.** No benchmark says what difference it is
   even *capable* of detecting — the single most decision-relevant number.

RIGOR is an engine that fixes all five, and — the part that makes it an
instrument rather than a formula collection — **its own statistics are
validated by simulation against known ground truth in the test suite.**

## What it computes

| Question | Method |
|---|---|
| How good is each model? | Mean score with **BCa bootstrap** 95% intervals (skew-robust) |
| Which differences are real? | **Paired sign-flip permutation tests** on per-task differences, **Holm-corrected** across the family, with **paired dominance** effect sizes |
| What can this benchmark detect? | **Minimum detectable difference** at 80% power under the report's own Holm-corrected rule, and tasks required to resolve 5- and 2-point gaps — validated against simulation with the actual test |
| What does quality cost? | Cost–quality **Pareto frontier with dominance probabilities** (bootstrap over the shared task set, pairing preserved) |
| Can the judges be trusted? | **Krippendorff's α** (handles missing ratings) with leave-one-out; **position bias** from an order-swapped design with Wilson intervals; **self-preference** screening by judge family |
| Do head-to-head verdicts agree? | **Bradley–Terry** strengths (Hunter's MM, ε-connectivity, residual-checked convergence) fitted **excluding flagged judges** with an all-verdicts sensitivity fit, cluster-bootstrap intervals, and **rank stability** |

Everything lands in a single-file HTML report, structured as questions and
verdicts. The report states what the benchmark *cannot* claim with the same
prominence as what it can.

## The receipts

`test/` measures the advertised operating characteristics rather than assuming
them:

- **BCa coverage:** ~95% measured over 400 synthetic worlds with skewed,
  ceiling-limited scores.
- **P-value calibration:** under a true null, permutation p-values pass a KS
  test for uniformity; type-I error at the nominal rate.
- **Holm FWER:** across hundreds of 10-comparison null worlds, family-wise
  error stays at ~5%.
- **Bradley–Terry:** planted strengths recovered inside the intervals at the
  advertised coverage rate, measured across many worlds — not "all four
  intervals covered once", which would itself be the multiple-comparison
  mistake this library exists to catch.
- **End-to-end truth recovery:** the demo world plants a position-biased
  judge, a self-preferring judge, and a model pair 2 points apart. The engine
  must flag both judges, neither honest one, and *refuse to rank* the
  unresolvable pair. It does, and the report prints the planted truth beside
  the recovered estimates so you can check it yourself.

Every stochastic step is seeded; rerunning reproduces the report bit for bit.

## Input format

```jsonc
{
  "name": "My benchmark",
  "models": [{ "id": "m1", "name": "Model One", "family": "vendor-a",
               "costPerTask": 0.12, "secondsPerTask": 40 }],
  "tasks":  [{ "id": "t1" }],
  "scores": [{ "model": "m1", "task": "t1", "score": 73 }],
  // optional — enables judge diagnostics and Bradley–Terry:
  "judgeScores": [{ "judge": "j1", "task": "t1", "model": "m1", "score": 70 }],
  "verdicts": [{ "judge": "j1", "task": "t1", "modelA": "m1", "modelB": "m2",
                 "winner": "m1", "winnerSlot": 1, "pairId": "p0", "presentation": 1 }],
  "judgeFamily": { "j1": "vendor-a" }
}
```

Tasks missing any model's score are excluded from paired analyses and the
exclusion is reported — silently keeping them would bias comparisons toward
whichever model skipped the hard tasks.

## Layout

```
rigor/stats.js         RNG, normal dist, BCa bootstrap, permutation test,
                       Holm, Wilson, Cliff's δ, power analysis
rigor/agreement.js     Krippendorff's α, Cohen's κ, position bias, self-preference
rigor/bradleyterry.js  BT strengths via MM, bootstrap CIs, rank stability
rigor/analyze.js       pipeline: records in, conclusions out
rigor/synthetic.js     ground-truth world generator (also the demo)
rigor/report.js        single-file HTML report (validated palette, both themes)
rigor/cli.js           demo | run
test/                  unit, calibration, and truth-recovery suites
```

## Honest limitations

- Pairwise permutation tests within one benchmark share models, so the tests
  are dependent; Holm remains valid under dependence (that is why it was
  chosen). Resolution figures are quoted at the family's worst-case threshold
  α/m — a conservative bound, and themselves estimated from the same data
  they describe.
- The MDD formula is a normal approximation with a hard refusal below the
  sign-flip test's discreteness floor (n ≤ 5 at α=0.05 detects nothing); the
  suite validates it against the exact permutation test at realistic n.
- Bradley–Terry: the primary fit excludes judges the diagnostics flagged, and
  an all-verdicts sensitivity fit ships beside it; the bootstrap clusters
  order-swapped duplicate presentations so they are never resampled apart.
  Verdicts by *different* judges on the same task remain treated as
  independent clusters.
- Krippendorff's α is reported as a point estimate against fixed gates; near
  a gate boundary the verdict can turn on sampling noise (bootstrapping α is
  the known remedy and is not yet implemented).
- LLM-as-judge diagnostics detect the pathologies they measure. A panel that
  is *consistently* wrong in the same direction passes every consistency
  check; only better ground truth fixes that.
