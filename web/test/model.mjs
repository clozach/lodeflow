// Document-model properties on random (often malformed) documents, in Node, no browser.
//   node test/model.mjs [count]        (MODEL=<path to model.ts> checks another copy)
// Bundles src/model.ts in memory with esbuild, then checks that tidyJunctions never leaves an edge
// pointing at nothing and that every junction it keeps is a real merge or fork (two or more branches, one
// trunk), on documents with chained, cyclic, branchless and trunkless junctions.
import { build } from 'esbuild';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const entry = process.env.MODEL || fileURLToPath(new URL('../src/model.ts', import.meta.url));
const out = await build({ entryPoints: [entry], bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'error' });
const { tidyJunctions, dissolveNode, normalizeDoc, dive, divePlan, surface, depthOf, parentOf, addLinkedTo, linkEach, commonGroup, connectionOf, connections, linked, linkFromEdge, forkProblem, mergeProblem, deleteItems, splitEdge, setEdgeLabel, addEffect, linkToEdge } = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));

const count = Number(process.argv[2] || 20000);
let seed = 11;
const rnd = () => {
  seed ^= seed << 13; seed >>>= 0;
  seed ^= seed >> 17;
  seed ^= seed << 5; seed >>>= 0;
  return seed / 4294967296;
};
const pick = (a) => a[Math.floor(rnd() * a.length)];
const sig = (d) => d.edges.map((e) => `${e.from}>${e.to}${e.label ? `[${e.label}]` : ''}`).join(' ') + ` | junctions ${d.junctions.map((j) => j.id).join(',')}`;

let failures = 0;
for (let t = 0; t < count && failures < 5; t++) {
  const nodes = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, text: id }));
  const junctions = Array.from({ length: 1 + Math.floor(rnd() * 4) }, (_, i) => ({ id: `j${i}`, ...(rnd() < 0.5 ? {kind: 'fork'} : {}) }));
  const ends = [...nodes.map((n) => n.id), ...junctions.map((j) => j.id)];
  const edges = [];
  for (let k = 0, m = 2 + Math.floor(rnd() * 8); k < m; k++) {
    const from = pick(ends);
    const to = pick(ends);
    if (from === to) continue;
    edges.push({ id: `e${k}`, from, to, ...(rnd() < 0.3 ? { label: `L${k}` } : {}) });
  }
  const doc = { nodes, edges, groups: [], junctions, settings: {} };
  const tidy = tidyJunctions(structuredClone(doc));
  const known = new Set([...nodes.map((n) => n.id), ...tidy.junctions.map((j) => j.id)]);
  const problems = [];
  if (tidy.edges.some((e) => !known.has(e.from) || !known.has(e.to))) problems.push('an edge points at nothing');
  for (const j of tidy.junctions) {
    const branches = tidy.edges.filter((e) => (j.kind === 'fork' ? e.from : e.to) === j.id).length;
    const trunks = tidy.edges.filter((e) => (j.kind === 'fork' ? e.to : e.from) === j.id).length;
    if (branches < 2 || trunks !== 1) problems.push(`junction ${j.id} has ${branches} branches and ${trunks} trunks`);
  }
  if (tidyJunctions(tidy) !== tidy) problems.push('a second tidy changed it again');
  if (problems.length) {
    failures++;
    console.log(`✗ ${problems.join('; ')}\n  in:  ${sig(doc)}\n  out: ${sig(tidy)}`);
  }
}
// Removing a node (the way back from inserting one into an edge) keeps a well-formed document
// well formed: no edge to nothing, no merge running into another merge, every merge real.
for (let t = 0; t < count / 4 && failures < 5; t++) {
  const nodes = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => ({ id, text: id }));
  const junctions = Array.from({ length: Math.floor(rnd() * 3) }, (_, i) => ({ id: `j${i}`, ...(rnd() < 0.5 ? {kind: 'fork'} : {}) }));
  const ends = [...nodes.map((n) => n.id), ...junctions.map((j) => j.id)];
  const edges = [];
  for (let k = 0, m = 3 + Math.floor(rnd() * 8); k < m; k++) edges.push({ id: `e${k}`, from: pick(ends), to: pick(ends), ...(rnd() < 0.3 ? { label: `L${k}` } : {}) });
  const doc = normalizeDoc({ nodes, edges, junctions, groups: [] });
  const isJ = (d, x) => d.junctions.some((j) => j.id === x);
  const ok = (d) => {
    const known = new Set([...d.nodes.map((n) => n.id), ...d.junctions.map((j) => j.id)]);
    if (d.edges.some((e) => !known.has(e.from) || !known.has(e.to))) return 'an edge points at nothing';
    if (d.edges.some((e) => isJ(d, e.from) && isJ(d, e.to))) return 'a merge runs into another merge';
    for (const j of d.junctions) {
      const b = d.edges.filter((e) => (j.kind === 'fork' ? e.from : e.to) === j.id).length;
      const tr = d.edges.filter((e) => (j.kind === 'fork' ? e.to : e.from) === j.id).length;
      if (b < 2 || tr !== 1) return `junction ${j.id} has ${b} branches and ${tr} trunks`;
    }
    return null;
  };
  if (ok(doc)) continue; // only well-formed starting points
  const victim = pick(doc.nodes).id;
  const after = dissolveNode(doc, victim);
  const why = ok(after);
  if (why) {
    failures++;
    console.log(`✗ removing ${victim}: ${why}\n  in:  ${sig(doc)}\n  out: ${sig(after)}`);
  }
}

