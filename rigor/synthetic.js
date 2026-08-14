/**
 * Synthetic benchmark worlds with known ground truth.
 *
 * The only way to prove an evaluation engine is honest is to run it on data
 * where the right answer is known by construction: plant true model
 * qualities, task difficulties, judge noise and judge biases, then check the
 * engine recovers the truth and flags the planted pathologies. Real
 * benchmark data can never do this — you don't know the truth, so you can't
 * measure whether the engine finds it.
 *
 * The generator is also the demo: the shipped report analyses a world with
 * five fictional models, one position-biased judge, and one self-preferring
 * judge, and the report's findings can be checked against this file.
 */
'use strict';

import { rng, gaussian } from './stats.js';

export const DEMO_WORLD = {
  name: 'Contract-review benchmark (synthetic, ground truth known)',
  seed: 20260814,
  tasks: 48,
  // True per-task quality on a 0..100 scale. Deliberately includes a pair
  // separated by less than the benchmark can resolve (72 vs 70): an honest
  // engine must refuse to rank them.
  models: [
    { id: 'atlas-large', name: 'Atlas Large', family: 'atlas', trueQuality: 78, costPerTask: 0.18, secondsPerTask: 74 },
    { id: 'boreal-pro', name: 'Boreal Pro', family: 'boreal', trueQuality: 72, costPerTask: 0.11, secondsPerTask: 41 },
    { id: 'cirrus-max', name: 'Cirrus Max', family: 'cirrus', trueQuality: 70, costPerTask: 0.14, secondsPerTask: 58 },
    { id: 'dune-flash', name: 'Dune Flash', family: 'dune', trueQuality: 61, costPerTask: 0.03, secondsPerTask: 12 },
    { id: 'ember-lite', name: 'Ember Lite', family: 'ember', trueQuality: 52, costPerTask: 0.01, secondsPerTask: 6 },
  ],
  judges: [
    // An honest judge, a position-biased judge, and a self-preferring judge.
    { id: 'judge-impartial', family: null, noise: 6, positionBias: 0, selfBoost: 0 },
    { id: 'judge-first-slot', family: null, noise: 6, positionBias: 0.22, selfBoost: 0 },
    { id: 'judge-boreal', family: 'boreal', noise: 6, positionBias: 0, selfBoost: 9 },
  ],
  taskSd: 9,     // spread of task difficulty
  scoreNoise: 8, // per-(model,task) execution noise
};

/**
 * Generate a full evaluation dataset from a world description.
 * Returns the exact input format `analyze()` consumes, plus `truth`.
 */
export function generateWorld(world = DEMO_WORLD) {
  const rand = rng(world.seed);
  const tasks = Array.from({ length: world.tasks }, (_, i) => ({
    id: 'task-' + String(i + 1).padStart(2, '0'),
    difficulty: gaussian(rand) * world.taskSd,
  }));

  const clamp01 = (x) => Math.min(100, Math.max(0, x));

  // Latent per-(model,task) performance: quality − shared task difficulty +
  // idiosyncratic noise. Shared difficulty is what makes pairing informative.
  const latent = new Map();
  for (const m of world.models) {
    for (const t of tasks) {
      latent.set(m.id + '|' + t.id,
        m.trueQuality - t.difficulty + gaussian(rand) * world.scoreNoise);
    }
  }

  const scores = [];
  for (const m of world.models) {
    for (const t of tasks) {
      scores.push({ model: m.id, task: t.id, score: clamp01(latent.get(m.id + '|' + t.id)) });
    }
  }

  // Per-judge scores over every (task, model): the latent value seen through
  // each judge's noise (and self-boost where the candidate is family).
  const judgeScores = [];
  for (const j of world.judges) {
    for (const m of world.models) {
      for (const t of tasks) {
        let v = latent.get(m.id + '|' + t.id) + gaussian(rand) * j.noise;
        if (j.family && m.family === j.family) v += j.selfBoost;
        judgeScores.push({ judge: j.id, task: t.id, model: m.id, score: clamp01(v) });
      }
    }
  }

  // Pairwise verdicts: every model pair on every 3rd task, judged by every
  // judge, each comparison presented in both orders (position-swap design).
  const verdicts = [];
  let pairSeq = 0;
  for (let i = 0; i < world.models.length; i++) {
    for (let k = i + 1; k < world.models.length; k++) {
      const A = world.models[i], B = world.models[k];
      for (let ti = 0; ti < tasks.length; ti += 3) {
        const t = tasks[ti];
        for (const j of world.judges) {
          const pairId = `p${pairSeq++}`;
          for (const presentation of [1, 2]) {
            // Slot 1 holds A in presentation 1, B in presentation 2.
            const slot1 = presentation === 1 ? A : B;
            const slot2 = presentation === 1 ? B : A;
            const perceive = (m) => {
              let v = latent.get(m.id + '|' + t.id) + gaussian(rand) * j.noise;
              if (j.family && m.family === j.family) v += j.selfBoost;
              return v;
            };
            // Position bias literally adds points to whatever sits first.
            const v1 = perceive(slot1) + j.positionBias * 25;
            const v2 = perceive(slot2);
            const margin = v1 - v2;
            const winnerSlot = Math.abs(margin) < 2 ? 0 : margin > 0 ? 1 : 2;
            const winner = winnerSlot === 0 ? null : winnerSlot === 1 ? slot1.id : slot2.id;
            verdicts.push({
              judge: j.id, task: t.id,
              modelA: slot1.id, modelB: slot2.id,
              winner, winnerSlot, pairId, presentation,
            });
          }
        }
      }
    }
  }

  return {
    name: world.name,
    description:
      'Synthetic dataset with planted ground truth: model qualities, task difficulties, ' +
      'judge noise, one position-biased judge, and one self-preferring judge are all known ' +
      'by construction, so every conclusion in this report can be checked against reality.',
    models: world.models.map(({ trueQuality, family, ...m }) => ({ ...m, family })),
    tasks: tasks.map((t) => ({ id: t.id })),
    scores,
    judgeScores,
    verdicts,
    judgeFamily: Object.fromEntries(world.judges.filter((j) => j.family).map((j) => [j.id, j.family])),
    truth: {
      qualities: Object.fromEntries(world.models.map((m) => [m.id, m.trueQuality])),
      biasedJudge: 'judge-first-slot',
      selfPreferringJudge: 'judge-boreal',
      unresolvablePair: ['boreal-pro', 'cirrus-max'],
    },
  };
}
