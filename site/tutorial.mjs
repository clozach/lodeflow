// The tutorial observes public editor state; its examples are plain document changes.
export const storageKey = 'public-tutorial-v2';
export const appearanceKey = 'lodeflow-tutorial:appearance:v1';
export const progressKey = 'lodeflow-tutorial:progress:v2';
export const seed = { nodes: [], edges: [], groups: [], junctions: [], settings: { orientation: 'auto', bias: 'start', compactness: 'comfortable', tightGroups: true, untangle: true } };
export const levels = [
  { title: 'Connect ideas', steps: [
    ['rename', 'Rename your node', 'Click the node again, type new words, then press Enter.', 'Tap the node again, type new words, then tap outside it.'],
    ['linked', 'Add a linked node', 'Select a node, press N, type its words, then press Enter.', 'Select a node, tap Add node, type its words, then tap outside it.'],
    ['free', 'Add a free node', 'Double-click empty space, type its words, then press Enter.', 'Tap empty space to deselect, tap Add node, then type its words.'],
    ['link', 'Connect the free node', 'Drag from the free node to another node. Or select it, press E and choose a target.', 'Select the free node, tap Link, then tap a target in the list.'],
  ] },
  { title: 'Shape the diagram', steps: [
    ['label', 'Label an arrow', 'Click an arrow twice, type its label, then press Enter.', 'Tap an arrow twice, type its label, then tap outside it.'],
    ['insert', 'Insert a node in an arrow', 'Select an arrow, press N, type the new node’s words, then press Enter.', 'Select an arrow, tap Insert node, type its words, then tap outside it.'],
    ['group', 'Group two nodes', 'Click one node, Shift-click a second, press G, name the group, then press Enter.', 'Touch can select one node at a time. Tap this step to group an example pair.'],
    ['collapse', 'Collapse the group', 'Select the group and press C, or click its folding arrow.', 'Tap the group’s folding arrow, or select the group and tap Collapse.'],
  ] },
  { title: 'Explore and undo', steps: [
    ['expand', 'Expand the group', 'Click the folded group’s arrow, or select it and press C.', 'Tap the folded group’s arrow, or select it and tap Expand.'],
    ['dive', 'Select what is inside', 'Select the group and press J, or click Dive on its controls.', 'Select the group and tap Dive on its controls.'],
    ['undo', 'Undo your last action', 'Click Undo in the diagram’s menu, or press Ctrl/⌘ Z.', 'Tap Undo in the diagram’s menu.'],
    ['redo', 'Bring the action back', 'Click Redo in the diagram’s menu, or press Ctrl/⌘ Shift Z.', 'Tap Redo in the diagram’s menu.'],
  ] },
];
export const steps = levels.flatMap((level, levelIndex) => level.steps.map(([id, title, desktop, touch], index) => ({ id, title, desktop, touch, level: levelIndex, index: levelIndex * 4 + index })));
export const countItems = (doc) => ['nodes', 'edges', 'groups', 'junctions'].reduce((n, key) => n + (doc[key]?.length || 0), 0);
export const validReached = (value) => Number.isInteger(value) && value >= -1 && value <= steps.length;
export const lastEntry = (state) => state?.history?.entries?.[state.history.index - 1];
export const entryKey = (entry) => entry ? `${entry.t}:${entry.kind}:${entry.label}` : '';
const documentAt = (history, snapshot) => typeof snapshot?.doc === 'number' ? history.docs[snapshot.doc] : snapshot?.doc;

export function observe(reached, before, state) {
  if (reached < 0) return state.doc.nodes.length ? 0 : -1;
  if (reached >= steps.length) return reached;
  const entry = lastEntry(state), old = documentAt(state.history, entry?.before);
  const doc = state.doc, added = doc.nodes.filter((node) => !old?.nodes.some((item) => item.id === node.id));
  const changed = entryKey(entry) !== entryKey(lastEntry(before)) || JSON.stringify(before?.doc) !== JSON.stringify(doc);
  const group = doc.groups.find((item) => old?.groups.some((prior) => prior.id === item.id && !!prior.collapsed !== !!item.collapsed));
  const tests = {
    rename: () => changed && entry?.kind === 'edit' && doc.nodes.some((node) => node.text.trim() && old?.nodes.some((prior) => prior.id === node.id && prior.text !== node.text)),
    linked: () => entry?.kind === 'add' && added.some((node) => node.text.trim() && doc.edges.some((edge) => edge.to === node.id && old?.nodes.some((prior) => prior.id === edge.from))),
    free: () => entry?.kind === 'add' && added.some((node) => node.text.trim() && !doc.edges.some((edge) => edge.from === node.id || edge.to === node.id)),
    link: () => changed && entry?.kind === 'link' && doc.edges.length > (old?.edges.length || 0),
    label: () => changed && entry?.kind === 'edit' && doc.edges.some((edge) => edge.label?.trim() && old?.edges.some((prior) => prior.id === edge.id && prior.label !== edge.label)),
    insert: () => entry?.kind === 'add' && added.some((node) => node.text.trim()) && doc.edges.length > (old?.edges.length || 0) && old?.edges.some((edge) => doc.edges.some((next) => next.id === edge.id && next.to !== edge.to)),
    group: () => entry?.kind === 'group' && doc.groups.some((item) => item.text.trim() && !old?.groups.some((prior) => prior.id === item.id) && doc.nodes.filter((node) => node.group === item.id).length >= 2),
    collapse: () => changed && entry?.kind === 'collapse' && group?.collapsed === true,
    expand: () => changed && entry?.kind === 'collapse' && group?.collapsed === false,
    dive: () => changed && entry?.kind === 'select' && doc.groups.some((item) => doc.nodes.some((node) => node.group === item.id) && doc.nodes.filter((node) => node.group === item.id).every((node) => state.view.sel.includes(node.id))),
    undo: () => entryKey(state.history.entries[state.history.index]) === entryKey(lastEntry(before)) && entryKey(lastEntry(before)) !== '',
    redo: () => entryKey(before?.history?.entries[before.history.index]) === entryKey(entry) && entryKey(entry) !== '',
  };
  return tests[steps[reached].id]() ? reached + 1 : reached;
}

