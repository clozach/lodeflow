import { LayoutEngine, EngineInput } from '../src/engine';
function rng(seed: number) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
export function flowGraph(n: number, seed = 1, ng = 0): EngineInput {
  const r = rng(seed);
  const nodes = Array.from({ length: n }, (_, i) => ({ w: 176, h: 38 + Math.floor(r() * 3) * 19, group: ng && r() < 0.25 ? Math.floor((i / n) * ng) : -1 }));
  const edges: EngineInput['edges'] = [];
  for (let i = 0; i < n; i++) {
    const k = 1 + Math.floor(r() * 2);
    for (let j = 0; j < k; j++) { const t = i + 1 + Math.floor(r() * 6); if (t < n) edges.push({ src: i, dst: t }); }
    if (r() < 0.04 && i > 4) edges.push({ src: i, dst: i - 1 - Math.floor(r() * 4) });
  }
  const groups = Array.from({ length: ng }, () => ({ parent: -1, collapsed: false, w: 176, h: 44, header: 22 }));
  return { options: { orientation: 'lr', biasEnd: false, nodeSep: 28, rankSep: 56, edgeSep: 12, groupPad: 14, groupGap: 24, incremental: false, margin: 24 }, nodes, edges, groups };
}
const eng = new LayoutEngine();
for (const [n, ng] of [[30, 2], [100, 4], [300, 8], [1000, 12]] as const) {
  const inp = flowGraph(n, 7, ng);
  eng.layout(inp); // warm
  const reps = n >= 1000 ? 3 : 20;
  const t = performance.now();
  let res;
  for (let i = 0; i < reps; i++) res = eng.layout(inp);
  const ms = (performance.now() - t) / reps;
  console.log(`${process.env.LABEL ?? ''} n=${n} edges=${inp.edges.length} groups=${ng}: ${ms.toFixed(2)} ms/layout · crossings ${res!.crossings} · ranks ${res!.ranks} · ${res!.width.toFixed(0)}×${res!.height.toFixed(0)}`);
}
