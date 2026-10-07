// Document model: plain JSON, updated immutably so history snapshots cost nothing.

export type Orientation = 'auto' | 'lr' | 'rl' | 'tb' | 'bt' | 'in-out' | 'out-in';
export type Bias = 'start' | 'end';
export type Compactness = 'relaxed' | 'comfortable' | 'compact';

export interface FlowNode {
  id: string;
  text: string;
  /** Id of the group this node belongs to. */
  group?: string | null;
}

export interface FlowEdge {
  id: string;
  /** A node id, or a junction id when this edge touches a junction. */
  from: string;
  /** A node id, or a junction id when this edge touches a junction. */
  to: string;
  /** Prefer this edge as the back edge when it closes a loop. */
  back?: boolean;
  /** Text drawn on the edge. Merges and forks keep their shared label on the trunk. */
  label?: string;
}

/**
 * A merge joins several incoming branches into one outgoing trunk; a fork splits one incoming
 * trunk into several outgoing branches. Legacy junctions without kind are merges.
 */
export type FlowJunction = { id: string; kind?: 'merge' } | { id: string; kind: 'fork' };

export interface FlowGroup {
  id: string;
  text: string;
  parent?: string | null;
  collapsed?: boolean;
}

export interface FlowSettings {
  orientation: Orientation;
  bias: Bias;
  compactness: Compactness;
  incremental: boolean;
  /** Tight groups: a group's members with room to move shift toward each other, closing empty bands. */
  tightGroups: boolean;
  /** Untangle: a node with room to move changes rank when that removes crossing lines. */
  untangle: boolean;
}

export interface FlowDoc {
  nodes: FlowNode[];
  edges: FlowEdge[];
  groups: FlowGroup[];
  junctions: FlowJunction[];
  settings: FlowSettings;
}

export const ORIENTATIONS: Orientation[] = ['auto', 'lr', 'tb', 'rl', 'bt', 'in-out', 'out-in'];
export const COMPACTNESS: Compactness[] = ['relaxed', 'comfortable', 'compact'];

export const DEFAULT_SETTINGS: FlowSettings = {
  orientation: 'auto',
  bias: 'start',
  compactness: 'comfortable',
  incremental: false,
  tightGroups: true,
  untangle: true,
};

export function emptyDoc(settings: Partial<FlowSettings> = {}): FlowDoc {
  return { nodes: [], edges: [], groups: [], junctions: [], settings: { ...DEFAULT_SETTINGS, ...settings } };
}

let counter = 0;
export function uid(prefix: string): string {
  counter = (counter + 1) % 1296;
  return prefix + Date.now().toString(36).slice(-5) + counter.toString(36).padStart(2, '0') + Math.random().toString(36).slice(2, 5);
}

function str(v: unknown, dflt = ''): string {
  return typeof v === 'string' ? v : v == null ? dflt : String(v);
}

/** Fills fields added since a document was saved (keeps ids as they are). */
export function withDefaults(doc: FlowDoc): FlowDoc {
  if (Array.isArray(doc.junctions) && typeof doc.settings?.tightGroups === 'boolean' && typeof doc.settings?.untangle === 'boolean') return doc;
  return { ...doc, junctions: Array.isArray(doc.junctions) ? doc.junctions : [], settings: { ...DEFAULT_SETTINGS, ...doc.settings } };
}

