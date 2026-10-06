// History properties, in Node, no browser: express rewind and fast-forward on random histories.
//   node test/history.mjs [count]        (HISTORY=<path to history.ts> checks another copy)
// Builds random histories of content steps, selections and camera moves, then runs random undo,
// redo, express rewind, express fast-forward and new steps, checking after every operation that
// the history is still one unbroken chain and that the express moves keep the camera.
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const entry = process.env.HISTORY || fileURLToPath(new URL('../src/history.ts', import.meta.url));
const out = await build({ entryPoints: [entry], bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'error' });
const { History, CAMERA_KINDS } = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));

const count = Number(process.argv[2] || 3000);
let seed = 7;
const rnd = () => {
  seed ^= seed << 13; seed >>>= 0;
  seed ^= seed >> 17;
  seed ^= seed << 5; seed >>>= 0;
  return seed / 4294967296;
};
const pick = (a) => a[Math.floor(rnd() * a.length)];

const camEq = (a, b) => a.x === b.x && a.y === b.y && a.z === b.z && a.r === b.r;
const viewEq = (a, b) => camEq(a.cam, b.cam) && a.follow === b.follow && a.sel.join() === b.sel.join();
const same = (a, b) => a.doc === b.doc && viewEq(a.view, b.view);
const at = (h) => (h.index > 0 ? h.entries[h.index - 1].after : h.entries[0]?.before);
const show = (s) => `doc ${s.doc.n} cam ${s.view.cam.x},${s.view.cam.z} sel [${s.view.sel}]`;

let docs = 0;
const newDoc = () => ({ n: ++docs });
const CONTENT = ['edit', 'add', 'link', 'delete', 'group', 'collapse', 'settings'];
const CAMERA = ['pan', 'zoom', 'rotate', 'fit'];
const SELECT = ['select', 'nav'];

/** A next state from `s` by a random kind of step. Some content steps also move the camera (fit-and-fold does). */
function step(s) {
  const r = rnd();
  const cam = { ...s.view.cam };
  if (r < 0.4) {
    const kind = pick(CONTENT);
    const moves = rnd() < 0.15;
    if (moves) cam.x += 37;
    const sel = rnd() < 0.5 ? [`n${docs + 1}`] : s.view.sel;
    return { kind, s: { doc: newDoc(), view: { cam, follow: moves ? !s.view.follow : s.view.follow, sel } } };
  }
  if (r < 0.75) {
    const kind = pick(CAMERA);
    if (kind === 'zoom') cam.z = Math.round(cam.z * (rnd() < 0.5 ? 125 : 80)) / 100;
    else if (kind === 'rotate') cam.r += 0.25;
    else cam.x += Math.round(rnd() * 200 - 100) || 1;
    return { kind, s: { doc: s.doc, view: { cam, follow: kind === 'fit', sel: s.view.sel } } };
  }
  return { kind: pick(SELECT), s: { doc: s.doc, view: { cam, follow: s.view.follow, sel: [`n${Math.floor(rnd() * 9)}`] } } };
}

function push(h, shown, t) {
  const { kind, s } = step(shown);
  h.push({ label: `${kind} ${t}`, kind, before: shown, after: s, t }, 0);
  return s;
}

function checkChain(h, shown, ctx) {
  for (let i = 1; i < h.entries.length; i++)
    assert.ok(same(h.entries[i].before, h.entries[i - 1].after), `${ctx}: entry ${i} starts where entry ${i - 1} ends (${show(h.entries[i].before)} vs ${show(h.entries[i - 1].after)})`);
  if (h.entries.length) assert.ok(same(at(h), shown), `${ctx}: what is shown is the state at the cursor (${show(shown)} vs ${show(at(h))})`);
}

const labels = (h) => h.entries.map((e) => e.label).sort().join('|');
let ops = 0, rewinds = 0, rebases = 0;

