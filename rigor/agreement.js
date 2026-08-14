/**
 * Judge science: are the graders trustworthy, and how would we know?
 *
 * LLM-as-judge pipelines inherit three well-documented pathologies:
 * position bias (the answer shown first wins more), self-preference (a judge
 * favours output from its own model family), and plain unreliability (judges
 * that disagree with every other judge). A platform that averages judge
 * scores without measuring any of these is laundering noise into rankings.
 * This module measures all three, plus chance-corrected agreement.
 */
'use strict';

import { wilsonInterval } from './stats.js';

// ---------------------------------------------------------------------------
// Krippendorff's alpha
// ---------------------------------------------------------------------------

/**
 * Krippendorff's alpha for inter-judge reliability.
 *
 * Chosen over raw percent agreement (which ignores chance) and over Fleiss'
 * kappa (which cannot handle missing ratings) because real judging runs have
 * holes: judges time out, abstain, or arrive mid-benchmark. Alpha handles any
 * number of judges, missing data, and both nominal and interval metrics.
 *
 * `units` is an array of arrays: units[u][j] = judge j's value for unit u,
 * with null/undefined for missing. Units with fewer than two ratings are
 * excluded by definition (they carry no agreement information).
 *
 * α = 1 − D_o/D_e with the coincidence-matrix formulation:
 *   o_ck  = Σ_units (pairs of values c,k in the unit) / (m_u − 1)
 *   D_o   = Σ_{c<k} o_ck · δ²(c,k)
 *   D_e   = Σ_{c<k} n_c · n_k · δ²(c,k) / (n − 1)
 * δ² is 1[c≠k] for nominal data, (c−k)² for interval data.
 *
 * Interpretation gates follow Krippendorff: α ≥ 0.800 reliable, α ≥ 0.667
 * usable for tentative conclusions, below that the ratings are noise.
 */
export function krippendorffAlpha(units, { metric = 'interval' } = {}) {
  const delta2 = metric === 'nominal'
    ? (c, k) => (c === k ? 0 : 1)
    : (c, k) => (c - k) * (c - k);

  // Coincidence counts keyed by value pair.
  const values = new Map(); // value -> marginal n_c
  const pairs = new Map();  // "c|k" (c<=k) -> o_ck
  let n = 0;
  let usableUnits = 0;

  for (const unit of units) {
    const vals = unit.filter((v) => v !== null && v !== undefined && !Number.isNaN(v));
    const m = vals.length;
    if (m < 2) continue;
    usableUnits++;
    const w = 1 / (m - 1);
    for (let i = 0; i < m; i++) {
      values.set(vals[i], (values.get(vals[i]) || 0) + 1);
      n += 1;
      for (let j = 0; j < m; j++) {
        if (i === j) continue;
        const c = Math.min(vals[i], vals[j]);
        const k = Math.max(vals[i], vals[j]);
        const key = c + '|' + k;
        pairs.set(key, (pairs.get(key) || 0) + w / 2); // each unordered pair counted once
      }
    }
  }

  if (usableUnits === 0 || n < 2) return { alpha: NaN, units: usableUnits, n };

  let Do = 0;
  for (const [key, o] of pairs) {
    const [c, k] = key.split('|').map(Number);
    if (c !== k) Do += o * delta2(c, k);
  }

  let De = 0;
  const vals = [...values.entries()];
  for (let i = 0; i < vals.length; i++) {
    for (let j = i + 1; j < vals.length; j++) {
      De += vals[i][1] * vals[j][1] * delta2(vals[i][0], vals[j][0]);
    }
  }
  De /= (n - 1);

  if (De === 0) {
    // Every rating identical: perfect (if trivial) agreement.
    return { alpha: 1, units: usableUnits, n };
  }
  return { alpha: 1 - Do / De, units: usableUnits, n };
}

/** Cohen's kappa for exactly two judges over nominal categories. */
export function cohensKappa(a, b) {
  if (a.length !== b.length) throw new RangeError('cohensKappa: length mismatch');
  const n = a.length;
  if (n === 0) return NaN;
  let agree = 0;
  const margA = new Map(), margB = new Map();
  for (let i = 0; i < n; i++) {
    if (a[i] === b[i]) agree++;
    margA.set(a[i], (margA.get(a[i]) || 0) + 1);
    margB.set(b[i], (margB.get(b[i]) || 0) + 1);
  }
  const po = agree / n;
  let pe = 0;
  for (const [cat, ca] of margA) pe += (ca / n) * ((margB.get(cat) || 0) / n);
  if (pe === 1) return 1;
  return (po - pe) / (1 - pe);
}

