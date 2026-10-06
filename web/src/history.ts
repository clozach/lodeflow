// One history for everything: content edits and view changes (pan, zoom, rotate, select).
// Undo and redo walk it one step at a time; express rewind and fast-forward skip camera moves.

import type { FlowDoc } from './model';

export interface Camera {
  /** World point at the viewport centre. */
  x: number;
  y: number;
  /** Zoom factor. */
  z: number;
  /** Rotation in radians. */
  r: number;
}

export interface ViewState {
  cam: Camera;
  /** Camera follows the diagram (fit to the container) until the viewer pans or zooms. */
  follow: boolean;
  sel: string[];
}

export interface Snapshot {
  doc: FlowDoc;
  view: ViewState;
}

export type EntryKind =
  | 'edit'
  | 'add'
  | 'link'
  | 'delete'
  | 'group'
  | 'ungroup'
  | 'collapse'
  | 'settings'
  | 'select'
  | 'nav'
  | 'pan'
  | 'zoom'
  | 'rotate'
  | 'fit'
  | 'load';

export interface Entry {
  label: string;
  kind: EntryKind;
  before: Snapshot;
  after: Snapshot;
  t: number;
  /** World point where the change happened (for the in-place way back). */
  where?: { x: number; y: number } | null;
}

export const CONTENT_KINDS: ReadonlySet<EntryKind> = new Set(['edit', 'add', 'link', 'delete', 'group', 'ungroup', 'collapse', 'settings', 'load']);

/** Camera moves: express rewind and fast-forward step over these and leave the view where it is. */
export const CAMERA_KINDS: ReadonlySet<EntryKind> = new Set(['pan', 'zoom', 'rotate', 'fit']);

/** `s` with the camera (and follow mode) of `cam` and the selection of `sel`. */
const reframe = (s: Snapshot, cam: ViewState, sel: ViewState): Snapshot => ({ doc: s.doc, view: { cam: cam.cam, follow: cam.follow, sel: sel.sel } });

export class History {
  entries: Entry[] = [];
  index = 0;
  private sealed = true;
  constructor(public limit = 300) {}

  get canUndo() {
    return this.index > 0;
  }
  get canRedo() {
    return this.index < this.entries.length;
  }
  peekUndo(): Entry | null {
    return this.index > 0 ? this.entries[this.index - 1] : null;
  }
  peekRedo(): Entry | null {
    return this.index < this.entries.length ? this.entries[this.index] : null;
  }

  /** Adds an entry. Same-kind entries inside `coalesceMs` merge (a wheel burst is one Zoom). */
  push(e: Entry, coalesceMs = 0): Entry {
    if (this.index < this.entries.length) this.entries.length = this.index;
    const last = this.entries[this.index - 1];
    if (!this.sealed && coalesceMs > 0 && last && last.kind === e.kind && e.t - last.t <= coalesceMs) {
      last.after = e.after;
      last.t = e.t;
      last.label = e.label;
      return last;
    }
    this.entries.push(e);
    if (this.entries.length > this.limit) this.entries.splice(0, this.entries.length - this.limit);
    this.index = this.entries.length;
    this.sealed = false;
    return e;
  }

  /** Stops the next push from merging into the last entry. */
  seal() {
    this.sealed = true;
  }

  /** Replace the latest entry's "after" (e.g. typing into a node you just added). */
  amendLast(after: Snapshot, label?: string) {
    const last = this.entries[this.index - 1];
    if (!last) return;
    last.after = after;
    if (label) last.label = label;
    this.entries.length = this.index;
  }

  /** Drop the latest entry without redo (e.g. a new node abandoned while still empty). */
  dropLast(): Entry | null {
    if (this.index === 0 || this.index !== this.entries.length) return null;
    this.index--;
    this.sealed = true;
    return this.entries.pop() ?? null;
  }

  /**
   * Removes `e` as if it had never happened, when only view steps (whose document is still `was`)
   * follow it and there is nothing to redo: those steps get `now` instead, keeping only the
   * selected ids `keep` accepts. For a new node abandoned while still empty after a pan or zoom.
   */
  forget(e: Entry, was: FlowDoc, now: FlowDoc, keep: (id: string) => boolean): boolean {
    const i = this.entries.indexOf(e);
    if (i < 0 || i >= this.index || this.index !== this.entries.length) return false;
    const later = this.entries.slice(i + 1);
    if (later.some((x) => x.before.doc !== was || x.after.doc !== was)) return false;
    const fix = (s: Snapshot): Snapshot => ({ doc: now, view: { ...s.view, sel: s.view.sel.filter(keep) } });
    for (const x of later) {
      x.before = fix(x.before);
      x.after = fix(x.after);
    }
    this.entries.splice(i, 1);
    this.index--;
    this.sealed = true;
    return true;
  }

  undo(): Entry | null {
    if (!this.canUndo) return null;
    this.index--;
    this.sealed = true;
    return this.entries[this.index];
  }