for (let run = 0; run < count; run++) {
  const h = new History(1000);
  let shown = { doc: newDoc(), view: { cam: { x: 0, y: 0, z: 1, r: 0 }, follow: true, sel: [] } };
  let t = 0;
  const n = 3 + Math.floor(rnd() * 14);
  for (let i = 0; i < n; i++) shown = push(h, shown, ++t);
  for (let o = 0; o < 24; o++) {
    const op = pick(['undo', 'redo', 'xundo', 'xundo', 'xredo', 'xredo', 'push']);
    const ctx = `run ${run} op ${o} ${op}`;
    const before = { labels: labels(h), shown, index: h.index, len: h.entries.length };
    if (op === 'undo') { const e = h.undo(); if (e) shown = e.before; }
    else if (op === 'redo') { const e = h.redo(); if (e) shown = e.after; }
    else if (op === 'push') shown = push(h, shown, ++t);
    else if (op === 'xundo') {
      // What it should land on: the state before the latest step that is not a camera move.
      let k = h.index - 1;
      while (k >= 0 && CAMERA_KINDS.has(h.entries[k].kind)) k--;
      const target = k >= 0 ? h.entries[k].before : null;
      const skipped = k >= 0 ? h.index - 1 - k : 0;
      const e = h.expressUndo();
      if (!target) assert.equal(e, null, `${ctx}: nothing but camera moves to rewind`);
      else {
        rewinds++;
        shown = e.before;
        assert.equal(shown.doc, target.doc, `${ctx}: the document is the one before the step`);
        assert.equal(shown.view.sel.join(), target.view.sel.join(), `${ctx}: and so is the selection`);
        if (skipped) {
          rebases++;
          assert.ok(camEq(shown.view.cam, before.shown.view.cam) && shown.view.follow === before.shown.view.follow, `${ctx}: the camera stays where it was`);
          assert.equal(h.index, before.index - 1, `${ctx}: the cursor sits after the rebased camera moves, before the step`);
        }
        assert.equal(labels(h), before.labels, `${ctx}: the same steps, reordered`);
        assert.equal(h.entries.length, before.len, `${ctx}: none added or lost`);
      }
    } else if (op === 'xredo') {
      let j = h.index;
      while (j < h.entries.length && CAMERA_KINDS.has(h.entries[j].kind)) j++;
      const target = j < h.entries.length ? h.entries[j].after : null;
      const skipped = target ? j - h.index : 0;
      const e = h.expressRedo();
      if (!target) assert.equal(e, null, `${ctx}: nothing but camera moves to fast-forward`);
      else {
        shown = e.after;
        assert.equal(shown.doc, target.doc, `${ctx}: the document is the one after the step`);
        assert.equal(shown.view.sel.join(), target.view.sel.join(), `${ctx}: and so is the selection`);
        if (skipped) assert.ok(camEq(shown.view.cam, before.shown.view.cam), `${ctx}: the camera stays where it was`);
        assert.equal(labels(h), before.labels, `${ctx}: the same steps, reordered`);
      }
    }
    checkChain(h, shown, ctx);
    ops++;
  }
}

// Al's example, step by step: drag a link (an edge pan, then the link), zoom out, rewind, fast-forward.
{
  const h = new History();
  const cam = (x, z) => ({ x, y: 0, z, r: 0 });
  const D0 = { n: 'no link' }, D1 = { n: 'linked' };
  const s0 = { doc: D0, view: { cam: cam(0, 2), follow: false, sel: [] } };
  const s1 = { doc: D0, view: { cam: cam(300, 2), follow: false, sel: [] } };
  const s2 = { doc: D1, view: { cam: cam(300, 2), follow: false, sel: ['e1'] } };
  const s3 = { doc: D1, view: { cam: cam(300, 0.5), follow: false, sel: ['e1'] } };
  h.push({ label: 'Pan', kind: 'pan', before: s0, after: s1, t: 1 });
  h.push({ label: 'Link', kind: 'link', before: s1, after: s2, t: 2 });
  h.push({ label: 'Zoom 50%', kind: 'zoom', before: s2, after: s3, t: 3 });
  const r = h.expressUndo();
  assert.equal(r.label, 'Link');
  assert.equal(r.before.doc, D0, 'rewind: the link is gone');
  assert.equal(r.before.view.cam.z, 0.5, 'rewind: still zoomed out');
  assert.deepEqual(h.entries.map((e) => e.label), ['Pan', 'Zoom 50%', 'Link'], 'the zoom-out is rebased before the link');
  assert.equal(h.index, 2, 'the link is next to redo');
  const f = h.expressRedo();
  assert.equal(f.label, 'Link');
  assert.equal(f.after.doc, D1, 'fast-forward: the link is back');
  assert.equal(f.after.view.cam.z, 0.5, 'fast-forward: in the zoomed-out view');
  assert.equal(h.index, 3);
  assert.equal(h.undo().label, 'Link', 'a plain undo now takes the link');
  assert.equal(h.undo().label, 'Zoom 50%', 'then the zoom-out');
  assert.equal(h.entries[1].before.view.cam.x, 300, 'which starts from the pan before the link');
  // A second rewind from the start of the zoom-out passes it and the pan: nothing but camera moves.
  assert.equal(h.expressUndo(), null, 'only camera moves remain before it');
}

console.log(`✓ history: ${count} random histories, ${ops} operations (${rewinds} express rewinds, ${rebases} with camera moves rebased); the drag-link-zoom-rewind example`);
