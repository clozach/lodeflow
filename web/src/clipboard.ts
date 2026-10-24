// Copy and paste as pure document functions. A fragment is a small document (ids as they were
// in the source); pasting it gives every item a fresh id, so the same fragment pastes any number
// of times, into the same diagram or another one.

import * as M from './model';
import type { FlowDoc, FlowEdge, FlowGroup, FlowJunction, FlowLoose, FlowNode } from './model';

export const MIME = 'application/x-lodeflow+json';
const KIND = 'lodeflow-fragment';

export interface Fragment {
  nodes: FlowNode[];
  edges: FlowEdge[];
  junctions: FlowJunction[];
  groups: FlowGroup[];
  loose: FlowLoose[];
}

/**
 * What copying the selection takes. Selected groups bring everything inside them; a group whose
 * every node is copied comes too, so Select all keeps its grouping. A connection comes along when
 * its ends do (a merge or fork with some ends left behind keeps the ones that came). A selected
 * edge whose ends stay behind becomes a loose edge: it keeps its label, and any end that came.
 * Null when there is nothing to copy.
 */
export function copyFragment(doc: FlowDoc, sel: string[]): Fragment | null {
  const picked = new Set(sel);
  const groups = new Set<string>();
  const nodes = new Set<string>();
  for (const id of picked) {
    if (M.nodeById(doc, id)) nodes.add(id);
    else if (M.groupById(doc, id)) {
      groups.add(id);
      const c = M.groupContents(doc, id);
      c.nodes.forEach((n) => nodes.add(n));
      c.groups.forEach((g) => groups.add(g));
    }
  }
  // Free loose edges are members of their group, as nodes are.
  const free = M.looseOf(doc).filter((l) => M.isFree(l));
  const filled = new Map<string, boolean>();
  const hasContent = (gid: string): boolean => {
    if (!filled.has(gid)) {
      filled.set(gid, false);
      filled.set(gid, doc.nodes.some((n) => n.group === gid) || free.some((l) => l.group === gid) || doc.groups.some((x) => x.parent === gid && hasContent(x.id)));
    }
    return filled.get(gid)!;
  };
  // A group comes along when everything it holds comes (so Select all keeps its grouping); empty
  // groups inside it ride with it. Repeat until stable, so nested groups count toward their parents.
  for (let changed = true; changed;) {
    changed = false;
    for (const g of doc.groups) {
      if (groups.has(g.id) || !hasContent(g.id)) continue;
      const whole = doc.nodes.every((n) => n.group !== g.id || nodes.has(n.id))
        && free.every((l) => l.group !== g.id || picked.has(l.id))
        && doc.groups.every((x) => x.parent !== g.id || groups.has(x.id) || !hasContent(x.id));
      if (whole) {
        groups.add(g.id);
        changed = true;
      }
    }
    for (const g of doc.groups) {
      if (!groups.has(g.id) && g.parent && groups.has(g.parent) && !hasContent(g.id)) {
        groups.add(g.id);
        changed = true;
      }
    }
  }
  const out: Fragment = { nodes: [], edges: [], junctions: [], groups: [], loose: [] };
  for (const g of doc.groups) {
    if (!groups.has(g.id)) continue;
    out.groups.push({ id: g.id, text: g.text, parent: g.parent && groups.has(g.parent) ? g.parent : null, collapsed: !!g.collapsed });
  }
  for (const n of doc.nodes) {
    if (!nodes.has(n.id)) continue;
    const node: FlowNode = { id: n.id, text: n.text };
    if (n.group && groups.has(n.group)) node.group = n.group;
    if (n.content) node.content = n.content;
    out.nodes.push(node);
  }
  let k = 0;
  const loose = (piece: Omit<FlowLoose, 'id'>, base: string) => out.loose.push({ id: `${base}~${k++}`, ...piece });
  for (const c of M.connections(doc)) {
    const ins = c.inputs.filter((id) => nodes.has(id));
    const outs = c.outputs.filter((id) => nodes.has(id));
    const label = c.trunk.label ? { label: c.trunk.label } : {};
    const back = c.trunk.back || c.branches.some((b) => b.back) ? { back: true } : {};
    if (ins.length && outs.length) {
      if (ins.length === 1 && outs.length === 1) out.edges.push({ id: c.trunk.id, from: ins[0], to: outs[0], ...label, ...back });
      else {
        const j = c.junction!;
        out.junctions.push(c.kind === 'fork' ? { id: j, kind: 'fork' } : { id: j, kind: 'merge' });
        if (c.kind === 'fork') {
          out.edges.push({ ...c.trunk });
          for (const b of c.branches) if (nodes.has(b.to)) out.edges.push({ ...b });
        } else {
          for (const b of c.branches) if (nodes.has(b.from)) out.edges.push({ ...b });
          out.edges.push({ ...c.trunk });
        }
      }
      continue;
    }
    if (![c.trunk, ...c.branches].some((e) => picked.has(e.id))) continue;
    if (ins.length) ins.forEach((from) => loose({ from, ...label }, c.trunk.id));
    else if (outs.length) outs.forEach((to) => loose({ to, ...label }, c.trunk.id));
    else loose({ ...label }, c.trunk.id);
  }
  for (const l of M.looseOf(doc)) {
    const anchor = M.looseAnchor(l);
    const hangs = !!anchor && nodes.has(anchor);
    const inside = !anchor && !!l.group && groups.has(l.group);
    if (!picked.has(l.id) && !hangs && !inside) continue;
    const piece: FlowLoose = { id: l.id };
    if (hangs) piece[l.from ? 'from' : 'to'] = anchor!;
    if (l.label) piece.label = l.label;
    if (!anchor && l.reversed) piece.reversed = true;
    if (!anchor && l.group && groups.has(l.group)) piece.group = l.group;
    out.loose.push(piece);
  }
  return out.nodes.length || out.loose.length || out.groups.length ? out : null;
}

