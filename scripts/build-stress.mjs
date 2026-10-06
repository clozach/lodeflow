// Writes the stress page: how large a diagram can get before an edit takes longer than a threshold.
//   node scripts/build-stress.mjs <out.html> [--label <legend text>] [--column <table header>]
//                                 [<reference.json from test/perf.mjs --out> …]
// Self-contained (element, generator and timing runner inlined); runs from file:// on any machine.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const here = new URL('..', import.meta.url).pathname;
const out = resolve(process.argv[2] || 'stress.html');
// Reference curves (drawn dashed, and a column in the limits table): one or more test/perf.mjs --out
// files, merged by size (e.g. all edits to 1,000 nodes, plus add and pan for bigger diagrams).
// --label names them in the legend, --column heads their column (say, a previous build's timings).
const rest = process.argv.slice(3);
const flag = (k, d) => {
  const i = rest.indexOf(`--${k}`);
  return i >= 0 ? rest.splice(i, 2)[1] : d;
};
const refLabel = flag('label', 'Measured on the build Mac');
const refColumn = flag('column', 'Build Mac');
const refPaths = rest.map((p) => resolve(p)).filter((p) => existsSync(p));
const js = readFileSync(resolve(here, 'web/dist/lode-flow.iife.js'), 'utf8').replace(/<\/script/gi, '<\\/script');
const strip = (p) => readFileSync(resolve(here, p), 'utf8').replace(/^export /gm, '').replace(/<\/script/gi, '<\\/script');
const gen = strip('web/test/gen.mjs');
const core = strip('web/test/perf-core.mjs');
const shapes = strip('web/test/shapes.mjs');
// Failure modes found by the 2026-10-01 hunt, with numbers from the build Mac (evidence/2026-10-01-stress).
const MODES = [
  { what: 'Every keystroke re-laid out the whole diagram', before: '211 ms per key at 1,000 nodes', after: '2 ms; a re-layout only when a line wraps' },
  { what: 'Several edits laid out twice with identical input', before: '2× the work for add, split, undo, load', after: 'once; a repeated input reuses the last result' },
  { what: 'Auto direction ran the whole engine once per direction', before: '1.35–1.96× the work of one direction', after: 'one ordering shared by both directions: 1.3–1.5×' },
  { what: 'Engine memory grew a few pages at a time and never reused freed memory', before: '10 s and 1.3 GB for the first 1,500-node layout', after: '0.8 s, about 10× less memory; the allocator alone changes no layout' },
  { what: 'Diagrams over about 2,500 nodes failed after long freezes', before: 'error at 2,500; a 10-minute freeze then a crash at 3,000', after: '1.3 s at 2,500, 2.4 s at 3,000' },
  { what: 'The E link list rescanned every edge for every node', before: '0.6–1.4 s per filter keystroke at 480 nodes', after: 'about 10 ms at 480 nodes, 19 ms at 1,000' },
  { what: 'An edit that moved nothing replayed the whole animation', before: '1,000 nodes: 23–24 full redraws, about 360 ms of work, to start or end an edit', after: 'one redraw, no animation' },
  { what: 'The link list could offer hidden nodes, or miss shown ones, after a collapse was undone or redone with it open', before: 'members of an expanded group missing until the next edit', after: 'the list follows the current layout' },
  { what: 'A click recounted every group’s members', before: '408 ms per click with 400 nested groups', after: 'a highlight change only' },
  { what: 'Untangle could cost 90–150 ms on small dense diagrams', before: 'a budget by node count', after: 'the same tries, capped by their cost in bend points too: at most about 16 ms, tapering off by about 250 nodes' },
  { what: 'Saving with storage-key failed silently once the browser store filled', before: 'about 300 nodes: later edits lost on reload', after: 'the diagram is saved first: its history is trimmed to fit, other diagrams’ saved histories give way, and a “Not saved” warning shows if even that fails' },
  { what: 'Saved undo history held two copies of the diagram per step', before: '1,000 nodes: about 26 MB rewritten on every click (15–24 ms each), so the store soon filled', after: 'each distinct diagram stored once, saved 250 ms after the last edit: 100 steps in 2.7 MB, 8 ms' },
  { what: 'One undo removed two steps when a just-added node was still empty', before: 'the step before vanished too', after: 'only the empty node goes' },
  { what: 'Undo after adding a node and scrolling left the empty node behind', before: 'the node stayed; the next undo took back the scroll', after: 'one undo removes the empty node, and only it' },
  { what: 'Cancelling an inserted node after scrolling deleted the edge it split', before: 'edge and label lost', after: 'the edge is whole again, label kept' },
  { what: 'Labels of edges into one collapsed group sat on top of each other', before: 'two labels in one spot', after: 'each label keeps its own place' },
  { what: 'Crowded radial rings overlapped', before: 'from about 184 nodes on one ring', after: 'rings widen until neighbours clear' },
  { what: 'A merge could duplicate a direct link', before: 'two arrows from one cause to one effect', after: 'refused: “Already linked to its effect”' },
  { what: 'Pan frames rewrote every node and edge', before: '18–27 ms per frame at 1,000 nodes', after: 'under 1 ms' },
  { what: 'Big diagrams could open on an empty corner', before: '0 nodes in view at 1,000 nodes; radial: 0–2 from 300 nodes', after: 'opens on the first nodes of the flow (radial: on its first ring)' },
];
const LEFT = [
  'Layout time still grows faster than the diagram (about n²): with Start bias every cause-less node starts in the first column, and its long line needs a bend point in every column it crosses. Flow-like diagrams stay within 50 ms per edit up to about 550 nodes on the build Mac.',
  'Group boxes multiply crossings on large, loosely grouped diagrams: lines must go around a box, so they gather in bands (300 nodes: 177 crossings without groups, about 1,400 with).',
  'Radial layouts are overviews: their lines can still cut across nodes, and their crossing count is the layered count, below what is drawn.',
  'At 1,000 nodes each animation frame takes about 30 ms, so a change animates at about 30 frames a second.',
  'Engine memory grows with the layout: about 136 MB at 1,000 nodes and 3 GB at 6,000, near WebAssembly’s 4 GB ceiling: about 7,000 flow-like nodes in one direction, 6,000 in Auto.',
];
let reference = 'null';
if (refPaths.length) {
  const files = refPaths.map((p) => JSON.parse(readFileSync(p, 'utf8')));
  const rows = files.flatMap((r) => r.rows).sort((a, b) => a.n - b.n);
  reference = JSON.stringify({
    label: refLabel,
    column: refColumn,
    family: files[0].family,
    orientation: files[0].orientation,
    rows: rows.map((row) => ({ n: row.n, ops: Object.fromEntries(Object.entries(row.ops).map(([k, v]) => [k, Math.round(v.total * 10) / 10])) })),
  });
}

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Diagram size limits</title>
<style>
  :root { color-scheme: light dark; --ink: #1f1c18; --muted: #6f6a61; --paper: #fdfcf9; --line: rgba(31,28,24,.14); --accent: #2f62d8; --soft: rgba(47,98,216,.08); --warn: #b93a22; --grid: rgba(31,28,24,.08); }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --ink: #ebe8e2; --muted: #a19b90; --paper: #111214; --line: rgba(255,255,255,.14); --accent: #7aa2ff; --soft: rgba(122,162,255,.1); --warn: #f0915a; --grid: rgba(255,255,255,.07); } }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--paper); color: var(--ink); font: 15px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width: 1180px; margin: 0 auto; padding: 20px 16px 40px; }
  h1 { font-size: 20px; margin: 0 0 4px; letter-spacing: -.01em; }
  h2 { font-size: 15px; margin: 22px 0 6px; }
  p { margin: 0 0 10px; color: var(--muted); max-width: 76ch; }
  .controls { display: flex; flex-wrap: wrap; gap: 10px 18px; align-items: end; margin: 12px 0; }
  label { display: grid; gap: 3px; font-size: 13px; color: var(--muted); }
  input, select, button { font: inherit; font-size: 14px; color: inherit; }
  input[type=number] { width: 90px; padding: 5px 8px; border: 1px solid var(--line); border-radius: 8px; background: transparent; }
  select { padding: 5px 8px; border: 1px solid var(--line); border-radius: 8px; background: transparent; }
  button { padding: 6px 12px; border-radius: 8px; border: 1px solid var(--line); background: transparent; cursor: pointer; }
  button:hover { background: color-mix(in srgb, var(--ink) 7%, transparent); }
  button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
  button.primary:hover { background: color-mix(in srgb, var(--accent) 85%, #000); }
  button:focus-visible, input:focus-visible, select:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  button[disabled] { opacity: .5; cursor: default; }
  .presets { display: flex; gap: 4px; }
  .presets button { padding: 4px 8px; font-size: 13px; }
  .presets button[aria-pressed=true] { border-color: var(--accent); color: var(--accent); background: var(--soft); }
  .ops { display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: 13px; }
  .ops label { display: flex; gap: 6px; align-items: center; color: var(--ink); }
  .verdict { margin: 14px 0; padding: 12px 14px; border-radius: 12px; background: var(--soft); font-size: 16px; }
  .verdict b { font-size: 20px; }
  .verdict small { display: block; color: var(--muted); font-size: 13px; margin-top: 2px; }
  .status { font-size: 13px; color: var(--muted); min-height: 1.5em; }
  .chart { width: 100%; border: 1px solid var(--line); border-radius: 12px; }
  .chart text { fill: var(--muted); font: 11px ui-sans-serif, system-ui, sans-serif; }
  .chart .axis { stroke: var(--line); }
  .chart .gridline { stroke: var(--grid); }
  .chart .threshold { stroke: var(--warn); stroke-width: 1.5; stroke-dasharray: 5 4; }
  .chart .limit { stroke: var(--accent); stroke-width: 1.5; }
  .legend { display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: 13px; margin: 6px 0 0; }
  .legend span { display: inline-flex; align-items: center; gap: 6px; }
  .legend i { width: 18px; height: 3px; border-radius: 2px; display: inline-block; }
  table { border-collapse: collapse; font-size: 13px; width: 100%; }
  th, td { text-align: right; padding: 4px 8px; border-bottom: 1px solid var(--line); white-space: nowrap; }
  th:first-child, td:first-child { text-align: left; white-space: normal; }
  #modes th, #modes td { text-align: left; white-space: normal; vertical-align: top; }
  td.over { color: var(--warn); font-weight: 600; }
  .scroll { overflow-x: auto; }
  .frame { height: 380px; border: 1px solid var(--line); border-radius: 12px; overflow: hidden; margin-top: 8px; }
  lode-flow { height: 100%; }
  .shapes { display: flex; flex-wrap: wrap; gap: 6px; }
  .note { font-size: 13px; color: var(--muted); }
  .problem { color: var(--warn); }
  .trampoline { margin-top: 26px; padding: 14px; border: 1px solid var(--line); border-radius: 12px; display: flex; flex-wrap: wrap; gap: 8px 14px; align-items: center; }
  .trampoline .model { font-size: 12px; color: var(--muted); margin-left: auto; }
  kbd { font: 12px ui-monospace, Menlo, monospace; border: 1px solid var(--line); border-bottom-width: 2px; border-radius: 4px; padding: 0 4px; }
</style>
</head>
<body>
<main>
  <h1>How big can a diagram get?</h1>
  <p>Each run builds diagrams of growing size and times the edits people make most: re-laying out after a change of direction, adding a node, splitting an edge, deleting a well-connected node, typing, linking. A time is how long the page is busy for one edit — the change, the layout, the drawing and the browser's own layout — measured right here, on this machine.</p>
  <div class="controls">
    <label>Budget per edit (ms)
      <span class="presets"><input id="threshold" type="number" min="1" max="5000" step="1" value="50" aria-describedby="th-hint">
        <button data-th="16" aria-pressed="false" title="One display frame at 60 Hz">16</button><button data-th="50" aria-pressed="true" title="Feels instant (RAIL: respond within 50 ms)">50</button><button data-th="100" aria-pressed="false" title="Starts to feel slow">100</button></span>
    </label>
    <label>Diagrams like
      <select id="family">
        <option value="flow">Flows with groups, labels, merges</option>
        <option value="plain">Plain flows (no groups or labels)</option>
        <option value="dense">Dense (four links per node)</option>
        <option value="deep">Deep (long chains)</option>
        <option value="wide">Wide (many starts and ends)</option>
      </select>
    </label>
    <label>Direction
      <select id="orientation">
        <option value="auto">Auto (tries both, keeps the larger text)</option>
        <option value="lr">Left to right</option>
      </select>
    </label>
    <label>Largest size to try
      <select id="maxn">
        <option>300</option><option>600</option><option selected>1000</option><option>1500</option><option>2000</option><option>3000</option><option value="5000">5000 (several minutes)</option>
      </select>
    </label>
    <button id="run" class="primary">Run</button>
    <button id="stop" disabled>Stop</button>
  </div>
  <div class="ops" id="ops" role="group" aria-label="Edits to time"></div>
  <p class="note" id="th-hint">16 ms is one display frame (typing should fit); 50 ms is the point where an edit stops feeling instant; 100 ms feels slow. Change the budget at any time: the verdict and chart update without running again. A run stops two sizes after every edit passes the budget.</p>

  <div class="verdict" id="verdict" role="status">Press <b>Run</b> to measure this machine.</div>
  <div class="status" id="status" aria-live="polite"></div>

  <svg class="chart" id="chart" viewBox="0 0 900 340" role="img" aria-label="Time per edit against diagram size"></svg>
  <div class="legend" id="legend"></div>

  <h2>Largest diagram within the budget, per edit</h2>
  <div class="scroll"><table id="limits"></table></div>

  <h2>All measurements (milliseconds, median of 3)</h2>
  <div class="scroll"><table id="table"></table></div>

  <h2>The diagram being measured</h2>
  <p class="note">The last size measured stays here to explore. Shapes that once caused trouble can be loaded and timed on their own:</p>
  <div class="shapes" id="shapes"></div>
  <div class="status" id="shape-status" aria-live="polite"></div>
  <div class="frame"><lode-flow id="flow"></lode-flow></div>

  <h2>What broke, and what changed (2026-10-01)</h2>
  <p class="note">Four independent agents hunted for failure modes on this component (scaling, long editing sessions, awkward shapes, interaction cost); a skeptic reproduced each finding before it was fixed, and the fixes were rechecked the same way. Times are from the build Mac.</p>
  <div class="scroll"><table id="modes"></table></div>
  <h2>Limits that remain</h2>
  <ul class="note" id="limits-left"></ul>

  <div class="trampoline">
    <button id="copy-md">Copy results (Markdown)</button>
    <button id="copy-prompt">Copy a prompt to speed up the slowest edit</button>
    <span class="status" id="copied" role="status"></span>
    <span class="model">Written by Opus 5.5 Ultracode</span>
  </div>
</main>
<script>${js}</script>
<script>
${gen}
${core}
${shapes}
const REFERENCE = ${reference};
const MODES = ${JSON.stringify(MODES)};
const LEFT = ${JSON.stringify(LEFT)};
const COLORS = { reorient: '#2f62d8', addNode: '#15803d', splitEdge: '#b45309', deleteHub: '#b91c1c', undoDelete: '#7c3aed', typeChar: '#0e7490', link: '#be185d', pan: '#6b7280' };
const DEFAULT_OPS = ['reorient', 'addNode', 'splitEdge', 'deleteHub', 'undoDelete', 'typeChar', 'link', 'pan'];
const LADDER = [10, 25, 50, 75, 100, 120, 150, 200, 300, 400, 600, 800, 1000, 1500, 2000, 2500, 3000, 4000, 5000];
const $ = (id) => document.getElementById(id);
const flow = $('flow');
let rows = [];
let stopRequested = false;
let running = false;

const opsBox = $('ops');
for (const k of DEFAULT_OPS) {
  const l = document.createElement('label');
  l.innerHTML = '<input type="checkbox" value="' + k + '" checked><i style="width:12px;height:3px;background:' + COLORS[k] + ';display:inline-block;border-radius:2px"></i>' + OPS[k].label;
  opsBox.append(l);
}
const chosenOps = () => [...opsBox.querySelectorAll('input:checked')].map((i) => i.value);
const threshold = () => Math.max(1, Number($('threshold').value) || 50);

// The largest size within budget: interpolated (in log space) between the last size under it and the first over.
function limitFor(series) {
  const th = threshold();
  let last = null;
  for (const p of series) {
    if (p.ms <= th) last = p;
    else {
      if (!last) return { n: 0, exceeded: true };
      const t = (Math.log(th) - Math.log(Math.max(0.01, last.ms))) / (Math.log(p.ms) - Math.log(Math.max(0.01, last.ms)));
      return { n: Math.round(last.n + (p.n - last.n) * Math.max(0, Math.min(1, t))), exceeded: true, between: [last.n, p.n] };
    }
  }
  return last ? { n: last.n, exceeded: false } : { n: 0, exceeded: false };
}
const seriesOf = (data, k) => data.filter((r) => r.ops[k] != null).map((r) => ({ n: r.n, ms: typeof r.ops[k] === 'number' ? r.ops[k] : r.ops[k].total }));

function render() {
  const th = threshold();
  document.querySelectorAll('[data-th]').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.th) === th)));
  const ops = chosenOps();
  // Verdict
  if (rows.length) {
    const lim = ops.map((k) => ({ k, ...limitFor(seriesOf(rows, k)) }));
    const worst = lim.reduce((a, b) => (a.n <= b.n ? a : b), lim[0]);
    const any = lim.some((l) => l.exceeded);
    const maxTried = rows[rows.length - 1].n;
    $('verdict').innerHTML = !any
      ? 'Every edit stays within <b>' + th + ' ms</b> up to the largest size tried: <b>' + maxTried + ' nodes</b>.<small>Try a larger size or a tighter budget to find the limit.</small>'
      : 'On this machine, diagrams up to about <b>' + worst.n + ' nodes</b> stay within <b>' + th + ' ms</b> for every edit.<small>The first edit to run out of time: ' + OPS[worst.k].label + (worst.between ? ' (between ' + worst.between[0] + ' and ' + worst.between[1] + ' nodes)' : '') + '.</small>';
    // Limits table
    let t = '<tr><th>Edit</th><th>Largest size within ' + th + ' ms</th>' + (REFERENCE ? '<th>' + REFERENCE.column + '</th>' : '') + '</tr>';
    for (const l of lim) {
      const ref = REFERENCE ? limitFor(seriesOf(REFERENCE.rows, l.k)) : null;
      t += '<tr><td>' + OPS[l.k].label + '</td><td' + (l.k === worst.k && any ? ' class="over"' : '') + '>' + (l.exceeded ? '≈ ' + l.n : '≥ ' + l.n) + '</td>' + (ref ? '<td>' + (ref.exceeded ? '≈ ' + ref.n : '≥ ' + ref.n) + '</td>' : '') + '</tr>';
    }
    $('limits').innerHTML = t;
    // Full table
    let h = '<tr><th>Nodes</th><th>Edges</th><th>Load</th>' + ops.map((k) => '<th title="' + OPS[k].label + '">' + k + '</th>').join('') + '<th>Problems</th></tr>';
    for (const r of rows) {
      h += '<tr><td>' + r.n + '</td><td>' + r.edges + '</td><td>' + r.load.toFixed(1) + '</td>' + ops.map((k) => { const v = r.ops[k]; return v ? '<td' + (v.total > th ? ' class="over"' : '') + ' title="engine ' + (v.timing ? v.timing.engineMs.toFixed(1) : '–') + ' ms · measuring text ' + (v.timing ? v.timing.measureMs.toFixed(1) : '–') + ' ms">' + v.total.toFixed(1) + '</td>' : '<td>–</td>'; }).join('') + '<td class="problem">' + (r.problems.length ? r.problems.join('; ') : '') + '</td></tr>';
    }
    $('table').innerHTML = h;
  } else {
    $('limits').innerHTML = '';
    $('table').innerHTML = '';
  }
  drawChart(ops, th);
}

