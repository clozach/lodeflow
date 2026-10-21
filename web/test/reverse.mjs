// Edge reversal: plain/loose arrows, shared trunks, individual branches and history snapshots.
//   node test/reverse.mjs           (MODEL=<path to model.ts> checks another copy)
import { build } from 'esbuild';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const load = async (entry) => {
  const out = await build({ entryPoints: [entry], bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'error' });
  return import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));
};
const M = await load(process.env.MODEL || fileURLToPath(new URL('../src/model.ts', import.meta.url)));
const { History } = await load(fileURLToPath(new URL('../src/history.ts', import.meta.url)));
const C = await load(fileURLToPath(new URL('../src/clipboard.ts', import.meta.url)));
assert.equal(typeof M.reverseEdge, 'function', 'the document model exposes edge reversal');
let passed = 0;
const check = (name, fn) => {
  try { fn(); passed++; } catch (e) { console.error(`✗ ${name}\n${e.stack}`); process.exitCode = 1; }
};
const base = () => M.normalizeDoc({
  groups: [{ id: 'g', text: 'Group' }],
  nodes: ['a', 'b', 'c', 'd', 'x'].map((id) => ({ id, text: id, group: 'g' })),
  edges: [{ id: 'ab', from: 'a', to: 'b', label: 'shared', back: true }],
});
const shared = (kind, count = 2) => {
  let d = base();
  for (const id of ['c', 'd'].slice(0, count - 1)) d = (kind === 'merge' ? M.linkToEdge(d, id, 'ab') : M.linkFromEdge(d, 'ab', id)).doc;
  return d;
};
const reverse = (d, id) => {
  const r = M.reverseEdge(d, id);
  assert.ok('doc' in r, r.error);
  assert.equal(r.edge, id, 'selection stays on the requested edge');
  assert.deepEqual(M.normalizeDoc(JSON.parse(JSON.stringify(r.doc))), r.doc, 'the output is already normalized and survives save/reload');
  return r.doc;
};
const freeze = (value) => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
const pairs = (d) => M.connections(d).flatMap((c) => c.inputs.flatMap((i) => c.outputs.map((o) => `${i}>${o}`))).sort();

check('ordinary reversal keeps id, label, back hint, groups and unrelated object identity', () => {
  const d = freeze(base());
  const before = JSON.stringify(d);
  const r = reverse(d, 'ab');
  assert.deepEqual(M.edgeById(r, 'ab'), { id: 'ab', from: 'b', to: 'a', label: 'shared', back: true });
  assert.equal(r.nodes, d.nodes); assert.equal(r.groups, d.groups); assert.equal(r.settings, d.settings);
  assert.equal(JSON.stringify(d), before);
  assert.deepEqual(reverse(r, 'ab'), d);
});
check('a reversed ordinary edge may close a cycle', () => {
  const d = M.normalizeDoc({ ...base(), edges: [...base().edges, { id: 'ac', from: 'a', to: 'c' }, { id: 'cb', from: 'c', to: 'b' }] });
  assert.deepEqual(pairs(reverse(d, 'ab')), ['a>c', 'b>a', 'c>b']);
});
check('ordinary reversal rejects a duplicate in an ordinary edge', () => {
  const d = M.normalizeDoc({ ...base(), edges: [...base().edges, { id: 'ba', from: 'b', to: 'a' }] });
  assert.deepEqual(M.reverseEdge(freeze(d), 'ab'), { error: 'Already linked in that direction' });
});
check('ordinary reversal detects a duplicate hidden inside a shared connection', () => {
  const d = M.linkToEdge(M.normalizeDoc({ ...base(), edges: [...base().edges, { id: 'ba', from: 'b', to: 'a' }] }), 'c', 'ba').doc;
  assert.deepEqual(M.reverseEdge(d, 'ab'), { error: 'Already linked in that direction' });
});
check('unknown edges, nodes and groups are rejected without a document mutation', () => {
  const d = freeze(base());
  for (const id of ['missing', 'a', 'g']) assert.deepEqual(M.reverseEdge(d, id), { error: 'Select an edge' });
});