/**
 * Adds a fragment's items with fresh ids. Its top-level items land in `group` (or at the top
 * level). Returns the new document and the top-level items to select, or null for an empty
 * fragment.
 */
export function pasteFragment(doc: FlowDoc, frag: Fragment, group: string | null = null): { doc: FlowDoc; ids: string[] } | null {
  if (!frag.nodes.length && !frag.loose.length && !frag.groups.length) return null;
  const into = group && M.groupById(doc, group) ? group : null;
  const ids = new Map<string, string>();
  const fresh = (old: string, prefix: string) => {
    const id = M.uid(prefix);
    ids.set(old, id);
    return id;
  };
  frag.groups.forEach((g) => fresh(g.id, 'g'));
  frag.nodes.forEach((n) => fresh(n.id, 'n'));
  frag.junctions.forEach((j) => fresh(j.id, 'j'));
  const top: string[] = [];
  const groups: FlowGroup[] = frag.groups.map((g) => {
    const parent = g.parent ? ids.get(g.parent) ?? null : null;
    if (!parent) top.push(ids.get(g.id)!);
    return { id: ids.get(g.id)!, text: g.text, parent: parent ?? into, collapsed: !!g.collapsed };
  });
  const nodes: FlowNode[] = frag.nodes.map((n) => {
    const inner = n.group ? ids.get(n.group) : undefined;
    if (!inner) top.push(ids.get(n.id)!);
    const node: FlowNode = { id: ids.get(n.id)!, text: n.text };
    if (n.content) node.content = n.content;
    const g = inner ?? into;
    if (g) node.group = g;
    return node;
  });
  const edges: FlowEdge[] = [];
  for (const e of frag.edges) {
    const from = ids.get(e.from), to = ids.get(e.to);
    if (!from || !to) continue;
    const edge: FlowEdge = { id: M.uid('e'), from, to };
    if (e.back) edge.back = true;
    if (e.label) edge.label = e.label;
    edges.push(edge);
  }
  const loose: FlowLoose[] = frag.loose.map((l) => {
    const piece: FlowLoose = { id: M.uid('e') };
    const from = l.from ? ids.get(l.from) : undefined, to = l.to ? ids.get(l.to) : undefined;
    if (from) piece.from = from;
    else if (to) piece.to = to;
    if (l.label) piece.label = l.label;
    if (M.isFree(piece)) {
      if (l.reversed) piece.reversed = true;
      const inner = l.group ? ids.get(l.group) : undefined;
      if (!inner) top.push(piece.id);
      const g = inner ?? into;
      if (g) piece.group = g;
    }
    return piece;
  });
  const next: FlowDoc = {
    ...doc,
    groups: [...doc.groups, ...groups],
    nodes: [...doc.nodes, ...nodes],
    junctions: [...doc.junctions, ...frag.junctions.map((j) => ({ ...j, id: ids.get(j.id)! }))],
    edges: [...doc.edges, ...edges],
  };
  const all = [...M.looseOf(doc), ...loose];
  if (all.length) next.loose = all;
  return { doc: M.tidyJunctions(next), ids: top };
}

