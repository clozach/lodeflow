// Loose edges and copy/paste fragments, in Node, no browser.
//   node test/loose.mjs
// Bundles src/model.ts and src/clipboard.ts in memory with esbuild.
import { build } from 'esbuild';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const load = async (file) => {
  const out = await build({ entryPoints: [fileURLToPath(new URL(`../src/${file}`, import.meta.url))], bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'error' });
  return import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));
};
const M = await load('model.ts');
const C = await load('clipboard.ts');
const { countItems } = await load('item-limit.ts');

let passed = 0;
const check = (name, fn) => {
  try { fn(); passed++; } catch (e) { console.error(`✗ ${name}\n${e.stack}`); process.exitCode = 1; }
};
const base = () => M.normalizeDoc({
  groups: [{ id: 'g', text: 'Group' }],
  nodes: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B', group: 'g' }, { id: 'c', text: 'C', group: 'g' }, { id: 'd', text: 'D' }],
  edges: [{ id: 'ab', from: 'a', to: 'b', label: 'leads' }, { id: 'bc', from: 'b', to: 'c' }, { id: 'cd', from: 'c', to: 'd' }],
});

check('normalize keeps edges with left-out ends as loose edges', () => {
  const d = M.normalizeDoc({ nodes: [{ id: 'a', text: 'A' }], edges: [{ id: 'x', label: 'relates to' }, { id: 'y', from: 'a', label: 'half' }, { id: 'z', from: 'a', to: 'missing' }] });
  assert.deepEqual(d.edges, [], 'an end naming something missing is still dropped');
  assert.deepEqual(d.loose, [{ id: 'x', label: 'relates to' }, { id: 'y', from: 'a', label: 'half' }]);
});
check('normalize leaves documents without loose edges as they were', () => {
  assert.equal('loose' in base(), false);
  assert.equal('loose' in M.normalizeDoc({ nodes: [], edges: [], loose: [] }), false);
});
check('normalize turns a loose edge with both ends into an edge, unless it would duplicate or self-link', () => {
  const d = M.normalizeDoc({ nodes: [{ id: 'a', text: '' }, { id: 'b', text: '' }], edges: [{ id: 'ab', from: 'a', to: 'b' }], loose: [{ id: 'l1', from: 'b', to: 'a', label: 'back' }, { id: 'l2', from: 'a', to: 'b' }, { id: 'l3', from: 'a', to: 'a' }] });
  assert.deepEqual(d.edges.map((e) => [e.id, e.from, e.to]), [['ab', 'a', 'b'], ['l1', 'b', 'a']]);
  assert.deepEqual(d.loose, [{ id: 'l2', from: 'a' }, { id: 'l3', from: 'a' }]);
});
check('a free loose edge keeps its group; an attached one follows its node', () => {
  const d = M.normalizeDoc({ groups: [{ id: 'g', text: '' }], nodes: [{ id: 'a', text: '' }], loose: [{ id: 'f', group: 'g' }, { id: 'h', from: 'a', group: 'g' }] });
  assert.deepEqual(d.loose, [{ id: 'f', group: 'g' }, { id: 'h', from: 'a' }]);
  assert.equal(M.parentOf(d, 'f'), 'g');
  assert.deepEqual(M.childrenOf(d, 'g'), ['f']);
});
check('addLoose starts labelled ‘relates to’ and attaches to a node when asked', () => {
  const r1 = M.addLoose(base());
  assert.deepEqual(M.looseById(r1.doc, r1.id), { id: r1.id, label: 'relates to' });
  const r2 = M.addLoose(base(), { from: 'a' });
  assert.equal(M.looseById(r2.doc, r2.id).from, 'a');
  const r3 = M.addLoose(base(), { to: 'd' }, '');
  assert.deepEqual(M.looseById(r3.doc, r3.id), { id: r3.id, to: 'd' });
});
check('attaching both ends makes an ordinary edge that keeps the id and label', () => {
  let { doc, id } = M.addLoose(base());
  let r = M.attachLoose(doc, id, 'd');
  assert.ok(!('error' in r));
  assert.equal(M.looseById(r.doc, id).to, 'd', 'the head goes first when both are free');
  r = M.attachLoose(r.doc, id, 'a');
  assert.ok(!('error' in r));
  assert.equal(M.looseById(r.doc, id), undefined);
  assert.deepEqual(M.edgeById(r.doc, id), { id, from: 'a', to: 'd', label: 'relates to' });
  assert.equal('loose' in r.doc, false);
});
check('attaching refuses self-links, duplicates and taken ends', () => {
  const { doc, id } = M.addLoose(base(), { from: 'a' });
  assert.equal(M.attachProblem(doc, id, 'a'), 'A node cannot link to itself');
  assert.equal(M.attachProblem(doc, id, 'b'), 'Already linked');
  assert.equal(M.attachProblem(doc, id, 'c', 'from'), 'This edge already has a cause');
  assert.equal(M.attachProblem(doc, id, 'c', 'to'), null);
});
check('deleting a node removes loose edges hanging from it; deleting a group removes free ones inside', () => {
  let d = M.addLoose(base(), { from: 'a' }).doc;
  d = M.addLoose(d, { group: 'g' }).doc;
  d = M.addLoose(d).doc;
  const r = M.deleteItems(d, ['a', 'g']);
  assert.equal(M.looseOf(r.doc).length, 1);
  assert.equal(r.edges, 0, 'like ordinary edges, ones that go with a node are not counted');
  const free = M.looseOf(r.doc)[0].id;
  assert.equal(M.deleteItems(r.doc, [free]).edges, 1, 'a selected loose edge counts');
});
check('labels, grouping and ungrouping include free loose edges', () => {
  const { doc, id } = M.addLoose(base());
  assert.equal(M.looseById(M.setLooseLabel(doc, id, ''), id).label, undefined);
  const g = M.groupItems(doc, [id, 'a']);
  assert.equal(M.looseById(g.doc, id).group, g.id);
  assert.equal(M.looseById(M.ungroup(g.doc, g.id), id).group, null);
});
check('linkEach attaches loose edges', () => {
  const { doc, id } = M.addLoose(base());
  const r = M.linkEach(doc, [{ from: 'a', to: { type: 'edge', id } }, { from: id, fromType: 'edge', to: { type: 'node', id: 'd' } }]);
  assert.equal(r.made, 2);
  assert.deepEqual(M.edgeById(r.doc, id), { id, from: 'a', to: 'd', label: 'relates to' });
});
check('the item limit counts loose edges', () => {
  assert.equal(countItems(M.addLoose(base()).doc), countItems(base()) + 1);
});

