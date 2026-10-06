// Bridge to the Rust/WASM layout engine. Flat Float64Array in, flat Float64Array out.

import wasmBase64 from './wasm-inline';

export type EngineOrientation = 'tb' | 'bt' | 'lr' | 'rl' | 'in-out' | 'out-in';
const ORIENT_CODE: Record<EngineOrientation, number> = { tb: 0, bt: 1, lr: 2, rl: 3, 'in-out': 4, 'out-in': 5 };

export interface EngineOptions {
  orientation: EngineOrientation;
  biasEnd: boolean;
  nodeSep: number;
  rankSep: number;
  edgeSep: number;
  groupPad: number;
  groupGap: number;
  incremental: boolean;
  margin: number;
  /** Group members with room to move shift toward the rest of their group. */
  tightGroups?: boolean;
  /** Nodes with room to move change rank when that removes crossing lines. */
  untangle?: boolean;
}

export interface EngineInput {
  options: EngineOptions;
  nodes: { w: number; h: number; group: number; prevX?: number; prevY?: number }[];
  /** `label`: size of the edge's label; it rides the edge's middle bend point. */
  edges: { src: number; dst: number; backHint?: boolean; label?: { w: number; h: number } | null }[];
  groups: { parent: number; collapsed: boolean; w: number; h: number; header: number }[];
}

export type GroupShape =
  | { kind: 'hidden' }
  | { kind: 'rect'; x: number; y: number; w: number; h: number }
  | { kind: 'sector'; cx: number; cy: number; r0: number; r1: number; a0: number; a1: number }
  | { kind: 'proxy'; x: number; y: number; w: number; h: number };

export interface LayoutResult {
  width: number;
  height: number;
  crossings: number;
  ranks: number;
  ms: number;
  nodes: { x: number; y: number; rank: number; order: number; visible: boolean }[];
  groups: { shape: GroupShape; label: { x: number; y: number; w: number } }[];
  edges: { back: boolean; hidden: boolean; path: Float64Array; label: { x: number; y: number } | null }[];
}

interface Exports {
  memory: WebAssembly.Memory;
  lf_begin(len: number): number;
  lf_run(): number;
  lf_out(): number;
  lf_version(): number;
}

let moduleCache: WebAssembly.Module | null = null;

function decodeBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function getModule(): WebAssembly.Module {
  if (!moduleCache) moduleCache = new WebAssembly.Module(decodeBase64(wasmBase64) as BufferSource);
  return moduleCache;
}

export class LayoutEngine {
  private ex: Exports;
  constructor() {
    this.ex = new WebAssembly.Instance(getModule(), {}).exports as unknown as Exports;
  }

  layout(input: EngineInput): LayoutResult {
    return this.layoutBoth(input, null)[0];
  }

  /**
   * Lays out in `input.options.orientation` and, when `also` is given, in that direction too,
   * from one ranking and ordering (they do not depend on the direction). Auto orientation uses
   * this to compare two directions for little more than the price of one.
   */
  layoutBoth(input: EngineInput, also: EngineOrientation | null): LayoutResult[] {
    try {
      return this.run(input, also);
    } catch (err) {
      // A trap leaves the instance unusable: start a fresh one next time.
      this.ex = new WebAssembly.Instance(getModule(), {}).exports as unknown as Exports;
      throw err;
    }
  }

