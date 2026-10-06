// Seeded generator of flow-like diagrams for performance tests and the stress page.
// Plain JavaScript with no imports, so a page can inline it (the stress page does).
//
//   generate(n, { seed, family, groups, labels, merges, loops, degree }) → a lodeflow document
//
// family: 'flow' (default: groups, labels, a few merges and loops), 'plain' (nodes and edges only),
//         'dense' (more edges per node), 'deep' (long chains), 'wide' (many sources and sinks).
// Each node links forward to 1–`degree` nodes a short way downstream, so the diagram reads as a flow
// whose length grows with n, like a real cause-and-effect map.

export function generate(n, opts = {}) {
  const family = opts.family || 'flow';
  const preset = {
    flow: { groups: 0.25, labels: 0.15, merges: 0.05, loops: 0.04, degree: 2, reach: 6 },
    plain: { groups: 0, labels: 0, merges: 0, loops: 0.03, degree: 2, reach: 6 },
    dense: { groups: 0.25, labels: 0.1, merges: 0.05, loops: 0.05, degree: 4, reach: 8 },
    deep: { groups: 0.2, labels: 0.1, merges: 0.02, loops: 0.02, degree: 1, reach: 2 },
    wide: { groups: 0.2, labels: 0.1, merges: 0.05, loops: 0.02, degree: 2, reach: Math.max(6, Math.round(n / 4)) },
  }[family] || {};
  const o = { ...preset, ...opts };
  let s = (opts.seed ?? 1) * 2654435761 % 4294967296 || 1;
  const rnd = () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
  const words = ['cost', 'delay', 'scope', 'risk', 'review', 'handoff', 'budget', 'quality', 'focus', 'demand', 'trust', 'rework', 'backlog', 'release', 'support', 'churn', 'hiring', 'morale', 'pricing', 'latency'];
  const verbs = ['rises', 'slips', 'grows', 'falls', 'stalls', 'doubles', 'drifts', 'piles up', 'gets skipped', 'waits'];
  const phrase = () => {
    const k = 1 + Math.floor(rnd() * 3);
    const parts = [];
    for (let i = 0; i < k; i++) parts.push(words[Math.floor(rnd() * words.length)]);
    let t = parts.join(' and ') + ' ' + verbs[Math.floor(rnd() * verbs.length)];
    if (rnd() < 0.25) t += ' because nobody owns the follow-up';
    return t[0].toUpperCase() + t.slice(1);
  };
  const nodes = [];
  const groups = [];
  const ng = o.groups > 0 ? Math.max(1, Math.round(n / 12)) : 0;
  for (let g = 0; g < ng; g++) {
    const parent = g > 0 && rnd() < 0.25 ? `g${Math.floor(rnd() * g)}` : null;
    groups.push({ id: `g${g}`, text: `Area ${g + 1}`, parent });
  }
  for (let i = 0; i < n; i++) {
    const node = { id: `n${i}`, text: phrase() };
    // Group members sit near each other in the flow, as in real diagrams.
    if (ng && rnd() < o.groups) node.group = `g${Math.min(ng - 1, Math.floor((i / n) * ng))}`;
    nodes.push(node);
  }
  const edges = [];
  const have = new Set();
  const add = (a, b, extra = {}) => {
    const k = a + '>' + b;
    if (a === b || have.has(k)) return null;
    have.add(k);
    const e = { id: `e${edges.length}`, from: a, to: b, ...extra };
    edges.push(e);
    return e;
  };
  for (let i = 0; i < n; i++) {
    const k = 1 + Math.floor(rnd() * o.degree);
    for (let j = 0; j < k; j++) {
      const t = i + 1 + Math.floor(rnd() * o.reach);
      if (t < n) add(`n${i}`, `n${t}`, rnd() < o.labels ? { label: words[Math.floor(rnd() * words.length)] } : {});
    }
    if (i > 4 && rnd() < o.loops) add(`n${i}`, `n${i - 1 - Math.floor(rnd() * 4)}`);
  }
  // Merges: another cause joins an existing edge, sharing its trunk.
  const junctions = [];
  const merges = Math.round(n * o.merges);
  for (let m = 0; m < merges && edges.length; m++) {
    const e = edges[Math.floor(rnd() * edges.length)];
    if (!e || e.from.startsWith('j') || e.to.startsWith('j')) continue;
    const to = Number(e.to.slice(1));
    const b = `n${Math.max(0, to - 1 - Math.floor(rnd() * 3))}`;
    if (b === e.from || b === e.to || have.has(b + '>' + e.to)) continue;
    const j = `j${junctions.length}`;
    junctions.push({ id: j });
    const target = e.to;
    e.to = j;
    add(b, j);
    add(j, target, e.label ? { label: e.label } : {});
    if (e.label) delete e.label;
  }
  return {
    nodes,
    edges,
    groups,
    junctions,
    settings: { orientation: opts.orientation || 'auto', bias: opts.bias || 'start', compactness: 'comfortable', incremental: false, tightGroups: true, untangle: true },
  };
}
