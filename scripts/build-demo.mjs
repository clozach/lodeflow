// Writes one self-contained demo page (engine + element + sample inline), openable from file://.
//   node scripts/build-demo.mjs <out.html>
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const here = new URL('..', import.meta.url).pathname;
const out = resolve(process.argv[2] || 'demo.html');
const js = readFileSync(resolve(here, 'web/dist/lode-flow.iife.js'), 'utf8').replace(/<\/script/gi, '<\\/script');
const sample = readFileSync(resolve(here, 'examples/release-slip.json'), 'utf8');
const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>lodeflow demo</title>
<style>
  :root { color-scheme: light dark; --ink: #1f1c18; --muted: #6f6a61; --paper: #fdfcf9; --line: rgba(31,28,24,.14); }
  @media (prefers-color-scheme: dark) { :root { --ink: #ebe8e2; --muted: #a19b90; --paper: #111214; --line: rgba(255,255,255,.14); } }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--paper); color: var(--ink); font: 15px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width: 1200px; margin: 0 auto; padding: 20px 16px 32px; }
  h1 { font-size: 20px; margin: 0 0 4px; letter-spacing: -.01em; }
  p { margin: 0 0 12px; color: var(--muted); max-width: 70ch; }
  kbd { font: 12px ui-monospace, Menlo, monospace; border: 1px solid var(--line); border-bottom-width: 2px; border-radius: 4px; padding: 0 4px; }
  .frame { resize: both; overflow: hidden; width: 100%; height: min(72vh, 720px); min-width: 240px; min-height: 220px;
    border: 1px solid var(--line); border-radius: 14px; }
  lode-flow { height: 100%; border-radius: 14px; }
  .row { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 12px; }
  button { font: inherit; font-size: 13px; padding: 6px 10px; border-radius: 8px; border: 1px solid var(--line); background: transparent; color: inherit; cursor: pointer; }
  button:hover { background: color-mix(in srgb, var(--ink) 7%, transparent); }
  button:focus-visible { outline: 2px solid #2f62d8; outline-offset: 2px; }
</style>
</head>
<body>
<main>
  <h1>lodeflow</h1>
  <p>A flow diagram that lays itself out. Drag the frame's bottom-right corner: with <b>Auto</b> orientation the flow turns to fit. Click a node, then click it again to edit. Drag from one node to another to link them, or onto an edge to merge into it; or select a node and press <kbd>E</kbd> for a list (<kbd>⇧E</kbd> lists nodes to link into it). Click an edge, then click it again to label it. <kbd>J</kbd> dives into a selected group (opening it if folded) and <kbd>K</kbd> surfaces; with nothing selected, <kbd>N</kbd> adds a node and <kbd>⇧N</kbd> lists nodes for a new one to link to. Press <kbd>?</kbd> inside the diagram for every gesture; <kbd>⌘Z</kbd>/<kbd>Ctrl+Z</kbd> undoes edits and view changes alike.</p>
  <div class="row" role="group" aria-label="Frame size">
    <button data-size="100%,min(72vh,720px)">Wide</button>
    <button data-size="390px,700px">Phone</button>
    <button data-size="560px,560px">Square</button>
    <button data-reset>Reset the sample</button>
  </div>
  <div class="frame" id="frame">
    <lode-flow id="flow" storage-key="lodeflow-demo">
      <script type="application/json">${sample}</script>
    </lode-flow>
  </div>
</main>
<script>${js}</script>
<script>
  const frame = document.getElementById('frame');
  const flow = document.getElementById('flow');
  const sample = ${sample.trim()};
  document.querySelectorAll('[data-size]').forEach((b) => b.addEventListener('click', () => {
    const [w, h] = b.dataset.size.split(',');
    frame.style.width = w; frame.style.height = h;
  }));
  document.querySelector('[data-reset]').addEventListener('click', () => {
    try { localStorage.removeItem('lodeflow:lodeflow-demo'); } catch {}
    flow.setDoc(sample);
  });
</script>
</body>
</html>
`;
writeFileSync(out, html);
console.log('demo →', out, (html.length / 1024).toFixed(0) + ' kB');