  private run(input: EngineInput, also: EngineOrientation | null): LayoutResult[] {
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
    const { options: o, nodes, edges, groups } = input;
    const len = 16 + nodes.length * 5 + edges.length * 5 + groups.length * 5;
    // Pointers above 2 GB come back from WebAssembly as negative numbers: read them unsigned.
    const ptr = this.ex.lf_begin(len) >>> 0;
    const b = new Float64Array(this.ex.memory.buffer, ptr, len);
    b[0] = 2;
    b[1] = ORIENT_CODE[o.orientation] ?? 0;
    b[2] = o.biasEnd ? 1 : 0;
    b[3] = o.nodeSep;
    b[4] = o.rankSep;
    b[5] = o.edgeSep;
    b[6] = o.groupPad;
    b[7] = o.groupGap;
    b[8] = o.incremental ? 1 : 0;
    b[9] = o.margin;
    b[10] = nodes.length;
    b[11] = edges.length;
    b[12] = groups.length;
    b[13] = o.tightGroups ? 1 : 0;
    b[14] = o.untangle ? 1 : 0;
    b[15] = also && also !== o.orientation ? (ORIENT_CODE[also] ?? 0) + 1 : 0;
    let p = 16;
    for (const n of nodes) {
      b[p] = n.w;
      b[p + 1] = n.h;
      b[p + 2] = n.group;
      b[p + 3] = n.prevX ?? NaN;
      b[p + 4] = n.prevY ?? NaN;
      p += 5;
    }
    for (const e of edges) {
      b[p] = e.src;
      b[p + 1] = e.dst;
      b[p + 2] = e.backHint ? 1 : 0;
      b[p + 3] = e.label ? e.label.w : 0;
      b[p + 4] = e.label ? e.label.h : 0;
      p += 5;
    }
    for (const g of groups) {
      b[p] = g.parent;
      b[p + 1] = g.collapsed ? 1 : 0;
      b[p + 2] = g.w;
      b[p + 3] = g.h;
      b[p + 4] = g.header;
      p += 5;
    }
    const outLen = this.ex.lf_run();
    // Copy out before anything else touches wasm memory.
    const o2 = new Float64Array(this.ex.memory.buffer, this.ex.lf_out() >>> 0, outLen).slice();
    const results: LayoutResult[] = [];
    let q = 0;
    while (q < o2.length) {
      const r = this.decode(o2, q);
      results.push(r.res);
      q = r.next;
    }
    const ms = (typeof performance !== 'undefined' ? performance.now() : 0) - t0;
    for (const r of results) r.ms = ms / results.length;
    return results;
  }

  private decode(o2: Float64Array, start: number): { res: LayoutResult; next: number } {
    const at = (i: number) => o2[start + i];
    const res: LayoutResult = {
      width: at(1),
      height: at(2),
      crossings: at(6),
      ranks: at(7),
      ms: 0,
      nodes: [],
      groups: [],
      edges: [],
    };
    const [nn, ne, ng] = [at(3), at(4), at(5)];
    let q = start + 8;
    for (let i = 0; i < nn; i++, q += 5) {
      res.nodes.push({ x: o2[q], y: o2[q + 1], rank: o2[q + 2], order: o2[q + 3], visible: o2[q + 4] === 1 });
    }
    for (let i = 0; i < ng; i++, q += 10) {
      const k = o2[q];
      const [a, bb, c, d, e, f] = [o2[q + 1], o2[q + 2], o2[q + 3], o2[q + 4], o2[q + 5], o2[q + 6]];
      const shape: GroupShape =
        k === 1
          ? { kind: 'rect', x: a, y: bb, w: c, h: d }
          : k === 2
            ? { kind: 'sector', cx: a, cy: bb, r0: c, r1: d, a0: e, a1: f }
            : k === 3
              ? { kind: 'proxy', x: a, y: bb, w: c, h: d }
              : { kind: 'hidden' };
      res.groups.push({ shape, label: { x: o2[q + 7], y: o2[q + 8], w: o2[q + 9] } });
    }
    for (let i = 0; i < ne; i++) {
      const flags = o2[q];
      const label = flags & 4 ? { x: o2[q + 1], y: o2[q + 2] } : null;
      const np = o2[q + 3];
      const path = o2.slice(q + 4, q + 4 + np * 2);
      res.edges.push({ back: (flags & 1) === 1, hidden: (flags & 2) === 2, path, label });
      q += 4 + np * 2;
    }
    return { res, next: q };
  }
}

let shared: LayoutEngine | null = null;
export function engine(): LayoutEngine {
  if (!shared) shared = new LayoutEngine();
  return shared;
}
