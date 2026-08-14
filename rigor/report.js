/**
 * Report generator: analysis results → a single self-contained HTML fragment.
 *
 * Design brief: a laboratory report, not a marketing leaderboard. Every chart
 * answers a stated question; every number that carries uncertainty shows it;
 * everything a chart shows is also present as a table (accessibility and
 * relief rule for low-contrast marks); hovers via native SVG <title> so the
 * document needs zero JavaScript.
 *
 * Colour system: the validated reference dataviz palette (series blue/orange/
 * aqua, status colours for flags), tokenised for light and dark with the
 * explicit-toggle-beats-OS pattern. Identity is never colour-alone: marks are
 * directly labelled.
 */
'use strict';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const f1 = (x) => (Math.round(x * 10) / 10).toFixed(1);
const f2 = (x) => (Math.round(x * 100) / 100).toFixed(2);
const f3 = (x) => (Math.round(x * 1000) / 1000).toFixed(3);
const pFmt = (p) => (p < 0.001 ? '&lt;0.001' : f3(p));
const money = (x) => '$' + (x < 0.1 ? x.toFixed(3) : x.toFixed(2));

const CSS = /* css */`
.rg { color-scheme: light;
  --surface: #fcfcfb; --card: #f4f4f1; --ink: #0b0b0b; --ink-2: #52514e; --ink-3: #8a8984;
  --line: #e3e2dd; --s1: #2a78d6; --s2: #eb6834; --s3: #1baf7a;
  --good: #0ca30c; --serious: #ec835a; --critical: #d03b3b;
  background: var(--surface); color: var(--ink);
  font: 15px/1.6 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}
@media (prefers-color-scheme: dark) {
  :root:where(:not([data-theme="light"])) .rg { color-scheme: dark;
    --surface: #1a1a19; --card: #232322; --ink: #ffffff; --ink-2: #c3c2b7; --ink-3: #8d8c85;
    --line: #34342f; --s1: #3987e5; --s2: #d95926; --s3: #199e70;
  }
}
:root[data-theme="dark"] .rg { color-scheme: dark;
  --surface: #1a1a19; --card: #232322; --ink: #ffffff; --ink-2: #c3c2b7; --ink-3: #8d8c85;
  --line: #34342f; --s1: #3987e5; --s2: #d95926; --s3: #199e70;
}
.rg * { box-sizing: border-box; }
.rg { margin: 0; padding: 0 0 5rem; }
.rg .wrap { max-width: 62rem; margin-inline: auto; padding-inline: clamp(16px, 4vw, 40px); }
.rg header.masthead { border-bottom: 1px solid var(--line); padding: 2.6rem 0 1.6rem; margin-bottom: 2.4rem; }
.rg .brand { font: 700 13px/1 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: .42em; color: var(--s1); }
.rg h1 { font-size: clamp(1.6rem, 3.6vw, 2.4rem); line-height: 1.15; letter-spacing: -.02em; margin: .55rem 0 .4rem; text-wrap: balance; }
.rg .sub { color: var(--ink-2); max-width: 62ch; margin: 0; }
.rg .meta { display: flex; gap: 1.6rem; flex-wrap: wrap; margin-top: 1.1rem;
  font: 12px/1.4 ui-monospace, monospace; color: var(--ink-3); }
.rg section { margin-bottom: 3rem; }
.rg h2 { font-size: 1.25rem; letter-spacing: -.01em; margin: 0 0 .3rem; text-wrap: balance; }
.rg .q { font: 600 11px/1 ui-monospace, monospace; letter-spacing: .3em; text-transform: uppercase;
  color: var(--s1); margin: 0 0 .5rem; }
.rg .note { color: var(--ink-2); max-width: 70ch; margin: .2rem 0 1rem; }
.rg .card { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 18px; }
.rg figure { margin: 0; }
.rg figcaption { font-size: 13px; color: var(--ink-3); margin-top: .6rem; }
.rg svg text { font-family: ui-sans-serif, system-ui, sans-serif; }
.rg svg .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.rg .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 12px; }
.rg .tile { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 16px 18px; }
.rg .tile .v { font: 600 1.7rem/1.1 ui-monospace, monospace; font-variant-numeric: tabular-nums; }
.rg .tile .l { font-size: 12.5px; color: var(--ink-2); margin-top: .35rem; }
.rg table { border-collapse: collapse; width: 100%; font-size: 13.5px; font-variant-numeric: tabular-nums; }
.rg th, .rg td { text-align: left; padding: 7px 10px; border-bottom: 1px solid var(--line); vertical-align: top; }
.rg th { font-size: 11.5px; text-transform: uppercase; letter-spacing: .07em; color: var(--ink-3); font-weight: 600; }
.rg td.num, .rg th.num { text-align: right; font-family: ui-monospace, monospace; }
.rg .chip { display: inline-block; font: 600 11px/1 ui-monospace, monospace; padding: 4px 8px; border-radius: 999px; }
.rg .chip.sig { background: var(--s1); color: #fff; }
.rg .chip.ns { border: 1px solid var(--line); color: var(--ink-2); }
.rg .flag { color: var(--critical); font-weight: 600; }
.rg .ok { color: var(--good); font-weight: 600; }
.rg details { margin-top: .8rem; }
.rg summary { cursor: pointer; font-size: 13px; color: var(--ink-2); }
.rg details[open] summary { margin-bottom: .5rem; }
.rg .verdicts li { margin: .35rem 0; max-width: 74ch; }
.rg .methods { font-size: 13.5px; color: var(--ink-2); }
.rg .methods h3 { font-size: 13px; text-transform: uppercase; letter-spacing: .08em; color: var(--ink-3); margin: 1.2rem 0 .3rem; }
.rg .methods p { max-width: 76ch; margin: .3rem 0; }
.rg .scroll { overflow-x: auto; }
`;

