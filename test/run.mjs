/**
 * Test runner. Each suite is its own process so a crash cannot mask results.
 * FAST=1 shrinks the calibration studies; CI runs them in full.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const suites = [
  'rigor-stats.test.mjs',
  'rigor-agreement.test.mjs',
  'rigor-calibration.test.mjs',
  'rigor-world.test.mjs',
];

let failed = 0;
for (const suite of suites) {
  console.log(`\n── ${suite} ${'─'.repeat(Math.max(0, 58 - suite.length))}`);
  const res = spawnSync(process.execPath, [join(here, suite)], { stdio: 'inherit', env: process.env });
  if (res.status !== 0) failed++;
}
console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} — ${suites.length - failed}/${suites.length} suites passed`);
process.exit(failed ? 1 : 0);
