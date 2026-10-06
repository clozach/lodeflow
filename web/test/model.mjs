// Document-model properties on random (often malformed) documents, in Node, no browser.
//   node test/model.mjs [count]        (MODEL=<path to model.ts> checks another copy)
// Bundles src/model.ts in memory with esbuild, then checks that tidyJunctions never leaves an edge
// pointing at nothing and that every junction it keeps is a real merge (two or more branches, one
// trunk), on documents with chained, cyclic, branchless and trunkless junctions.
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const entry = process.env.MODEL || fileURLToPath(new URL('../src/model.ts', import.meta.url));
const out = await build({ entryPoints: [entry], bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'error' });
const { tidyJunctions, dissolveNode, normalizeDoc, dive, divePlan, surface, depthOf, parentOf, addLinkedTo, linkEach, commonGroup } = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));

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
  const junctions = Array.from({ length: 1 + Math.floor(rnd() * 4) }, (_, i) => ({ id: `j${i}` }));
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
    const branches = tidy.edges.filter((e) => e.to === j.id).length;
    const trunks = tidy.edges.filter((e) => e.from === j.id).length;
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
  const junctions = Array.from({ length: Math.floor(rnd() * 3) }, (_, i) => ({ id: `j${i}` }));
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
      const b = d.edges.filter((e) => e.to === j.id).length;
      const tr = d.edges.filter((e) => e.from === j.id).length;
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

console.log(failures ? `model: ${failures} failing documents` : `model: ${count} random documents tidied correctly; selection levels and multi-links hold`);
process.exit(failures ? 1 : 0);