// ---------------------------------------------------------------------------
// SVG chart primitives
// ---------------------------------------------------------------------------

/** Horizontal dot-and-interval chart: one row per item. */
function intervalChart(items, { domain, refLine = null, fmt = f1, unit = '', width = 860 }) {
  const rowH = 46, padL = 150, padR = 96, padT = 16, padB = 34;
  const H = padT + items.length * rowH + padB;
  const [d0, d1] = domain;
  const X = (v) => padL + ((v - d0) / (d1 - d0)) * (width - padL - padR);

  // Recessive grid at ~6 ticks.
  const ticks = [];
  const step = niceStep((d1 - d0) / 5);
  for (let t = Math.ceil(d0 / step) * step; t <= d1 + 1e-9; t += step) ticks.push(t);

  let s = `<svg viewBox="0 0 ${width} ${H}" role="img" style="width:100%;height:auto;display:block">`;
  for (const t of ticks) {
    s += `<line x1="${X(t)}" y1="${padT}" x2="${X(t)}" y2="${H - padB}" stroke="var(--line)" stroke-width="1"/>`;
    s += `<text x="${X(t)}" y="${H - padB + 18}" text-anchor="middle" font-size="11" class="mono" fill="var(--ink-3)">${fmt(t)}${unit}</text>`;
  }
  if (refLine !== null) {
    s += `<line x1="${X(refLine)}" y1="${padT}" x2="${X(refLine)}" y2="${H - padB}" stroke="var(--ink-3)" stroke-width="1.5" stroke-dasharray="4 4"/>`;
  }
  items.forEach((it, i) => {
    const y = padT + i * rowH + rowH / 2;
    const title = `${it.label}: ${fmt(it.v)}${unit} [${fmt(it.lo)}, ${fmt(it.hi)}]`;
    s += `<g><title>${esc(title)}</title>`;
    s += `<text x="${padL - 12}" y="${y + 4}" text-anchor="end" font-size="13" fill="var(--ink)">${esc(it.label)}</text>`;
    s += `<line x1="${X(it.lo)}" y1="${y}" x2="${X(it.hi)}" y2="${y}" stroke="${it.color || 'var(--s1)'}" stroke-width="2"/>`;
    s += `<line x1="${X(it.lo)}" y1="${y - 5}" x2="${X(it.lo)}" y2="${y + 5}" stroke="${it.color || 'var(--s1)'}" stroke-width="2"/>`;
    s += `<line x1="${X(it.hi)}" y1="${y - 5}" x2="${X(it.hi)}" y2="${y + 5}" stroke="${it.color || 'var(--s1)'}" stroke-width="2"/>`;
    s += `<circle cx="${X(it.v)}" cy="${y}" r="5" fill="${it.color || 'var(--s1)'}" stroke="var(--surface)" stroke-width="2"/>`;
    s += `<text x="${X(it.hi) + 10}" y="${y + 4}" font-size="12" class="mono" fill="var(--ink-2)">${fmt(it.v)}${unit}</text>`;
    if (it.tag) s += `<text x="${width - padR + 88}" y="${y + 4}" text-anchor="end" font-size="11" class="mono" fill="${it.tagColor || 'var(--ink-3)'}">${esc(it.tag)}</text>`;
    s += `</g>`;
  });
  s += '</svg>';
  return s;
}