for (const kind of ['merge', 'fork']) {
  check(`${kind} trunk reverses the entire connection and reverses back without changing ids`, () => {
    const d = freeze(shared(kind, 3)), c = M.connectionOf(d, 'ab');
    const r = reverse(d, 'ab'), next = M.connectionOf(r, 'ab');
    assert.equal(next.kind, kind === 'merge' ? 'fork' : 'merge');
    assert.deepEqual(next.inputs, c.outputs); assert.deepEqual(next.outputs, c.inputs);
    assert.equal(next.junction, c.junction);
    assert.deepEqual(r.edges, d.edges.map((e) => ({ ...e, from: e.to, to: e.from })));
    assert.equal(next.trunk.label, 'shared'); assert.equal(next.trunk.back, true);
    assert.deepEqual(reverse(r, 'ab'), d);
  });
  check(`${kind} branch detaches only itself, carries the shared label, and leaves a valid junction`, () => {
    const d = freeze(shared(kind, 3)), c = M.connectionOf(d, 'ab'), e = c.branches[1];
    const r = reverse(d, e.id), next = M.connectionOf(r, 'ab');
    const expected = kind === 'merge' ? { from: 'b', to: e.from } : { from: e.to, to: 'a' };
    assert.deepEqual(M.edgeById(r, e.id), { id: e.id, ...expected, label: 'shared', back: true });
    assert.equal(next.kind, kind); assert.equal(next.branches.length, 2);
    assert.deepEqual(next.trunk, c.trunk);
    assert.deepEqual(pairs(r), pairs(d).filter((p) => p !== (kind === 'merge' ? `${e.from}>b` : `a>${e.to}`)).concat(`${expected.from}>${expected.to}`).sort());
    assert.equal(M.parentOf(r, e.id), 'g', 'the detached edge stays in its endpoints’ common group');
  });
  check(`${kind} branch reversal dissolves a two-branch junction and retains the original trunk`, () => {
    const d = shared(kind), c = M.connectionOf(d, 'ab'), e = c.branches[1];
    const r = reverse(d, e.id);
    assert.deepEqual(r.junctions, []); assert.equal(r.edges.length, 2);
    assert.deepEqual(M.edgeById(r, 'ab'), { id: 'ab', from: 'a', to: 'b', label: 'shared', back: true });
    assert.equal(M.edgeById(r, e.id).label, 'shared');
    assert.equal(M.edgeById(r, c.branches[0].id), undefined, 'the dissolved branch no longer exists');
  });
  for (const count of [2, 3]) check(`${kind} first-branch reversal keeps the selected id with ${count} original branches`, () => {
    const d = shared(kind, count), e = M.connectionOf(d, 'ab').branches[0];
    const r = reverse(d, e.id);
    assert.deepEqual(M.edgeById(r, e.id), { id: e.id, from: kind === 'merge' ? 'b' : e.to, to: kind === 'merge' ? e.from : 'a', label: 'shared', back: true });
    assert.equal(M.connectionOf(r, 'ab').kind, count === 2 ? 'plain' : kind);
  });
  check(`${kind} trunk rejects a colliding reversed pair atomically`, () => {
    const d = shared(kind, 3), c = M.connectionOf(d, 'ab');
    const from = c.outputs[0], to = c.inputs[0];
    const withTwin = M.linkNodes(d, from, to).doc;
    const before = JSON.stringify(withTwin);
    assert.deepEqual(M.reverseEdge(freeze(withTwin), 'ab'), { error: 'Already linked in that direction' });
    assert.equal(JSON.stringify(withTwin), before);
  });
  check(`${kind} branch rejects a collision with another shared connection`, () => {
    const d = shared(kind, 3), c = M.connectionOf(d, 'ab'), e = c.branches[1];
    const from = kind === 'merge' ? 'b' : e.to, to = kind === 'merge' ? e.from : 'a';
    let withTwin = M.linkNodes(d, from, to).doc;
    const twin = withTwin.edges.at(-1).id;
    withTwin = M.linkToEdge(withTwin, 'x', twin).doc;
    assert.deepEqual(M.reverseEdge(freeze(withTwin), e.id), { error: 'Already linked in that direction' });
  });
}
check('legacy merge junctions reverse as forks', () => {
  const d = shared('merge');
  const legacy = { ...d, junctions: d.junctions.map(({ id }) => ({ id })) };
  assert.equal(M.connectionOf(reverse(legacy, 'ab'), 'ab').kind, 'fork');
});
check('shared branch reversal does not invent a label or back hint', () => {
  const d = shared('fork');
  const clean = { ...d, edges: d.edges.map(({ label: _label, back: _back, ...e }) => e) };
  const e = M.connectionOf(clean, 'ab').branches[0];
  assert.deepEqual(M.edgeById(reverse(clean, e.id), e.id), { id: e.id, from: e.to, to: 'a' });
});