/** Accepts loose JSON (missing ids, dangling references) and returns a valid document. */
export function normalizeDoc(raw: unknown, fallback: Partial<FlowSettings> = {}): FlowDoc {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>;
  const used = new Set<string>();
  const fresh = (want: unknown, prefix: string) => {
    let id = str(want).trim();
    if (!id || used.has(id)) id = uid(prefix);
    used.add(id);
    return id;
  };
  const groupsIn: any[] = Array.isArray(r.groups) ? r.groups : [];
  const nodesIn: any[] = Array.isArray(r.nodes) ? r.nodes : [];
  const edgesIn: any[] = Array.isArray(r.edges) ? r.edges : [];
  const groups: FlowGroup[] = groupsIn.map((g) => ({
    id: fresh(g?.id, 'g'),
    text: str(g?.text ?? g?.label ?? g?.title),
    parent: g?.parent == null ? null : str(g.parent),
    collapsed: !!g?.collapsed,
  }));
  const gids = new Set(groups.map((g) => g.id));
  for (const g of groups) if (g.parent && (!gids.has(g.parent) || g.parent === g.id)) g.parent = null;
  // Break parent cycles.
  const byId = new Map(groups.map((g) => [g.id, g]));
  for (const g of groups) {
    const seen = new Set<string>([g.id]);
    let p = g.parent;
    while (p) {
      if (seen.has(p)) {
        g.parent = null;
        break;
      }
      seen.add(p);
      p = byId.get(p)?.parent ?? null;
    }
  }
  const nodes: FlowNode[] = nodesIn.map((n) => {
    const node: FlowNode = { id: fresh(n?.id, 'n'), text: str(n?.text ?? n?.label ?? n?.title) };
    const g = n?.group == null ? null : str(n.group);
    if (g && gids.has(g)) node.group = g;
    return node;
  });
  const nids = new Set(nodes.map((n) => n.id));
  const junctionsIn: any[] = Array.isArray(r.junctions) ? r.junctions : [];
  const junctions: FlowJunction[] = junctionsIn.map((j) => ({ id: fresh(j?.id, 'j'), kind: j?.kind === 'fork' ? 'fork' : 'merge' }));
  const jids = new Set(junctions.map((j) => j.id));
  const edges: FlowEdge[] = [];
  const pairs = new Set<string>();
  for (const e of edgesIn) {
    const from = str(e?.from ?? e?.source);
    const to = str(e?.to ?? e?.target);
    const ok = (id: string) => nids.has(id) || jids.has(id);
    // Junctions connect nodes only: junction → junction is dropped, as are duplicates and self-loops.
    if (!ok(from) || !ok(to) || from === to || (jids.has(from) && jids.has(to)) || pairs.has(from + '\u0000' + to)) continue;
    pairs.add(from + '\u0000' + to);
    const edge: FlowEdge = { id: fresh(e?.id, 'e'), from, to };
    if (e?.back) edge.back = true;
    const lbl = str(e?.label ?? e?.text);
    if (lbl.trim()) edge.label = lbl;
    edges.push(edge);
  }
  const s = (r.settings && typeof r.settings === 'object' ? r.settings : {}) as Record<string, any>;
  const settings: FlowSettings = { ...DEFAULT_SETTINGS, ...fallback };
  if (ORIENTATIONS.includes(s.orientation)) settings.orientation = s.orientation;
  if (s.bias === 'start' || s.bias === 'end') settings.bias = s.bias;
  if (COMPACTNESS.includes(s.compactness)) settings.compactness = s.compactness;
  if (typeof s.incremental === 'boolean') settings.incremental = s.incremental;
  if (typeof s.tightGroups === 'boolean') settings.tightGroups = s.tightGroups;
  if (typeof s.untangle === 'boolean') settings.untangle = s.untangle;
  return tidyJunctions({ nodes, edges, groups, junctions, settings });
}

/**
 * Keeps every junction real: at least two branches and exactly one trunk, with direction set by
 * its kind (legacy missing kind means merge). A junction left
 * with one branch dissolves back into a plain edge (keeping the trunk's id and label); one left
 * with no branches or no trunk goes, with its edges. Linear per pass; repeats until stable. A
 * junction whose edges another junction rewrote in the same pass (a chain of junctions) waits for
 * the next pass, so no edge is rewritten twice from stale ends.
 */
export function tidyJunctions(doc: FlowDoc): FlowDoc {
  if (!doc.junctions.length) return doc;
  let { edges, junctions } = doc;
  for (let pass = 0; pass <= 2 * doc.junctions.length + 1; pass++) {
    const jset = new Set(junctions.map((j) => j.id));
    const ins = new Map<string, FlowEdge[]>();
    const outs = new Map<string, FlowEdge[]>();
    const byPair = new Map<string, FlowEdge>();
    for (const e of edges) {
      if (jset.has(e.to)) (ins.get(e.to) ?? ins.set(e.to, []).get(e.to)!).push(e);
      if (jset.has(e.from)) (outs.get(e.from) ?? outs.set(e.from, []).get(e.from)!).push(e);
      byPair.set(e.from + '\u0000' + e.to, e);
    }
    const drop = new Set<FlowEdge>();
    const swap = new Map<FlowEdge, FlowEdge>();
    const gone = new Set<string>();
    const touched = (e: FlowEdge) => drop.has(e) || swap.has(e);
    // Edges this pass created are not in `edges` yet: a junction that would rely on one waits.
    const created = new Set<FlowEdge>();
    for (const j of junctions) {
      const fork = j.kind === 'fork';
      let i = (fork ? outs : ins).get(j.id) ?? [];
      const o = (fork ? ins : outs).get(j.id) ?? [];
      if (i.some(touched) || o.some(touched)) continue;
      // An imported branch returning to the trunk's own endpoint is a self-link.
      const end = fork ? o[0]?.from : o[0]?.to;
      i = i.filter((e) => {
        if ((fork ? e.to : e.from) !== end) return true;
        drop.add(e);
        return false;
      });
      if (!i.length || !o.length) {
        i.forEach((e) => drop.add(e));
        o.forEach((e) => drop.add(e));
        gone.add(j.id);
        continue;
      }
      o.slice(1).forEach((e) => drop.add(e));
      if (i.length === 1) {
        const [branch] = i;
        const [trunk] = o;
        const from = fork ? trunk.from : branch.from;
        const to = fork ? branch.to : trunk.to;
        const key = from + '\u0000' + to;
        const lbl = trunk.label ?? branch.label;
        const twin = byPair.get(key);
        if (twin && created.has(twin)) continue;
        drop.add(branch);
        if (from === to || twin || swap.has(trunk)) {
          drop.add(trunk);
          if (twin && !twin.label && lbl && !drop.has(twin)) swap.set(twin, { ...(swap.get(twin) ?? twin), label: lbl });
        } else {
          const next: FlowEdge = { id: trunk.id, from, to };
          if (trunk.back || branch.back) next.back = true;
          if (lbl) next.label = lbl;
          swap.set(trunk, next);
          byPair.set(key, next);
          created.add(next);
        }
        gone.add(j.id);
      }
    }
    if (!drop.size && !swap.size && !gone.size) break;
    edges = edges.flatMap((e) => (drop.has(e) ? [] : [swap.get(e) ?? e]));
    junctions = junctions.filter((j) => !gone.has(j.id));
  }
  return edges === doc.edges && junctions === doc.junctions ? doc : { ...doc, edges, junctions };
}