/** Cost–quality scatter with vertical CI whiskers and a frontier steps line. */
function paretoChart(models, paretoProbs, { width = 860 } = {}) {
  const H = 400, padL = 64, padR = 30, padT = 18, padB = 52;
  const costs = models.map((m) => m.costPerTask);
  const cMin = Math.min(...costs) / 1.6, cMax = Math.max(...costs) * 1.6;
  const sMin = Math.min(...models.map((m) => m.lo)) - 4;
  const sMax = Math.max(...models.map((m) => m.hi)) + 4;
  const X = (c) => padL + (Math.log(c / cMin) / Math.log(cMax / cMin)) * (width - padL - padR);
  const Y = (v) => padT + (1 - (v - sMin) / (sMax - sMin)) * (H - padT - padB);
  const probOf = Object.fromEntries(paretoProbs.map((p) => [p.id, p.frontierProbability]));

  let s = `<svg viewBox="0 0 ${width} ${H}" role="img" style="width:100%;height:auto;display:block">`;
  // Grid: score lines + log-cost ticks.
  const yStep = niceStep((sMax - sMin) / 4);
  for (let t = Math.ceil(sMin / yStep) * yStep; t <= sMax; t += yStep) {
    s += `<line x1="${padL}" y1="${Y(t)}" x2="${width - padR}" y2="${Y(t)}" stroke="var(--line)"/>`;
    s += `<text x="${padL - 8}" y="${Y(t) + 4}" text-anchor="end" font-size="11" class="mono" fill="var(--ink-3)">${f1(t)}</text>`;
  }
  for (const c of logTicks(cMin, cMax)) {
    s += `<line x1="${X(c)}" y1="${padT}" x2="${X(c)}" y2="${H - padB}" stroke="var(--line)"/>`;
    s += `<text x="${X(c)}" y="${H - padB + 18}" text-anchor="middle" font-size="11" class="mono" fill="var(--ink-3)">${money(c)}</text>`;
  }
  s += `<text x="${(padL + width - padR) / 2}" y="${H - 8}" text-anchor="middle" font-size="11.5" fill="var(--ink-3)">cost per task (log scale)</text>`;

  // Empirical frontier through point estimates (staircase, dashed).
  const sorted = models.slice().sort((a, b) => a.costPerTask - b.costPerTask);
  let best = -Infinity;
  const frontier = [];
  for (const m of sorted) if (m.mean > best) { best = m.mean; frontier.push(m); }
  let path = '';
  frontier.forEach((m, i) => {
    const x = X(m.costPerTask), y = Y(m.mean);
    path += i === 0 ? `M ${x} ${y}` : ` L ${x} ${Y(frontier[i - 1].mean)} L ${x} ${y}`;
  });
  s += `<path d="${path}" fill="none" stroke="var(--s3)" stroke-width="2" stroke-dasharray="5 4" opacity="0.85"/>`;

  // Label placement with collision avoidance: labels prefer sitting above
  // their dot; when the box would overlap an already-placed label, try below,
  // then step further down. Crude and sufficient for a handful of models.
  const placed = [];
  const overlaps = (b) => placed.some((o) =>
    b.x < o.x + o.w && b.x + b.w > o.x && b.y < o.y + o.h && b.y + b.h > o.y);
  for (const m of models) {
    const x = X(m.costPerTask);
    const p = probOf[m.id] ?? 0;
    const onFrontier = p >= 0.5;
    const title = `${m.name}: ${f1(m.mean)} [${f1(m.lo)}, ${f1(m.hi)}] at ${money(m.costPerTask)}/task — P(on frontier) = ${f2(p)}`;
    s += `<g><title>${esc(title)}</title>`;
    s += `<line x1="${x}" y1="${Y(m.lo)}" x2="${x}" y2="${Y(m.hi)}" stroke="var(--s1)" stroke-width="2"/>`;
    // Frontier state is fill vs outline plus the printed probability — never colour alone.
    s += onFrontier
      ? `<circle cx="${x}" cy="${Y(m.mean)}" r="6" fill="var(--s1)" stroke="var(--surface)" stroke-width="2"/>`
      : `<circle cx="${x}" cy="${Y(m.mean)}" r="6" fill="var(--surface)" stroke="var(--s1)" stroke-width="2"/>`;
    const anchor = x > width - 170 ? 'end' : 'start';
    const dx = anchor === 'end' ? -12 : 12;
    const w = Math.max(m.name.length, 15) * 7.2, h = 32;
    let ly = Y(m.mean) - 24; // label block top when sitting above the dot
    let box = { x: anchor === 'end' ? x + dx - w : x + dx, y: ly, w, h };
    let guard = 0;
    while (overlaps(box) && guard++ < 6) {
      ly += h + 6;
      box = { ...box, y: ly };
    }
    placed.push(box);
    s += `<text x="${x + dx}" y="${ly + 12}" text-anchor="${anchor}" font-size="12.5" font-weight="600" fill="var(--ink)">${esc(m.name)}</text>`;
    s += `<text x="${x + dx}" y="${ly + 27}" text-anchor="${anchor}" font-size="11" class="mono" fill="var(--ink-2)">P(frontier) ${f2(p)}</text>`;
    s += `</g>`;
  }
  s += '</svg>';
  return s;
}

