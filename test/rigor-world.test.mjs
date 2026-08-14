/**
 * End to end: analyze() on the demo world must recover the planted truth.
 *  - ranking of well-separated models correct, with intervals covering truth-
 *    implied ordering
 *  - the deliberately unresolvable pair (72 vs 70) must NOT be called
 *    significant after Holm
 *  - the planted position-biased judge must be flagged, the honest one not
 *  - the planted self-preferring judge must be flagged
 *  - power section must say the benchmark cannot resolve 2 points
 */
import { generateWorld, DEMO_WORLD } from '../rigor/synthetic.js';
import { analyze } from '../rigor/analyze.js';

let failures = 0;
const check = (name, cond, extra = '') => {
  if (!cond) { failures++; console.log(`  FAIL ${name} ${extra}`); }
};

const data = generateWorld();
const result = analyze(data);
const truth = data.truth;

// --- ranking ----------------------------------------------------------------
const byMean = result.models.slice().sort((a, b) => b.mean - a.mean).map((m) => m.id);
check('best model recovered', byMean[0] === 'atlas-large', byMean.join(','));
check('worst model recovered', byMean[4] === 'ember-lite', byMean.join(','));

// Big true gaps must be significant after Holm.
const pair = (a, b) => result.pairs.find((p) => (p.a === a && p.b === b) || (p.a === b && p.b === a));
check('atlas vs ember significant', pair('atlas-large', 'ember-lite').significant);
check('atlas vs dune significant', pair('atlas-large', 'dune-flash').significant);

// The planted 2-point gap must be refused: an honest engine says "cannot tell".
const close = pair(truth.unresolvablePair[0], truth.unresolvablePair[1]);
check('2-point gap not called significant', !close.significant,
  `pAdj=${close.pAdjusted}, meanDiff=${close.meanDiff}`);

// --- power section names the limitation -------------------------------------
check('MDD larger than the unresolvable gap', result.power.mdd80 > 2, String(result.power.mdd80));
check('required tasks for 2 pts exceeds benchmark size',
  result.power.tasksFor2pts > result.power.tasks,
  `${result.power.tasksFor2pts} needed vs ${result.power.tasks} present`);

// --- judge pathology detection ----------------------------------------------
const biased = result.bias.byJudge[truth.biasedJudge];
const honest = result.bias.byJudge['judge-impartial'];
check('position-biased judge flagged (first-slot CI clear of 0.5)',
  biased.firstSlot.lo > 0.5, JSON.stringify(biased.firstSlot));
check('honest judge not flagged', honest.firstSlot.lo <= 0.5 && honest.firstSlot.hi >= 0.5,
  JSON.stringify(honest.firstSlot));
check('biased judge flips more than honest judge',
  biased.flipRate > honest.flipRate, `${biased.flipRate} vs ${honest.flipRate}`);

const sp = result.bias.selfPreference.find((s) => s.judge === truth.selfPreferringJudge);
check('self-preferring judge flagged', sp && sp.flagged, JSON.stringify(sp));

// --- panel reliability -------------------------------------------------------
check('alpha in plausible range for noisy panel', result.judges.alpha > 0.5 && result.judges.alpha < 0.99,
  String(result.judges.alpha));

// --- Bradley-Terry agrees with score ranking on separated models -------------
const bt = result.bradleyTerry.strengths.slice().sort((a, b) => b.logStrength - a.logStrength).map((e) => e.model);
check('BT top matches score top', bt[0] === 'atlas-large', bt.join(','));
check('BT bottom matches score bottom', bt[4] === 'ember-lite', bt.join(','));
// The flagged judges must be excluded from the primary fit — feeding a
// detected bias back into the headline ranking was the critic's critical.
check('flagged judges excluded from primary BT fit',
  result.bradleyTerry.excludedJudges.includes(truth.selfPreferringJudge) &&
  result.bradleyTerry.excludedJudges.includes(truth.biasedJudge),
  JSON.stringify(result.bradleyTerry.excludedJudges));
check('sensitivity fit present', result.bradleyTerry.allVerdicts !== null);

// --- Pareto ------------------------------------------------------------------
const par = Object.fromEntries(result.pareto.map((p) => [p.id, p.frontierProbability]));
check('cheapest model on frontier with certainty', par['ember-lite'] > 0.95, String(par['ember-lite']));
check('best model on frontier with certainty', par['atlas-large'] > 0.95, String(par['atlas-large']));
// cirrus-max: worse than boreal-pro on quality AND more expensive → dominated.
check('dominated model has low frontier probability', par['cirrus-max'] < 0.4, String(par['cirrus-max']));

console.log(failures === 0 ? 'rigor/world: all checks passed' : `rigor/world: ${failures} FAILURES`);
process.exit(failures ? 1 : 0);