/** The fragment as clipboard JSON. */
export function encodeFragment(frag: Fragment): string {
  return JSON.stringify({ kind: KIND, version: 1, ...frag });
}

/** A fragment from clipboard text, or null when the text is not one. */
export function decodeFragment(text: string): Fragment | null {
  let v: any;
  try { v = JSON.parse(text); } catch { return null; }
  if (!v || typeof v !== 'object' || v.kind !== KIND) return null;
  // The same rules as loading a document: valid ids, ends that exist, junctions that are real.
  // Anything it cannot read is not a fragment, so the paste falls through to plain text.
  let doc: M.FlowDoc;
  try { doc = M.normalizeDoc({ nodes: v.nodes, edges: v.edges, junctions: v.junctions, groups: v.groups, loose: v.loose }); } catch { return null; }
  return { nodes: doc.nodes, edges: doc.edges, junctions: doc.junctions, groups: doc.groups, loose: M.looseOf(doc) };
}

/** Plain words for other apps: each node on its own line, then each connection. */
export function fragmentText(frag: Fragment): string {
  const text = new Map(frag.nodes.map((n) => [n.id, n.text.replace(/\s+/g, ' ').trim() || '(empty)']));
  const lines = frag.nodes.map((n) => text.get(n.id)!);
  const ends = new Map<string, { from: string[]; to: string[]; label?: string }>();
  const junctions = new Set(frag.junctions.map((j) => j.id));
  for (const e of frag.edges) {
    const key = junctions.has(e.to) ? e.to : junctions.has(e.from) ? e.from : e.id;
    const c = ends.get(key) ?? ends.set(key, { from: [], to: [] }).get(key)!;
    if (!junctions.has(e.from)) c.from.push(e.from);
    if (!junctions.has(e.to)) c.to.push(e.to);
    if (e.label) c.label = e.label;
  }
  for (const c of ends.values()) {
    const words = (xs: string[]) => [...new Set(xs)].map((id) => text.get(id) ?? '').join(' + ');
    lines.push(`${words(c.from)} → ${words(c.to)}${c.label ? ` (${c.label})` : ''}`);
  }
  for (const l of frag.loose) {
    lines.push(`${l.from ? text.get(l.from) : '…'} → ${l.to ? text.get(l.to) : '…'}${l.label ? ` (${l.label})` : ''}`);
  }
  return lines.join('\n');
}

/** Plain text from another app: one node per non-empty line (up to `max` lines), or null. */
/** Most plain-text lines one paste turns into nodes. */
export const TEXT_LINES = 50;

/** Non-empty lines of pasted text. */
export function textLines(text: string): string[] {
  return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

export function textFragment(text: string, max = TEXT_LINES): Fragment | null {
  const lines = textLines(text);
  if (!lines.length || lines.length > max) return null;
  return { nodes: lines.map((t, i) => ({ id: `t${i}`, text: t })), edges: [], junctions: [], groups: [], loose: [] };
}