function drawChart(ops, th) {
  const svg = $('chart');
  const W = 900, H = 340, L = 52, R = 16, T = 14, B = 34;
  const all = [...rows.flatMap((r) => ops.map((k) => r.ops[k] && r.ops[k].total).filter(Boolean)), ...(REFERENCE ? REFERENCE.rows.flatMap((r) => ops.map((k) => r.ops[k]).filter(Boolean)) : [])];
  const maxN = Math.max(100, ...rows.map((r) => r.n), ...(REFERENCE ? REFERENCE.rows.map((r) => r.n) : []));
  const maxMs = Math.max(th * 2, ...all, 10);
  const x = (n) => L + ((Math.log10(Math.max(n, 10)) - 1) / (Math.log10(maxN) - 1)) * (W - L - R);
  const y = (ms) => T + (1 - (Math.log10(Math.max(ms, 0.5)) - Math.log10(0.5)) / (Math.log10(maxMs) - Math.log10(0.5))) * (H - T - B);
  let s = '';
  for (const ms of [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000]) if (ms <= maxMs) s += '<line class="gridline" x1="' + L + '" x2="' + (W - R) + '" y1="' + y(ms) + '" y2="' + y(ms) + '"/><text x="' + (L - 6) + '" y="' + (y(ms) + 4) + '" text-anchor="end">' + ms + '</text>';
  for (const n of [10, 25, 50, 100, 200, 500, 1000, 2000, 5000]) if (n <= maxN) s += '<line class="gridline" y1="' + T + '" y2="' + (H - B) + '" x1="' + x(n) + '" x2="' + x(n) + '"/><text x="' + x(n) + '" y="' + (H - B + 16) + '" text-anchor="middle">' + n + '</text>';
  s += '<text x="' + ((L + W - R) / 2) + '" y="' + (H - 4) + '" text-anchor="middle">nodes in the diagram</text>';
  s += '<text x="12" y="' + ((T + H - B) / 2) + '" text-anchor="middle" transform="rotate(-90 12 ' + ((T + H - B) / 2) + ')">ms per edit</text>';
  if (REFERENCE) for (const k of ops) {
    const pts = seriesOf(REFERENCE.rows, k);
    if (pts.length > 1) s += '<polyline fill="none" stroke="' + COLORS[k] + '" stroke-opacity=".35" stroke-width="1.5" stroke-dasharray="3 3" points="' + pts.map((p) => x(p.n) + ',' + y(p.ms)).join(' ') + '"/>';
  }
  for (const k of ops) {
    const pts = seriesOf(rows, k);
    if (pts.length) s += '<polyline fill="none" stroke="' + COLORS[k] + '" stroke-width="2" points="' + pts.map((p) => x(p.n) + ',' + y(p.ms)).join(' ') + '"/>' + pts.map((p) => '<circle cx="' + x(p.n) + '" cy="' + y(p.ms) + '" r="2.5" fill="' + COLORS[k] + '"><title>' + OPS[k].label + ': ' + p.n + ' nodes, ' + p.ms.toFixed(1) + ' ms</title></circle>').join('');
  }
  s += '<line class="threshold" x1="' + L + '" x2="' + (W - R) + '" y1="' + y(th) + '" y2="' + y(th) + '"/><text x="' + (W - R - 4) + '" y="' + (y(th) - 5) + '" text-anchor="end" style="fill:var(--warn)">budget ' + th + ' ms</text>';
  if (rows.length) {
    const lims = ops.map((k) => limitFor(seriesOf(rows, k)));
    const n = Math.min(...lims.map((l) => l.n));
    if (lims.some((l) => l.exceeded) && n > 0) s += '<line class="limit" x1="' + x(n) + '" x2="' + x(n) + '" y1="' + T + '" y2="' + (H - B) + '"/><text x="' + (x(n) + 4) + '" y="' + (T + 12) + '" style="fill:var(--accent)">≈ ' + n + ' nodes</text>';
  }
  svg.innerHTML = s;
  $('legend').innerHTML = ops.map((k) => '<span><i style="background:' + COLORS[k] + '"></i>' + OPS[k].label + '</span>').join('') + (REFERENCE ? '<span><i style="background:repeating-linear-gradient(90deg,var(--muted) 0 3px,transparent 3px 6px)"></i>' + REFERENCE.label + '</span>' : '');
}