function niceStep(raw) {
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const r = raw / mag;
  return (r >= 5 ? 10 : r >= 2 ? 5 : r >= 1 ? 2 : 1) * mag;
}

function logTicks(lo, hi) {
  const out = [];
  for (let e = Math.floor(Math.log10(lo)); e <= Math.ceil(Math.log10(hi)); e++) {
    for (const m of [1, 2, 5]) {
      const v = m * Math.pow(10, e);
      if (v >= lo && v <= hi) out.push(v);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Report assembly
// ---------------------------------------------------------------------------

export function renderReport(result, { truth = null } = {}) {
  const LVL = Math.round(result.config.level * 100);
  const models = result.models.slice().sort((a, b) => b.mean - a.mean);
  const nameOf = Object.fromEntries(result.models.map((m) => [m.id, m.name]));

  // ---- headline verdicts --------------------------------------------------
  const sig = result.pairs.filter((p) => p.significant);
  const nsig = result.pairs.filter((p) => !p.significant);
  const verdictList = sig
    .slice()
    .sort((a, b) => Math.abs(b.meanDiff) - Math.abs(a.meanDiff))
    .map((p) => {
      const [hi, lo] = p.meanDiff > 0 ? [p.a, p.b] : [p.b, p.a];
      return `<li><b>${esc(nameOf[hi])}</b> outperforms <b>${esc(nameOf[lo])}</b> by ${f1(Math.abs(p.meanDiff))} points (Holm-adjusted p ${pFmt(p.pAdjusted)}, paired dominance ${f2(Math.abs(p.dominance))}).</li>`;
    }).join('');
  const cannotList = nsig.map((p) =>
    `<li><b>${esc(nameOf[p.a])}</b> vs <b>${esc(nameOf[p.b])}</b>: observed gap ${f1(Math.abs(p.meanDiff))} points — not resolvable on ${result.power.tasks} tasks (adjusted p ${pFmt(p.pAdjusted)}). Ranking them would be storytelling.</li>`
  ).join('');

  // ---- ranking chart ------------------------------------------------------
  const lo = Math.min(...models.map((m) => m.lo)), hi = Math.max(...models.map((m) => m.hi));
  const rankingSvg = intervalChart(
    models.map((m) => ({ label: m.name, v: m.mean, lo: m.lo, hi: m.hi })),
    { domain: [Math.max(0, Math.floor((lo - 3) / 5) * 5), Math.min(100, Math.ceil((hi + 3) / 5) * 5)] }
  );
  const rankingTable = `<details><summary>Data table</summary><div class="scroll"><table>
    <thead><tr><th>Model</th><th class="num">Mean</th><th class="num">${LVL}% CI</th><th class="num">SD</th><th class="num">Cost/task</th><th class="num">Time/task</th></tr></thead>
    <tbody>${models.map((m) => `<tr><td>${esc(m.name)}</td><td class="num">${f1(m.mean)}</td><td class="num">[${f1(m.lo)}, ${f1(m.hi)}]</td><td class="num">${f1(m.sd)}</td><td class="num">${m.costPerTask != null ? money(m.costPerTask) : '—'}</td><td class="num">${m.secondsPerTask != null ? m.secondsPerTask + 's' : '—'}</td></tr>`).join('')}</tbody>
  </table></div></details>`;

  // ---- pairwise matrix ----------------------------------------------------
  const pairRows = result.pairs
    .slice()
    .sort((a, b) => a.pAdjusted - b.pAdjusted)
    .map((p) => {
      // The label is reordered winner-first, so every signed statistic must be
      // flipped with it — printing the raw a−b sign under a reordered label
      // once inverted the table's meaning whenever input order wasn't sorted.
      const flip = p.meanDiff < 0;
      const [w, l] = flip ? [p.b, p.a] : [p.a, p.b];
      const dMean = flip ? -p.meanDiff : p.meanDiff;
      const dDom = flip ? -p.dominance : p.dominance;
      return `<tr>
        <td>${esc(nameOf[w])} <span style="color:var(--ink-3)">vs</span> ${esc(nameOf[l])}</td>
        <td class="num">+${f1(dMean)}</td>
        <td class="num">${f2(dDom)}</td>
        <td class="num">${pFmt(p.p)}</td>
        <td class="num">${pFmt(p.pAdjusted)}</td>
        <td>${p.significant ? '<span class="chip sig">significant</span>' : '<span class="chip ns">not resolved</span>'}</td>
      </tr>`;
    }).join('');

  // ---- power tiles --------------------------------------------------------
  const pw = result.power;
  const powerTiles = `<div class="tiles">
    <div class="tile"><div class="v">${Number.isFinite(pw.mdd80) ? f1(pw.mdd80) + ' pts' : 'nothing'}</div><div class="l">Smallest true difference detectable at 80% power under this report's Holm-corrected rule (${pw.tasks} tasks, worst-case α = ${pw.alphaFamily.toExponential(1)})</div></div>
    <div class="tile"><div class="v">${pw.tasksFor5pts}</div><div class="l">Tasks needed to resolve a 5-point difference</div></div>
    <div class="tile"><div class="v">${pw.tasksFor2pts}</div><div class="l">Tasks needed to resolve a 2-point difference</div></div>
    <div class="tile"><div class="v">${f1(pw.typicalDiffSd)}</div><div class="l">Typical SD of per-task score differences (drives all of the above)</div></div>
  </div>`;

  // ---- judges -------------------------------------------------------------
  let judgeSection = '';
  if (result.judges && result.bias) {
    const alpha = result.judges.alpha;
    const gate = alpha >= 0.8 ? '<span class="ok">reliable (α ≥ 0.800)</span>'
      : alpha >= 0.667 ? '<span style="color:var(--s2);font-weight:600">tentative only (0.667 ≤ α &lt; 0.800)</span>'
      : '<span class="flag">unreliable (α &lt; 0.667) — scores should not be trusted</span>';

    const hasSwaps = result.bias.overall.swappedPairs > 0;
    const biasItems = Object.entries(result.bias.byJudge).map(([j, b]) => {
      const flagged = b.firstSlot.lo > 0.5 || b.firstSlot.hi < 0.5;
      return {
        label: j, v: b.firstSlot.est, lo: b.firstSlot.lo, hi: b.firstSlot.hi,
        color: flagged ? 'var(--critical)' : 'var(--s1)',
        tag: flagged ? '▲ position bias' : 'no bias detected',
        tagColor: flagged ? 'var(--critical)' : 'var(--ink-3)',
      };
    });
    const bLo = Math.min(0.45, ...biasItems.map((b) => b.lo)) - 0.05;
    const bHi = Math.max(0.55, ...biasItems.map((b) => b.hi)) + 0.05;
    const biasSvg = intervalChart(biasItems, { domain: [Math.max(0, bLo), Math.min(1, bHi)], refLine: 0.5, fmt: f2, width: 860 });

    const looRows = result.judges.leaveOneOut.map((l) =>
      `<tr><td>${esc(l.judge)}</td><td class="num">${f3(result.judges.alpha)}</td><td class="num">${f3(l.alphaWithout)}</td>
       <td>${l.alphaWithout > result.judges.alpha + 0.02 ? '<span class="flag">dragging the panel down</span>' : '<span style="color:var(--ink-3)">consistent with panel</span>'}</td></tr>`
    ).join('');

    const spRows = result.bias.selfPreference.map((s) =>
      `<tr><td>${esc(s.judge)}</td><td>${esc(s.family)}</td>
        <td class="num">${f2(s.ownRate.est)} [${f2(s.ownRate.lo)}, ${f2(s.ownRate.hi)}]</td>
        <td class="num">${f2(s.panelRate.est)} [${f2(s.panelRate.lo)}, ${f2(s.panelRate.hi)}]</td>
        <td>${s.flagged ? '<span class="flag">▲ self-preference</span>' : '<span style="color:var(--ink-3)">not flagged</span>'}</td></tr>`
    ).join('');

    judgeSection = `
    <section>
      <p class="q">Can the graders be trusted?</p>
      <h2>Judge panel diagnostics</h2>
      <p class="note">Krippendorff's α across ${result.judges.units} rated units:
        <b class="mono">${f3(alpha)}</b> — ${gate}.${hasSwaps ? ` Comparisons were presented in both
        orders (${result.bias.overall.swappedPairs.toLocaleString()} swapped duplicates); a judge whose
        "first slot wins" rate departs from 0.5 is position-biased, and its verdicts inflate whichever
        model luck placed first.` : ''}</p>
      ${hasSwaps ? `<div class="card"><figure>${biasSvg}
        <figcaption>Rate at which the first-presented answer won, per judge, with ${LVL}% Wilson intervals.
        Dashed line = no positional preference.</figcaption></figure></div>`
      : `<p class="note"><b>Position bias not assessable:</b> the verdicts contain no order-swapped
        duplicates, so positional preference cannot be separated from candidate quality. Present each
        comparison in both orders to enable this diagnostic.</p>`}
      <details><summary>Leave-one-out reliability</summary><div class="scroll"><table>
        <thead><tr><th>Judge removed</th><th class="num">α (full panel)</th><th class="num">α without judge</th><th>Reading</th></tr></thead>
        <tbody>${looRows}</tbody></table></div></details>
      ${spRows ? `<details open><summary>Self-preference screening</summary><div class="scroll"><table>
        <thead><tr><th>Judge</th><th>Own family</th><th class="num">Family win rate, own verdicts</th><th class="num">Family win rate, rest of panel</th><th>Verdict</th></tr></thead>
        <tbody>${spRows}</tbody></table></div></details>` : ''}
    </section>`;
  }

  // ---- Bradley–Terry ------------------------------------------------------
  let btSection = '';
  if (result.bradleyTerry) {
    const btr = result.bradleyTerry;
    const bt = btr.strengths.slice().sort((a, b) => b.logStrength - a.logStrength);
    const btSvg = intervalChart(
      bt.map((e) => ({
        label: nameOf[e.model] || e.model,
        v: e.logStrength, lo: e.lo, hi: e.hi,
        tag: `rank ${e.modalRank} in ${Math.round(e.rankStability * 100)}% of worlds`,
      })),
      { domain: [Math.min(...bt.map((e) => e.lo)) - 0.15, Math.max(...bt.map((e) => e.hi)) + 0.15], fmt: f2, width: 900 }
    );
    btSection = `
    <section>
      <p class="q">Does head-to-head preference agree?</p>
      <h2>Bradley–Terry strengths from pairwise verdicts</h2>
      <p class="note">Latent strength fitted by maximum likelihood (Hunter's MM), log scale,
      field average = 0; intervals from a cluster bootstrap that keeps order-swapped duplicate
      presentations together. Rank stability is the share of bootstrap worlds in which the model
      keeps its modal rank — a ranking that survives resampling is a finding; one that does not is
      noise arranged in descending order.
      ${btr.excludedJudges.length
        ? `<b>Verdicts from flagged judges are excluded from this fit</b>
           (${btr.excludedJudges.map(esc).join(', ')} — ${btr.verdictsUsed.toLocaleString()} of
           ${btr.verdictsTotal.toLocaleString()} verdicts used): a judge the diagnostics above caught
           biasing outcomes does not get to drive the headline ranking.`
        : ''}</p>
      <div class="card"><figure>${btSvg}
        <figcaption>Log-strength with ${LVL}% cluster-bootstrap intervals.</figcaption></figure></div>
      ${btr.allVerdicts ? (() => {
        const allSorted = btr.allVerdicts.slice().sort((a, b) => b.logStrength - a.logStrength);
        const flips = allSorted.map((e) => e.model).join() !== bt.map((e) => e.model).join();
        return `<p class="note" style="margin-top:.8rem"><b>Sensitivity:</b> refitting with the
        flagged judges included ${flips ? '<b class="flag">changes the ranking order</b>' : 'keeps the same order'}
        and shifts strengths by up to ${f2(Math.max(...allSorted.map((e) => {
          const p = bt.find((x) => x.model === e.model);
          return Math.abs(e.logStrength - p.logStrength);
        })))} log units. Where the two fits disagree, trust neither.</p>`;
      })() : ''}
    </section>`;
  }

  // ---- ground truth (synthetic demos only) --------------------------------
  let truthSection = '';
  if (truth) {
    const rows = models.map((m) => {
      const t = truth.qualities[m.id];
      const inside = m.lo <= t && t <= m.hi;
      return `<tr><td>${esc(m.name)}</td><td class="num">${t}</td><td class="num">${f1(m.mean)} [${f1(m.lo)}, ${f1(m.hi)}]</td>
        <td>${inside ? '<span class="ok">covered</span>' : '<span class="flag">missed</span>'}</td></tr>`;
    }).join('');
    truthSection = `
    <section>
      <p class="q">Because this dataset is synthetic, we can grade the grader</p>
      <h2>Recovery of planted ground truth</h2>
      <p class="note">This demo dataset was generated with known model qualities, one deliberately
      position-biased judge, one self-preferring judge, and one pair of models too close to resolve.
      The engine's job was to recover all of it — and the flags above can be checked against reality:
      the planted biased judge is <b class="mono">${esc(truth.biasedJudge)}</b>, the planted
      self-preferring judge is <b class="mono">${esc(truth.selfPreferringJudge)}</b>, and the pair
      planted 2 points apart is <b class="mono">${esc(truth.unresolvablePair.join(' / '))}</b>.</p>
      <div class="scroll"><table>
        <thead><tr><th>Model</th><th class="num">True quality</th><th class="num">Estimated (95% CI)</th><th>CI covers truth</th></tr></thead>
        <tbody>${rows}</tbody></table></div>
    </section>`;
  }

  // ---- assemble -----------------------------------------------------------
  return `<title>RIGOR Report</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>${CSS}</style>
<div class="rg">
<div class="wrap">

<header class="masthead">
  <div class="brand">RIGOR</div>
  <h1>${esc(result.name)}</h1>
  <p class="sub">${esc(result.description)}</p>
  <div class="meta">
    <span>${result.models.length} models</span>
    <span>${pw.tasks} paired tasks${pw.droppedTasks ? ` (${pw.droppedTasks} dropped: incomplete)` : ''}</span>
    <span>confidence ${Math.round(result.config.level * 100)}%</span>
    <span>seed ${result.config.seed} · fully reproducible</span>
  </div>
</header>

<section>
  <p class="q">What can this benchmark actually claim?</p>
  <h2>Verdicts at ${Math.round(result.config.level * 100)}% confidence, corrected for ${result.pairs.length} comparisons</h2>
  <ul class="verdicts">${verdictList || '<li>No pairwise difference survives correction.</li>'}</ul>
  <h2 style="margin-top:1.4rem">What it cannot claim</h2>
  <ul class="verdicts">${cannotList || '<li>Every pairwise difference is resolved.</li>'}</ul>
</section>

<section>
  <p class="q">How do the models score?</p>
  <h2>Mean task score with ${LVL}% BCa bootstrap intervals</h2>
  <p class="note">Wherever two intervals overlap heavily, the paired test below — not the picture —
  decides whether the gap is real. Intervals are per-model; comparisons use per-task pairing,
  which is far more sensitive.</p>
  <div class="card"><figure>${rankingSvg}
    <figcaption>Score scale 0–100. Dot = mean over ${pw.tasks} tasks; whiskers = ${LVL}% BCa interval.</figcaption>
  </figure></div>
  ${rankingTable}
</section>

<section>
  <p class="q">Which differences are real?</p>
  <h2>Paired permutation tests, Holm-adjusted</h2>
  <p class="note">Both models saw identical tasks, so the per-task score differences are the data.
  P-values come from ${result.config.permB.toLocaleString()} sign-flip permutations; the Holm
  step-down correction controls the chance of even one false "X beats Y" across all
  ${result.pairs.length} comparisons at ${Math.round((1 - result.config.level) * 100)}%.</p>
  <div class="scroll"><table>
    <thead><tr><th>Comparison</th><th class="num">Δ mean</th><th class="num">Paired dominance</th><th class="num">p (raw)</th><th class="num">p (Holm)</th><th>Verdict</th></tr></thead>
    <tbody>${pairRows}</tbody>
  </table></div>
</section>

<section>
  <p class="q">What is this benchmark even capable of detecting?</p>
  <h2>Resolution</h2>
  <p class="note">No leaderboard reports this, and it changes how every score should be read:
  differences smaller than the detection limit are indistinguishable from noise <em>by design</em>,
  no matter how confidently a table orders them. Figures are quoted at the family-corrected
  threshold this report actually decides with (α/${pw.comparisons}), and are themselves estimated
  from this dataset's ${pw.tasks} tasks — treat them as a scale, not a constant.</p>
  ${powerTiles}
</section>

<section>
  <p class="q">What does quality cost?</p>
  <h2>Cost–quality frontier with dominance probabilities</h2>
  <p class="note">A model is dominated when another is at least as good and at least as cheap,
  and strictly better on one of the two — ties do not rescue it. Under uncertainty, frontier
  membership is a probability, not a fact: across 1,000 bootstrap resamples of the task set,
  P(frontier) is how often each model survives undominated. Filled = frontier-likely;
  outlined = usually dominated.</p>
  <div class="card"><figure>${result.pareto ? paretoChart(models.filter((m) => m.costPerTask != null), result.pareto) : '<p>No cost data.</p>'}
    <figcaption>Vertical whiskers: ${LVL}% score intervals. Dashed staircase: empirical frontier
    of point estimates.${models.some((m) => m.costPerTask == null) ? ' Models without cost data are excluded: ' + esc(models.filter((m) => m.costPerTask == null).map((m) => m.name).join(', ')) + '.' : ''}</figcaption>
  </figure></div>
</section>

${judgeSection}
${btSection}
${truthSection}

<section class="methods">
  <p class="q">Methods</p>
  <h2>How every number above was computed</h2>
  <h3>Intervals</h3>
  <p>Per-model score intervals are bias-corrected and accelerated (BCa) bootstrap intervals
  (${result.config.bootstrapB.toLocaleString()} resamples; acceleration from the jackknife). BCa is used because
  score distributions with floors and ceilings are skewed, where percentile intervals under-cover.
  Proportions use Wilson score intervals. Coverage of the implementation is measured by simulation
  in the test suite (400 synthetic worlds), not assumed.</p>
  <h3>Hypothesis tests</h3>
  <p>Model pairs are compared with paired sign-flip permutation tests on per-task differences
  (add-one correction, guaranteeing validity at any permutation count). The family of
  ${result.pairs.length} comparisons is controlled with Holm's step-down procedure. Cliff's δ
  accompanies every p-value because significance and practical size are different questions.</p>
  <h3>Resolution</h3>
  <p>Minimum detectable difference: (z<sub>0.975</sub> + z<sub>0.80</sub>) · σ<sub>d</sub> / √n,
  with σ<sub>d</sub> the median SD of per-task differences across pairs — validated against
  simulation with the actual permutation test in the suite.</p>
  <h3>Judges</h3>
  <p>Panel reliability is Krippendorff's α (interval metric), which handles missing ratings and
  any panel size; gates at 0.800 / 0.667 follow Krippendorff. Position bias uses an order-swapped
  design with Wilson intervals on the first-slot win rate. Self-preference compares a judge's win
  rate for its own model family with the rest of the panel's on the same matches; a flag requires
  the intervals to separate.</p>
  <h3>Head-to-head strengths</h3>
  <p>Bradley–Terry by Hunter's MM algorithm with ε-pseudocounts for connectivity; intervals and
  rank stability from a bootstrap over matches. Recovery of planted strengths is verified in the
  test suite at measured coverage.</p>
  <h3>Reproducibility</h3>
  <p>Every stochastic step is seeded (seed ${result.config.seed}); rerunning the analysis
  reproduces this report bit for bit. The engine is dependency-free JavaScript; the full source,
  including the calibration studies, ships with the repository.</p>
</section>

</div></div>`;
}
