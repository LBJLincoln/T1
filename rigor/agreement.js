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

  if (metric !== 'nominal') {
    // The interval metric is only defined on numbers; anything else must fail
    // loudly rather than be silently coerced.
    for (const unit of units) for (const v of unit) {
      if (v !== null && v !== undefined && typeof v !== 'number') {
        throw new TypeError('krippendorffAlpha: interval metric requires numeric values');
      }
    }
  }

  // Coincidence counts keyed by value IDENTITY (string form), holding the
  // original values for delta2 — numeric coercion previously collapsed all
  // string labels into one NaN bucket counted entirely as disagreement.
  const values = new Map(); // key -> {v, n_c}
  const pairs = new Map();  // "kc\u0000kk" (kc <= kk as strings) -> {c, k, o}
  let n = 0;
  let usableUnits = 0;

  for (const unit of units) {
    const vals = unit.filter((v) => v !== null && v !== undefined &&
      !(typeof v === 'number' && Number.isNaN(v)));
    const m = vals.length;
    if (m < 2) continue;
    usableUnits++;
    const w = 1 / (m - 1);
    for (let i = 0; i < m; i++) {
      const ki = String(vals[i]);
      const rec = values.get(ki) || { v: vals[i], count: 0 };
      rec.count += 1;
      values.set(ki, rec);
      n += 1;
      for (let j = 0; j < m; j++) {
        if (i === j) continue;
        const kj = String(vals[j]);
        const [ka, kb] = ki <= kj ? [ki, kj] : [kj, ki];
        const key = ka + '\u0000' + kb;
        const p = pairs.get(key) || {
          c: ki <= kj ? vals[i] : vals[j],
          k: ki <= kj ? vals[j] : vals[i],
          o: 0,
        };
        p.o += w / 2; // each unordered pair counted once
        pairs.set(key, p);
      }
    }
  }

  if (usableUnits === 0 || n < 2) return { alpha: NaN, units: usableUnits, n };

  let Do = 0;
  for (const p of pairs.values()) {
    if (String(p.c) !== String(p.k)) Do += p.o * delta2(p.c, p.k);
  }

  let De = 0;
  const vals = [...values.values()];
  for (let i = 0; i < vals.length; i++) {
    for (let j = i + 1; j < vals.length; j++) {
      De += vals[i].count * vals[j].count * delta2(vals[i].v, vals[j].v);
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
export function positionBias(records, { level = 0.95 } = {}) {
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
    // Only explicit slot verdicts count: data without the swap design
    // (winnerSlot missing) previously inflated "decided" and fabricated bias.
    if (r.winnerSlot !== 1 && r.winnerSlot !== 2) continue;
    decided++;
    if (r.winnerSlot === 1) firstWins++;
  }

  return {
    swappedPairs: dupes,
    flipRate: dupes ? flips / dupes : NaN,
    flipCI: wilsonInterval(flips, Math.max(dupes, 1), { level }),
    firstSlot: wilsonInterval(firstWins, Math.max(decided, 1), { level }),
    decided,
  };
}

/**
 * Self-preference: does a judge rate its own model family above what the
 * rest of the panel gives it?
 *
 * For judge J and candidate model M (same family as J): compare M's win rate
 * in J's verdicts against M's win rate in the rest of the panel's verdicts on
 * the same matchups (task + model pair) — restricting the baseline is what
 * separates self-preference from opponent-mix effects. A gap whose intervals
 * clear zero is flagged.
 *
 * `verdicts`: [{judge, modelA, modelB, winner: modelId|null}]
 * `judgeFamily`: {judgeId: familyName}
 * `modelFamily`: {modelId: familyName} — verdicts speak in model ids, judges
 * in families; conflating the two silently finds no matches (a bug this
 * signature exists to prevent).
 */
export function selfPreference(verdicts, judgeFamily, modelFamily = {}, { level = 0.95 } = {}) {
  const famOf = (modelId) => modelFamily[modelId] ?? modelId;
  // Matchup key: task plus the unordered model pair. The panel baseline is
  // restricted to matchups the judge itself judged — otherwise a judge that
  // only saw its family against weak opponents would be flagged for honestly
  // reporting wins the rest of the panel never got to see.
  const matchKey = (v) => {
    const [a, b] = [v.modelA, v.modelB].sort();
    return (v.task ?? '') + '\u0000' + a + '\u0000' + b;
  };
  const out = [];
  const judges = [...new Set(verdicts.map((v) => v.judge))];
  for (const judge of judges) {
    const family = judgeFamily[judge];
    if (!family) continue;
    const ownMatches = new Set(
      verdicts.filter((v) => v.judge === judge).map(matchKey));
    let ownWins = 0, ownDecided = 0, otherWins = 0, otherDecided = 0;
    for (const v of verdicts) {
      const involvesFamily = famOf(v.modelA) === family || famOf(v.modelB) === family;
      if (!involvesFamily || !v.winner) continue;
      if (v.judge === judge) {
        ownDecided++;
        if (famOf(v.winner) === family) ownWins++;
      } else if (ownMatches.has(matchKey(v))) {
        otherDecided++;
        if (famOf(v.winner) === family) otherWins++;
      }
    }
    if (ownDecided === 0 || otherDecided === 0) continue;
    const own = wilsonInterval(ownWins, ownDecided, { level });
    const others = wilsonInterval(otherWins, otherDecided, { level });
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