async function run() {
  if (running) return;
  running = true;
  stopRequested = false;
  rows = [];
  $('run').disabled = true;
  $('stop').disabled = false;
  const maxn = Number($('maxn').value);
  const sizes = LADDER.filter((n) => n <= maxn);
  const ops = chosenOps();
  let pastAll = 0;
  try {
    for (const n of sizes) {
      if (stopRequested) break;
      $('status').textContent = 'Measuring ' + n + ' nodes…';
      const got = await runSuite(flow, { sizes: [n], family: $('family').value, orientation: $('orientation').value, ops, reps: 3, generate });
      rows.push(got[0]);
      render();
      const th = threshold();
      if (ops.every((k) => got[0].ops[k].total > th)) pastAll++;
      if (pastAll >= 2) break;
    }
    $('status').textContent = stopRequested ? 'Stopped.' : 'Done. ' + rows.length + ' sizes measured; the diagram below is the last one.';
  } catch (err) {
    $('status').textContent = 'The run failed: ' + err.message;
  } finally {
    running = false;
    $('run').disabled = false;
    $('stop').disabled = true;
  }
}

$('run').addEventListener('click', run);
$('stop').addEventListener('click', () => { stopRequested = true; $('status').textContent = 'Stopping after this size…'; });
$('threshold').addEventListener('input', render);
document.querySelectorAll('[data-th]').forEach((b) => b.addEventListener('click', () => { $('threshold').value = b.dataset.th; render(); }));
opsBox.addEventListener('change', render);