// ---------- queries ----------
// Documents are never changed in place, so each document object gets one lookup index,
// built on first use. Without it, per-item lookups made the link list, group counts and
// merge checks quadratic or worse on large diagrams.

interface DocIndex {
  nodes: Map<string, FlowNode>;
  groups: Map<string, FlowGroup>;
  edges: Map<string, FlowEdge>;
  junctions: Set<string>;
  forks: Set<string>;
  trunk: Map<string, FlowEdge>;
  branches: Map<string, FlowEdge[]>;
  conns: Connection[] | null;
  links: Set<string> | null;
  counts: Map<string, { nodes: number; groups: number }> | null;
}
const indexes = new WeakMap<FlowDoc, DocIndex>();

function indexOf(doc: FlowDoc): DocIndex {
  let ix = indexes.get(doc);
  if (ix) return ix;
  const junctions = new Set(doc.junctions.map((j) => j.id));
  const forks = new Set(doc.junctions.filter((j) => j.kind === 'fork').map((j) => j.id));
  const trunk = new Map<string, FlowEdge>();
  const branches = new Map<string, FlowEdge[]>();
  for (const e of doc.edges) {
    const trunkJ = junctions.has(e.from) && !forks.has(e.from) ? e.from : forks.has(e.to) ? e.to : null;
    const branchJ = junctions.has(e.to) && !forks.has(e.to) ? e.to : forks.has(e.from) ? e.from : null;
    if (trunkJ && !trunk.has(trunkJ)) trunk.set(trunkJ, e);
    if (branchJ) (branches.get(branchJ) ?? branches.set(branchJ, []).get(branchJ)!).push(e);
  }
  ix = {
    nodes: new Map(doc.nodes.map((n) => [n.id, n])),
    groups: new Map(doc.groups.map((g) => [g.id, g])),
    edges: new Map(doc.edges.map((e) => [e.id, e])),
    junctions,
    forks,
    trunk,
    branches,
    conns: null,
    links: null,
    counts: null,
  };
  indexes.set(doc, ix);
  return ix;
}

export function nodeById(doc: FlowDoc, id: string) {
  return indexOf(doc).nodes.get(id);
}

export function groupById(doc: FlowDoc, id: string) {
  return indexOf(doc).groups.get(id);
}

export function edgeById(doc: FlowDoc, id: string) {
  return indexOf(doc).edges.get(id);
}

export function isJunction(doc: FlowDoc, id: string) {
  return indexOf(doc).junctions.has(id);
}

/**
 * One connection as the viewer sees it: a plain edge, a merge, or a fork.
 * `trunk` carries the label; `branches` are empty for a plain edge.
 */
export interface Connection {
  kind: 'plain' | 'merge' | 'fork';
  trunk: FlowEdge;
  junction: string | null;
  branches: FlowEdge[];
  /** Cause node ids, in creation order. */
  inputs: string[];
  /** Effect node ids, in creation order. */
  outputs: string[];
  /** Legacy first effect; use outputs for fork-aware callers. */
  target: string;
}