check('copying nodes brings the edges between them and groups whose contents all come', () => {
  const f = C.copyFragment(base(), ['b', 'c']);
  assert.deepEqual(f.nodes.map((n) => [n.id, n.group]), [['b', 'g'], ['c', 'g']]);
  assert.deepEqual(f.groups.map((g) => g.id), ['g']);
  assert.deepEqual(f.edges.map((e) => e.id), ['bc']);
  assert.deepEqual(f.loose, []);
});
check('a copied edge whose ends stay behind becomes a loose edge with its label', () => {
  const f = C.copyFragment(base(), ['ab']);
  assert.deepEqual(f.loose.map(({ id: _id, ...l }) => l), [{ label: 'leads' }]);
  const g = C.copyFragment(base(), ['a', 'ab']);
  assert.deepEqual(g.loose.map(({ id: _id, ...l }) => l), [{ from: 'a', label: 'leads' }]);
});
check('a merge keeps the causes that came along', () => {
  let d = base();
  d = M.linkToEdge(d, 'd', 'bc').doc;
  const all = C.copyFragment(d, ['b', 'd', 'c']);
  assert.equal(all.junctions.length, 1);
  const some = C.copyFragment(d, ['b', 'c']);
  assert.equal(some.junctions.length, 0);
  assert.deepEqual(some.edges.map((e) => [e.from, e.to]), [['b', 'c']]);
});
check('pasting gives fresh ids, keeps structure, lands in a group and selects the top level', () => {
  const doc = base();
  const f = C.copyFragment(doc, ['g']);
  const r = C.pasteFragment(doc, f);
  assert.equal(r.doc.nodes.length, 6);
  assert.equal(r.doc.groups.length, 2);
  assert.equal(r.ids.length, 1, 'the pasted group is the top-level item');
  const g2 = r.ids[0];
  assert.notEqual(g2, 'g');
  assert.deepEqual(r.doc.nodes.slice(4).map((n) => n.group), [g2, g2]);
  assert.equal(r.doc.edges.length, 4);
  const into = C.pasteFragment(doc, C.copyFragment(doc, ['a']), 'g');
  assert.equal(M.nodeById(into.doc, into.ids[0]).group, 'g');
  const twice = C.pasteFragment(r.doc, f);
  assert.equal(new Set(twice.doc.nodes.map((n) => n.id)).size, 8, 'pasting again never reuses an id');
});
check('fragments round-trip through clipboard text', () => {
  let d = M.addLoose(base(), { from: 'a' }).doc;
  const f = C.copyFragment(d, ['a', 'b', 'ab']);
  const back = C.decodeFragment(C.encodeFragment(f));
  assert.deepEqual(back.nodes, f.nodes);
  assert.deepEqual(back.loose.map((l) => l.from), f.loose.map((l) => l.from));
  assert.equal(C.decodeFragment('{"kind":"other"}'), null);
  assert.equal(C.decodeFragment('not json'), null);
  assert.match(C.fragmentText(f), /^A\nB\nA → B \(leads\)/);
});
check('plain text pastes as one node per line, and only within the cap', () => {
  assert.deepEqual(C.textFragment(' one \n\n two ').nodes.map((n) => n.text), ['one', 'two']);
  assert.equal(C.textFragment(''), null);
  assert.equal(C.textFragment(Array(51).fill('x').join('\n')), null);
});
check('copying a group brings the free loose edges inside it', () => {
  const d = M.normalizeDoc({ groups: [{ id: 'g', text: 'Box' }], nodes: [{ id: 'n', text: 'Inside', group: 'g' }], loose: [{ id: 'x', label: 'relates to', group: 'g' }] });
  const f = C.copyFragment(d, ['g']);
  assert.deepEqual(f.loose.map((l) => [l.label, l.group]), [['relates to', 'g']]);
  const r = C.pasteFragment(M.emptyDoc(), f);
  assert.equal(M.looseOf(r.doc)[0].group, r.doc.groups[0].id);
});
check('groups holding only loose edges or nothing come along when everything else does', () => {
  const nested = M.normalizeDoc({ groups: [{ id: 'o', text: 'Outer' }, { id: 'e', text: 'Empty', parent: 'o' }], nodes: [{ id: 'a', text: '', group: 'o' }, { id: 'b', text: '', group: 'o' }] });
  assert.deepEqual(C.copyFragment(nested, ['a', 'b']).groups.map((g) => g.id).sort(), ['e', 'o']);
  const box = M.normalizeDoc({ groups: [{ id: 'g', text: 'Box' }], nodes: [{ id: 'a', text: '' }], loose: [{ id: 'x', group: 'g' }] });
  const f = C.copyFragment(box, ['a', 'x']);
  assert.deepEqual(f.groups.map((g) => g.id), ['g']);
  assert.equal(f.loose[0].group, 'g');
  assert.deepEqual(C.copyFragment(box, ['a']).groups, [], 'a group whose arrow stays behind stays too');
});
check('dissolving a node removes the loose edges hanging from it', () => {
  const d = M.normalizeDoc({ nodes: [{ id: 'a', text: '' }, { id: 'b', text: '' }, { id: 'c', text: '' }], edges: [{ id: 'ab', from: 'a', to: 'b' }, { id: 'bc', from: 'b', to: 'c' }], loose: [{ id: 'x', from: 'b' }] });
  const r = M.dissolveNode(d, 'b');
  assert.deepEqual(r.edges.map((e) => [e.from, e.to]), [['a', 'c']]);
  assert.equal(M.looseOf(r).length, 0);
});
check('several link-list picks from a loose edge give it effects, never a cause', () => {
  const { doc, id } = M.addLoose(base());
  const r = M.linkEach(doc, [{ from: id, fromType: 'edge', to: { type: 'node', id: 'b' } }, { from: id, fromType: 'edge', to: { type: 'node', id: 'c' } }]);
  assert.equal(M.looseById(r.doc, id).to, 'b');
  assert.equal(M.looseById(r.doc, id).from, undefined);
  assert.equal(r.made, 1);
});
check('a folded group counts the free loose edges inside it', () => {
  const d = M.normalizeDoc({ groups: [{ id: 'g', text: 'G' }, { id: 'h', text: 'H', parent: 'g' }], nodes: [{ id: 'a', text: '', group: 'g' }], loose: [{ id: 'x', group: 'h' }, { id: 'y', from: 'a' }] });
  assert.deepEqual(M.groupCounts(d, 'g'), { nodes: 1, groups: 1, loose: 1 }, 'a hanging edge belongs with its node');
  assert.deepEqual(M.groupCounts(d, 'h'), { nodes: 0, groups: 0, loose: 1 });
});
check('a value whose toString throws becomes empty text, on load and in a pasted fragment', () => {
  const d = M.normalizeDoc({ nodes: [{ id: 'q', text: { toString: 1 } }] });
  assert.equal(d.nodes[0].text, '');
  const f = C.decodeFragment(JSON.stringify({ kind: 'lodeflow-fragment', nodes: [{ id: { toString: 1, valueOf: 2 }, text: 'x' }] }));
  assert.ok(f === null || Array.isArray(f.nodes), 'never throws');
});
check('plain text: up to 50 lines paste, more are refused with the count known', () => {
  const text = (n) => Array.from({ length: n }, (_, i) => `line ${i}`).join('\n');
  assert.equal(C.textFragment(text(50)).nodes.length, 50);
  assert.equal(C.textFragment(text(51)), null);
  assert.equal(C.textLines(text(51) + '\n\n  \n').length, 51);
  assert.equal(C.TEXT_LINES, 50);
});
check('copying nothing gives nothing', () => {
  assert.equal(C.copyFragment(base(), []), null);
  assert.equal(C.pasteFragment(base(), { nodes: [], edges: [], junctions: [], groups: [], loose: [] }), null);
});

console.log(process.exitCode ? `loose: ${passed} passed, some failed` : `✓ loose: ${passed} loose-edge and copy/paste model checks`);