for (const end of ['from', 'to']) {
  check(`hanging loose ${end} reversal swaps attached ends and reverses back`, () => {
    const d = freeze(M.addLoose(base(), { [end]: 'c' }, 'hanging').doc), l = d.loose[0];
    const r = reverse(d, l.id), opposite = end === 'from' ? 'to' : 'from';
    assert.deepEqual(M.looseById(r, l.id), { id: l.id, [opposite]: 'c', label: 'hanging' });
    assert.equal(r.edges, d.edges);
    assert.deepEqual(reverse(r, l.id), d);
  });
}
check('fully free reversal toggles a saved direction, retaining its group and label', () => {
  const d = freeze(M.addLoose(base(), { group: 'g' }, 'free').doc), l = d.loose[0];
  const r = reverse(d, l.id);
  assert.deepEqual(M.looseById(r, l.id), { ...l, reversed: true });
  assert.deepEqual(reverse(r, l.id), d);
  assert.equal(r.edges, d.edges); assert.equal(r.groups, d.groups);
});
check('normalization keeps true free reversal only and drops unused/invalid direction values', () => {
  const d = M.normalizeDoc({ ...base(), loose: [
    { id: 'free', reversed: true, label: 'free', group: 'g' },
    { id: 'tail', from: 'a', reversed: true }, { id: 'head', to: 'b', reversed: true },
    { id: 'false', reversed: false }, { id: 'string', reversed: 'yes' },
  ] });
  assert.deepEqual(d.loose, [{ id: 'free', reversed: true, label: 'free', group: 'g' }, { id: 'tail', from: 'a' }, { id: 'head', to: 'b' }, { id: 'false' }, { id: 'string' }]);
  assert.deepEqual(M.normalizeDoc(JSON.parse(JSON.stringify(d))), d);
});
check('attaching a reversed free edge consumes its direction flag; endpoints carry direction thereafter', () => {
  let d = M.addLoose(base(), { group: 'g' }).doc, id = d.loose[0].id;
  d = reverse(d, id);
  const attached = M.attachLoose(d, id, 'x', 'from').doc;
  assert.deepEqual(M.looseById(attached, id), { id, from: 'x', label: 'relates to' });
  const completed = M.attachLoose(attached, id, 'd', 'to').doc;
  assert.deepEqual(M.edgeById(completed, id), { id, from: 'x', to: 'd', label: 'relates to' });
  assert.equal('loose' in completed, false);
});
check('saved history keeps each original and reversed snapshot, including free direction', () => {
  let d = M.addLoose(shared('merge'), { group: 'g' }).doc, id = d.loose[0].id;
  const before = freeze(d), after = reverse(reverse(before, 'ab'), id);
  const view = { cam: { x: 0, y: 0, z: 1, r: 0 }, follow: true, sel: [id] };
  const h = new History();
  h.push({ label: 'Reverse edge', kind: 'link', before: { doc: before, view }, after: { doc: after, view }, t: 1 });
  const restored = History.fromJSON(JSON.parse(JSON.stringify(h.toJSON())));
  assert.deepEqual(restored.undo().before.doc, before);
  assert.deepEqual(restored.redo().after.doc, after);
  assert.deepEqual(M.normalizeDoc(restored.entries[0].after.doc), after);
});
check('copy, clipboard encoding and repeated paste preserve a free arrow’s reverse direction', () => {
  const d = M.addLoose(base(), { group: 'g' }, 'free').doc, id = d.loose[0].id;
  const source = reverse(d, id);
  const fragment = C.decodeFragment(C.encodeFragment(C.copyFragment(source, [id])));
  assert.equal(fragment.loose[0].reversed, true);
  let pasted = C.pasteFragment(M.emptyDoc(), fragment);
  const first = pasted.ids[0];
  assert.equal(M.looseById(pasted.doc, first).reversed, true);
  assert.equal(M.looseById(pasted.doc, first).label, 'free');
  assert.notEqual(first, id);
  pasted = C.pasteFragment(pasted.doc, fragment);
  assert.notEqual(pasted.ids[0], first);
  assert.ok(pasted.doc.loose.every((l) => l.reversed));
  assert.deepEqual(M.normalizeDoc(JSON.parse(JSON.stringify(pasted.doc))), pasted.doc);
});