/** The connection an edge belongs to (a branch or trunk resolves to its whole shared connection). */
export function connectionOf(doc: FlowDoc, edgeId: string): Connection | null {
  const ix = indexOf(doc);
  const e = ix.edges.get(edgeId);
  if (!e) return null;
  const j = ix.junctions.has(e.to) ? e.to : ix.junctions.has(e.from) ? e.from : null;
  if (!j) return { kind: 'plain', trunk: e, junction: null, branches: [], inputs: [e.from], outputs: [e.to], target: e.to };
  const trunk = ix.trunk.get(j);
  if (!trunk) return null;
  const branches = ix.branches.get(j) ?? [];
  const fork = ix.forks.has(j);
  const inputs = fork ? [trunk.from] : branches.map((b) => b.from);
  const outputs = fork ? branches.map((b) => b.to) : [trunk.to];
  return { kind: fork ? 'fork' : 'merge', trunk, junction: j, branches, inputs, outputs, target: outputs[0] };
}

/** Every connection once (plain edges, merges and forks), in creation order of their trunks. */
export function connections(doc: FlowDoc): Connection[] {
  const ix = indexOf(doc);
  if (!ix.conns) {
    ix.conns = [];
    for (const e of doc.edges) {
      const j = ix.junctions.has(e.to) ? e.to : ix.junctions.has(e.from) ? e.from : null;
      if (j && ix.trunk.get(j)?.id !== e.id) continue;
      const c = connectionOf(doc, e.id);
      if (c && c.trunk.id === e.id) ix.conns.push(c);
    }
  }
  return ix.conns;
}

/** True when `from` already causes `to`, directly or through a shared connection. */
export function linked(doc: FlowDoc, from: string, to: string): boolean {
  const ix = indexOf(doc);
  if (!ix.links) {
    ix.links = new Set();
    for (const c of connections(doc)) for (const i of c.inputs) for (const o of c.outputs) ix.links.add(i + '\u0000' + o);
  }
  return ix.links.has(from + '\u0000' + to);
}

/** How many nodes and groups sit inside a group, at any depth (one pass for all groups). */
export function groupCounts(doc: FlowDoc, gid: string): { nodes: number; groups: number } {
  const ix = indexOf(doc);
  if (!ix.counts) {
    const counts = new Map<string, { nodes: number; groups: number }>();
    const bump = (start: string | null | undefined, key: 'nodes' | 'groups') => {
      let cur = start ?? null;
      for (let guard = 0; cur && guard < 1000; guard++) {
        const c = counts.get(cur) ?? counts.set(cur, { nodes: 0, groups: 0 }).get(cur)!;
        c[key]++;
        cur = ix.groups.get(cur)?.parent ?? null;
      }
    };
    for (const n of doc.nodes) bump(n.group, 'nodes');
    for (const g of doc.groups) bump(g.parent, 'groups');
    ix.counts = counts;
  }
  return ix.counts.get(gid) ?? { nodes: 0, groups: 0 };
}

/** The deepest group holding every one of these (null = top level). */
export function commonGroup(doc: FlowDoc, groups: (string | null | undefined)[]): string | null {
  const chain = (g: string | null | undefined) => {
    const out: (string | null)[] = [];
    let cur = g ?? null;
    let guard = 0;
    while (cur && guard++ < 1000) {
      out.push(cur);
      cur = groupById(doc, cur)?.parent ?? null;
    }
    out.push(null);
    return out;
  };
  if (!groups.length) return null;
  const chains = groups.map(chain);
  for (const cand of chains[0]) if (chains.every((c) => c.includes(cand))) return cand;
  return null;
}

/** Plain words for a connection, with shared causes or effects joined by ‘ + ’. */
export function describeConnection(doc: FlowDoc, c: Connection): string {
  const t = (id: string) => label(nodeById(doc, id)?.text ?? '');
  return `${c.inputs.map(t).join(' + ')} → ${c.outputs.map(t).join(' + ')}`;
}

/** True when `id` is the group `gid` or nested somewhere inside it. */
export function groupWithin(doc: FlowDoc, id: string | null | undefined, gid: string): boolean {
  let cur = id;
  let guard = 0;
  while (cur && guard++ < 1000) {
    if (cur === gid) return true;
    cur = groupById(doc, cur)?.parent ?? null;
  }
  return false;
}

/** Every node and group inside a group (recursive). */
export function groupContents(doc: FlowDoc, gid: string): { nodes: string[]; groups: string[] } {
  const groups = doc.groups.filter((g) => g.id !== gid && groupWithin(doc, g.parent, gid)).map((g) => g.id);
  const nodes = doc.nodes.filter((n) => groupWithin(doc, n.group, gid)).map((n) => n.id);
  return { nodes, groups };
}

