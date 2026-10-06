// Writes the layout comparison page: the sample three times — strict ranks, tight groups, tight groups + untangle.
//   node scripts/build-compare.mjs <out.html>
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const here = new URL('..', import.meta.url).pathname;
const out = resolve(process.argv[2] || 'tight-groups.html');
const js = readFileSync(resolve(here, 'web/dist/lode-flow.iife.js'), 'utf8').replace(/<\/script/gi, '<\\/script');
const sample = JSON.parse(readFileSync(resolve(here, 'examples/release-slip.json'), 'utf8'));
const doc = (tight, untangle) => JSON.stringify({ ...sample, settings: { ...sample.settings, orientation: 'lr', bias: 'end', tightGroups: tight, untangle } });
const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Layouts compared</title>
<style>
  :root { color-scheme: light dark; --ink: #1f1c18; --muted: #6f6a61; --paper: #fdfcf9; --line: rgba(31,28,24,.14); --accent: #2f62d8; --soft: rgba(47,98,216,.08); }
  @media (prefers-color-scheme: dark) { :root { --ink: #ebe8e2; --muted: #a19b90; --paper: #111214; --line: rgba(255,255,255,.14); --accent: #7aa2ff; --soft: rgba(122,162,255,.1); } }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--paper); color: var(--ink); font: 15px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width: 1240px; margin: 0 auto; padding: 20px 16px 40px; }
  h1 { font-size: 20px; margin: 0 0 4px; letter-spacing: -.01em; }
  h2 { font-size: 15px; margin: 0 0 2px; }
  p { margin: 0 0 12px; color: var(--muted); max-width: 72ch; }
  .row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 0 0 14px; }
  button { font: inherit; font-size: 13px; padding: 6px 10px; border-radius: 8px; border: 1px solid var(--line); background: transparent; color: inherit; cursor: pointer; }
  button:hover { background: color-mix(in srgb, var(--ink) 7%, transparent); }
  button[aria-pressed="true"] { border-color: var(--accent); color: var(--accent); background: var(--soft); }
  button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .pair { display: grid; gap: 22px; }
  .cc { font-weight: 600; color: var(--ink); }
  figure { margin: 0; }
  .frame { height: clamp(260px, 38vw, 420px); border: 1px solid var(--line); border-radius: 14px; overflow: hidden; }
  lode-flow { height: 100%; }
  figcaption { margin-top: 8px; color: var(--muted); font-size: 14px; }
  figcaption b { color: var(--ink); }
  .decide { margin-top: 22px; padding: 14px 16px; border-radius: 12px; background: var(--soft); }
  .decide ul { margin: 6px 0 0; padding-left: 20px; }
  .decide li { margin: 3px 0; }
  kbd { font: 12px ui-monospace, Menlo, monospace; border: 1px solid var(--line); border-bottom-width: 2px; border-radius: 4px; padding: 0 4px; }
</style>
</head>
<body>
<main>
  <h1>Layouts compared</h1>
  <p>The sample diagram three times with <b>End bias</b>, each pane the real engine, fitted whole (this page sets <code>fit-min="0.35"</code>). Question 3 chose tight groups (2026-09-30); untangling followed from your sketch the same day. Both are now on by default; <kbd>T</kbd> and <kbd>U</kbd> switch them in any diagram.</p>
  <div class="row" role="group" aria-label="Bias for both panes">
    <span>Bias:</span>
    <button data-bias="end" aria-pressed="true">End</button>
    <button data-bias="start" aria-pressed="false">Start</button>
    <span style="color:var(--muted);font-size:13px">With Start bias all three are crossing-free; the differences appear when nodes are pushed late.</span>
  </div>
  <div class="pair">
    <figure>
      <div class="frame"><lode-flow id="strict" readonly fit-min="0.35">
        <script type="application/json">${doc(false, false)}</script>
      </lode-flow></div>
      <figcaption><b>Strict rules</b> · <span class="cc" data-for="strict">…</span>. Each node's column comes from cause and effect alone. <i>Estimates are guesses</i> waits until just before <i>Stakeholders push harder</i>, so the Planning box stretches across the diagram with an empty band inside.</figcaption>
    </figure>
    <figure>
      <div class="frame"><lode-flow id="tight" readonly fit-min="0.35">
        <script type="application/json">${doc(true, false)}</script>
      </lode-flow></div>
      <figcaption><b>Tight groups</b> · <span class="cc" data-for="tight">…</span>. A member with room to move joins the rest of its group, and the Planning box closes up. But with <i>Customers lose trust</i> pushed to the last column, one crossing is unavoidable: every ordering of these columns was checked.</figcaption>
    </figure>
    <figure>
      <div class="frame"><lode-flow id="untangled" readonly fit-min="0.35">
        <script type="application/json">${doc(true, true)}</script>
      </lode-flow></div>
      <figcaption><b>Tight groups + untangle</b> (the default) · <span class="cc" data-for="untangled">…</span>. A node with room to move may shift a column when that removes a crossing: <i>Customers lose trust</i> moves next to its cause, and the ordering can then route every line clear.</figcaption>
    </figure>
  </div>
  <div class="decide">
    <h2>How untangling works</h2>
    <ul>
      <li><b>Ordering</b> (inside each column) is classic crossing minimisation, the drawing-world cousin of a knot's crossing number. It is NP-hard, so the engine sweeps from several starting orders and keeps the best.</li>
      <li><b>Columns</b>: some nodes have room to move — a cause that could come later, an end effect like <i>Customers lose trust</i>. Untangle tries each at the ends of its room and keeps a move only if it removes crossings (lines over lines first, then lines cutting through group outlines) without adding a crossing line. It prefers moves that keep groups tight, and never puts an effect before its cause.</li>
      <li>Bias and tight groups give way only to remove a crossing. Diagrams over 120 nodes skip the column search to keep editing instant.</li>
    </ul>
  </div>
</main>
<script>${js}</script>
<script>
  const panes = ['strict', 'tight', 'untangled'].map((id) => document.getElementById(id));
  const say = (f) => {
    const n = f.layoutInfo ? f.layoutInfo.crossings : null;
    const el = document.querySelector('.cc[data-for="' + f.id + '"]');
    if (el && n !== null) el.textContent = n === 0 ? 'no lines cross' : n === 1 ? '1 line crossing' : n + ' line crossings';
  };
  for (const f of panes) f.addEventListener('lode-layout', () => say(f));
  document.querySelectorAll('[data-bias]').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('[data-bias]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    for (const f of panes) f.setDoc({ ...f.doc, settings: { ...f.doc.settings, bias: b.dataset.bias } });
  }));
</script>
</body>
</html>
`;
writeFileSync(out, html);
console.log('layouts compared →', out, (html.length / 1024).toFixed(0) + ' kB');