// A node between two merges: a, b → (merge) → n; n, c → (merge) → z. Removing n cannot join the
// first merge's trunk into the second merge, so it removes n's links: the first merge goes, and
// the second, left with one cause, becomes the plain edge c → z.
{
  const doc = {
    nodes: ['a', 'b', 'c', 'n', 'z'].map((id) => ({ id, text: id })),
    junctions: [{ id: 'j1' }, { id: 'j2' }],
    edges: [
      { id: 'ba', from: 'a', to: 'j1' },
      { id: 'bb', from: 'b', to: 'j1' },
      { id: 't1', from: 'j1', to: 'n', label: 'first merge' },
      { id: 'bn', from: 'n', to: 'j2' },
      { id: 'bc', from: 'c', to: 'j2' },
      { id: 't2', from: 'j2', to: 'z' },
    ],
    groups: [],
    settings: {},
  };
  const got = sig(dissolveNode(doc, 'n'));
  if (got !== 'c>z | junctions ') {
    failures++;
    console.log(`✗ removing a node between two merges: ${got}`);
  }
}

// Two merges into the same effect dissolving at once (the shape an old merge bug could leave):
// the surviving direct link keeps the label.
{
  const doc = {
    nodes: ['a', 'b'].map((id) => ({ id, text: id })),
    junctions: [{ id: 'j0' }, { id: 'j2' }],
    edges: [
      { id: 'b0', from: 'a', to: 'j0' },
      { id: 't0', from: 'j0', to: 'b' },
      { id: 'b2', from: 'a', to: 'j2' },
      { id: 't2', from: 'j2', to: 'b', label: 'pressure' },
    ],
    groups: [],
    settings: {},
  };
  const got = sig(tidyJunctions(doc));
  if (got !== 'a>b[pressure] | junctions ') {
    failures++;
    console.log(`✗ two merges dissolving together lost a label: ${got}`);
  }
}
// Dive (J) and Surface (K) on random nested groups: Dive only ever hands a selected group's place
// to its own members, opening exactly the collapsed ones it enters, and keeps everything else;
// Surface lifts exactly the deepest items one level and keeps the rest; surfacing what a group
// dived into gives back that group.
for (let t = 0; t < count / 4 && failures < 5; t++) {
  const groups = [];
  for (let i = 0; i < 1 + Math.floor(rnd() * 5); i++) groups.push({ id: `g${i}`, text: `g${i}`, ...(i && rnd() < 0.7 ? { parent: `g${Math.floor(rnd() * i)}` } : {}), ...(rnd() < 0.2 ? { collapsed: true } : {}) });
  const nodes = Array.from({ length: 2 + Math.floor(rnd() * 7) }, (_, i) => ({ id: `n${i}`, text: `n${i}`, ...(rnd() < 0.7 ? { group: pick(groups).id } : {}) }));
  const edges = Array.from({ length: Math.floor(rnd() * 5) }, (_, i) => ({ id: `e${i}`, from: pick(nodes).id, to: pick(nodes).id })).filter((e) => e.from !== e.to);
  const doc = { nodes, edges, groups, junctions: [], settings: {} };
  const all = [...nodes.map((n) => n.id), ...groups.map((g) => g.id), ...edges.map((e) => e.id)];
  const sel = [...new Set(Array.from({ length: Math.floor(rnd() * 4) }, () => pick(all)))];
  const problems = [];
  const plan = divePlan(doc, sel);
  const down = plan.sel;
  if (JSON.stringify(dive(doc, sel)) !== JSON.stringify(down)) problems.push('dive and divePlan disagree');
  for (const id of down) {
    if (sel.includes(id)) continue;
    const p = parentOf(doc, id);
    if (!sel.length ? p !== null : !sel.includes(p)) problems.push(`dive added ${id}, not a member of a selected group`);
  }
  for (const id of sel) {
    const g = groups.find((x) => x.id === id);
    const entered = g && down.some((x) => parentOf(doc, x) === id);
    if (!down.includes(id) && !entered) problems.push(`dive dropped ${id}`);
    if (g && entered && !!g.collapsed !== plan.open.includes(id)) problems.push(`dive ${g.collapsed ? 'did not open' : 'opened'} ${id}`);
  }
  if (plan.open.some((id) => !sel.includes(id))) problems.push('dive opened a group outside the selection');
  if (surface(doc, []).length) problems.push('surfacing from the diagram itself changed the selection');
  if (surface(doc, dive(doc, [])).length) problems.push('surfacing from the top level did not reach the diagram itself (the empty selection)');
  if (sel.length) {
    const up = surface(doc, sel);
    const deepest = Math.max(...sel.map((id) => depthOf(doc, id)));
    if (deepest === 0 && up.length) problems.push('surfacing from the top level did not reach the diagram itself');
    for (const id of sel) {
      if (deepest === 0) continue;
      const kept = up.includes(id);
      if (deepest > 0 && depthOf(doc, id) === deepest && kept && parentOf(doc, id) !== null) problems.push(`surface kept deepest ${id}`);
      if (depthOf(doc, id) < deepest && !kept) problems.push(`surface dropped higher ${id}`);
    }
  }
  for (const g of groups) {
    const kids = dive(doc, [g.id]);
    if (!(kids.length === 1 && kids[0] === g.id) && JSON.stringify(surface(doc, kids)) !== JSON.stringify([g.id])) problems.push(`surface(dive(${g.id})) is not ${g.id}`);
  }
  // A new node linked to several: one edge each, in the deepest group holding them all.
  const anchors = [...new Set([pick(nodes).id, pick(nodes).id])];
  const dir = rnd() < 0.5 ? 'after' : 'before';
  const r = addLinkedTo(doc, anchors, dir);
  const fresh = r.doc.nodes.find((n) => n.id === r.id);
  if (r.doc.edges.length !== edges.length + anchors.length) problems.push('addLinkedTo: one edge per anchor');
  if ((fresh.group ?? null) !== commonGroup(doc, anchors.map((a) => nodes.find((n) => n.id === a).group ?? null))) problems.push('addLinkedTo: wrong group');
  const links = anchors.map((a) => (dir === 'before' ? { from: r.id, to: { type: 'node', id: a } } : { from: a, to: { type: 'node', id: r.id } }));
  const again = linkEach(r.doc, links);
  if (again.made !== 0 || again.problems.length !== links.length) problems.push('linkEach: existing links are skipped with a reason');
  if (problems.length) {
    failures++;
    console.log(`✗ ${problems.join('; ')}\n  sel ${sel.join(',')} in groups ${JSON.stringify(groups)} nodes ${JSON.stringify(nodes)}`);
  }
}