// ---------- selection levels: Dive (↵) and Surface (⇧↵) ----------

/** The group an item sits in: a node's or group's own; an edge's deepest group holding all its ends. */
export function parentOf(doc: FlowDoc, id: string): string | null {
  const n = nodeById(doc, id);
  if (n) return n.group ?? null;
  const g = groupById(doc, id);
  if (g) return g.parent ?? null;
  const c = connectionOf(doc, id);
  return c ? commonGroup(doc, [...c.inputs, ...c.outputs].map((x) => nodeById(doc, x)?.group ?? null)) : null;
}

/** How many groups hold an item (0 = top level). */
export function depthOf(doc: FlowDoc, id: string): number {
  let d = 0;
  let cur = parentOf(doc, id);
  while (cur && d < 1000) {
    d++;
    cur = groupById(doc, cur)?.parent ?? null;
  }
  return d;
}

/** A group's own members, one level down: its nodes, then its groups. Null = the top level. */
export function childrenOf(doc: FlowDoc, gid: string | null): string[] {
  return [...doc.nodes.filter((n) => (n.group ?? null) === gid).map((n) => n.id), ...doc.groups.filter((g) => (g.parent ?? null) === gid).map((g) => g.id)];
}

/**
 * Dive: each group in the selection gives the selection over to its own members, one level down.
 * A collapsed group is opened to reach them (`open`; Al, Q9 2026-10-04). Nodes, edges and empty
 * groups stay selected. Nothing selected: the top level (the diagram is the outermost container).
 */
export function divePlan(doc: FlowDoc, sel: string[]): { sel: string[]; open: string[] } {
  if (!sel.length) return { sel: childrenOf(doc, null), open: [] };
  const out = new Set<string>();
  const open: string[] = [];
  for (const id of sel) {
    const g = groupById(doc, id);
    const kids = g ? childrenOf(doc, id) : [];
    if (!kids.length) out.add(id);
    else {
      kids.forEach((k) => out.add(k));
      if (g!.collapsed) open.push(id);
    }
  }
  return { sel: [...out], open };
}

/** The selection Dive (↵, J) moves to; see divePlan for the groups it opens. */
export function dive(doc: FlowDoc, sel: string[]): string[] {
  return divePlan(doc, sel).sel;
}

/**
 * Surface: the deepest items in the selection give way to the group around them, one level up.
 * Items higher up stay selected until the selection's level reaches theirs. Once everything is at
 * the top level, the next level up is the diagram itself (depth −1), which is the empty selection
 * (Al, 2026-10-04): Dive from there selects the top level again. Nothing selected: no change.
 */
export function surface(doc: FlowDoc, sel: string[]): string[] {
  if (!sel.length) return [];
  const depth = new Map(sel.map((id) => [id, depthOf(doc, id)]));
  const deepest = Math.max(...depth.values());
  if (deepest === 0) return [];
  const out = new Set<string>();
  for (const id of sel) out.add(depth.get(id) === deepest ? parentOf(doc, id) ?? id : id);
  return [...out];
}

export function label(text: string, empty = 'an empty node'): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t ? `‘${t}’` : empty;
}

// ---------- updates (all return a new document) ----------

export function setSettings(doc: FlowDoc, patch: Partial<FlowSettings>): FlowDoc {
  return { ...doc, settings: { ...doc.settings, ...patch } };
}

export function addNode(doc: FlowDoc, text = '', group: string | null = null): { doc: FlowDoc; id: string } {
  const id = uid('n');
  const node: FlowNode = { id, text };
  if (group) node.group = group;
  return { doc: { ...doc, nodes: [...doc.nodes, node] }, id };
}

/** New node joined to `anchor`: after = anchor → new, before = new → anchor. Same group as the anchor. */
export function addLinked(doc: FlowDoc, anchor: string, dir: 'after' | 'before'): { doc: FlowDoc; id: string } {
  return addLinkedTo(doc, [anchor], dir) ?? addNode(doc);
}

/**
 * New node joined to every one of `anchors`: after = each anchor → new, before = new → each
 * anchor. It joins the deepest group holding all of them. Null when none is a node.
 */
export function addLinkedTo(doc: FlowDoc, anchors: string[], dir: 'after' | 'before'): { doc: FlowDoc; id: string } | null {
  const ids = [...new Set(anchors)].filter((a) => nodeById(doc, a));
  if (!ids.length) return null;
  const { doc: d1, id } = addNode(doc, '', commonGroup(doc, ids.map((a) => nodeById(doc, a)!.group ?? null)));
  const edges: FlowEdge[] = ids.map((a) => (dir === 'after' ? { id: uid('e'), from: a, to: id } : { id: uid('e'), from: id, to: a }));
  return { doc: { ...d1, edges: [...d1.edges, ...edges] }, id };
}