let swept = 0;
const sweepKinds = new Set();
check('randomized reversal sweeps every edge kind without mutation or malformed junctions', () => {
  let seed = 29;
  const rnd = (n) => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return Math.floor((seed >>> 0) / 4294967296 * n); };
  for (let t = 0; t < 300; t++) {
    const nodes = ['a', 'b', 'c', 'd', 'x'].map((id) => ({ id, text: id }));
    const junctions = [0, 1, 2].map((i) => ({ id: `j${i}`, kind: rnd(2) ? 'merge' : 'fork' }));
    const ends = [...nodes.map((n) => n.id), ...junctions.map((j) => j.id)];
    const edges = Array.from({ length: 14 }, (_, i) => ({ id: `e${i}`, from: ends[rnd(ends.length)], to: ends[rnd(ends.length)], ...(rnd(3) ? {} : { label: `L${i}`, back: true }) }));
    const loose = [{ id: 'free', ...(rnd(2) ? { reversed: true } : {}) }, { id: 'tail', from: 'a' }, { id: 'head', to: 'b' }];
    const d = freeze(M.normalizeDoc({ nodes, junctions, edges, loose })), before = JSON.stringify(d);
    for (const e of [...d.edges, ...d.loose]) {
      swept++;
      const c = M.connectionOf(d, e.id);
      sweepKinds.add(c ? c.kind + (c.junction ? c.trunk.id === e.id ? ' trunk' : ' branch' : '') : M.isFree(e) ? 'free loose' : 'hanging loose');
      const result = M.reverseEdge(d, e.id);
      if ('error' in result) assert.equal(result.error, 'Already linked in that direction');
      else {
        const r = result.doc;
        assert.deepEqual(M.normalizeDoc(JSON.parse(JSON.stringify(r))), r, `normalized output, document ${t}, edge ${e.id}`);
        assert.ok(M.edgeById(r, e.id) || M.looseById(r, e.id), 'the requested edge keeps its id');
        assert.equal(r.nodes, d.nodes); assert.equal(r.groups, d.groups); assert.equal(r.settings, d.settings);
        // Branch detachment changes the connection's shape, so Undo, rather than a second
        // reversal, is its inverse. All other normalized arrows are structural involutions.
        if (!c?.junction || c.trunk.id === e.id) {
          // Imports may already contain the same semantic link both directly and through a
          // junction. Returning to that duplicate is refused just like creating a new one.
          const others = c ? M.connections(d).filter((other) => other.trunk.id !== c.trunk.id) : [];
          const alreadyDuplicated = c && c.inputs.some((i) => c.outputs.some((o) => others.some((other) => other.inputs.includes(i) && other.outputs.includes(o))));
          if (!alreadyDuplicated) assert.deepEqual(reverse(r, e.id), d);
        }
      }
      assert.equal(JSON.stringify(d), before, 'the source snapshot stays unchanged');
    }
  }
});

console.log(process.exitCode ? `reverse: ${passed} passed, some failed` : `✓ reverse: ${passed} edge-reversal model checks`);
console.log(`reverse sweep: ${swept} edge candidates across 300 normalized documents; ${[...sweepKinds].sort().join(', ')}`);