export function recover(state) {
  let reached = -1, before = { doc: seed, history: { entries: [], index: 0 }, view: { sel: [] } };
  for (let index = 0; index < (state.history?.index || 0); index++) {
    const entry = state.history.entries[index];
    const current = { doc: documentAt(state.history, entry.after), history: { ...state.history, index: index + 1 }, view: entry.after.view };
    reached = observe(reached, before, current);
    before = current;
  }
  return reached < 0 && state.doc.nodes.length ? 0 : reached;
}

export function guideDocument(reached, shownLevels, openLevels = new Set(), touch = false) {
  const nodes = [], edges = [], groups = [];
  for (const step of steps.filter((item) => item.level < shownLevels)) {
    const done = step.index < reached, current = step.index === reached;
    const cue = done ? '✓' : current ? '→' : '🔒';
    const action = done ? `${touch ? 'Tap' : 'Click'} to replay this example.` : current ? `${touch ? 'Tap' : 'Click'} this step for an example.` : 'Complete the previous step first.';
    const node = { id: step.id, text: `${cue} ${step.index + 1}. ${step.title}\n${touch ? step.touch : step.desktop}\n${action}` };
    if (reached >= (step.level + 1) * 4) node.group = `level-${step.level}`;
    nodes.push(node);
    if (step.index) edges.push({ id: `step-${step.index}`, from: steps[step.index - 1].id, to: step.id });
  }
  for (let index = 0; index < shownLevels; index++) {
    if (reached >= (index + 1) * 4) groups.push({ id: `level-${index}`, text: `✓ Level ${index + 1}: ${levels[index].title}\n${touch ? 'Tap' : 'Click'} to replay`, collapsed: !openLevels.has(index) });
  }
  return { nodes, edges, groups, junctions: [], settings: { orientation: 'lr', compactness: 'compact', bias: 'start', tightGroups: true, untangle: false } };
}

// Each clicked example repairs only the prerequisites its own action needs.
export function example(doc, id) {
  const next = structuredClone(doc);
  const unique = (prefix) => { let number = 1; while (['nodes', 'edges', 'groups', 'junctions'].some((key) => next[key].some((item) => item.id === `${prefix}-${number}`))) number++; return `${prefix}-${number}`; };
  const node = (text) => { const item = { id: unique('example-node'), text }; next.nodes.push(item); return item; };
  const edge = (from, to) => { const item = { id: unique('example-edge'), from, to }; next.edges.push(item); return item; };
  const origin = next.nodes[0] || node('My first idea');
  if (id === 'rename') { origin.text = 'My first idea'; return next; }
  if (id === 'free' || id === 'link') {
    let free = next.nodes.find((item) => item.id !== origin.id && !next.edges.some((arrow) => arrow.from === item.id || arrow.to === item.id));
    if (id === 'link' && !free) free = next.nodes.find((item) => item.id !== origin.id && next.edges.some((arrow) => arrow.from === item.id && arrow.to === origin.id));
    if (!free) free = node('A different idea');
    if (id === 'link' && !next.edges.some((arrow) => arrow.from === free.id && arrow.to === origin.id)) edge(free.id, origin.id);
    return next;
  }
  let linked = next.nodes.find((item) => next.edges.some((arrow) => arrow.from === origin.id && arrow.to === item.id));
  if (!linked) { linked = next.nodes[1] || node('A next step'); edge(origin.id, linked.id); }
  if (id === 'linked') return next;
  const arrow = next.edges.find((item) => item.from === origin.id && item.to === linked.id);
  if (id === 'label') { arrow.label = 'leads to'; return next; }
  if (id === 'insert') { const middle = node('One smaller step'); const target = arrow.to; arrow.to = middle.id; edge(middle.id, target); return next; }
  let group = next.groups.find((item) => origin.group === item.id && linked.group === item.id);
  if (!group) { group = { id: unique('example-group'), text: 'Ideas together', collapsed: false }; next.groups.push(group); origin.group = group.id; linked.group = group.id; }
  if (id === 'collapse') group.collapsed = true;
  if (id === 'expand' || id === 'dive') group.collapsed = false;
  return next;
}