export function setNodeText(doc: FlowDoc, id: string, text: string): FlowDoc {
  return { ...doc, nodes: doc.nodes.map((n) => (n.id === id ? { ...n, text } : n)) };
}

export function setGroupText(doc: FlowDoc, id: string, text: string): FlowDoc {
  return { ...doc, groups: doc.groups.map((g) => (g.id === id ? { ...g, text } : g)) };
}

/**
 * Removes nodes, groups (with everything inside them), edges, and the edges that touched them.
 * Deleting a shared trunk removes its whole connection; deleting one branch leaves the rest.
 */
export function deleteItems(doc: FlowDoc, ids: Iterable<string>): { doc: FlowDoc; nodes: number; groups: number; edges: number } {
  const killN = new Set<string>();
  const killG = new Set<string>();
  const killE = new Set<string>();
  for (const id of ids) {
    if (nodeById(doc, id)) killN.add(id);
    else if (groupById(doc, id)) {
      killG.add(id);
      const c = groupContents(doc, id);
      c.nodes.forEach((n) => killN.add(n));
      c.groups.forEach((g) => killG.add(g));
    } else {
      const e = edgeById(doc, id);
      if (!e) continue;
      killE.add(id);
      const c = connectionOf(doc, id);
      if (c?.junction && c.trunk.id === id) c.branches.forEach((x) => killE.add(x.id));
    }
  }
  const nodes = doc.nodes.filter((n) => !killN.has(n.id));
  const edges = doc.edges.filter((e) => !killE.has(e.id) && !killN.has(e.from) && !killN.has(e.to));
  const groups = doc.groups.filter((g) => !killG.has(g.id));
  // Count connections as the viewer sees them: a shared connection is one.
  const trunks = new Set([...killE].map((id) => connectionOf(doc, id)?.trunk.id));
  return { doc: tidyJunctions({ ...doc, nodes, edges, groups }), nodes: killN.size, groups: killG.size, edges: trunks.size };
}

export type LinkResult = { doc: FlowDoc; edge: string; trunk: string; merged: boolean } | { error: string };

/** Why `from` → `to` cannot be linked, or null when it can. */
export function linkProblem(doc: FlowDoc, from: string, to: string): string | null {
  if (!nodeById(doc, from) || !nodeById(doc, to)) return 'Link two nodes';
  if (from === to) return 'A node cannot link to itself';
  if (linked(doc, from, to)) return 'Already linked';
  return null;
}

/** Why `from` cannot merge into this edge, or null when it can. */
export function mergeProblem(doc: FlowDoc, from: string, edgeId: string): string | null {
  const c = connectionOf(doc, edgeId);
  if (!c || !nodeById(doc, from)) return 'Link a node to an edge';
  if (c.kind === 'fork') return 'This connection is already a fork';
  if (c.outputs.includes(from)) return 'This edge already points at it';
  if (c.inputs.includes(from)) return 'Already part of this edge';
  if (linked(doc, from, c.outputs[0])) return 'Already linked to its effect';
  return null;
}

/** Links two existing nodes: `from` → `to`. */
export function linkNodes(doc: FlowDoc, from: string, to: string): LinkResult {
  const why = linkProblem(doc, from, to);
  if (why) return { error: why };
  const id = uid('e');
  return { doc: { ...doc, edges: [...doc.edges, { id, from, to }] }, edge: id, trunk: id, merged: false };
}

/**
 * Links a node onto an existing edge: the node joins it as another cause, and the causes share
 * one trunk and one label. A plain edge becomes a merge (it keeps its id, label and loop hint as
 * the trunk); a merge gains a branch.
 */
export function linkToEdge(doc: FlowDoc, from: string, edgeId: string): LinkResult {
  const why = mergeProblem(doc, from, edgeId);
  const c = connectionOf(doc, edgeId);
  if (why || !c) return { error: why ?? 'Link a node to an edge' };
  const id = uid('e');
  if (c.junction) {
    return { doc: { ...doc, edges: [...doc.edges, { id, from, to: c.junction }] }, edge: id, trunk: c.trunk.id, merged: true };
  }
  const e = c.trunk;
  const j = uid('j');
  const trunk: FlowEdge = { id: e.id, from: j, to: e.to };
  if (e.back) trunk.back = true;
  if (e.label) trunk.label = e.label;
  const first: FlowEdge = { id: uid('e'), from: e.from, to: j };
  const edges = doc.edges.flatMap((x) => (x === e ? [first, trunk] : [x]));
  return { doc: { ...doc, junctions: [...doc.junctions, { id: j, kind: 'merge' }], edges: [...edges, { id, from, to: j }] }, edge: id, trunk: e.id, merged: true };
}

