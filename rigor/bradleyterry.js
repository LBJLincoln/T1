/**
 * Bradley–Terry strength estimation from pairwise preferences, with honest
 * uncertainty.
 *
 * Raw win rate is the obvious statistic and the wrong one: it depends on who
 * you happened to be compared against. Bradley–Terry models a latent strength
 * π_i per model with P(i beats j) = π_i / (π_i + π_j), which corrects for
 * opponent mix — the same reason chess uses Elo rather than win percentage.
 *
 * Fitting uses Hunter's (2004) MM algorithm, which is guaranteed to increase
 * the likelihood monotonically:  π_i ← W_i / Σ_{j≠i} n_ij / (π_i + π_j).
 * Ties are split as half a win to each side (the standard reduction). A small
 * pseudo-count ε on every pair keeps the comparison graph connected so the
 * MLE exists even when one model never lost — otherwise its strength diverges
 * and the algorithm silently degenerates.
 *
 * Uncertainty comes from bootstrap over matches: resample the match list with
 * replacement, refit, take percentile intervals on the log-strength scale.
 * That answers the question a rating point cannot: "could this ranking
 * plausibly be the other way round?" — reported as rankStability, the
 * fraction of bootstrap worlds in which each model holds its modal rank.
 */
'use strict';

import { rng, quantile } from './stats.js';

/**
 * @param models  array of model names
 * @param matches array of {a, b, winner} where winner is a|b|null (tie)
 */
export function bradleyTerry(models, matches, {
  epsilon = 0.1, maxIter = 2000, tol = 1e-10, B = 1000, seed = 11, level = 0.95,
} = {}) {
  const index = new Map(models.map((m, i) => [m, i]));
  const k = models.length;
  if (k < 2) throw new RangeError('bradleyTerry: need at least two models');

  const fit = (wins, games) => {
    // wins[i][j]: (possibly fractional) wins of i over j; games = wins + wins^T.
    let pi = new Array(k).fill(1);
    for (let iter = 0; iter < maxIter; iter++) {
      let maxDelta = 0;
      const next = new Array(k);
      for (let i = 0; i < k; i++) {
        let W = 0, denom = 0;
        for (let j = 0; j < k; j++) {
          if (j === i) continue;
          W += wins[i][j];
          denom += games[i][j] / (pi[i] + pi[j]);
        }
        next[i] = denom > 0 ? W / denom : pi[i];
      }
      // Normalise to geometric mean 1: strengths are only identified up to scale.
      const logMean = next.reduce((a, p) => a + Math.log(p), 0) / k;
      const scale = Math.exp(logMean);
      for (let i = 0; i < k; i++) {
        next[i] /= scale;
        maxDelta = Math.max(maxDelta, Math.abs(next[i] - pi[i]));
      }
      pi = next;
      if (maxDelta < tol) break;
    }
    return pi;
  };

  const tally = (ms) => {
    const wins = Array.from({ length: k }, () => new Array(k).fill(0));
    const games = Array.from({ length: k }, () => new Array(k).fill(0));
    // Pseudo-counts: every ordered pair gets ε half-games, guaranteeing a
    // connected graph and a finite MLE.
    for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) {
      if (i !== j) { wins[i][j] = epsilon; games[i][j] = 2 * epsilon; }
    }
    for (const m of ms) {
      const i = index.get(m.a), j = index.get(m.b);
      if (i === undefined || j === undefined) continue;
      games[i][j] += 1; games[j][i] += 1;
      if (m.winner === m.a) wins[i][j] += 1;
      else if (m.winner === m.b) wins[j][i] += 1;
      else { wins[i][j] += 0.5; wins[j][i] += 0.5; }
    }
    return { wins, games };
  };

  const { wins, games } = tally(matches);
  const point = fit(wins, games);
  const logPoint = point.map(Math.log);

  // Bootstrap over matches.
  const rand = rng(seed);
  const n = matches.length;
  const logReps = Array.from({ length: k }, () => []);
  const rankCounts = Array.from({ length: k }, () => new Array(k).fill(0));
  for (let b = 0; b < B; b++) {
    const res = new Array(n);
    for (let i = 0; i < n; i++) res[i] = matches[(rand() * n) | 0];
    const t = tally(res);
    const p = fit(t.wins, t.games);
    const order = p.map((v, i) => [v, i]).sort((x, y) => y[0] - x[0]);
    for (let r = 0; r < k; r++) rankCounts[order[r][1]][r]++;
    for (let i = 0; i < k; i++) logReps[i].push(Math.log(p[i]));
  }

  const alpha = (1 - level) / 2;
  return models.map((m, i) => {
    const sorted = logReps[i].slice().sort((a, b) => a - b);
    const modalRank = rankCounts[i].indexOf(Math.max(...rankCounts[i]));
    return {
      model: m,
      // Log-strength: 0 is the field average by construction.
      logStrength: logPoint[i],
      lo: quantile(sorted, alpha),
      hi: quantile(sorted, 1 - alpha),
      // Elo-style display scale (400/ln 10 per log unit, anchored at 1000).
      elo: 1000 + (400 / Math.LN10) * logPoint[i],
      modalRank: modalRank + 1,
      rankStability: rankCounts[i][modalRank] / B,
      rankDistribution: rankCounts[i].map((c) => c / B),
    };
  });
}
