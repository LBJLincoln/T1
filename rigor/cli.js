/**
 * CLI: generate the demo report, or analyse a benchmark JSON file.
 *   node rigor/cli.js demo [out.html]     — synthetic world with ground truth
 *   node rigor/cli.js run data.json [out] — your own benchmark data
 */
import { readFile, writeFile } from 'node:fs/promises';
import { generateWorld } from './synthetic.js';
import { analyze } from './analyze.js';
import { renderReport } from './report.js';

const wrap = (fragment) => `<!doctype html>\n<html lang="en">\n<head><meta charset="utf-8">${''}</head>\n<body style="margin:0">${fragment}</body>\n</html>\n`;

const [mode = 'demo', a, b] = process.argv.slice(2);
let data, out, truth = null;
if (mode === 'demo') {
  data = generateWorld();
  truth = data.truth;
  out = a || 'rigor-report.html';
} else if (mode === 'run') {
  data = JSON.parse(await readFile(a, 'utf8'));
  out = b || 'rigor-report.html';
} else {
  console.error('usage: node rigor/cli.js demo [out.html] | run data.json [out.html]');
  process.exit(2);
}

const t0 = Date.now();
const result = analyze(data);
const html = wrap(renderReport(result, { truth }));
await writeFile(out, html);
console.log(`${out} — ${(html.length / 1024).toFixed(0)} KB, analysed in ${Date.now() - t0}ms`);
console.log(`  significant pairs: ${result.pairs.filter((p) => p.significant).length}/${result.pairs.length}`);
console.log(`  MDD(80% power): ${result.power.mdd80.toFixed(1)} pts on ${result.power.tasks} tasks`);