/** Why this edge cannot fork toward `to`, or null when it can. */
export function forkProblem(doc: FlowDoc, edgeId: string, to: string): string | null {
  const c = connectionOf(doc, edgeId);
  if (!c || !nodeById(doc, to)) return 'Link an edge to a node';
  if (c.kind === 'merge') return 'This connection is already a merge';
  if (c.inputs.includes(to)) return 'This edge already starts at it';
  if (c.outputs.includes(to)) return 'Already part of this edge';
  if (linked(doc, c.inputs[0], to)) return 'Already linked from its cause';
  return null;
}

/** Links an edge to another effect, retaining its id, label and loop hint on the shared trunk. */
export function linkFromEdge(doc: FlowDoc, edgeId: string, to: string): LinkResult {
  const why = forkProblem(doc, edgeId, to);
  const c = connectionOf(doc, edgeId);
  if (why || !c) return { error: why ?? 'Link an edge to a node' };
  const id = uid('e');
  if (c.junction) return { doc: { ...doc, edges: [...doc.edges, { id, from: c.junction, to }] }, edge: id, trunk: c.trunk.id, merged: true };
  const e = c.trunk, j = uid('j');
  const trunk: FlowEdge = { ...e, to: j };
  const first: FlowEdge = { id: uid('e'), from: j, to: e.to };
  const edges = doc.edges.flatMap((x) => x === e ? [trunk, first] : [x]);
  return { doc: { ...doc, junctions: [...doc.junctions, { id: j, kind: 'fork' }], edges: [...edges, { id, from: j, to }] }, edge: id, trunk: e.id, merged: true };
}

/**
 * Several links in one change, in order (node→node, node→edge merge, edge→node fork). A link an
 * earlier one made impossible, or one that was never possible, is skipped with its reason.
 */
export function linkEach(doc: FlowDoc, links: { from: string; fromType?: 'node' | 'edge'; to: { type: 'node' | 'edge'; id: string } }[]): { doc: FlowDoc; made: number; problems: string[] } {
  let d = doc;
  let made = 0;
  const problems: string[] = [];
  for (const l of links) {
    const r = l.fromType === 'edge' ? (l.to.type === 'node' ? linkFromEdge(d, l.from, l.to.id) : { error: 'Link an edge to a node' }) : l.to.type === 'node' ? linkNodes(d, l.from, l.to.id) : linkToEdge(d, l.from, l.to.id);
    if ('error' in r) problems.push(r.error);
    else {
      d = r.doc;
      made++;
    }
  }
  return { doc: d, made, problems };
}

/**
 * Puts a new node in the middle of an edge: from → new → to. The first half keeps its id, label
 * and loop hint, except an incoming fork trunk keeps them on the junction-side half so its label
 * stays shared. The node joins the deepest group holding the connection's ends.
 */
export function splitEdge(doc: FlowDoc, edgeId: string, text = ''): { doc: FlowDoc; id: string } | null {
  const e = edgeById(doc, edgeId);
  if (!e) return null;
  const c = connectionOf(doc, edgeId);
  const group = c ? commonGroup(doc, [...c.inputs, ...c.outputs].map((x) => nodeById(doc, x)?.group ?? null)) : null;
  const id = uid('n');
  const node: FlowNode = { id, text };
  if (group) node.group = group;
  const forkTrunk = c?.kind === 'fork' && c.trunk.id === e.id;
  const first: FlowEdge = forkTrunk ? { id: uid('e'), from: e.from, to: id } : { ...e, to: id };
  const second: FlowEdge = forkTrunk ? { ...e, from: id } : { id: uid('e'), from: id, to: e.to };
  const edges = doc.edges.flatMap((x) => (x === e ? [first, second] : [x]));
  return { doc: { ...doc, nodes: [...doc.nodes, node], edges }, id };
}

/**
 * Adds a new, empty node that joins an edge as another cause of its effect (a merge; the edge
 * keeps its id and label as the trunk). The node joins the deepest group holding the edge's ends.
 */
export function addCause(doc: FlowDoc, edgeId: string, text = ''): { doc: FlowDoc; id: string } | null {
  const c = connectionOf(doc, edgeId);
  if (!c || c.kind === 'fork') return null;
  const ends = [...c.inputs, ...c.outputs].map((x) => nodeById(doc, x)?.group ?? null);
  const group = commonGroup(doc, ends);
  const id = uid('n');
  const node: FlowNode = { id, text };
  if (group) node.group = group;
  const r = linkToEdge({ ...doc, nodes: [...doc.nodes, node] }, id, edgeId);
  return 'doc' in r && r.doc ? { doc: r.doc, id } : null;
}

