// What the engine lays out for a document. Nodes go in as they are. Each junction goes in as a
// small node of its own (a dot, or its connection's shared label), so branches meet at one point.
// A plain edge's label goes in as a size on the edge: the engine hangs it on the edge's middle
// bend point, lengthening a one-rank edge to two, and keeps it clear of everything else.
// Junction dots and labels are both drawn as *carriers*.
// A loose edge free at both ends goes in as a box vertex of its own (drawn as a straight arrow with
// its label in the middle); one hanging from a node goes in as an ordinary part whose free end is
// a zero-size stub vertex. Boxes and stubs are *extras*: engine vertices after the junctions.

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

/** An engine vertex for a loose edge: its box (both ends free) or the stub at its free end. */
export interface Extra {
  /** `b:<loose id>` or `s:<loose id>`. */
  key: string;
  kind: 'box' | 'stub';
  loose: string;
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
  /** Doc edge ids that end in an arrowhead (every edge ending at a node). */
  arrow: Set<string>;
  /** Doc edge id → the carrier it runs through or into, if any. */
  carrierOf: Map<string, string>;
  /** Box and stub vertices, engine vertices nodeCount + junctionCount + i. */
  extras: Extra[];
}

export const junctionKey = (id: string) => `j:${id}`;
export const labelKey = (id: string) => `l:${id}`;
export const boxKey = (id: string) => `b:${id}`;
export const stubKey = (id: string) => `s:${id}`;

/**
 * @param draft An edge whose label is being written: it gets a carrier even while empty, with this text.
 */
export function plan(doc: FlowDoc, draft: { edge: string; text: string } | null = null): Plan {
  const index = new Map<string, number>();
  doc.nodes.forEach((n, i) => index.set(n.id, i));
  const nodeCount = doc.nodes.length;
  const groupOf = (id: string) => M.nodeById(doc, id)?.group ?? null;
  // Draft of a branch's label writes the connection's shared label; a loose edge's is its own.
  if (draft && !M.looseById(doc, draft.edge)) {
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
    const c = M.connectionOf(doc, doc.edges.find((e) => e.from === j.id || e.to === j.id)?.id ?? '');
    if (!c) continue;
    const trunk = c.trunk;
    const ends = [...c.inputs, ...c.outputs];
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
  const extras: Extra[] = [];
  for (const l of M.looseOf(doc)) {
    const key = labelKey(l.id);
    // A free one always has a label element: it sizes the box and gives it something to grab.
    const text = textFor(l.id, l.label);
    const anchor = M.looseAnchor(l);
    const group = anchor ? groupOf(anchor) : l.group ?? null;
    const extra = { key: anchor ? stubKey(l.id) : boxKey(l.id), kind: anchor ? 'stub' as const : 'box' as const, loose: l.id, group };
    index.set(extra.key, nodeCount + junctionCount + extras.length);
    extras.push(extra);
    arrow.add(l.id);
    if (!anchor) {
      carriers.push({ key, kind: 'label', edge: l.id, text: text ?? '', group });
      carrierOf.set(l.id, key);
      continue;
    }
    if (text !== null) {
      carriers.push({ key, kind: 'label', edge: l.id, text, group: null });
      carrierOf.set(l.id, key);
    }
    const stub = index.get(extra.key)!;
    partOf.set(l.id, parts.length);
    parts.push({ src: l.from ? vertex(l.from) : stub, dst: l.to ? vertex(l.to) : stub, backHint: false, label: text !== null ? key : null });
  }
  return { index, nodeCount, carriers, junctionCount, parts, partOf, arrow, carrierOf, extras };
}
