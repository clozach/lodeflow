// Hand-built diagrams with awkward shapes, for the stress page and the perf tests.
// Plain JavaScript with no imports, so a page can inline it. Each shape: { label, why, build() → document }.

const S = (orientation = 'auto') => ({ orientation, bias: 'start', compactness: 'comfortable', incremental: false, tightGroups: true, untangle: true });
const node = (i, text, group) => (group ? { id: `n${i}`, text: text ?? `Step ${i + 1}`, group } : { id: `n${i}`, text: text ?? `Step ${i + 1}` });

export const SHAPES = [
  {
    label: 'Hub with 150 effects',
    why: 'One node causing 150 others: a very wide rank and 150 ports on one side.',
    build: () => ({
      nodes: Array.from({ length: 151 }, (_, i) => node(i, i ? `Effect ${i}` : 'The hub')),
      edges: Array.from({ length: 150 }, (_, i) => ({ from: 'n0', to: `n${i + 1}` })),
      settings: S(),
    }),
  },
  {
    label: 'Hub with 150 causes',
    why: 'The same, pointing in.',
    build: () => ({
      nodes: Array.from({ length: 151 }, (_, i) => node(i, i ? `Cause ${i}` : 'The hub')),
      edges: Array.from({ length: 150 }, (_, i) => ({ from: `n${i + 1}`, to: 'n0' })),
      settings: S(),
    }),
  },
  {
    label: '15 × 15, everything to everything',
    why: 'A complete bipartite graph: 225 edges between two ranks, the worst case for crossings.',
    build: () => ({
      nodes: Array.from({ length: 30 }, (_, i) => node(i, i < 15 ? `Cause ${i + 1}` : `Effect ${i - 14}`)),
      edges: Array.from({ length: 225 }, (_, k) => ({ from: `n${Math.floor(k / 15)}`, to: `n${15 + (k % 15)}` })),
      settings: S(),
    }),
  },
  {
    label: 'A chain of 300',
    why: 'Very long and thin: 300 ranks.',
    build: () => ({
      nodes: Array.from({ length: 300 }, (_, i) => node(i)),
      edges: Array.from({ length: 299 }, (_, i) => ({ from: `n${i}`, to: `n${i + 1}` })),
      settings: S(),
    }),
  },
  {
    label: 'Groups nested 10 deep',
    why: 'Ten boxes inside each other, members at every level, linked across levels.',
    build: () => {
      const groups = Array.from({ length: 10 }, (_, g) => ({ id: `g${g}`, text: `Level ${g + 1}`, parent: g ? `g${g - 1}` : null }));
      const nodes = Array.from({ length: 40 }, (_, i) => node(i, null, `g${i % 10}`));
      const edges = [];
      for (let i = 0; i < 39; i++) edges.push({ from: `n${i}`, to: `n${i + 1}` });
      for (let i = 0; i < 30; i += 3) edges.push({ from: `n${i}`, to: `n${i + 7}` });
      return { nodes, edges, groups, settings: S() };
    },
  },
  {
    label: 'Loops everywhere',
    why: 'A 60-node flow where nearly a third of the edges point backwards.',
    build: () => {
      const nodes = Array.from({ length: 60 }, (_, i) => node(i));
      const edges = [];
      for (let i = 0; i < 59; i++) edges.push({ from: `n${i}`, to: `n${i + 1}` });
      for (let i = 5; i < 60; i += 2) edges.push({ from: `n${i}`, to: `n${i - 3 - (i % 4)}` });
      return { nodes, edges, settings: S() };
    },
  },
  {
    label: '120 long labels',
    why: 'Every edge labelled with 30+ characters: labels take rank space and must not overlap.',
    build: () => {
      const nodes = Array.from({ length: 80 }, (_, i) => node(i));
      const edges = [];
      for (let i = 0; i < 80; i++) for (const d of [1, 3]) if (i + d < 80 && edges.length < 120) edges.push({ from: `n${i}`, to: `n${i + d}`, label: `because step ${i + 1} feeds step ${i + d + 1} directly` });
      return { nodes, edges, settings: S() };
    },
  },
  {
    label: 'Merges of ten causes',
    why: 'Twelve junctions, each joining ten causes into one trunk.',
    build: () => {
      const nodes = [];
      const edges = [];
      const junctions = [];
      for (let m = 0; m < 12; m++) {
        const t = nodes.length;
        nodes.push(node(t, `Effect ${m + 1}`));
        junctions.push({ id: `j${m}` });
        edges.push({ from: `j${m}`, to: `n${t}`, label: `together (${m + 1})` });
        for (let c = 0; c < 10; c++) {
          const i = nodes.length;
          nodes.push(node(i, `Cause ${m + 1}.${c + 1}`));
          edges.push({ from: `n${i}`, to: `j${m}` });
        }
        if (m) edges.push({ from: `n${t}`, to: `n${t - 11}` });
      }
      return { nodes, edges, junctions, settings: S() };
    },
  },
  {
    label: 'One very long node',
    why: 'A node holding 500 characters: its height dominates its rank.',
    build: () => ({
      nodes: [node(0, 'Start'), node(1, 'This node holds a long paragraph. '.repeat(15).trim()), node(2, 'End'), node(3, 'Beside')],
      edges: [{ from: 'n0', to: 'n1' }, { from: 'n1', to: 'n2' }, { from: 'n0', to: 'n3' }, { from: 'n3', to: 'n2' }],
      settings: S(),
    }),
  },
  {
    label: 'Radial, 300 nodes',
    why: 'Inner-to-outer rings with a few hundred nodes.',
    build: () => {
      const nodes = Array.from({ length: 300 }, (_, i) => node(i));
      const edges = [];
      for (let i = 1; i < 300; i++) edges.push({ from: `n${Math.floor((i - 1) / 3)}`, to: `n${i}` });
      return { nodes, edges, settings: S('in-out') };
    },
  },
];