/** Adds a new effect sharing the selected edge's trunk and label, in its common group. */
export function addEffect(doc: FlowDoc, edgeId: string, text = ''): { doc: FlowDoc; id: string } | null {
  const c = connectionOf(doc, edgeId);
  if (!c || c.kind === 'merge') return null;
  const group = commonGroup(doc, [...c.inputs, ...c.outputs].map((x) => nodeById(doc, x)?.group ?? null));
  const { doc: next, id } = addNode(doc, text, group);
  const r = linkFromEdge(next, edgeId, id);
  return 'doc' in r ? { doc: r.doc, id } : null;
}

/**
 * Removes a node; when it had exactly one cause and one effect, joins them again, keeping the
 * incoming edge's id and label, except an outgoing fork trunk retains its shared id and label
 * (the inverse of splitEdge). Otherwise like deleteItems; joining two junctions is unsupported.
 */
export function dissolveNode(doc: FlowDoc, id: string): FlowDoc {
  const ins = doc.edges.filter((e) => e.to === id);
  const outs = doc.edges.filter((e) => e.from === id);
  if (ins.length === 1 && outs.length === 1 && !(isJunction(doc, ins[0].from) && isJunction(doc, outs[0].to))) {
    const [a, b] = [ins[0], outs[0]];
    const c = connectionOf(doc, b.id);
    const joined: FlowEdge = c?.kind === 'fork' && c.trunk.id === b.id ? { ...b, from: a.from, ...(a.back || b.back ? { back: true } : {}) } : { ...a, to: b.to };
    const dup = a.from === b.to || doc.edges.some((e) => e.from === a.from && e.to === b.to);
    const edges = doc.edges.flatMap((e) => (e === a ? (dup ? [] : [joined]) : e === b ? [] : [e]));
    return tidyJunctions({ ...doc, nodes: doc.nodes.filter((n) => n.id !== id), edges });
  }
  return deleteItems(doc, [id]).doc;
}

/** Sets an edge's label; a branch sets its connection's shared label. Empty text removes it. */
export function setEdgeLabel(doc: FlowDoc, edgeId: string, text: string): FlowDoc {
  const c = connectionOf(doc, edgeId);
  if (!c) return doc;
  const keep = text.trim() ? text : '';
  return {
    ...doc,
    edges: doc.edges.map((e) => {
      if (e.id !== c.trunk.id) return e;
      const { label: _old, ...rest } = e;
      return keep ? { ...rest, label: keep } : rest;
    }),
  };
}

/** Wraps the selection in a new group, placed under the selection's common parent. */
export function groupItems(doc: FlowDoc, ids: string[], text = ''): { doc: FlowDoc; id: string } | null {
  const nodes = ids.filter((id) => nodeById(doc, id));
  const groups = ids.filter((id) => groupById(doc, id));
  if (!nodes.length && !groups.length) return null;
  const parents = [...nodes.map((id) => nodeById(doc, id)!.group ?? null), ...groups.map((id) => groupById(doc, id)!.parent ?? null)];
  let common = commonGroup(doc, parents);
  // A group cannot become its own ancestor.
  if (common && groups.some((g) => groupWithin(doc, common, g))) common = null;
  const id = uid('g');
  const g: FlowGroup = { id, text, parent: common, collapsed: false };
  const nset = new Set(nodes);
  const gset = new Set(groups);
  return {
    doc: {
      ...doc,
      groups: [...doc.groups.map((x) => (gset.has(x.id) ? { ...x, parent: id } : x)), g],
      nodes: doc.nodes.map((n) => (nset.has(n.id) ? { ...n, group: id } : n)),
    },
    id,
  };
}

export function ungroup(doc: FlowDoc, gid: string): FlowDoc {
  const g = groupById(doc, gid);
  if (!g) return doc;
  const up = g.parent ?? null;
  return {
    ...doc,
    groups: doc.groups.filter((x) => x.id !== gid).map((x) => (x.parent === gid ? { ...x, parent: up } : x)),
    nodes: doc.nodes.map((n) => (n.group === gid ? { ...n, group: up } : n)),
  };
}

export function setCollapsed(doc: FlowDoc, gid: string, collapsed: boolean): FlowDoc {
  return { ...doc, groups: doc.groups.map((g) => (g.id === gid ? { ...g, collapsed } : g)) };
}