// Shared outgoing forks use the same public operations as shared incoming merges.
{
  const imported = normalizeDoc({nodes: ['a', 'b', 'c'].map(id => ({id, text: id})), junctions: [{id: 'fork', kind: 'fork'}], edges: [{id: 'trunk', from: 'a', to: 'fork', label: 'shared'}, {id: 'b', from: 'fork', to: 'b'}, {id: 'c', from: 'fork', to: 'c'}]});
  assert.equal(imported.junctions.length, 1, 'import retains one incoming trunk with two outgoing branches');
  assert.equal(imported.junctions[0].kind, 'fork');
  const malformedFork = normalizeDoc({...imported, edges: [...imported.edges, {id: 'self', from: 'fork', to: 'a'}, {id: 'duplicate', from: 'fork', to: 'b'}, {id: 'dangling', from: 'fork', to: 'absent'}]});
  assert.deepEqual(connectionOf(malformedFork, 'trunk').outputs, ['b', 'c'], 'invalid self, duplicate and dangling fork branches are dropped');
  assert.equal(typeof linkFromEdge, 'function', 'shared outgoing links have a model operation');
  const base = normalizeDoc({nodes: ['a', 'b', 'c', 'd'].map(id => ({id, text: id, group: 'inner'})), groups: [{id: 'outer'}, {id: 'inner', parent: 'outer'}], edges: [{id: 'ab', from: 'a', to: 'b', label: 'shared', back: true}]});
  const first = linkFromEdge(base, 'ab', 'c');
  assert.ok('doc' in first);
  const fork = first.doc, c = connectionOf(fork, first.edge);
  assert.equal(c.kind, 'fork');
  assert.equal(c.trunk.id, 'ab');
  assert.equal(c.trunk.label, 'shared');
  assert.equal(c.trunk.back, true);
  assert.deepEqual(c.inputs, ['a']);
  assert.deepEqual(c.outputs, ['b', 'c']);
  assert.equal(c.target, 'b', 'legacy first effect stays available');
  assert.equal(connections(fork).length, 1);
  assert.equal(linked(fork, 'a', 'b'), true);
  assert.equal(linked(fork, 'a', 'c'), true);
  assert.equal(linked(fork, 'c', 'a'), false);
  assert.equal(parentOf(fork, first.edge), 'inner');
  assert.equal(forkProblem(fork, first.edge, 'c'), 'Already part of this edge');
  assert.ok(forkProblem(fork, 'ab', 'a'));
  assert.equal(mergeProblem(fork, 'd', first.edge), 'This connection is already a fork');
  assert.equal('error' in linkToEdge(fork, 'd', first.edge), true);
  const merge = linkToEdge(base, 'c', 'ab').doc;
  assert.equal(connectionOf(merge, 'ab').kind, 'merge');
  const malformedMerge = normalizeDoc({...merge, edges: [...merge.edges, {id: 'self', from: 'b', to: merge.junctions[0].id}]});
  assert.deepEqual(connectionOf(malformedMerge, 'ab').inputs, ['a', 'c'], 'same self-branch mechanism is repaired for merges');
  assert.equal(forkProblem(merge, 'ab', 'd'), 'This connection is already a merge');
  assert.equal('error' in linkFromEdge(merge, 'ab', 'd'), true);
  const extended = linkFromEdge(fork, c.branches[0].id, 'd');
  assert.deepEqual(connectionOf(extended.doc, 'ab').outputs, ['b', 'c', 'd']);
  assert.equal(extended.doc.junctions.length, 1);
  assert.equal(connectionOf(setEdgeLabel(fork, first.edge, 'changed'), 'ab').trunk.label, 'changed');
  const remaining = deleteItems(fork, [first.edge]).doc;
  assert.deepEqual(remaining.junctions, []);
  assert.deepEqual(remaining.edges, [{id: 'ab', from: 'a', to: 'b', label: 'shared', back: true}]);
  assert.equal(deleteItems(fork, ['ab']).doc.edges.length, 0, 'deleting the incoming trunk removes every fork branch');
  assert.equal(deleteItems(fork, ['a']).doc.edges.length, 0);
  assert.deepEqual(deleteItems(fork, ['c']).doc.edges, remaining.edges);
  assert.equal(deleteItems(fork, ['outer']).doc.edges.length, 0, 'nested group removal tidies its fork');
  assert.equal(deleteItems(fork, ['outer']).doc.junctions.length, 0);
  const dup = normalizeDoc({...fork, edges: [...fork.edges, {id: 'duplicate', from: 'a', to: 'b'}]});
  const deduped = deleteItems(dup, [first.edge]).doc;
  assert.equal(deduped.edges.length, 1);
  assert.equal(deduped.edges[0].label, 'shared', 'dissolution transfers shared label to an existing direct edge');
  const split = splitEdge(fork, 'ab', 'middle');
  assert.equal(connectionOf(split.doc, 'ab').trunk.from, split.id);
  assert.equal(connectionOf(split.doc, 'ab').trunk.label, 'shared');
  assert.equal(split.doc.nodes.find(n => n.id === split.id).group, 'inner');
  const crossing = {...fork, nodes: fork.nodes.map(n => n.id === 'c' ? {...n, group: 'outer'} : n)};
  const crossSplit = splitEdge(crossing, 'ab');
  assert.equal(crossSplit.doc.nodes.find(n => n.id === crossSplit.id).group, 'outer', 'trunk insertion uses all shared ends for its common group');
  const inverse = dissolveNode(split.doc, split.id);
  assert.deepEqual(inverse.edges, fork.edges);
  assert.deepEqual(inverse.junctions, fork.junctions);
  const splitBranch = splitEdge(fork, first.edge, 'branch middle');
  assert.equal(connectionOf(splitBranch.doc, 'ab').outputs.includes(splitBranch.id), true);
  assert.deepEqual(dissolveNode(splitBranch.doc, splitBranch.id).edges, fork.edges);
  const added = addEffect(fork, first.edge, 'another effect');
  assert.equal(added.doc.nodes.find(n => n.id === added.id).group, 'inner');
  assert.equal(connectionOf(added.doc, 'ab').outputs.includes(added.id), true);
  assert.equal(addEffect(merge, 'ab'), null);
  const batch = linkEach(base, [{from: 'ab', fromType: 'edge', to: {type: 'node', id: 'c'}}, {from: 'ab', fromType: 'edge', to: {type: 'node', id: 'd'}}, {from: 'ab', fromType: 'edge', to: {type: 'node', id: 'd'}}]);
  assert.equal(batch.made, 2); assert.equal(batch.problems.length, 1);
  assert.deepEqual(connectionOf(batch.doc, 'ab').outputs, ['b', 'c', 'd']);
  const cyclic = normalizeDoc({...base, edges: [...base.edges, {id: 'ca', from: 'c', to: 'a'}]});
  assert.ok('doc' in linkFromEdge(cyclic, 'ab', 'c'), 'node cycles remain permitted like ordinary links');
  assert.deepEqual(normalizeDoc(JSON.parse(JSON.stringify(fork))).edges, fork.edges);
  assert.equal(normalizeDoc(JSON.parse(JSON.stringify(fork))).junctions[0].kind, 'fork');
  const legacy = normalizeDoc({...merge, junctions: merge.junctions.map(({id}) => ({id}))});
  assert.equal(legacy.junctions[0].kind, 'merge');
  assert.deepEqual(connectionOf(legacy, 'ab').inputs, ['a', 'c']);
  assert.equal(normalizeDoc({...fork, edges: fork.edges.filter(e => e.id !== 'ab')}).junctions.length, 0);
  const planOut = await build({entryPoints: [fileURLToPath(new URL('../src/plan.ts', import.meta.url))], bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'error'});
  const {plan} = await import('data:text/javascript;base64,' + Buffer.from(planOut.outputFiles[0].text).toString('base64'));
  const p = plan(fork);
  assert.equal(p.junctionCount, 1);
  assert.equal(p.carriers[0].edge, 'ab');
  assert.equal(p.carriers[0].text, 'shared');
  assert.equal(p.carriers[0].group, 'inner');
  assert.equal(p.arrow.has('ab'), false, 'incoming fork trunk ends at the junction without an arrow');
  assert.deepEqual([...p.arrow].sort(), c.branches.map(b => b.id).sort());
  assert.equal(plan(fork, {edge: first.edge, text: 'draft'}).carriers[0].text, 'draft');
  assert.equal(plan({...fork, groups: fork.groups.map(g => ({...g, collapsed: true}))}).carriers[0].group, 'inner');
  console.log('model: shared forks preserve trunk labels, merge migration, deletion, split/dissolve, nested groups, batch links and engine carriers');
}

console.log(failures ? `model: ${failures} failing documents` : `model: ${count} random documents tidied correctly; selection levels and multi-links hold`);
process.exit(failures ? 1 : 0);