// ---------------------------------------------------------------------------
// Judge bias diagnostics
// ---------------------------------------------------------------------------

/**
 * Position bias from order-swapped duplicate judgments.
 *
 * Every pairwise comparison is presented twice, with the candidate order
 * swapped. A judge with no position bias gives the same verdict both times
 * (up to noise, and up to ties). Two readouts:
 *
 *  - flipRate: fraction of swapped duplicates whose verdict changed. Pure
 *    inconsistency; includes noise as well as bias.
 *  - firstSlotRate: among all verdicts, how often the answer shown first won.
 *    0.5 means no positional preference; deviation with a Wilson CI excluding
 *    0.5 is bias, in either direction.
 *
 * `records`: [{winnerSlot: 1|2|0 (0 = tie), pairId, presentation: 1|2}]
 * where presentation distinguishes the two orderings of the same pair.
 */
export function positionBias(records) {
  const byPair = new Map();
  for (const r of records) {
    if (!byPair.has(r.pairId)) byPair.set(r.pairId, {});
    byPair.get(r.pairId)[r.presentation] = r;
  }

  let dupes = 0, flips = 0;
  for (const pres of byPair.values()) {
    if (!pres[1] || !pres[2]) continue;
    dupes++;
    // Consistency in *candidate* space: slot-1 winner in presentation 1 is the
    // slot-2 candidate in presentation 2. Same candidate winning both times
    // means slots differ; equal slots across presentations = a flip.
    const a = pres[1].winnerSlot, b = pres[2].winnerSlot;
    const consistent = (a === 0 && b === 0) || (a !== 0 && b !== 0 && a !== b);
    if (!consistent) flips++;
  }

  let decided = 0, firstWins = 0;
  for (const r of records) {
    if (r.winnerSlot === 0) continue;
    decided++;
    if (r.winnerSlot === 1) firstWins++;
  }

  return {
    swappedPairs: dupes,
    flipRate: dupes ? flips / dupes : NaN,
    flipCI: wilsonInterval(flips, Math.max(dupes, 1)),
    firstSlot: wilsonInterval(firstWins, Math.max(decided, 1)),
    decided,
  };
}

/**
 * Self-preference: does a judge rate its own model family above what the
 * rest of the panel gives it?
 *
 * For judge J and candidate model M (same family as J): compare M's win rate
 * in J's verdicts against M's win rate in all other judges' verdicts on the
 * same pairs. Report the gap with intervals on both sides; a gap whose
 * intervals clear zero is flagged.
 *
 * `verdicts`: [{judge, modelA, modelB, winner: modelId|null}]
 * `judgeFamily`: {judgeId: familyName}
 * `modelFamily`: {modelId: familyName} — verdicts speak in model ids, judges
 * in families; conflating the two silently finds no matches (a bug this
 * signature exists to prevent).
 */
export function selfPreference(verdicts, judgeFamily, modelFamily = {}) {
  const famOf = (modelId) => modelFamily[modelId] ?? modelId;
  const out = [];
  const judges = [...new Set(verdicts.map((v) => v.judge))];
  for (const judge of judges) {
    const family = judgeFamily[judge];
    if (!family) continue;
    let ownWins = 0, ownDecided = 0, otherWins = 0, otherDecided = 0;
    for (const v of verdicts) {
      const involvesFamily = famOf(v.modelA) === family || famOf(v.modelB) === family;
      if (!involvesFamily || !v.winner) continue;
      if (v.judge === judge) {
        ownDecided++;
        if (famOf(v.winner) === family) ownWins++;
      } else {
        otherDecided++;
        if (famOf(v.winner) === family) otherWins++;
      }
    }
    if (ownDecided === 0 || otherDecided === 0) continue;
    const own = wilsonInterval(ownWins, ownDecided);
    const others = wilsonInterval(otherWins, otherDecided);
    out.push({
      judge,
      family,
      ownRate: own,
      panelRate: others,
      gap: own.est - others.est,
      // Conservative flag: the judge's lower bound clears the panel's upper.
      flagged: own.lo > others.hi,
    });
  }
  return out;
}
