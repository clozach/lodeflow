// What the engine lays out for a document. Nodes go in as they are. Each junction goes in as a
// small node of its own (a dot, or its merge's shared label), so branches meet at one point.
// A plain edge's label goes in as a size on the edge: the engine hangs it on the edge's middle
// bend point, lengthening a one-rank edge to two, and keeps it clear of everything else.
// Junction dots and labels are both drawn as *carriers*.

import * as M from './model';
import type { FlowDoc } from './model';

export interface Carrier {
  /** `j:<junction id>` or `l:<edge id>`. */
  key: string;
  kind: 'junction' | 'label';
  /** The edge whose label this carrier shows (a merge's trunk, or the labelled plain edge). */
  edge: string;
  /** Label text, or null for a bare junction dot. */
  text: string | null;
  /** Deepest group holding every end (junctions only: labels follow their edge). */
  group: string | null;
}

export interface EnginePart {
  src: number;
  dst: number;
  backHint: boolean;
  /** Carrier key of the label this part carries, if any. */
  label: string | null;
}

export interface Plan {
  /** Engine vertex index for each node id and junction key. */
  index: Map<string, number>;
  nodeCount: number;
  /** Every carrier: junctions first (engine vertices nodeCount + i), then edge labels. */
  carriers: Carrier[];
  junctionCount: number;
  parts: EnginePart[];
  /** Doc edge id → its engine part. */
  partOf: Map<string, number>;
  /** Doc edge ids that end in an arrowhead (all but merge branches). */
  arrow: Set<string>;
  /** Doc edge id → the carrier it runs through or into, if any. */
  carrierOf: Map<string, string>;
}

export const junctionKey = (id: string) => `j:${id}`;
export const labelKey = (id: string) => `l:${id}`;

/**
 * @param draft An edge whose label is being written: it gets a carrier even while empty, with this text.
 */
export function plan(doc: FlowDoc, draft: { edge: string; text: string } | null = null): Plan {
  const index = new Map<string, number>();
  doc.nodes.forEach((n, i) => index.set(n.id, i));
  const nodeCount = doc.nodes.length;
  const groupOf = (id: string) => M.nodeById(doc, id)?.group ?? null;
  // Draft of a branch's label writes the merge's shared label.
  if (draft) {
    const c = M.connectionOf(doc, draft.edge);
    draft = c ? { edge: c.trunk.id, text: draft.text } : null;
  }
  const textFor = (edgeId: string, stored: string | undefined) => {
    if (draft && draft.edge === edgeId) return draft.text;
    return stored && stored.trim() ? stored : null;
  };
  const carriers: Carrier[] = [];
  const carrierOf = new Map<string, string>();
  for (const j of doc.junctions) {
    const trunk = doc.edges.find((e) => e.from === j.id);
    if (!trunk) continue;
    const ends = [...doc.edges.filter((e) => e.to === j.id).map((e) => e.from), trunk.to];
    const key = junctionKey(j.id);
    index.set(key, nodeCount + carriers.length);
    carriers.push({ key, kind: 'junction', edge: trunk.id, text: textFor(trunk.id, trunk.label), group: M.commonGroup(doc, ends.map(groupOf)) });
  }
  const junctionCount = carriers.length;
  const parts: EnginePart[] = [];
  const partOf = new Map<string, number>();
  const arrow = new Set<string>();
  const vertex = (id: string) => (M.isJunction(doc, id) ? index.get(junctionKey(id)) : index.get(id)) ?? -1;
  for (const e of doc.edges) {
    const toJ = M.isJunction(doc, e.to);
    const fromJ = M.isJunction(doc, e.from);
    if (!toJ) arrow.add(e.id);
    if (toJ) carrierOf.set(e.id, junctionKey(e.to));
    if (fromJ) carrierOf.set(e.id, junctionKey(e.from));
    let label: string | null = null;
    const text = !toJ && !fromJ ? textFor(e.id, e.label) : null;
    if (text !== null) {
      label = labelKey(e.id);
      carriers.push({ key: label, kind: 'label', edge: e.id, text, group: null });
      carrierOf.set(e.id, label);
    }
    partOf.set(e.id, parts.length);
    parts.push({ src: vertex(e.from), dst: vertex(e.to), backHint: !!e.back, label });
  }
  return { index, nodeCount, carriers, junctionCount, parts, partOf, arrow, carrierOf };
}