// Shapes
for (const sh of SHAPES) {
  const b = document.createElement('button');
  b.textContent = sh.label;
  b.title = sh.why;
  b.addEventListener('click', async () => {
    const doc = sh.build();
    const t0 = performance.now();
    flow.setDoc(doc);
    if (flow.raf) { cancelAnimationFrame(flow.raf); flow.raf = 0; }
    flow.flush();
    const load = performance.now() - t0;
    await settle(flow);
    const bad = problems(flow);
    $('shape-status').textContent = sh.label + ': ' + doc.nodes.length + ' nodes, ' + doc.edges.length + ' edges · loaded and laid out in ' + load.toFixed(1) + ' ms' + (bad.length ? ' · problems: ' + bad.join('; ') : ' · no overlaps or broken lines');
  });
  $('shapes').append(b);
}

function markdown() {
  const th = threshold();
  const ops = chosenOps();
  let md = '| Nodes | Edges | ' + ops.map((k) => OPS[k].label).join(' | ') + ' |\\n|' + ' --- |'.repeat(ops.length + 2) + '\\n';
  for (const r of rows) md += '| ' + r.n + ' | ' + r.edges + ' | ' + ops.map((k) => r.ops[k].total.toFixed(1)).join(' | ') + ' |\\n';
  const lim = ops.map((k) => OPS[k].label + ': ' + (limitFor(seriesOf(rows, k)).exceeded ? '≈ ' : '≥ ') + limitFor(seriesOf(rows, k)).n);
  return 'lodeflow stress results (' + $('family').selectedOptions[0].textContent + ', ' + $('orientation').selectedOptions[0].textContent + ', ' + navigator.userAgent.replace(/.*(Chrome\\/[\\d.]+|Firefox\\/[\\d.]+|Version\\/[\\d.]+ Safari).*/, '$1') + ').\\nBudget ' + th + ' ms. Largest size within it: ' + lim.join('; ') + '.\\n\\n' + md;
}
async function copy(text, what) {
  try { await navigator.clipboard.writeText(text); $('copied').textContent = what + ' copied to the clipboard.'; }
  catch { $('copied').textContent = 'The browser refused the clipboard; nothing was copied.'; }
}
$('copy-md').addEventListener('click', () => rows.length ? copy(markdown(), 'Results') : ($('copied').textContent = 'Run the measurement first.'));
$('copy-prompt').addEventListener('click', () => {
  if (!rows.length) { $('copied').textContent = 'Run the measurement first.'; return; }
  const ops = chosenOps();
  const lim = ops.map((k) => ({ k, ...limitFor(seriesOf(rows, k)) })).sort((a, b) => a.n - b.n)[0];
  copy('In projects/lodeflow (the <lode-flow> element in src/web/src/lode-flow.ts and the Rust engine in src/engine/src), make "' + OPS[lim.k].label + '" faster for large diagrams. On my machine it passes ' + threshold() + ' ms at about ' + lim.n + ' nodes. Measure with src/web/test/perf.mjs (layoutInfo.timing breaks a re-layout into sync, measuring, engine, rest and draw), find the phase that dominates, change the cheapest thing that cuts it, and show before/after numbers. Keep every test in src/scripts/test.sh passing.\\n\\nMy measurements:\\n' + markdown(), 'A prompt');
});
$('modes').innerHTML = '<tr><th>Failure mode</th><th>Before</th><th>After</th></tr>' + MODES.map((m) => '<tr><td>' + m.what + '</td><td>' + m.before + '</td><td>' + m.after + '</td></tr>').join('');
$('limits-left').innerHTML = LEFT.map((l) => '<li>' + l + '</li>').join('');
render();
</script>
</body>
</html>
`;
writeFileSync(out, html);
console.log('stress page →', out, (html.length / 1024).toFixed(0) + ' kB');