  redo(): Entry | null {
    if (!this.canRedo) return null;
    const e = this.entries[this.index];
    this.index++;
    this.sealed = true;
    return e;
  }

  /**
   * Express rewind: undoes the latest step that is not a camera move, keeping the camera where it
   * is. The camera moves made since that step are rebased in front of it, onto the state it
   * started from, so the history reads as if the view had changed first: a redo (or an express
   * fast-forward) then replays the step in the current view, and an undo walks the camera back.
   * With no camera move since the step, this is a plain undo. Every entry still starts where the
   * one before it ends. Returns the (rebased) step, whose `before` is the state to show, or null
   * when only camera moves are left to undo.
   */
  expressUndo(): Entry | null {
    let k = this.index - 1;
    while (k >= 0 && CAMERA_KINDS.has(this.entries[k].kind)) k--;
    if (k < 0) return null;
    const moves = this.entries.slice(k + 1, this.index);
    if (!moves.length) return this.undo();
    const step = this.entries[k];
    const now = moves[moves.length - 1].after.view;
    const base = step.before;
    const rebased = moves.map((m, i) => ({
      ...m,
      before: reframe(base, i ? moves[i - 1].after.view : base.view, base.view),
      after: reframe(base, m.after.view, base.view),
    }));
    const replayed = { ...step, before: reframe(base, now, base.view), after: reframe(step.after, now, step.after.view) };
    this.entries.splice(k, moves.length + 1, ...rebased, replayed);
    this.index = k + moves.length;
    this.sealed = true;
    return replayed;
  }

  /**
   * Express fast-forward, the mirror of `expressUndo`: redoes the next step that is not a camera
   * move, in the current view; the camera moves that came before it are rebased after it, the
   * last one ending where the step itself left the camera. With no camera move before the step,
   * this is a plain redo. Returns the (rebased) step, whose `after` is the state to show, or null
   * when only camera moves are left.
   */
  expressRedo(): Entry | null {
    let j = this.index;
    while (j < this.entries.length && CAMERA_KINDS.has(this.entries[j].kind)) j++;
    if (j >= this.entries.length) return null;
    if (j === this.index) return this.redo();
    const step = this.entries[j];
    const moves = this.entries.slice(this.index, j);
    const now = (this.index > 0 ? this.entries[this.index - 1].after : this.entries[this.index].before).view;
    const end = step.after;
    const replayed = { ...step, before: reframe(step.before, now, step.before.view), after: reframe(end, now, end.view) };
    const rebased = moves.map((m, i) => ({
      ...m,
      before: reframe(end, i ? moves[i - 1].after.view : now, end.view),
      after: reframe(end, i === moves.length - 1 ? end.view : m.after.view, end.view),
    }));
    this.entries.splice(this.index, moves.length + 1, replayed, ...rebased);
    this.index++;
    this.sealed = true;
    return replayed;
  }

  clear() {
    this.entries = [];
    this.index = 0;
    this.sealed = true;
  }

  /**
   * Up to `limit` entries each side of the current one. Most entries share their document with
   * their neighbours (a selection, a pan or a zoom does not change it), so each distinct document
   * is written once and entries refer to it by number: a long history of view changes costs about
   * one document, not two per entry.
   */
  toJSON(limit = 100) {
    const start = Math.max(0, this.index - limit);
    const end = Math.min(this.entries.length, this.index + limit);
    const docs: FlowDoc[] = [];
    const ids = new Map<FlowDoc, number>();
    const ref = (d: FlowDoc) => {
      let i = ids.get(d);
      if (i === undefined) {
        i = docs.length;
        ids.set(d, i);
        docs.push(d);
      }
      return i;
    };
    const entries = this.entries.slice(start, end).map((e) => ({
      ...e,
      before: { doc: ref(e.before.doc), view: e.before.view },
      after: { doc: ref(e.after.doc), view: e.after.view },
    }));
    return { v: 2, index: this.index - start, docs, entries };
  }

  /** Reads what `toJSON` wrote, and the format before shared documents (v1). */
  static fromJSON(data: any, limit = 300): History {
    const h = new History(limit);
    if (!data || !Array.isArray(data.entries)) return h;
    if (data.v === 1) {
      h.entries = data.entries.filter((e: any) => e && e.before && e.after && e.kind);
    } else if (data.v === 2 && Array.isArray(data.docs)) {
      const doc = (i: unknown) => (Number.isInteger(i) ? data.docs[i as number] : undefined);
      h.entries = data.entries
        .filter((e: any) => e && e.kind && e.before && e.after && doc(e.before.doc) && doc(e.after.doc))
        .map((e: any) => ({ ...e, before: { doc: doc(e.before.doc), view: e.before.view }, after: { doc: doc(e.after.doc), view: e.after.view } }));
    } else return h;
    h.index = Math.max(0, Math.min(h.entries.length, Number(data.index) || 0));
    return h;
  }
}
