// <lode-flow>: a self-organizing flow diagram. Layout comes from the Rust/WASM engine;
// this element renders it, animates between layouts, and owns one undo history for
// content and view changes alike.

import { CSS } from './styles';
import { ICON } from './icons';
import { engine, type EngineInput, type EngineOrientation, type GroupShape, type LayoutEngine, type LayoutResult } from './engine';
import { CAMERA_KINDS, History, type Camera, type Entry, type EntryKind, type Snapshot, type ViewState } from './history';
import { countItems, itemLimitProblem, parseMaxItems } from './item-limit';
import * as M from './model';
import type { Compactness, FlowDoc, Orientation } from './model';
import { plan, type Plan } from './plan';
import {
  camEqual,
  clamp,
  cssTransform,
  ease,
  edgePanStop,
  edgePanVelocity,
  lerpCam,
  panBy,
  pathData,
  pin,
  polyData,
  rectData,
  sample,
  screenBox,
  sectorData,
  toScreen,
  toWorld,
  type Pt,
  type Rect,
} from './geometry';

const Base: typeof HTMLElement = typeof HTMLElement !== 'undefined' ? HTMLElement : (class {} as unknown as typeof HTMLElement);
const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || '');
const K = {
  undo: IS_MAC ? '⌘Z' : 'Ctrl+Z',
  redo: IS_MAC ? '⇧⌘Z' : 'Ctrl+Y',
  rewind: IS_MAC ? '⌥⌘Z' : 'Ctrl+Alt+Z',
  fastForward: IS_MAC ? '⇧⌥⌘Z' : 'Ctrl+Alt+Shift+Z',
  all: IS_MAC ? '⌘A' : 'Ctrl+A',
  addNext: IS_MAC ? '⌘↵' : 'Ctrl+Enter',
};
const SAMPLES = 24;
/** How close (screen px) a pointer must come to a line to hover or pick it: mouse, then touch. */
const EDGE_HIT = 12;
const EDGE_HIT_TOUCH = 22;
/**
 * Edge pan: the band along the frame's edges (px), the top speed (px/s), its ramp-up (ms) and how
 * far inside the frame the diagram's far side stops (px).
 */
const EDGE_PAN_BAND = 48;
const EDGE_PAN_MAX = 900;
const EDGE_PAN_RAMP = 250;
const EDGE_PAN_MARGIN = 16;
/** Saved undo history: entries each side of the current one, longest first, until one fits. */
const HISTORY_LIMITS = [100, 30, 10, 3];

const DENSITY: Record<Compactness, { node: number; rank: number; edge: number }> = {
  relaxed: { node: 44, rank: 88, edge: 18 },
  comfortable: { node: 28, rank: 60, edge: 12 },
  compact: { node: 14, rank: 36, edge: 8 },
};

const ORIENT_LABEL: Record<Orientation, string> = {
  auto: 'Auto — fits the container',
  lr: 'Left to right',
  rl: 'Right to left',
  tb: 'Top to bottom',
  bt: 'Bottom to top',
  'in-out': 'Inner to outer (radial)',
  'out-in': 'Outer to inner (radial)',
};
const ORIENT_ICON: Record<Orientation, string> = {
  auto: ICON.auto,
  lr: ICON.lr,
  rl: ICON.rl,
  tb: ICON.tb,
  bt: ICON.bt,
  'in-out': ICON.inout,
  'out-in': ICON.outin,
};

/** Runtime-editable values (the exhaustive tier of the view magnet). */
interface Tunables {
  nodeWidth: number;
  animMs: number;
  groupPad: number;
  fitMin: number;
  fitMax: number;
  wheelZoom: number;
  relaxedNode: number;
  relaxedRank: number;
  comfortableNode: number;
  comfortableRank: number;
  compactNode: number;
  compactRank: number;
}
const TUNABLE_DEFAULTS: Tunables = {
  nodeWidth: 176,
  animMs: 380,
  groupPad: 14,
  fitMin: 0.7,
  fitMax: 1,
  wheelZoom: 1,
  relaxedNode: DENSITY.relaxed.node,
  relaxedRank: DENSITY.relaxed.rank,
  comfortableNode: DENSITY.comfortable.node,
  comfortableRank: DENSITY.comfortable.rank,
  compactNode: DENSITY.compact.node,
  compactRank: DENSITY.compact.rank,
};
const TUNABLE_META: { key: keyof Tunables; label: string; min: number; max: number; step: number }[] = [
  { key: 'nodeWidth', label: 'Node width (px)', min: 96, max: 480, step: 4 },
  { key: 'animMs', label: 'Transition (ms)', min: 0, max: 2000, step: 20 },
  { key: 'groupPad', label: 'Group padding (px)', min: 6, max: 48, step: 1 },
  { key: 'fitMin', label: 'Smallest fit zoom', min: 0.1, max: 1, step: 0.05 },
  { key: 'fitMax', label: 'Largest fit zoom', min: 0.5, max: 3, step: 0.05 },
  { key: 'wheelZoom', label: 'Wheel zoom speed', min: 0.2, max: 4, step: 0.1 },
  { key: 'relaxedNode', label: 'Relaxed: gap beside (px)', min: 4, max: 160, step: 2 },
  { key: 'relaxedRank', label: 'Relaxed: gap between ranks (px)', min: 8, max: 240, step: 2 },
  { key: 'comfortableNode', label: 'Comfortable: gap beside (px)', min: 4, max: 160, step: 2 },
  { key: 'comfortableRank', label: 'Comfortable: gap between ranks (px)', min: 8, max: 240, step: 2 },
  { key: 'compactNode', label: 'Compact: gap beside (px)', min: 2, max: 160, step: 2 },
  { key: 'compactRank', label: 'Compact: gap between ranks (px)', min: 8, max: 240, step: 2 },
];

interface GeoNode {
  x: number;
  y: number;
  w: number;
  h: number;
  visible: boolean;
}
interface GeoGroup {
  shape: GroupShape;
  label: { x: number; y: number; w: number };
  /** A hidden nested group folds into the visible collapsed ancestor. */
  foldTo: string | null;
}
interface GeoEdge {
  path: Float64Array;
  samples: Float64Array;
  back: boolean;
  hidden: boolean;
  from: string;
  to: string;
  /** Ends in an arrowhead (merge branches end at their junction instead). */
  arrow: boolean;
}
/** A junction dot or an edge label, laid out like a small node. */
interface GeoCarrier {
  x: number;
  y: number;
  w: number;
  h: number;
  visible: boolean;
}
interface Geo {
  orient: EngineOrientation;
  width: number;
  height: number;
  crossings: number;
  ms: number;
  nodes: Map<string, GeoNode>;
  groups: Map<string, GeoGroup>;
  edges: Map<string, GeoEdge>;
  carriers: Map<string, GeoCarrier>;
  /** Doc edge id → the carrier (label or junction) it runs through or into. */
  carrierOf: Map<string, string>;
}
interface Shown {
  nodes: Map<string, { x: number; y: number; o: number }>;
  carriers: Map<string, { x: number; y: number; o: number }>;
  edges: Map<string, { s: Float64Array; o: number }>;
  groups: Map<string, { shape: GroupShape; label: { x: number; y: number; w: number }; pc: Pt; o: number; po: number }>;
}
/**
 * How an edit ends: `save` keeps the words (↵, Esc, a click away) and the item stays selected (Al,
 * 2026-10-04); `discard` puts the original back (only when the document is replaced).
 */
type FinishEdit = 'save' | 'discard';
interface EditState {
  id: string;
  kind: 'node' | 'group' | 'edge';
  original: string;
  isNew: boolean;
  entry: Entry | null;
  ta: HTMLTextAreaElement;
}
interface GroupEls {
  box: SVGPathElement;
  label: HTMLDivElement | HTMLButtonElement;
  proxy: HTMLDivElement | HTMLButtonElement;
}
interface EdgeEls {
  path: SVGPathElement;
  arrow: SVGPathElement;
}
/** What a pointer is over, for clicks and for dropping a link. */
type Hit = { type: 'node' | 'group' | 'chev' | 'edge' | 'empty'; id: string | null };
/**
 * The link list. `out` (E): pick a node or an edge to link the source node to. `in` (⇧E, the
 * reverse link): pick a node to link into the source node. `new` (⇧N, or ⇧-click on Add node, with
 * nothing selected; `source` is empty): pick nodes for a new node to link before (↵) or after (⇧↵).
 * ⌘-click / ⌘↵ checks a row, ⇧-click checks every row between it and the last one checked; a pick
 * acts on the checked rows and the picked one together.
 */
interface Linker {
  source: string;
  dir: 'out' | 'in' | 'new';
  filter: string;
  active: number;
  items: LinkItem[];
  receipt: string | null;
  focusInput: boolean;
  /** Checked rows (`kind:id`, in the order checked); they survive filtering. */
  checked: string[];
  /** The row a ⇧-click range starts from: the last one checked or unchecked. */
  anchor: string | null;
}
interface LinkItem {
  kind: 'node' | 'edge';
  id: string;
  text: string;
  sub: string;
  empty: boolean;
}

export interface LodeFlowLayoutInfo {
  orientation: EngineOrientation;
  width: number;
  height: number;
  crossings: number;
  /** Engine time for the chosen direction (a call that placed two directions splits its time between them). */
  ms: number;
  /** Where the last re-layout frame spent its time (milliseconds). */
  timing: LodeFlowTiming | null;
}

/** One re-layout frame, from updating the DOM to drawing the first frame of the new layout. */
export interface LodeFlowTiming {
  /** Creating, updating and removing elements to match the document. */
  syncMs: number;
  /** Reading every node's rendered size (forces the browser to lay out the text). */
  measureMs: number;
  /** All engine calls. Auto places two directions per call (one per direction with incremental layout). */
  engineMs: number;
  engineRuns: number;
  /** Layouts reused from the previous frame because the engine input had not changed. */
  engineReused: number;
  /** Everything else in the re-layout: turning results into geometry, camera, anchors. */
  restMs: number;
  /** Writing positions and paths for the first frame. */
  drawMs: number;
  totalMs: number;
  nodes: number;
  edges: number;
}

function h<T extends keyof HTMLElementTagNameMap>(tag: T, cls = '', attrs: Record<string, string> = {}): HTMLElementTagNameMap[T] {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}
function svg<T extends keyof SVGElementTagNameMap>(tag: T, cls = ''): SVGElementTagNameMap[T] {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  if (cls) el.setAttribute('class', cls);
  return el;
}
function kbd(s: string) {
  return `<kbd>${s}</kbd>`;
}
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const reducedMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** A host action, independent of editing or selection. */
export interface LodeFlowActivation {
  id: string;
  node: M.FlowNode;
  trigger: 'pointer' | 'keyboard';
}

export interface LodeFlowGroupActivation {
  id: string;
  group: M.FlowGroup;
  trigger: LodeFlowActivation['trigger'];
}

export class LodeFlowElement extends Base {
  static get observedAttributes() {
    return ['orientation', 'bias', 'compactness', 'incremental', 'tight-groups', 'untangle', 'node-width', 'fit-min', 'readonly', 'presentation', 'node-activation', 'group-activation', 'empty-hint', 'storage-key', 'src', 'wheel', 'auto-orientations'];
  }

  // ----- state -----
  private _doc: FlowDoc = M.emptyDoc();
  /** Host action availability is independent of diagram content, history and persistence. */
  private disabledActions = new Set<string>();
  private pendingGraphReveal: 'layout' | 'scroll' | null = null;
  private view: ViewState = { cam: { x: 0, y: 0, z: 1, r: 0 }, follow: true, sel: [] };
  private hist = new History();
  /** Loads keep recoverable history, but Undo enters the toolbar only after an action. */
  private undoDisplay: 'awaiting-action' | 'active' = 'awaiting-action';
  private tun: Tunables = { ...TUNABLE_DEFAULTS };
  private eng: LayoutEngine | null = null;
  private geo: Geo | null = null;
  private shown: Shown = { nodes: new Map(), carriers: new Map(), edges: new Map(), groups: new Map() };
  private from: Shown | null = null;
  private t0 = 0;
  private dur = 0;
  private camShown: Camera = { x: 0, y: 0, z: 1, r: 0 };
  private camFrom: Camera | null = null;
  private camT0 = 0;
  private camDur = 0;
  private sizes = new Map<string, { w: number; h: number }>();
  private headers = new Map<string, number>();
  private groupLabelSizes = new Map<string, { w: number; h: number }>();
  private autoPick: EngineOrientation | null = null;
  private editing: EditState | null = null;
  /** The edge label being written (it gets its carrier while still empty). */
  private labelDraft: { edge: string; text: string } | null = null;
  private linker: Linker | null = null;
  /** S steps through the edges of this node. */
  private edgeCycle: { pivot: string; at: number } | null = null;
  private hoverEdge: string | null = null;
  private persistTimer = 0;
  /** The longest saved history (index into HISTORY_LIMITS) that fitted last time. */
  private histFit = 0;
  private saves = 0;
  private saveProblem: string | null = null;
  private dirtySel = false;
  private drawnGeo: Geo | null = null;
  private redraw = true;
  private linkerDoc: FlowDoc | null = null;
  private engineCache = new Map<string, LayoutResult[]>();
  private pass: { measureMs: number; engineMs: number; engineRuns: number; engineReused: number } | null = null;
  private timing: LodeFlowTiming | null = null;
  private lastPointerType = 'mouse';
  private linkMark: { el: Element; cls: string } | null = null;
  /** Screen boxes of floating controls placed earlier this frame, for later ones to keep clear of. */
  private uiRects: Rect[] = [];
  private magAt: Pt = { x: 0, y: 0 };
  private panel: null | { at: 'puck' | Pt } = null;
  private exhaustive = false;
  private helpOpen = false;
  private raf = 0;
  private dirtyDom = true;
  private dirtyLayout = true;
  private pendingAnchor: { id: string; screen: Pt } | null = null;
  private error: string | null = null;
  private connected = false;
  private lastPointer: Pt | null = null;
  private readonly_ = false;
  private storageKey: string | null = null;
  /** Preserve a saved document/history rejected by this embed's item cap until an explicit load. */
  private blockedStorageKey: string | null = null;
  private wheelMode: 'auto' | 'always' | 'modifier' = 'auto';
  private autoCandidates: EngineOrientation[] = ['lr', 'tb'];
  private attrSettings: Partial<M.FlowSettings> = {};
  private vw = 0;
  private vh = 0;

  // ----- DOM -----
  private root!: ShadowRoot;
  private vp!: HTMLDivElement;
  private world!: HTMLDivElement;
  private gLayer!: SVGGElement;
  private eLayer!: SVGGElement;
  private nLayer!: HTMLDivElement;
  private nodeMag!: HTMLDivElement;
  private nodeMagBar!: HTMLDivElement;
  private puck!: HTMLDivElement;
  private panelEl!: HTMLDivElement;
  private helpEl!: HTMLDivElement;
  private emptyEl!: HTMLDivElement;
  private kickstarterEl!: HTMLDivElement;
  private ringEl!: HTMLDivElement;
  private marqueeEl!: HTMLDivElement;
  private nudgeEl!: HTMLDivElement;
  private live!: HTMLDivElement;
  private nodeEls = new Map<string, HTMLElement>();
  private carrierEls = new Map<string, HTMLDivElement>();
  private linkLine!: SVGPathElement;
  private linkHead!: SVGPathElement;
  private linkerEl!: HTMLDivElement;
  private groupEls = new Map<string, GroupEls>();
  private edgeEls = new Map<string, EdgeEls>();
  private ro: ResizeObserver | null = null;
  private sizeRo: ResizeObserver | null = null;
  private nodeMagKey = '';
  private magSizes: { w: number; h: number; cost: number }[] | null = null;
  private puckKey = '';

  // ----- gestures -----
  private pointers = new Map<number, Pt>();
  private gesture:
    | null
    | {
        kind: 'pending' | 'pan' | 'marquee' | 'pinch' | 'link';
        id: number;
        start: Pt;
        last: Pt;
        before: Snapshot;
        target: Hit;
        /** While linking: what the pointer is over, and whether dropping there links. */
        over?: { hit: Hit; ok: boolean; why: string | null };
        /** While linking: edge pan moved the view (one Pan step when the drag ends). */
        panned?: boolean;
        /** This press ended an edit: a click on empty canvas then only leaves Edit mode, keeping the selection. */
        endedEdit?: boolean;
        shift: boolean;
        toggle: boolean;
        button: number;
        pointerType: string;
        longPress: number;
        pinch?: { d0: number; a0: number; cam0: Camera; mid0: Pt; world0: Pt; rotating: boolean; zoomed: boolean };
      } = null;
  /** A link drag held near the frame's edge moves the view toward it (`edgePanFrame`). */
  private edgePan: { raf: number; t: number; since: number } | null = null;
  private lastTap: { t: number; x: number; y: number; target: string | null } | null = null;
  private spaceDown = false;
  private nudgeTimer = 0;

  constructor() {
    super();
    if (typeof document === 'undefined') return;
    this.root = this.attachShadow({ mode: 'open' });
    this.buildDom();
  }

  // =====================================================================
  // Public API
  // =====================================================================

  private get graphPresentation() { return this.getAttribute('presentation') === 'graph'; }
  private get eventActivation() { return this.getAttribute('node-activation') === 'event'; }
  private get groupActivation() { return this.graphPresentation && this.getAttribute('group-activation') === 'event'; }
  private get touchContext() { return this.lastPointerType === 'touch' || (typeof matchMedia !== 'undefined' && matchMedia('(any-pointer: coarse)').matches); }

  private activateNode(id: string, trigger: LodeFlowActivation['trigger']) {
    const node = M.nodeById(this._doc, id);
    if (node && !this.disabledActions.has(id)) this.emit('lode-activate', { id, node, trigger } satisfies LodeFlowActivation);
  }

  private activateGroup(id: string, trigger: LodeFlowActivation['trigger']) {
    const group = M.groupById(this._doc, id);
    if (group && this.groupActivation) this.emit('lode-group-activate', { id, group, trigger } satisfies LodeFlowGroupActivation);
  }

  /** Disabled native node actions. IDs may be supplied before their nodes are added. */
  get disabledNodeIds(): string[] { return [...this.disabledActions]; }
  set disabledNodeIds(ids: readonly string[]) {
    if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) throw new TypeError('disabledNodeIds must be an array of node IDs');
    const next = new Set(ids);
    if (next.size === this.disabledActions.size && [...next].every((id) => this.disabledActions.has(id))) return;
    this.disabledActions = next;
    this.dirtyDom = true;
    this.schedule();
  }

  /** The diagram document. Setting it replaces the content and clears history. */
  get doc(): FlowDoc {
    return this._doc;
  }
  set doc(d: FlowDoc) {
    if (d === this._doc) {
      this.undoDisplay = 'awaiting-action';
      this.schedule();
      return;
    }
    this.setDoc(d);
  }

  setDoc(raw: unknown, opts: { resetHistory?: true; discardPendingSave?: boolean } | { resetHistory: false; discardPendingSave?: never } = {}) {
    if (opts.resetHistory === false && opts.discardPendingSave) throw new TypeError('discardPendingSave requires history reset');
    const doc = M.normalizeDoc(raw, this.attrSettings);
    this.requireWithinLimit(doc);
    // A save still waiting belongs to the document being replaced.
    if (opts.discardPendingSave) {
      clearTimeout(this.persistTimer);
      this.persistTimer = 0;
    } else if (this.persistTimer) this.saveNow();
    this.blockedStorageKey = null;
    this.diveOpened.clear();
    if (opts.resetHistory === false) {
      this.undoDisplay = 'awaiting-action';
      this.commit('Load', 'load', { doc, view: { sel: [] } });
      this.schedule();
      return;
    }
    this.finishEdit('discard');
    // Abandoning a new node can schedule a save of the old document too.
    if (opts.discardPendingSave) {
      clearTimeout(this.persistTimer);
      this.persistTimer = 0;
    }
    this._doc = doc;
    this.view = { ...this.view, sel: this.view.sel.filter((id) => this.exists(id)), follow: true };
    // A new document chooses its own direction; the previous one's choice must not stick.
    this.autoPick = null;
    this.hist.clear();
    this.undoDisplay = 'awaiting-action';
    this.invalidate(true);
    this.emitHistory();
  }

  get selection(): string[] {
    return [...this.view.sel];
  }
  select(ids: string[]) {
    const sel = ids.filter((id) => this.exists(id));
    // A host can mark the current step of a graph without making editor history.
    if (this.graphPresentation) {
      this.view = { ...this.view, sel };
      this.dirtySel = true;
      this.schedule();
      this.emit('lode-select', { selection: [...sel] });
      return;
    }
    this.commit('Select', 'select', { view: { sel } });
  }

  /** Give keyboard gestures to the diagram after a host control selects an item. */
  override focus(options?: FocusOptions) {
    this.vp?.focus(options);
  }

  /** Editor: one Show/Pan step. Graph: reveal minimally at the current zoom, without history. */
  showSelection() {
    if (this.graphPresentation) {
      this.pendingGraphReveal = 'layout';
      this.schedule();
      return;
    }
    this.locateSelection();
  }

  get itemCount(): number { return countItems(this._doc); }
  get maxItems(): number | null { return parseMaxItems(this.getAttribute('max-items')); }

  /** Collapse or expand every group, including nested groups, in one undoable change. */
  setAllGroupsCollapsed(collapsed: boolean, opts: { fit?: boolean } = {}) {
    if (this.readonly_ || !this._doc.groups.length) return;
    this.diveOpened.clear();
    const changed = this._doc.groups.some((g) => !!g.collapsed !== collapsed);
    if (!changed && !opts.fit) return;
    const doc = changed ? { ...this._doc, groups: this._doc.groups.map((g) => !!g.collapsed === collapsed ? g : { ...g, collapsed }) } : this._doc;
    const view = opts.fit ? { cam: this.geo ? this.fitCamera(this.geo) : this.view.cam, follow: true } : undefined;
    this.commit(collapsed ? 'Collapse all groups' : 'Expand all groups', 'collapse', { doc, view });
  }

  get layoutInfo(): LodeFlowLayoutInfo | null {
    const g = this.geo;
    return g ? { orientation: g.orient, width: g.width, height: g.height, crossings: g.crossings, ms: g.ms, timing: this.timing } : null;
  }

  get camera(): Camera {
    return { ...this.view.cam };
  }

  get canUndo() {
    return this.hist.canUndo;
  }
  get canRedo() {
    return this.hist.canRedo;
  }

  undo() {
    if (this.graphPresentation) return;
    const ed = this.editing;
    const before = this.hist.index;
    this.finishEdit('save');
    // An empty new node vanishes as its edit ends, and its "Add" with it: that was this undo.
    // (If a "Discard empty node" step had to be recorded instead, undoing it would bring the node
    // straight back, so stop there too.)
    if (ed?.isNew && this.hist.index !== before) return;
    const target = this.hist.peekUndo();
    if (target && !this.acceptWithinLimit(target.before.doc)) return;
    const e = this.hist.undo();
    if (!e) return;
    this.restore(e.before, e);
    this.announce(`Undid ${e.label}`);
  }

  redo() {
    if (this.graphPresentation) return;
    const ed = this.editing;
    const before = this.hist.index;
    this.finishEdit('save');
    if (ed?.isNew && this.hist.index !== before) return;
    const target = this.hist.peekRedo();
    if (target && !this.acceptWithinLimit(target.after.doc)) return;
    const e = this.hist.redo();
    if (!e) return;
    this.restore(e.after, e);
    this.announce(`Redid ${e.label}`);
  }

  /**
   * Express rewind (⌥⌘Z): undoes the latest change that is not a camera move and leaves the view
   * where it is. The camera moves made since are moved ahead of that change in the history
   * (`History.expressUndo`), so zooming out, rewinding and fast-forwarding replays the change with
   * more of the diagram in view; ⌘Z then takes the change back and, after it, the zoom.
   */
  rewind() {
    if (this.graphPresentation) return;
    const ed = this.editing;
    const before = this.hist.index;
    this.finishEdit('save');
    if (ed?.isNew && this.hist.index !== before) return;
    const target = this.hist.entries.slice(0, this.hist.index).reverse().find((e) => !CAMERA_KINDS.has(e.kind));
    if (target && !this.acceptWithinLimit(target.before.doc)) return;
    const e = this.hist.expressUndo();
    if (!e) return this.nudge(this.hintPoint(), `Nothing to rewind but camera moves — ${K.undo} undoes those`);
    this.restore(e.before, e);
    this.announce(`Rewound ${e.label}`);
  }

  /** Express fast-forward (⇧⌥⌘Z): redoes the next change that is not a camera move, in the current view. */
  fastForward() {
    if (this.graphPresentation) return;
    const ed = this.editing;
    const before = this.hist.index;
    this.finishEdit('save');
    if (ed?.isNew && this.hist.index !== before) return;
    const target = this.hist.entries.slice(this.hist.index).find((e) => !CAMERA_KINDS.has(e.kind));
    if (target && !this.acceptWithinLimit(target.after.doc)) return;
    const e = this.hist.expressRedo();
    if (!e) return this.nudge(this.hintPoint(), `Nothing to fast-forward but camera moves — ${K.redo} redoes those`);
    this.restore(e.after, e);
    this.announce(`Fast-forwarded ${e.label}`);
  }

  /** Fit the whole diagram in view and follow it through later changes. */
  fit() {
    const cam = this.geo ? this.fitCamera(this.geo) : this.view.cam;
    if (this.graphPresentation) {
      this.view = { ...this.view, cam, follow: true };
      this.camShown = { ...cam };
      this.camFrom = null;
      this.schedule();
      return;
    }
    this.commit('Fit to view', 'fit', { view: { cam, follow: true } });
  }

  /** Everything needed to rebuild this editor later: content plus undo history. */
  getState() {
    return { doc: this._doc, history: this.hist.toJSON(), view: this.view };
  }
  setState(state: { doc?: unknown; history?: unknown; view?: Partial<ViewState> }) {
    // Validate the entire incoming transaction before replacing content, selection or history.
    const doc = M.normalizeDoc(state.doc ?? this._doc, this.attrSettings);
    this.requireWithinLimit(doc);
    const hist = state.history ? History.fromJSON(state.history) : new History();
    if (state.history) {
      // Histories saved before merges existed hold documents without junctions.
      hist.entries = hist.entries.map((e) => {
        const before = { ...e.before, doc: M.withDefaults(e.before.doc) };
        const after = { ...e.after, doc: M.withDefaults(e.after.doc) };
        this.requireWithinLimit(before.doc);
        this.requireWithinLimit(after.doc);
        return { ...e, before, after };
      });
    }
    this.setDoc(doc);
    this.hist = hist;
    if (state.view) {
      const v = state.view;
      this.view = {
        cam: v.cam && Number.isFinite(v.cam.z) ? { ...v.cam } : this.view.cam,
        follow: v.follow ?? true,
        sel: Array.isArray(v.sel) ? v.sel.filter((id) => this.exists(id)) : [],
      };
      this.camShown = { ...this.view.cam };
    }
    this.invalidate(true);
    this.emitHistory();
  }

  // =====================================================================
  // Lifecycle
  // =====================================================================

  connectedCallback() {
    if (!this.root) return;
    this.connected = true;
    try {
      this.eng = engine();
    } catch (err) {
      this.error = `Layout engine failed to load: ${(err as Error).message}`;
    }
    this.readAttributes();
    if (this._doc.nodes.length === 0 && this._doc.groups.length === 0) this.loadInitial();
    this.ro = new ResizeObserver(() => this.onResize());
    this.ro.observe(this.vp);
    // Only a real change of size re-lays out. A newly observed element reports once, and a size
    // the last layout already measured reports again; neither needs a second layout.
    this.sizeRo = new ResizeObserver((entries) => {
      if (entries.some((en) => this.sizeChanged(en.target as HTMLElement))) {
        this.dirtyLayout = true;
        this.schedule();
      }
    });
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', this.onHide);
      document.addEventListener('visibilitychange', this.onHide);
      window.addEventListener('keydown', this.onShift);
      window.addEventListener('keyup', this.onShift);
      window.addEventListener('blur', this.onShift);
      window.addEventListener('focus', this.syncRing);
      window.addEventListener('blur', this.syncRing);
    }
    this.syncRing();
    if (typeof document !== 'undefined' && (document as any).fonts?.ready) {
      (document as any).fonts.ready.then(() => this.invalidate(false));
    }
    this.invalidate(true);
  }

  disconnectedCallback() {
    this.connected = false;
    if (this.persistTimer) this.saveNow();
    if (typeof window !== 'undefined') {
      window.removeEventListener('pagehide', this.onHide);
      document.removeEventListener('visibilitychange', this.onHide);
      window.removeEventListener('keydown', this.onShift);
      window.removeEventListener('keyup', this.onShift);
      window.removeEventListener('blur', this.onShift);
      window.removeEventListener('focus', this.syncRing);
      window.removeEventListener('blur', this.syncRing);
    }
    this.ro?.disconnect();
    this.sizeRo?.disconnect();
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  attributeChangedCallback(name: string, _old: string | null, val: string | null) {
    if (!this.root) return;
    switch (name) {
      case 'orientation':
      case 'bias':
      case 'compactness':
      case 'incremental':
      case 'tight-groups':
      case 'untangle': {
        this.readAttributes();
        const s = { ...this._doc.settings, ...this.attrSettings };
        if (JSON.stringify(s) !== JSON.stringify(this._doc.settings)) {
          this._doc = { ...this._doc, settings: s };
          this.invalidate(false);
        }
        break;
      }
      case 'node-width': {
        const w = Number(val);
        if (Number.isFinite(w) && w >= 60) {
          this.tun.nodeWidth = w;
          this.applyNodeWidth();
          this.invalidate(false);
        }
        break;
      }
      case 'fit-min': {
        const z = parseFitMin(val);
        if (z !== null) {
          this.tun.fitMin = z;
          this.invalidate(false);
        }
        break;
      }
      case 'readonly':
      case 'presentation':
      case 'node-activation':
      case 'group-activation':
        this.finishEdit('save');
        this.readAttributes();
        if (!this.graphPresentation) this.pendingGraphReveal = null;
        if (this.graphPresentation) {
          this.closePanel();
          this.closeHelp(false);
          this.closeLinker(false);
          if (this.gesture?.longPress) clearTimeout(this.gesture.longPress);
          this.gesture = null;
          this.pointers.clear();
          this.vp.classList.remove('panning', 'linking');
          this.marqueeEl.hidden = true;
        }
        this.invalidate(true);
        break;
      case 'empty-hint':
        this.schedule();
        break;
      case 'storage-key':
        // A save still waiting belongs to the old key and the document it was made on.
        if (this.persistTimer && val !== this.storageKey) this.saveNow();
        this.storageKey = val;
        break;
      case 'wheel':
        this.wheelMode = val === 'always' || val === 'modifier' ? val : 'auto';
        // A full-page diagram owns every gesture from the first touch.
        this.vp.classList.toggle('captured', this.wheelMode === 'always');
        break;
      case 'auto-orientations': {
        const list = (val ?? '').split(/[\s,]+/).filter((x) => ['lr', 'rl', 'tb', 'bt', 'in-out', 'out-in'].includes(x)) as EngineOrientation[];
        this.autoCandidates = list.length ? list : ['lr', 'tb'];
        this.autoPick = null;
        this.invalidate(false);
        break;
      }
      case 'src':
        if (val && this.connected) this.loadSrc(val);
        break;
    }
  }

  private readAttributes() {
    const s: Partial<M.FlowSettings> = {};
    const o = this.getAttribute('orientation');
    if (o && (M.ORIENTATIONS as string[]).includes(o)) s.orientation = o as Orientation;
    const b = this.getAttribute('bias');
    if (b === 'start' || b === 'end') s.bias = b;
    const c = this.getAttribute('compactness');
    if (c && (M.COMPACTNESS as string[]).includes(c)) s.compactness = c as Compactness;
    if (this.hasAttribute('incremental')) s.incremental = this.getAttribute('incremental') !== 'false';
    if (this.hasAttribute('tight-groups')) s.tightGroups = this.getAttribute('tight-groups') !== 'false';
    if (this.hasAttribute('untangle')) s.untangle = this.getAttribute('untangle') !== 'false';
    this.attrSettings = s;
    this.readonly_ = this.graphPresentation || (this.hasAttribute('readonly') && this.getAttribute('readonly') !== 'false');
    this.vp.tabIndex = this.graphPresentation ? -1 : 0;
    this.vp.setAttribute('role', this.graphPresentation ? 'group' : 'application');
    this.storageKey = this.getAttribute('storage-key');
    const w = Number(this.getAttribute('node-width'));
    if (Number.isFinite(w) && w >= 60) this.tun.nodeWidth = w;
    const z = parseFitMin(this.getAttribute('fit-min'));
    if (z !== null) this.tun.fitMin = z;
  }

  /** Tunable defaults as this embed's attributes set them. */
  private attrTunables(): Tunables {
    const t = { ...TUNABLE_DEFAULTS };
    const w = Number(this.getAttribute('node-width'));
    if (Number.isFinite(w) && w >= 60) t.nodeWidth = w;
    const z = parseFitMin(this.getAttribute('fit-min'));
    if (z !== null) t.fitMin = z;
    return t;
  }

  private loadInitial() {
    // 1) Saved state for this storage key (content + history survive reloads).
    if (this.storageKey) {
      try {
        const raw = localStorage.getItem(`lodeflow:${this.storageKey}`);
        if (raw) {
          const st = JSON.parse(raw);
          // Since 2026-10-01 the history lives under its own key, tagged with the document's revision.
          if (!st.history) {
            try {
              const h = JSON.parse(localStorage.getItem(`lodeflow:${this.storageKey}:history`) || 'null');
              if (h && h.rev === st.rev) st.history = h.history;
            } catch {
              /* no usable history: the document still loads */
            }
          }
          try {
            this.setState(st);
          } catch (err) {
            if (!(err instanceof RangeError)) throw err;
            this.blockedStorageKey = this.storageKey;
            this.error = `Saved diagram was not loaded: ${err.message} The saved data is unchanged. Load it in an uncapped editor or reset this demo to continue.`;
            return;
          }
          if (st?.tunables) this.tun = { ...this.attrTunables(), ...st.tunables };
          this.applyNodeWidth();
          return;
        }
      } catch {
        /* storage unavailable: fall through */
      }
    }
    // 2) Inline JSON: <lode-flow><script type="application/json">…</script></lode-flow>
    const script = this.querySelector('script[type="application/json"]');
    if (script?.textContent?.trim()) {
      try {
        this.setDoc(JSON.parse(script.textContent));
      } catch (err) {
        this.error = `Could not read the inline diagram JSON: ${(err as Error).message}`;
      }
    } else {
      this._doc = M.emptyDoc(this.attrSettings);
    }
    this.applyNodeWidth();
    // 3) src="…" loads asynchronously.
    const src = this.getAttribute('src');
    if (src) this.loadSrc(src);
  }

  private async loadSrc(src: string) {
    try {
      const res = await fetch(src);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      this.setDoc(await res.json());
    } catch (err) {
      this.error = `Could not load ${src}: ${(err as Error).message}`;
      this.invalidate(false);
    }
  }

  /**
   * Saves shortly after a burst of changes (serialising a large history on every click costs
   * frames), and at once when the page is hidden or closed.
   */
  private persist() {
    if (this.graphPresentation) return;
    if (!this.storageKey || this.blockedStorageKey === this.storageKey) return;
    clearTimeout(this.persistTimer);
    this.persistTimer = window.setTimeout(() => this.saveNow(), 250);
  }

  /** While ⇧ is held, the two-way buttons (selection, Layout pill, lists) show their reverse (see flipBtn). */
  /**
   * The focus ring: on while keys reach the component (focus inside it, and the page itself has
   * focus), thick while nothing is selected. Checked after the event, since mid-focusout the next
   * element has not taken focus yet.
   */
  private syncRing = () => queueMicrotask(() => this.drawRing());

  private drawRing() {
    if (!this.ringEl) return;
    const on = !!this.root.activeElement && (typeof document === 'undefined' || document.hasFocus());
    const empty = on && !this.view.sel.length;
    if (this.ringEl.classList.contains('on') !== on) this.ringEl.classList.toggle('on', on);
    if (this.ringEl.classList.contains('empty') !== empty) this.ringEl.classList.toggle('empty', empty);
  }

  private onShift = (e: Event) => {
    const on = e.type !== 'blur' && (e as KeyboardEvent).shiftKey;
    for (const box of [this.nodeMag, this.puck, this.linkerEl]) if (box.classList.contains('shift') !== on) box.classList.toggle('shift', on);
  };

  private onHide = () => {
    if (this.persistTimer && (document.visibilityState === 'hidden' || !this.connected)) this.saveNow();
  };

  /**
   * The document first, under its own key: it must survive. Then as much undo history as fits,
   * under a second key tagged with the same revision, so a stale history never meets a newer
   * document. A full store is announced and shown on the Layout pill, never swallowed.
   */
  private saveNow() {
    clearTimeout(this.persistTimer);
    this.persistTimer = 0;
    if (this.graphPresentation || !this.storageKey || this.blockedStorageKey === this.storageKey) return;
    const key = `lodeflow:${this.storageKey}`;
    const rev = Date.now();
    let problem: string | null = null;
    const state = JSON.stringify({ v: 2, rev, doc: this._doc, view: this.view, tunables: this.tun });
    const dropHistory = () => {
      try {
        localStorage.removeItem(`${key}:history`);
      } catch {
        /* nothing to remove */
      }
    };
    const tryDoc = () => {
      try {
        localStorage.setItem(key, state);
        return true;
      } catch {
        return false;
      }
    };
    // A document comes before any saved undo history: when the store is full, make room by
    // dropping this diagram's own history, then other diagrams' (largest first). Their documents,
    // and every diagram's in-memory history, are never touched.
    if (!tryDoc()) {
      dropHistory();
      let saved = tryDoc();
      if (!saved) {
        let others: { k: string; n: number }[] = [];
        try {
          for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && k.startsWith('lodeflow:') && k.endsWith(':history') && k !== `${key}:history`) others.push({ k, n: localStorage.getItem(k)?.length ?? 0 });
          }
        } catch {
          others = [];
        }
        for (const o of others.sort((a, b) => b.n - a.n)) {
          try {
            localStorage.removeItem(o.k);
          } catch {
            /* keep going */
          }
          if ((saved = tryDoc())) break;
        }
      }
      if (!saved) problem = 'This browser’s storage is full or blocked, so this diagram is not being saved.';
    }
    if (!problem) {
      // Start from the length that fitted last time, so a nearly full store does not cost a long
      // history written and refused on every save. Every tenth save tries one step longer, in
      // case space was freed.
      let kept = false;
      const from = this.saves++ % 10 === 0 ? Math.max(0, this.histFit - 1) : this.histFit;
      for (let i = from; i < HISTORY_LIMITS.length; i++) {
        try {
          localStorage.setItem(`${key}:history`, JSON.stringify({ rev, history: this.hist.toJSON(HISTORY_LIMITS[i]) }));
          this.histFit = i;
          kept = true;
          break;
        } catch {
          /* too big: try a shorter history */
        }
      }
      if (!kept) dropHistory();
    }
    if (problem !== this.saveProblem) {
      this.saveProblem = problem;
      this.puckKey = '';
      this.schedule();
      if (problem) this.announce(problem);
      this.emit('lode-save', { ok: !problem, problem });
    }
  }

  // =====================================================================
  // DOM construction
  // =====================================================================

  private buildDom() {
    const style = document.createElement('style');
    style.textContent = CSS;
    this.root.appendChild(style);

    this.vp = h('div', 'vp', { tabindex: '0', role: 'application', 'aria-roledescription': 'flow diagram', 'aria-label': 'Flow diagram' });
    this.world = h('div', 'world');
    const layer = svg('svg', 'layer');
    this.gLayer = svg('g', 'groups');
    this.eLayer = svg('g', 'edges');
    const xLayer = svg('g', 'linking');
    this.linkLine = svg('path', 'linkline');
    this.linkHead = svg('path', 'linkhead');
    xLayer.append(this.linkLine, this.linkHead);
    layer.append(this.gLayer, this.eLayer, xLayer);
    this.nLayer = h('div', 'nodes');
    this.world.append(layer, this.nLayer);
    this.emptyEl = h('div', 'empty');
    this.marqueeEl = h('div', 'marquee');
    this.marqueeEl.hidden = true;
    this.vp.append(this.world, this.emptyEl, this.marqueeEl);
    // The frame's edge says whether keys reach the diagram: thin blue with something selected, thick
    // blue with nothing selected (↵ selects the top level), none when keys go elsewhere.
    this.ringEl = h('div', 'ring', { 'aria-hidden': 'true' });

    // Magnet: selection controls.
    this.nodeMag = h('div', 'ui magnet node-magnet', { role: 'toolbar', 'aria-label': 'Selection' });
    this.nodeMagBar = h('div', 'bar');
    this.nodeMag.append(this.nodeMagBar);
    this.nodeMag.hidden = true;
    // ⇧ pressed while the page was in the background reaches here first.
    this.nodeMag.addEventListener('pointermove', this.onShift);

    // Magnet: diagram controls, clinging to the diagram's corner.
    this.puck = h('div', 'ui magnet puck', { role: 'toolbar', 'aria-label': 'Diagram' });
    this.kickstarterEl = h('div', 'kickstarter');
    this.kickstarterEl.innerHTML = '<div>Double-click anywhere</div><div>to add the first node</div><div class="or">or</div>';
    this.kickstarterEl.hidden = true;
    this.panelEl = h('div', 'ui panel', { role: 'dialog', 'aria-label': 'Diagram layout' });
    this.panelEl.hidden = true;
    this.helpEl = h('div', 'ui help', { role: 'dialog', 'aria-label': 'Gestures and keys' });
    this.helpEl.hidden = true;
    this.nudgeEl = h('div', 'nudge');
    this.nudgeEl.hidden = true;
    this.live = h('div', 'sr', { 'aria-live': 'polite' });
    this.linkerEl = h('div', 'ui linker', { role: 'dialog' });
    this.linkerEl.hidden = true;
    // Once, here: the list's contents are rebuilt on every open, the element itself is not.
    this.linkerEl.addEventListener('keydown', (e) => this.onLinkerKey(e));
    this.linkerEl.addEventListener('pointermove', this.onShift);
    this.puck.addEventListener('pointermove', this.onShift);

    this.root.append(this.vp, this.ringEl, this.nodeMag, this.linkerEl, this.kickstarterEl, this.puck, this.panelEl, this.helpEl, this.nudgeEl, this.live);

    // Events
    this.vp.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    this.vp.addEventListener('pointermove', (e) => this.onPointerMove(e));
    this.vp.addEventListener('pointerup', (e) => this.onPointerUp(e));
    this.vp.addEventListener('pointercancel', (e) => this.onPointerUp(e, true));
    this.vp.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    this.vp.addEventListener('contextmenu', (e) => this.onContextMenu(e));
    // Graph presentation keeps native page scrolling and button-like pointer activation.
    this.vp.addEventListener('click', (e) => {
      if (!this.graphPresentation) return;
      const id = (e.target as Element).closest('.node[data-id]')?.getAttribute('data-id');
      const group = (e.target as Element).closest('.group-action[data-gid]')?.getAttribute('data-gid');
      const trigger = e.detail === 0 ? 'keyboard' : 'pointer';
      if (id && this.eventActivation) this.activateNode(id, trigger);
      else if (group) this.activateGroup(group, trigger);
    });
    this.vp.addEventListener('focus', () => this.vp.classList.add('active'));
    this.root.addEventListener('focusin', this.syncRing);
    this.root.addEventListener('focusout', this.syncRing);
    this.vp.addEventListener('blur', () => this.vp.classList.remove('active'));
    this.root.addEventListener('keydown', (e) => {
      const k = (e as KeyboardEvent).key;
      if (k === 'Tab' || k.startsWith('Arrow') || k === 'Enter') this.vp.classList.add('kbd');
      this.onKeyDown(e as KeyboardEvent);
    });
    this.root.addEventListener('pointerdown', (e) => {
      this.vp.classList.remove('kbd');
      this.lastPointerType = (e as PointerEvent).pointerType;
    }, { capture: true });
    this.root.addEventListener('pointerup', () => {
      // Keep a first touch's target still until the press is released.
      requestAnimationFrame(() => {
        if (this.vp.classList.contains('touch') === this.touchContext) return;
        this.vp.classList.toggle('touch', this.touchContext);
        this.dirtyDom = true;
        this.dirtySel = true;
        this.puckKey = '';
        this.magSizes = null;
        if (this.helpOpen) this.openHelp();
        this.schedule();
      });
    }, { capture: true });
    // Scrolling over a floating control still moves the diagram underneath it.
    for (const ui of [this.nodeMag, this.puck]) ui.addEventListener('wheel', (e) => this.onWheel(e as WheelEvent), { passive: false });
    // Pressing a floating control keeps the keys where they were: Safari never focuses a clicked
    // button, so the press would drop focus onto the page and ⌫, ⌘Z and every other key would stop
    // reaching the diagram. (Tab still reaches the buttons; keepFocus handles a focused one.)
    // A group's chevron would take focus on the press and then hide with its label as the group
    // folds, dropping focus onto the page: the diagram keeps it instead.
    this.vp.addEventListener('mousedown', (e) => {
      if ((e.target as Element).closest?.('.chev')) e.preventDefault();
    });
    for (const ui of [this.nodeMag, this.puck, this.panelEl])
      ui.addEventListener('mousedown', (e) => {
        const t = e.target as Element;
        const had = this.root.activeElement as HTMLElement | null;
        if (!had || t.closest?.('input, textarea, select')) return;
        if (t.closest?.('button')) return e.preventDefault();
        // A press on a control's rim, a gap or its words also drops focus onto the page. Put it back
        // once the press is over, unless the press selected words (they stay selectable).
        window.addEventListener('mouseup', () => requestAnimationFrame(() => {
          if (this.root.activeElement || !document.getSelection()?.isCollapsed) return;
          (had.isConnected ? had : this.vp).focus({ preventScroll: true });
        }), { once: true });
      });
    this.root.addEventListener('keyup', (e) => {
      if ((e as KeyboardEvent).code === 'Space') this.spaceDown = false;
    });
    // Outside clicks close the panel / help (inside the component).
    this.root.addEventListener('pointerdown', (e) => {
      const t = e.target as Element;
      if (this.panel && !this.panelEl.contains(t) && !this.puck.contains(t)) this.closePanel();
      if (this.helpOpen && !e.composedPath().includes(this.helpEl)) this.closeHelp(false);
      if (this.linker && !this.linkerEl.contains(t)) this.closeLinker(false);
    });
    // …and clicks anywhere else on the page.
    if (typeof document !== 'undefined') {
      document.addEventListener('pointerdown', (e) => {
        if (!this.connected || e.composedPath().includes(this)) return;
        if (this.panel) this.closePanel();
        if (this.helpOpen) this.closeHelp(false);
        if (this.linker) this.closeLinker(false);
      });
    }
  }

  private applyNodeWidth() {
    this.style.setProperty('--lf-node-width', `${this.tun.nodeWidth}px`);
  }

  // =====================================================================
  // State changes and history
  // =====================================================================

  private exists(id: string) {
    return !!(M.nodeById(this._doc, id) || M.groupById(this._doc, id) || M.edgeById(this._doc, id));
  }

  private snapshot(): Snapshot {
    return { doc: this._doc, view: { cam: { ...this.view.cam }, follow: this.view.follow, sel: [...this.view.sel] } };
  }

  private requireWithinLimit(doc: FlowDoc) {
    const problem = itemLimitProblem(doc, this.maxItems, this.itemCount);
    if (problem) {
      this.emit('lode-limit', problem);
      throw new RangeError(problem.message);
    }
  }

  /** Reject the whole proposed change before it can affect selection, history or an editor. */
  private acceptWithinLimit(doc: FlowDoc): boolean {
    const problem = itemLimitProblem(doc, this.maxItems, this.itemCount, true);
    if (!problem) return true;
    this.nudge(this.hintPoint(), problem.message);
    this.emit('lode-limit', problem);
    return false;
  }

  /**
   * Apply a change and record it. Content kinds relayout; view kinds only move the camera or selection.
   * Returns the entry (or null when nothing changed).
   */
  private commit(
    label: string,
    kind: EntryKind,
    next: { doc?: FlowDoc; view?: Partial<ViewState> },
    opts: { coalesce?: number; where?: Pt | null; anchor?: { id: string; screen: Pt } | null; before?: Snapshot; animateCam?: boolean } = {},
  ): Entry | null {
    if (next.doc && !this.acceptWithinLimit(next.doc)) return null;
    const before = opts.before ?? this.snapshot();
    const doc = next.doc ?? this._doc;
    const view: ViewState = { ...this.view, ...next.view };
    const selChanged = view.sel.join('\u0000') !== this.view.sel.join('\u0000');
    const docChanged = doc !== this._doc;
    const camChanged = !camEqual(view.cam, before.view.cam) || view.follow !== before.view.follow;
    if (!docChanged && !selChanged && !camChanged && !opts.before) return null;
    this._doc = doc;
    this.view = view;
    if (docChanged) {
      this.pendingAnchor = opts.anchor !== undefined ? opts.anchor : this.defaultAnchor();
      this.invalidate(true);
    } else {
      if (opts.animateCam !== false && camChanged) this.animateCamera();
      else if (camChanged) this.camShown = { ...this.view.cam };
      if (selChanged) this.dirtySel = true;
      this.schedule();
    }
    const e = this.hist.push({ label, kind, before, after: this.snapshot(), t: Date.now(), where: opts.where ?? null }, opts.coalesce ?? 0);
    this.undoDisplay = kind === 'load' ? 'awaiting-action' : 'active';
    if (docChanged) this.emit('lode-change', { doc: this._doc, label });
    if (selChanged) this.emit('lode-select', { selection: [...this.view.sel] });
    this.emitHistory();
    this.persist();
    return e;
  }

  private restore(s: Snapshot, e: Entry) {
    this.undoDisplay = 'active';
    const docChanged = s.doc !== this._doc;
    const selChanged = s.view.sel.join('\u0000') !== this.view.sel.join('\u0000');
    if (docChanged) {
      this._doc = s.doc;
      // A content transaction may also deliberately move the view (e.g. fold all and fit).
      const restoreCamera = e.before.view.follow !== e.after.view.follow || !camEqual(e.before.view.cam, e.after.view.cam);
      this.view = { cam: restoreCamera ? { ...s.view.cam } : this.view.cam, follow: s.view.follow, sel: s.view.sel.filter((id) => this.exists(id)) };
      this.pendingAnchor = restoreCamera ? null : this.defaultAnchor(e);
      if (restoreCamera) this.animateCamera();
      this.invalidate(true);
      this.emit('lode-change', { doc: this._doc, label: e.label });
    } else {
      this.view = { cam: { ...s.view.cam }, follow: s.view.follow, sel: [...s.view.sel] };
      this.animateCamera();
      if (selChanged) this.dirtySel = true;
      this.schedule();
    }
    if (selChanged) this.emit('lode-select', { selection: [...this.view.sel] });
    this.emitHistory();
    this.persist();
  }

  /** Keep what the viewer is looking at still while everything else reorganizes. */
  private defaultAnchor(e?: Entry): { id: string; screen: Pt } | null {
    if (this.view.follow || !this.geo) return null;
    const cands: string[] = [...this.view.sel];
    if (e) cands.push(...e.before.view.sel, ...e.after.view.sel);
    for (const id of cands) {
      const s = this.shownScreen(id);
      if (s) return { id, screen: s };
    }
    // Otherwise the item nearest the middle of the viewport.
    let best: { id: string; screen: Pt } | null = null;
    let bestD = Infinity;
    for (const [id] of this.shown.nodes) {
      const s = this.shownScreen(id);
      if (!s) continue;
      const d = Math.hypot(s.x - this.vw / 2, s.y - this.vh / 2);
      if (d < bestD) {
        bestD = d;
        best = { id, screen: s };
      }
    }
    return best;
  }

  private shownScreen(id: string): Pt | null {
    const n = this.shown.nodes.get(id);
    if (n && n.o > 0.5) return toScreen(this.camShown, this.vw, this.vh, n);
    const g = this.shown.groups.get(id);
    if (g) {
      const b = shapeBounds(g.shape);
      if (b) return toScreen(this.camShown, this.vw, this.vh, { x: b.x + b.w / 2, y: b.y + b.h / 2 });
    }
    const a = this.edgeAnchor(id);
    return a ? toScreen(this.camShown, this.vw, this.vh, a) : null;
  }

  /** The carrier (label or junction) an edge runs through or into, while it is on screen. */
  private carrierOfEdge(id: string): string | null {
    const key = this.geo?.carrierOf.get(id) ?? null;
    return key && this.carrierEls.has(key) ? key : null;
  }

  /** World point that stands for an edge: its label or junction when it has one, else the middle of its route. */
  private edgeAnchor(id: string, target = false): Pt | null {
    const doc = this._doc;
    const e = M.edgeById(doc, id);
    if (!e) return null;
    if (!M.isJunction(doc, e.to)) {
      const key = this.carrierOfEdge(id);
      const c = key ? target ? this.geo?.carriers.get(key) : this.shown.carriers.get(key) : null;
      if (c && ('visible' in c ? c.visible : c.o > 0.5)) return { x: c.x, y: c.y };
    }
    const se = target ? this.geo?.edges.get(id) : this.shown.edges.get(id);
    if (!se || ('hidden' in se ? se.hidden : se.o < 0.05)) return null;
    const samples = 'samples' in se ? se.samples : se.s;
    const m = Math.floor(samples.length / 4);
    return { x: samples[m * 2], y: samples[m * 2 + 1] };
  }

  /** World box around an edge: its label when it has one, else a small box at the middle of its route. */
  private edgeBox(id: string, target = false): Rect | null {
    const a = this.edgeAnchor(id, target);
    if (!a) return null;
    const key = M.isJunction(this._doc, M.edgeById(this._doc, id)?.to ?? '') ? null : this.carrierOfEdge(id);
    const sz = key ? this.sizes.get(key) : null;
    const w = Math.max(sz?.w ?? 0, 24);
    const hh = Math.max(sz?.h ?? 0, 24);
    return { x: a.x - w / 2, y: a.y - hh / 2, w, h: hh };
  }

  private emit(type: string, detail: unknown) {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }

  private emitHistory() {
    const u = this.hist.peekUndo();
    const r = this.hist.peekRedo();
    this.emit('lode-history', { canUndo: !!u, canRedo: !!r, undoLabel: u?.label ?? null, redoLabel: r?.label ?? null });
    this.puckKey = '';
    this.schedule();
  }

  private announce(msg: string) {
    this.live.textContent = '';
    // Force a change so screen readers speak repeats too.
    setTimeout(() => (this.live.textContent = msg), 10);
  }

  // =====================================================================
  // Render loop
  // =====================================================================

  private invalidate(layout: boolean) {
    this.dirtyDom = true;
    if (layout) this.dirtyLayout = true;
    else this.dirtyLayout = true;
    this.schedule();
  }

  private schedule() {
    if (this.raf || !this.connected) return;
    this.raf = requestAnimationFrame(() => this.flush());
  }

  private flush() {
    this.raf = 0;
    if (!this.connected) return;
    this.onResize();
    const t0 = now();
    const synced = this.dirtyDom;
    if (this.dirtyDom) this.syncDom();
    else if (this.dirtySel) this.syncSelection();
    const t1 = now();
    const relaid = this.dirtyLayout;
    if (this.dirtyLayout) this.relayout();
    if (this.pendingGraphReveal === 'layout' && this.geo && !this.dirtyLayout) this.revealGraphSelection();
    if (this.linker && this.linkerDoc !== this._doc) this.refreshLinker();
    const t2 = now();
    this.draw();
    if (this.pendingGraphReveal === 'scroll' && !this.camFrom && now() - this.t0 >= this.dur) {
      this.pendingGraphReveal = null;
      for (const id of this.view.sel) {
        const group = this.groupEls.get(id);
        const shape = this.geo?.groups.get(id)?.shape;
        const el = this.geo?.nodes.get(id)?.visible ? this.nodeEls.get(id)
          : group && shape && shape.kind !== 'hidden' ? shape.kind === 'proxy' ? group.proxy : group.label
            : this.geo?.edges.get(id)?.hidden === false ? this.edgeEls.get(id)?.path : null;
        if (el) { el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); break; }
      }
    }
    if (relaid && this.pass) {
      const t3 = now();
      const p = this.pass;
      this.timing = {
        syncMs: synced ? t1 - t0 : 0,
        measureMs: p.measureMs,
        engineMs: p.engineMs,
        engineRuns: p.engineRuns,
        engineReused: p.engineReused,
        restMs: Math.max(0, t2 - t1 - p.measureMs - p.engineMs),
        drawMs: t3 - t2,
        totalMs: t3 - t0,
        nodes: this._doc.nodes.length,
        edges: this._doc.edges.length,
      };
      this.pass = null;
    }
  }

  /**
   * The one place a new container size is taken in (the resize observer and every frame both
   * call it), so whichever notices first also re-decides the orientation or refits the view.
   */
  private onResize() {
    const w = this.vp.clientWidth;
    const hgt = this.vp.clientHeight;
    if (w === this.vw && hgt === this.vh) return;
    const appearing = this.vw === 0 || this.vh === 0;
    this.vw = w;
    this.vh = hgt;
    // Hidden (display: none, a closed tab or <details>): nothing to fit until it shows again.
    if (w === 0 || hgt === 0) return;
    // First shown, or shown again: lay out (an unchanged input reuses the last result) and refit.
    if (appearing) {
      this.dirtyLayout = true;
      this.schedule();
      return;
    }
    if (this._doc.settings.orientation === 'auto') this.dirtyLayout = true;
    else if (this.view.follow && this.geo) {
      this.view = { ...this.view, cam: this.fitCamera(this.geo) };
      this.camShown = { ...this.view.cam };
      this.camFrom = null;
    }
    this.schedule();
  }

  /** Selection changed, nothing else: move the highlight, not the whole DOM. */
  private syncSelection() {
    this.dirtySel = false;
    const sel = new Set(this.view.sel);
    for (const [id, el] of this.nodeEls) {
      el.classList.toggle('sel', sel.has(id));
      if (this.eventActivation) el.setAttribute('aria-pressed', String(sel.has(id)));
    }
    for (const [id, els] of this.groupEls) {
      const on = sel.has(id);
      els.box.classList.toggle('sel', on);
      els.label.classList.toggle('sel', on);
      els.proxy.classList.toggle('sel', on);
      if (this.groupActivation) for (const el of [els.label, els.proxy]) el.setAttribute('aria-pressed', String(on));
    }
    this.applyEdgeClasses();
    this.nodeMagKey = '';
  }

  /** Create, update and remove elements so the DOM matches the document. */
  private syncDom() {
    this.dirtyDom = false;
    this.dirtySel = false;
    this.redraw = true;
    const doc = this._doc;
    const sel = new Set(this.view.sel);
    // Nodes
    const keepN = new Set<string>();
    for (const n of doc.nodes) {
      keepN.add(n.id);
      let el = this.nodeEls.get(n.id);
      // Actions use native buttons; the editor keeps its existing canvas-owned focus model.
      const action = this.eventActivation;
      if (el && (el.tagName === 'BUTTON') !== action) {
        const hadFocus = this.root.activeElement === el;
        this.sizeRo?.unobserve(el);
        el.remove();
        this.nodeEls.delete(n.id);
        el = undefined;
        if (hadFocus && !this.graphPresentation) this.vp.focus({ preventScroll: true });
      }
      if (!el) {
        el = action ? h('button', 'node', { 'data-id': n.id, type: 'button' }) : h('div', 'node', { 'data-id': n.id });
        const t = h('div', 't', { 'data-ph': 'Type…' });
        el.append(t);
        el.style.opacity = '0';
        this.nLayer.append(el);
        this.nodeEls.set(n.id, el);
        this.sizeRo?.observe(el);
      }
      if (this.editing?.id !== n.id) {
        const t = el.firstElementChild as HTMLDivElement;
        if (t.textContent !== n.text) t.textContent = n.text;
      }
      el.classList.toggle('sel', sel.has(n.id));
      el.setAttribute('aria-label', n.text || 'Empty node');
      el.classList.toggle('action', this.eventActivation);
      if (this.eventActivation) {
        el.setAttribute('role', 'button');
        el.setAttribute('aria-pressed', String(sel.has(n.id)));
        (el as HTMLButtonElement).disabled = this.disabledActions.has(n.id);
        el.tabIndex = this.disabledActions.has(n.id) ? -1 : 0;
      } else {
        el.removeAttribute('role');
        el.removeAttribute('aria-pressed');
        el.removeAttribute('tabindex');
      }
    }
    for (const [id, el] of this.nodeEls) {
      if (!keepN.has(id)) {
        this.sizeRo?.unobserve(el);
        el.remove();
        this.nodeEls.delete(id);
        this.sizes.delete(id);
        this.shown.nodes.delete(id);
      }
    }
    // Groups
    const keepG = new Set<string>();
    for (const g of doc.groups) {
      keepG.add(g.id);
      let els = this.groupEls.get(g.id);
      const action = this.groupActivation;
      if (els && (els.label.tagName === 'BUTTON') !== action) {
        this.sizeRo?.unobserve(els.label);
        this.sizeRo?.unobserve(els.proxy);
        els.box.remove(); els.label.remove(); els.proxy.remove();
        this.groupEls.delete(g.id);
        els = undefined;
      }
      if (!els) {
        const box = svg('path', 'gbox');
        box.setAttribute('data-gid', g.id);
        box.style.opacity = '0';
        const label = h(action ? 'button' : 'div', `glabel${action ? ' group-action' : ''}`, { 'data-gid': g.id, ...(action ? { type: 'button' } : {}) });
        const chevron = action ? `<span class="chev" aria-hidden="true"></span>` : `<button class="chev" tabindex="-1" data-chev="${g.id}"></button>`;
        label.innerHTML = `${chevron}<span class="gt" data-ph="Untitled group"></span>`;
        label.style.opacity = '0';
        const proxy = h(action ? 'button' : 'div', `node proxy${action ? ' group-action' : ''}`, { 'data-gid': g.id, ...(action ? { type: 'button' } : {}) });
        proxy.innerHTML = `<div class="row">${chevron}<div class="t" data-ph="Untitled group"></div></div><div class="count"></div>`;
        proxy.style.opacity = '0';
        this.gLayer.append(box);
        this.nLayer.append(label, proxy);
        els = { box, label, proxy };
        this.groupEls.set(g.id, els);
        this.sizeRo?.observe(label);
        this.sizeRo?.observe(proxy);
      }
      const collapsed = !!g.collapsed;
      for (const chev of [els.label.querySelector('.chev'), els.proxy.querySelector('.chev')] as HTMLButtonElement[]) {
        // Only when it changes: rewriting the icon under a press (an edit ending on pointerdown
        // redraws) detached the pressed element, so the click did nothing and focus fell to the page.
        const state = collapsed ? 'shut' : 'open';
        if (chev.dataset.state !== state) {
          chev.dataset.state = state;
          chev.innerHTML = collapsed ? ICON.expand : ICON.collapse;
        }
        chev.title = `${collapsed ? 'Expand group' : 'Collapse group'}${this.touchContext ? '' : ' (C)'}`;
        chev.setAttribute('aria-label', chev.title);
      }
      if (this.editing?.id !== g.id) {
        const gt = els.label.querySelector('.gt') as HTMLSpanElement;
        if (gt.textContent !== g.text) gt.textContent = g.text;
        const pt = els.proxy.querySelector('.t') as HTMLDivElement;
        if (pt.textContent !== g.text) pt.textContent = g.text;
      }
      const c = M.groupCounts(doc, g.id);
      const count = els.proxy.querySelector('.count') as HTMLDivElement;
      const parts = [];
      if (c.nodes) parts.push(`${c.nodes} node${c.nodes === 1 ? '' : 's'}`);
      if (c.groups) parts.push(`${c.groups} group${c.groups === 1 ? '' : 's'}`);
      count.textContent = parts.length ? parts.join(' · ') : 'Empty group';
      const on = sel.has(g.id);
      els.box.classList.toggle('sel', on);
      els.label.classList.toggle('sel', on);
      els.proxy.classList.toggle('sel', on);
      if (action) for (const el of [els.label, els.proxy]) {
        el.setAttribute('aria-label', g.text || 'Untitled group');
        el.setAttribute('aria-pressed', String(on));
      }
    }
    for (const [id, els] of this.groupEls) {
      if (!keepG.has(id)) {
        this.sizeRo?.unobserve(els.label);
        this.sizeRo?.unobserve(els.proxy);
        els.box.remove();
        els.label.remove();
        els.proxy.remove();
        this.groupEls.delete(id);
        this.shown.groups.delete(id);
        this.sizes.delete(id);
        this.headers.delete(id);
        this.groupLabelSizes.delete(id);
      }
    }
    // Nested boxes: parents first.
    const depth = (id: string) => {
      let d = 0;
      let cur = M.groupById(doc, id)?.parent ?? null;
      while (cur && d < 100) {
        d++;
        cur = M.groupById(doc, cur)?.parent ?? null;
      }
      return d;
    };
    [...doc.groups].sort((a, b) => depth(a.id) - depth(b.id)).forEach((g) => this.gLayer.append(this.groupEls.get(g.id)!.box));
    // Edges
    const keepE = new Set<string>();
    for (const e of doc.edges) {
      keepE.add(e.id);
      if (!this.edgeEls.has(e.id)) {
        const path = svg('path', 'edge');
        const arrow = svg('path', 'arrow');
        path.style.opacity = '0';
        arrow.style.opacity = '0';
        this.eLayer.append(path, arrow);
        this.edgeEls.set(e.id, { path, arrow });
      }
    }
    for (const [id, els] of this.edgeEls) {
      if (!keepE.has(id)) {
        els.path.remove();
        els.arrow.remove();
        this.edgeEls.delete(id);
        this.shown.edges.delete(id);
      }
    }
    // Carriers: junction dots and edge labels.
    const pl = plan(doc, this.labelDraft);
    const keepC = new Set<string>();
    for (const c of pl.carriers) {
      keepC.add(c.key);
      let el = this.carrierEls.get(c.key);
      if (!el) {
        el = h('div', 'carrier', { 'data-cid': c.key });
        el.append(h('div', 't', { 'data-ph': 'Label…' }));
        el.style.opacity = '0';
        this.nLayer.append(el);
        this.carrierEls.set(c.key, el);
        this.sizeRo?.observe(el);
      }
      el.dataset.eid = c.edge;
      el.classList.toggle('dot', c.text === null);
      el.classList.toggle('junction', c.kind === 'junction');
      if (!(this.editing?.kind === 'edge' && this.editing.id === c.edge)) {
        const t = el.firstElementChild as HTMLDivElement;
        if (t.textContent !== (c.text ?? '')) t.textContent = c.text ?? '';
      }
      el.setAttribute('aria-label', c.text === null ? 'Merge point' : `Edge label: ${c.text || 'empty'}`);
    }
    for (const [key, el] of this.carrierEls) {
      if (!keepC.has(key)) {
        this.sizeRo?.unobserve(el);
        el.remove();
        this.carrierEls.delete(key);
        this.sizes.delete(key);
        this.shown.carriers.delete(key);
      }
    }
    this.applyEdgeClasses();
    // The list is rebuilt after the next layout (what it hides depends on the new one).
    if (this.linker && (this.readonly_ || !M.nodeById(doc, this.linker.source))) this.closeLinker(false);
    // Empty state / errors.
    this.emptyEl.hidden = !this.error;
    if (this.error) this.emptyEl.textContent = this.error;
    this.nodeMagKey = '';
    this.puckKey = '';
  }

  /** Selected, hot (touching the selection) and hovered edges, their arrowheads and labels. One pass. */
  private applyEdgeClasses() {
    const doc = this._doc;
    const sel = new Set(this.view.sel);
    const trunkOf = new Map<string, M.FlowEdge>();
    const branchSel = new Set<string>();
    const branchFromSel = new Set<string>();
    for (const e of doc.edges) if (M.isJunction(doc, e.from)) trunkOf.set(e.from, e);
    for (const e of doc.edges) {
      if (!M.isJunction(doc, e.to)) continue;
      if (sel.has(e.id)) branchSel.add(e.to);
      if (sel.has(e.from)) branchFromSel.add(e.to);
    }
    const state = new Map<string, 'sel' | 'hot' | ''>();
    for (const e of doc.edges) {
      const toJ = trunkOf.get(e.to);
      const fromJ = M.isJunction(doc, e.from);
      let st: 'sel' | 'hot' | '' = '';
      if (sel.has(e.id) || (toJ && sel.has(toJ.id))) st = 'sel';
      else if (toJ) st = sel.has(e.from) || sel.has(toJ.to) ? 'hot' : '';
      else if (fromJ) st = sel.has(e.to) || branchSel.has(e.from) || branchFromSel.has(e.from) ? 'hot' : '';
      else st = sel.has(e.from) || sel.has(e.to) ? 'hot' : '';
      state.set(e.id, st);
      const els = this.edgeEls.get(e.id);
      if (!els) continue;
      const hover = this.hoverEdge === e.id || (!!toJ && this.hoverEdge === toJ.id);
      for (const x of [els.path, els.arrow]) {
        x.classList.toggle('sel', st === 'sel');
        x.classList.toggle('hot', st === 'hot');
        x.classList.toggle('hover', hover);
      }
    }
    for (const el of this.carrierEls.values()) {
      const eid = el.dataset.eid ?? '';
      const st = state.get(eid) ?? '';
      const trunk = doc.edges.length && M.edgeById(doc, eid);
      const j = trunk && M.isJunction(doc, trunk.from) ? trunk.from : null;
      el.classList.toggle('sel', st === 'sel' || (!!j && branchSel.has(j)));
      el.classList.toggle('hot', st === 'hot');
      el.classList.toggle('hover', this.hoverEdge === eid);
    }
  }

  /** Does this element's size differ from what the last layout measured? */
  private sizeChanged(el: HTMLElement): boolean {
    const d = el.dataset;
    if (d.id) {
      const s = this.sizes.get(d.id);
      return !s || s.w !== (el.offsetWidth || this.tun.nodeWidth) || s.h !== (el.offsetHeight || 40);
    }
    if (d.cid) {
      const s = this.sizes.get(d.cid);
      return !s || s.w !== (el.offsetWidth || 12) || s.h !== (el.offsetHeight || 12);
    }
    if (d.gid && el.classList.contains('glabel')) return this.headers.get(d.gid) !== (el.offsetHeight || 18) + 6;
    if (d.gid && el.classList.contains('proxy')) {
      const s = this.sizes.get(d.gid);
      return !s || s.w !== (el.offsetWidth || this.tun.nodeWidth) || s.h !== (el.offsetHeight || 44);
    }
    return true;
  }

  private measure() {
    for (const n of this._doc.nodes) {
      const el = this.nodeEls.get(n.id);
      if (!el) continue;
      this.sizes.set(n.id, { w: el.offsetWidth || this.tun.nodeWidth, h: el.offsetHeight || 40 });
    }
    for (const g of this._doc.groups) {
      const els = this.groupEls.get(g.id);
      if (!els) continue;
      this.sizes.set(g.id, { w: els.proxy.offsetWidth || this.tun.nodeWidth, h: els.proxy.offsetHeight || 44 });
      this.headers.set(g.id, (els.label.offsetHeight || 18) + 6);
      this.groupLabelSizes.set(g.id, { w: els.label.offsetWidth, h: els.label.offsetHeight });
    }
    for (const [key, el] of this.carrierEls) this.sizes.set(key, { w: el.offsetWidth || 12, h: el.offsetHeight || 12 });
  }

  private engineInput(orient: EngineOrientation, incremental: boolean, pl: Plan): EngineInput {
    const doc = this._doc;
    const s = doc.settings;
    const dens = {
      node: this.tun[`${s.compactness}Node` as keyof Tunables] as number,
      rank: this.tun[`${s.compactness}Rank` as keyof Tunables] as number,
      edge: DENSITY[s.compactness].edge,
    };
    const gIndex = new Map(doc.groups.map((g, i) => [g.id, i]));
    const prevOk = incremental && this.geo && this.geo.orient === orient;
    return {
      options: {
        orientation: orient,
        biasEnd: s.bias === 'end',
        nodeSep: dens.node,
        rankSep: dens.rank,
        edgeSep: dens.edge,
        groupPad: this.tun.groupPad,
        groupGap: Math.max(dens.node, 16),
        incremental: !!prevOk,
        margin: 28,
        tightGroups: s.tightGroups,
        untangle: s.untangle,
      },
      nodes: [
        ...doc.nodes.map((n) => {
          const sz = this.sizes.get(n.id) ?? { w: this.tun.nodeWidth, h: 40 };
          const prev = prevOk ? this.geo!.nodes.get(n.id) : undefined;
          return {
            w: sz.w,
            h: sz.h,
            group: n.group ? gIndex.get(n.group) ?? -1 : -1,
            prevX: prev && prev.visible ? prev.x : undefined,
            prevY: prev && prev.visible ? prev.y : undefined,
          };
        }),
        ...pl.carriers.slice(0, pl.junctionCount).map((c) => {
          const sz = this.sizes.get(c.key) ?? (c.text === null ? { w: 12, h: 12 } : { w: 64, h: 24 });
          const prev = prevOk ? this.geo!.carriers.get(c.key) : undefined;
          return {
            w: sz.w,
            h: sz.h,
            group: c.group ? gIndex.get(c.group) ?? -1 : -1,
            prevX: prev && prev.visible ? prev.x : undefined,
            prevY: prev && prev.visible ? prev.y : undefined,
          };
        }),
      ],
      edges: pl.parts.map((p) => ({ src: p.src, dst: p.dst, backHint: p.backHint, label: p.label ? this.sizes.get(p.label) ?? { w: 64, h: 24 } : null })),
      groups: doc.groups.map((g) => {
        const sz = this.sizes.get(g.id) ?? { w: this.tun.nodeWidth, h: 44 };
        return { parent: g.parent ? gIndex.get(g.parent) ?? -1 : -1, collapsed: !!g.collapsed, w: sz.w, h: sz.h, header: this.headers.get(g.id) ?? 24 };
      }),
    };
  }

  private toGeo(r: LayoutResult, orient: EngineOrientation, pl: Plan): Geo {
    const doc = this._doc;
    const nodes = new Map<string, GeoNode>();
    doc.nodes.forEach((n, i) => {
      const o = r.nodes[i];
      const sz = this.sizes.get(n.id) ?? { w: this.tun.nodeWidth, h: 40 };
      nodes.set(n.id, { x: o.x, y: o.y, w: sz.w, h: sz.h, visible: o.visible });
    });
    const groups = new Map<string, GeoGroup>();
    doc.groups.forEach((g, i) => groups.set(g.id, { shape: r.groups[i].shape, label: r.groups[i].label, foldTo: null }));
    // The engine does not place hidden labels/routes. Their zero coordinates are not a
    // visual destination: fold every hidden descendant into its visible group proxy.
    const owners = new Map<string, string | null>();
    const foldedOwner = (gid: string | null | undefined): string | null => {
      const chain: string[] = [];
      let owner: string | null = null;
      for (let guard = 0; gid && guard < doc.groups.length; guard++) {
        if (owners.has(gid)) { owner = owners.get(gid)!; break; }
        chain.push(gid);
        if (groups.get(gid)?.shape.kind === 'proxy') { owner = gid; break; }
        gid = M.groupById(doc, gid)?.parent;
      }
      for (const id of chain) owners.set(id, owner);
      return owner;
    };
    const foldedCenter = (gid: string | null | undefined) => {
      const owner = foldedOwner(gid);
      return owner ? centerOf(groups.get(owner)!.shape) : null;
    };
    for (const g of doc.groups) {
      const gg = groups.get(g.id)!;
      if (gg.shape.kind === 'hidden') gg.foldTo = foldedOwner(g.parent);
    }
    const vertexGroups = new Map(doc.nodes.map((n) => [n.id, n.group]));
    for (const c of pl.carriers.slice(0, pl.junctionCount)) vertexGroups.set(c.key.slice(2), c.group);
    const edgeGroup = (eid: string) => {
      const e = M.edgeById(doc, eid);
      return e ? M.commonGroup(doc, [vertexGroups.get(e.from), vertexGroups.get(e.to)]) : null;
    };
    for (const n of doc.nodes) {
      const gn = nodes.get(n.id)!;
      const pc = !gn.visible && foldedCenter(n.group);
      if (pc) Object.assign(gn, pc);
    }
    const carriers = new Map<string, GeoCarrier>();
    pl.carriers.forEach((c, k) => {
      const sz = this.sizes.get(c.key) ?? { w: 12, h: 12 };
      if (k < pl.junctionCount) {
        const o = r.nodes[pl.nodeCount + k];
        if (o) carriers.set(c.key, { x: o.x, y: o.y, w: sz.w, h: sz.h, visible: o.visible });
      } else {
        // An edge label sits where the engine hung it on its edge's route.
        const o = r.edges[pl.partOf.get(c.edge) ?? -1];
        if (o) carriers.set(c.key, { x: o.label?.x ?? 0, y: o.label?.y ?? 0, w: sz.w, h: sz.h, visible: !o.hidden && !!o.label });
      }
    });
    for (const c of pl.carriers) {
      const gc = carriers.get(c.key);
      const pc = gc && !gc.visible && foldedCenter(c.group ?? edgeGroup(c.edge));
      if (gc && pc) Object.assign(gc, pc);
    }
    const edges = new Map<string, GeoEdge>();
    for (const e of doc.edges) {
      const o = r.edges[pl.partOf.get(e.id) ?? -1];
      if (!o) continue;
      const samples = sample(o.path, SAMPLES);
      const pc = o.hidden && foldedCenter(edgeGroup(e.id));
      if (pc) for (let i = 0; i < samples.length; i += 2) { samples[i] = pc.x; samples[i + 1] = pc.y; }
      edges.set(e.id, { path: o.path, samples, back: o.back, hidden: o.hidden, from: e.from, to: e.to, arrow: pl.arrow.has(e.id) });
    }
    return { orient, width: r.width, height: r.height, crossings: r.crossings, ms: r.ms, nodes, groups, edges, carriers, carrierOf: pl.carrierOf };
  }

  private fitZoom(g: { width: number; height: number }, r = 0): number {
    const cos = Math.abs(Math.cos(r));
    const sin = Math.abs(Math.sin(r));
    const w = g.width * cos + g.height * sin;
    const hh = g.width * sin + g.height * cos;
    const pad = 16;
    return Math.min((this.vw - 2 * pad) / Math.max(1, w), (this.vh - 2 * pad) / Math.max(1, hh));
  }

  private relayout() {
    // Without an engine or a visible frame, stay pending: onResize lays out once the frame shows.
    if (!this.eng || this.vw === 0 || this.vh === 0) return;
    this.dirtyLayout = false;
    const tm = now();
    this.measure();
    const pass = { measureMs: now() - tm, engineMs: 0, engineRuns: 0, engineReused: 0 };
    this.pass = pass;
    const run = (inp: EngineInput) => {
      const te = now();
      const r = this.eng!.layout(inp);
      pass.engineMs += now() - te;
      pass.engineRuns++;
      return r;
    };
    const runBoth = (inp: EngineInput, also: EngineOrientation | null) => {
      const te = now();
      const r = this.eng!.layoutBoth(inp, also);
      pass.engineMs += now() - te;
      pass.engineRuns++;
      return r;
    };
    // An edit that changes neither structure nor any size (new text on the same lines, a rename)
    // gives the engine the same input: reuse the last results instead of laying out again.
    const cached = (inp: EngineInput, also: EngineOrientation | null, go: () => LayoutResult[]) => {
      const key = JSON.stringify(inp) + '|' + also;
      const hit = this.engineCache.get(key);
      if (hit) {
        pass.engineReused++;
        return hit;
      }
      const r = go();
      if (this.engineCache.size > 4) this.engineCache.clear();
      this.engineCache.set(key, r);
      return r;
    };
    const s = this._doc.settings;
    const pl = plan(this._doc, this.labelDraft);
    let chosen: { geo: Geo } | null = null;
    try {
      if (s.orientation === 'auto') {
        // Lay out every candidate direction and keep the one that shows the text biggest.
        let best: { o: EngineOrientation; r: LayoutResult; z: number } | null = null;
        let current: { o: EngineOrientation; r: LayoutResult; z: number } | null = null;
        // Ranks and order do not depend on the direction, so (unless incremental layout keeps
        // each direction's previous order) the engine places two directions per call.
        const cands = this.autoCandidates;
        const laid: { o: EngineOrientation; r: LayoutResult }[] = [];
        for (let i = 0; i < cands.length; i += s.incremental ? 1 : 2) {
          const o = cands[i];
          const o2 = s.incremental ? null : cands[i + 1] ?? null;
          const inp = this.engineInput(o, s.incremental, pl);
          const rs = cached(inp, o2, () => (o2 ? runBoth(inp, o2) : [run(inp)]));
          laid.push({ o, r: rs[0] });
          if (o2 && rs[1]) laid.push({ o: o2, r: rs[1] });
        }
        for (const { o, r } of laid) {
          const z = Math.min(this.fitZoom(r, this.view.cam.r), this.tun.fitMax * 4);
          const c = { o, r, z };
          if (!best || z > best.z) best = c;
          if (o === this.autoPick) current = c;
        }
        // Hysteresis: only switch direction when the other one is clearly better.
        const pick = current && best && best.o !== current.o && best.z < current.z * 1.12 ? current : best!;
        this.autoPick = pick.o;
        chosen = { geo: this.toGeo(pick.r, pick.o, pl) };
      } else {
        const o = s.orientation as EngineOrientation;
        const inp = this.engineInput(o, s.incremental, pl);
        chosen = { geo: this.toGeo(cached(inp, null, () => [run(inp)])[0], o, pl) };
      }
      if (this.error && !(this.blockedStorageKey && this.blockedStorageKey === this.storageKey)) {
        // A good layout after a failed one: the failure message goes.
        this.error = null;
        this.emptyEl.hidden = true;
      }
    } catch (err) {
      this.error = layoutFailure(err);
      this.emptyEl.hidden = false;
      this.emptyEl.textContent = this.error;
      return;
    }
    // Nothing moved (an edit began or ended without changing any size, or the frame was only
    // hidden and shown): keep what is drawn, so no animation replays every node and line for
    // nothing. The camera below still refits.
    const unchanged = !!this.geo && pass.engineRuns === 0 && sameGeo(this.geo, chosen.geo);
    const first = !this.geo;
    if (!unchanged) {
      this.from = first ? null : cloneShown(this.shown);
      this.geo = chosen.geo;
      this.t0 = now();
      this.dur = first || reducedMotion() ? 0 : this.tun.animMs;
      if (first) this.snapShown();
    }
    const geo = this.geo ?? chosen.geo;
    // Camera
    if (this.view.follow) {
      const cam = this.fitCamera(geo);
      this.view = { ...this.view, cam };
      if (first) this.camShown = { ...cam };
      else this.animateCamera();
    } else if (this.pendingAnchor && !unchanged) {
      const a = this.pendingAnchor;
      const target = geo.nodes.get(a.id);
      const gg = geo.groups.get(a.id);
      let w: Pt | null = null;
      if (target && target.visible) w = target;
      else if (gg) {
        const b = shapeBounds(gg.shape);
        if (b) w = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
      } else if (target) w = target;
      if (w) {
        this.view = { ...this.view, cam: pin(this.view.cam, this.vw, this.vh, w, a.screen) };
        this.animateCamera();
      }
    }
    this.pendingAnchor = null;
    this.nodeMagKey = '';
    if (!unchanged) this.emit('lode-layout', this.layoutInfo);
  }

  private fitCamera(g: Geo): Camera {
    // A hidden frame has no size to fit: keep the camera for when it shows again.
    if (this.vw === 0 || this.vh === 0) return this.view.cam;
    const r = this.view.cam.r;
    let z = this.fitZoom(g, r);
    // Radial layouts are overviews: let them shrink further before scrolling takes over.
    const minZ = g.orient === 'in-out' || g.orient === 'out-in' ? Math.min(this.tun.fitMin, 0.35) : this.tun.fitMin;
    z = clamp(z, minZ, this.tun.fitMax);
    let cx = g.width / 2;
    let cy = g.height / 2;
    // Too big to fit at a readable size: start where the flow starts, and across the flow, on the
    // entities found there (the corner of the bounding box can be empty).
    const full = this.fitZoom(g, r);
    if (full < minZ && Math.abs(r) < 1e-6) {
      const halfW = this.vw / 2 / z;
      const halfH = this.vh / 2 / z;
      const o = g.orient;
      const across = o === 'lr' || o === 'rl';
      const linear = across || o === 'tb' || o === 'bt';
      if (g.width * z > this.vw) {
        cx = o === 'rl' ? g.width - halfW : o === 'lr' ? halfW : cx;
      }
      if (g.height * z > this.vh) {
        cy = o === 'bt' ? g.height - halfH : o === 'tb' ? halfH : cy;
      }
      if (linear) {
        const along = (n: GeoNode) => (o === 'lr' ? n.x : o === 'rl' ? g.width - n.x : o === 'tb' ? n.y : g.height - n.y);
        const span = across ? 2 * halfW : 2 * halfH;
        const shown = [...g.nodes.values()].filter((n) => n.visible);
        const first = Math.min(...shown.map(along));
        const near = shown.filter((n) => along(n) <= first + span * 0.8).map((n) => (across ? n.y : n.x)).sort((a, b) => a - b);
        if (near.length) {
          const mid = near[Math.floor(near.length / 2)];
          if (across && g.height * z > this.vh) cy = clamp(mid, halfH, g.height - halfH);
          if (!across && g.width * z > this.vw) cx = clamp(mid, halfW, g.width - halfW);
        }
        if (!across && g.width * z > this.vw && !near.length) cx = halfW;
        if (across && g.height * z > this.vh && !near.length) cy = halfH;
      } else {
        // Radial: the middle can be nearly empty when the first ring is crowded. Start instead on
        // the ring the flow starts from (innermost for in-out, outermost for out-in), at its top,
        // whenever that shows more of the diagram.
        const shown = [...g.nodes.values()].filter((n) => n.visible);
        const seen = (x: number, y: number) => shown.filter((n) => Math.abs(n.x - x) < halfW + n.w / 2 && Math.abs(n.y - y) < halfH + n.h / 2).length;
        if (shown.length) {
          const ds = shown.map((n) => Math.hypot(n.x - g.width / 2, n.y - g.height / 2));
          const start = o === 'in-out' ? Math.min(...ds) : Math.max(...ds);
          const ring = shown.filter((_, i) => Math.abs(ds[i] - start) <= Math.min(halfW, halfH));
          const top = ring.reduce((a, b) => (b.y < a.y ? b : a));
          const x = g.width * z > this.vw ? clamp(top.x, halfW, g.width - halfW) : cx;
          const y = g.height * z > this.vh ? clamp(top.y, halfH, g.height - halfH) : cy;
          if (seen(x, y) > seen(cx, cy)) {
            cx = x;
            cy = y;
          }
        }
      }
    }
    return { x: cx, y: cy, z, r };
  }

  private animateCamera() {
    const target = this.view.cam;
    if (camEqual(target, this.camShown)) return;
    if (reducedMotion() || this.tun.animMs === 0) {
      this.camShown = { ...target };
      this.camFrom = null;
    } else {
      this.camFrom = { ...this.camShown };
      this.camT0 = now();
      this.camDur = this.tun.animMs;
    }
    this.schedule();
  }

  private snapShown() {
    if (!this.geo) return;
    this.shown = { nodes: new Map(), carriers: new Map(), edges: new Map(), groups: new Map() };
    for (const [id, n] of this.geo.nodes) this.shown.nodes.set(id, { x: n.x, y: n.y, o: n.visible ? 1 : 0 });
    for (const [id, c] of this.geo.carriers) this.shown.carriers.set(id, { x: c.x, y: c.y, o: c.visible ? 1 : 0 });
    for (const [id, e] of this.geo.edges) this.shown.edges.set(id, { s: e.samples, o: e.hidden ? 0 : 1 });
    for (const [id, g] of this.geo.groups)
      this.shown.groups.set(id, { shape: g.shape, label: g.label, pc: centerOf(g.shape) ?? (g.foldTo ? centerOf(this.geo.groups.get(g.foldTo)!.shape) : null) ?? { x: 0, y: 0 }, o: g.shape.kind === 'rect' || g.shape.kind === 'sector' ? 1 : 0, po: g.shape.kind === 'proxy' ? 1 : 0 });
  }

  // =====================================================================
  // Drawing (one frame)
  // =====================================================================

  private draw() {
    const t = now();
    const geo = this.geo;
    let busy = false;
    // Camera
    if (this.camFrom) {
      const p = this.camDur ? clamp((t - this.camT0) / this.camDur, 0, 1) : 1;
      this.camShown = lerpCam(this.camFrom, this.view.cam, ease(p));
      if (p >= 1) this.camFrom = null;
      else busy = true;
    } else if (!camEqual(this.camShown, this.view.cam) && !this.gesture) {
      this.camShown = { ...this.view.cam };
    }
    this.world.style.transform = cssTransform(this.camShown, this.vw, this.vh);

    const p0 = geo && this.dur > 0 && this.from ? clamp((t - this.t0) / this.dur, 0, 1) : 1;
    // Once the new layout has been drawn in full, frames that only pan, zoom or rotate need not
    // rewrite every node and edge (the world transform above moves them all).
    const still = !!geo && p0 >= 1 && this.drawnGeo === geo && !this.redraw;
    if (geo && !still) {
      this.redraw = false;
      const p = p0;
      const k = ease(p);
      if (p < 1) busy = true;
      const from = p < 1 ? this.from : null;
      const lerp = (a: number, b: number) => a + (b - a) * k;
      // Nodes
      for (const [id, n] of geo.nodes) {
        const el = this.nodeEls.get(id);
        if (!el) continue;
        const a = from?.nodes.get(id);
        const tgtO = n.visible ? 1 : 0;
        const x = a ? lerp(a.x, n.x) : n.x;
        const y = a ? lerp(a.y, n.y) : n.y;
        const o = a ? lerp(a.o, tgtO) : from ? k * tgtO : tgtO;
        const sz = this.sizes.get(id) ?? { w: n.w, h: n.h };
        const sc = 0.6 + 0.4 * o;
        el.style.transform = `translate(${x - sz.w / 2}px, ${y - sz.h / 2}px)${sc !== 1 ? ` scale(${sc})` : ''}`;
        const isEd = this.editing?.id === id;
        el.style.opacity = String(isEd ? Math.max(o, 1) : o);
        el.style.visibility = o < 0.01 && !isEd ? 'hidden' : '';
        el.classList.toggle('hidden', !n.visible);
        if (this.eventActivation) el.tabIndex = n.visible && !this.disabledActions.has(id) ? 0 : -1;
        this.shown.nodes.set(id, { x, y, o });
      }
      // Junction dots and edge labels move like nodes.
      for (const [key, c] of geo.carriers) {
        const el = this.carrierEls.get(key);
        if (!el) continue;
        const a = from?.carriers.get(key);
        const tgtO = c.visible ? 1 : 0;
        const x = a ? lerp(a.x, c.x) : c.x;
        const y = a ? lerp(a.y, c.y) : c.y;
        const o = a ? lerp(a.o, tgtO) : from ? k * tgtO : tgtO;
        const sz = this.sizes.get(key) ?? { w: c.w, h: c.h };
        const sc = 0.6 + 0.4 * o;
        el.style.transform = `translate(${x - sz.w / 2}px, ${y - sz.h / 2}px)${sc !== 1 ? ` scale(${sc})` : ''}`;
        const isEd = this.editing?.kind === 'edge' && this.editing.id === el.dataset.eid;
        el.classList.toggle('back', !!geo.edges.get(el.dataset.eid ?? '')?.back);
        el.style.opacity = String(isEd ? 1 : o);
        el.style.visibility = o < 0.01 && !isEd ? 'hidden' : '';
        this.shown.carriers.set(key, { x, y, o });
      }
      // Groups
      for (const [id, g] of geo.groups) {
        const els = this.groupEls.get(id);
        if (!els) continue;
        const a = from?.groups.get(id);
        const boxT = g.shape.kind === 'rect' || g.shape.kind === 'sector' ? 1 : 0;
        const proxT = g.shape.kind === 'proxy' ? 1 : 0;
        const o = a ? lerp(a.o, boxT) : from ? k * boxT : boxT;
        const po = a ? lerp(a.po, proxT) : from ? k * proxT : proxT;
        const targetPc = centerOf(g.shape) ?? (g.foldTo ? centerOf(geo.groups.get(g.foldTo)!.shape) : null) ?? a?.pc ?? { x: 0, y: 0 };
        const pc = a ? { x: lerp(a.pc.x, targetPc.x), y: lerp(a.pc.y, targetPc.y) } : targetPc;
        let shape: GroupShape = g.shape;
        if (a && boxT && a.shape.kind === g.shape.kind) shape = lerpShape(a.shape, g.shape, k);
        else if (a && boxT && (a.po > 0 || a.o < 1)) shape = lerpShape(foldShape(g.shape, a.pc), g.shape, k);
        else if (a && !boxT && (a.shape.kind === 'rect' || a.shape.kind === 'sector')) shape = lerpShape(a.shape, foldShape(a.shape, targetPc), k);
        const labelSize = this.groupLabelSizes.get(id) ?? { w: 0, h: 0 };
        const labelTarget = boxT ? g.label : { x: targetPc.x - labelSize.w / 2, y: targetPc.y - labelSize.h / 2, w: g.label.w };
        const label = a ? { x: lerp(a.label.x, labelTarget.x), y: lerp(a.label.y, labelTarget.y), w: g.label.w } : labelTarget;
        if (shape.kind === 'rect') els.box.setAttribute('d', rectData(shape.x, shape.y, shape.w, shape.h, 16));
        else if (shape.kind === 'sector') els.box.setAttribute('d', sectorData(shape.cx, shape.cy, shape.r0, shape.r1, shape.a0, shape.a1));
        els.box.style.opacity = String(o);
        els.box.style.visibility = o < 0.01 ? 'hidden' : '';
        els.label.style.transform = `translate(${label.x}px, ${label.y}px)`;
        const edG = this.editing?.id === id;
        const editingLabel = edG && els.label.contains(this.editing!.ta);
        const editingProxy = edG && els.proxy.contains(this.editing!.ta);
        // Keep the active title editor visible when its group changes shape, as with node/edge drafts.
        els.label.style.opacity = String(editingLabel ? 1 : o);
        els.label.style.visibility = o < 0.01 && !editingLabel ? 'hidden' : '';
        // Proxy (collapsed / empty group) moves like a node.
        const sz = this.sizes.get(id) ?? { w: this.tun.nodeWidth, h: 44 };
        els.proxy.style.transform = `translate(${pc.x - sz.w / 2}px, ${pc.y - sz.h / 2}px)`;
        els.proxy.style.opacity = String(editingProxy ? 1 : po);
        els.proxy.style.visibility = po < 0.01 && !editingProxy ? 'hidden' : '';
        if (this.groupActivation) {
          els.label.tabIndex = boxT ? 0 : -1;
          els.proxy.tabIndex = proxT ? 0 : -1;
        }
        this.shown.groups.set(id, { shape, label, pc, o, po });
      }
      // Edges
      for (const [id, e] of geo.edges) {
        const els = this.edgeEls.get(id);
        if (!els) continue;
        const a = from?.edges.get(id);
        const tgtO = e.hidden ? 0 : 1;
        const o = a ? lerp(a.o, tgtO) : from ? k * tgtO : tgtO;
        let s: Float64Array;
        if (p >= 1 || !a) {
          s = e.samples;
          els.path.setAttribute('d', pathData(e.path));
        } else {
          s = new Float64Array(e.samples.length);
          for (let i = 0; i < s.length; i++) s[i] = a.s[i] + (e.samples[i] - a.s[i]) * k;
          els.path.setAttribute('d', polyData(s));
        }
        els.path.classList.toggle('back', e.back);
        els.arrow.classList.toggle('back', e.back);
        els.arrow.setAttribute('d', e.arrow ? arrowData(s) : '');
        els.path.style.opacity = String(o);
        els.arrow.style.opacity = String(o);
        this.shown.edges.set(id, { s, o });
      }
      if (p >= 1) {
        this.from = null;
        this.drawnGeo = geo;
      }
    }
    this.drawLinkLine();
    this.world.classList.toggle('moving', busy || !!this.gesture);
    this.placeMagnets();
    this.revealEditor();
    if (busy) this.schedule();
  }

  /** Keep the active editor reachable as layout, floating controls or its host frame change. */
  private revealEditor() {
    const ed = this.editing;
    if (!ed || !this.vw || !this.vh) return;
    const el = ed.ta.closest('.node, .glabel, .proxy, .carrier') as HTMLElement;
    const r = el.getBoundingClientRect();
    const vp = this.vp.getBoundingClientRect();
    let left = Math.max(vp.left, 0) + 8, top = Math.max(vp.top, 0) + 8;
    let right = Math.min(vp.right, window.innerWidth) - 8, bottom = Math.min(vp.bottom, window.innerHeight) - 8;
    for (let parent = this.parentElement; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent), box = parent.getBoundingClientRect();
      if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) { left = Math.max(left, box.left + 8); right = Math.min(right, box.right - 8); }
      if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) { top = Math.max(top, box.top + 8); bottom = Math.min(bottom, box.bottom - 8); }
    }
    if (right <= left || bottom <= top) return;
    const w = Math.min(r.width, right - left), hgt = Math.min(r.height, bottom - top);
    const puck = this.puck.getBoundingClientRect();
    const fit = (x: number, y: number) => ({ x: clamp(x, left, right - w), y: clamp(y, top, bottom - hgt) });
    const clear = (p: Pt) => p.x + w <= puck.left - 8 || p.x >= puck.right + 8 || p.y + hgt <= puck.top - 8 || p.y >= puck.bottom + 8;
    const candidates = [fit(r.left, r.top), fit(r.left, puck.bottom + 8), fit(r.left, puck.top - hgt - 8), fit(puck.left - w - 8, r.top), fit(puck.right + 8, r.top)];
    const options = candidates.filter(clear);
    const target = (options.length ? options : candidates).reduce((a, b) => Math.hypot(a.x - r.left, a.y - r.top) <= Math.hypot(b.x - r.left, b.y - r.top) ? a : b);
    const dx = target.x - r.left, dy = target.y - r.top;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
    // Move the drawn and destination cameras together, preserving an in-flight layout animation.
    this.view = { ...this.view, cam: panBy(this.view.cam, dx, dy), follow: false };
    this.camShown = panBy(this.camShown, dx, dy);
    if (this.camFrom) this.camFrom = panBy(this.camFrom, dx, dy);
    this.redraw = true;
    this.schedule();
  }

  // =====================================================================
  // Magnet controls
  // =====================================================================

  /** Screen rectangles of visible entities (optionally skipping some), for placement decisions. */
  private occupied(skip: Set<string>): Rect[] {
    const out: Rect[] = [];
    for (const [id, n] of this.shown.nodes) {
      if (skip.has(id) || n.o < 0.5) continue;
      const sz = this.sizes.get(id);
      if (sz) out.push(screenBox(this.camShown, this.vw, this.vh, { x: n.x - sz.w / 2, y: n.y - sz.h / 2, w: sz.w, h: sz.h }));
    }
    for (const [key, c] of this.shown.carriers) {
      const el = this.carrierEls.get(key);
      if (c.o < 0.5 || !el || skip.has(el.dataset.eid ?? '')) continue;
      const sz = this.sizes.get(key);
      if (sz) out.push(screenBox(this.camShown, this.vw, this.vh, { x: c.x - sz.w / 2, y: c.y - sz.h / 2, w: sz.w, h: sz.h }));
    }
    for (const [id, g] of this.shown.groups) {
      if (skip.has(id)) continue;
      if (g.po > 0.5 && g.shape.kind === 'proxy') {
        const sz = this.sizes.get(id) ?? { w: g.shape.w, h: g.shape.h };
        out.push(screenBox(this.camShown, this.vw, this.vh, { x: g.shape.x - sz.w / 2, y: g.shape.y - sz.h / 2, w: sz.w, h: sz.h }));
      } else if (g.o > 0.5) {
        const sz = { w: g.label.w, h: this.headers.get(id) ?? 20 };
        out.push(screenBox(this.camShown, this.vw, this.vh, { x: g.label.x, y: g.label.y, w: sz.w, h: sz.h }));
      }
    }
    return out;
  }

  /**
   * Magnet placement: cling just outside the target's border, fully on-screen first,
   * then covering as little of the diagram as possible.
   */
  private placeNear(sb: Rect, mw: number, mh: number, skip: Set<string>, variants?: { w: number; h: number; cost: number }[]): Pt & { v: number } {
    const vw = this.vw;
    const vh = this.vh;
    const gap = 10;
    const others = this.occupied(skip);
    const ui = this.uiRects;
    const sizes = variants && variants.length ? variants : [{ w: mw, h: mh, cost: 0 }];
    let best = { x: 8, y: 8, v: 0 };
    let bestBuried = Infinity;
    let bestScore = Infinity;
    sizes.forEach((sz, vi) => {
      const w = sz.w;
      const hh = sz.h;
      const cx = sb.x + sb.w / 2 - w / 2;
      const cy = sb.y + sb.h / 2 - hh / 2;
      const above = sb.y - hh - gap;
      const below = sb.y + sb.h + gap;
      const right = sb.x + sb.w + gap;
      const left = sb.x - w - gap;
      const cands: { x: number; y: number; pref: number }[] = [
        { x: cx, y: above, pref: 0 },
        { x: sb.x, y: above, pref: 1 },
        { x: sb.x + sb.w - w, y: above, pref: 1 },
        { x: cx, y: below, pref: 2 },
        { x: sb.x, y: below, pref: 3 },
        { x: sb.x + sb.w - w, y: below, pref: 3 },
        { x: right, y: cy, pref: 4 },
        { x: right, y: sb.y, pref: 5 },
        { x: right, y: sb.y + sb.h - hh, pref: 5 },
        { x: left, y: cy, pref: 6 },
        { x: left, y: sb.y, pref: 7 },
        { x: left, y: sb.y + sb.h - hh, pref: 7 },
      ];
      // A tall list can have no clear target-adjacent candidate. Also try each control's edges,
      // so the list (and a node/edge magnet) can move just below or beside the Layout pill.
      for (const o of ui) cands.push(
        { x: cx, y: o.y + o.h + gap, pref: 8 }, { x: cx, y: o.y - hh - gap, pref: 8 },
        { x: o.x + o.w + gap, y: cy, pref: 9 }, { x: o.x - w - gap, y: cy, pref: 9 },
      );
      for (const c of cands) {
        const off = Math.max(0, 8 - c.x) + Math.max(0, c.x + w - (vw - 8)) + Math.max(0, 8 - c.y) + Math.max(0, c.y + hh - (vh - 8));
        const x = clamp(c.x, 8, Math.max(8, vw - w - 8));
        const y = clamp(c.y, 8, Math.max(8, vh - hh - 8));
        // Covering any part of an entity hides words: count entities first, area second.
        let cover = 0;
        for (const o of others) {
          const ix = Math.min(x + w, o.x + o.w) - Math.max(x, o.x);
          const iy = Math.min(y + hh, o.y + o.h) - Math.max(y, o.y);
          if (ix > 0 && iy > 0) cover += 4000 + ix * iy;
        }
        const sx = Math.min(x + w, sb.x + sb.w) - Math.max(x, sb.x);
        const sy = Math.min(y + hh, sb.y + sb.h) - Math.max(y, sb.y);
        const self = sx > 0 && sy > 0 ? 8000 + sx * sy : 0;
        // Another floating control on top would make these buttons unreachable: worse than anything.
        let buried = 0;
        for (const o of ui) {
          const ix = Math.min(x + w, o.x + o.w) - Math.max(x, o.x);
          const iy = Math.min(y + hh, o.y + o.h) - Math.max(y, o.y);
          if (ix > 0 && iy > 0) buried += 200000 + ix * iy;
        }
        const score = off * 50 + cover + self + c.pref * 30 + sz.cost;
        if (buried < bestBuried || (buried === bestBuried && score < bestScore)) {
          bestBuried = buried;
          bestScore = score;
          best = { x, y, v: vi };
        }
      }
    });
    return best;
  }

  private selectionBounds(target = false): Rect | null {
    let r: Rect | null = null;
    const add = (b: Rect) => {
      if (!r) r = { ...b };
      else {
        const x = Math.min(r.x, b.x);
        const y = Math.min(r.y, b.y);
        r = { x, y, w: Math.max(r.x + r.w, b.x + b.w) - x, h: Math.max(r.y + r.h, b.y + b.h) - y };
      }
    };
    for (const id of this.view.sel) {
      const n = target ? this.geo?.nodes.get(id) : this.shown.nodes.get(id);
      if (n) {
        const sz = this.sizes.get(id);
        if (sz && ('visible' in n ? n.visible : n.o > 0.05)) add({ x: n.x - sz.w / 2, y: n.y - sz.h / 2, w: sz.w, h: sz.h });
        continue;
      }
      const g = target ? this.geo?.groups.get(id) : this.shown.groups.get(id);
      if (g) {
        if (g.shape.kind === 'proxy') {
          const sz = this.sizes.get(id) ?? { w: g.shape.w, h: g.shape.h };
          add({ x: g.shape.x - sz.w / 2, y: g.shape.y - sz.h / 2, w: sz.w, h: sz.h });
        } else {
          const b = shapeBounds(g.shape);
          if (b) add(b);
        }
        continue;
      }
      const eb = this.edgeBox(id, target);
      if (eb) add(eb);
    }
    return r;
  }

  private placeMagnets() {
    if (this.graphPresentation) return;
    const vw = this.vw;
    const vh = this.vh;
    // ---- diagram magnet (puck), first: the other floating controls keep clear of it ----
    this.renderPuck();
    const pw = this.puck.offsetWidth;
    const ph = this.puck.offsetHeight;
    let px = vw - pw - 8;
    let py = 8;
    if (!this._doc.nodes.length) {
      px = (vw - pw) / 2;
      py = (vh - ph) / 2;
    } else if (this.geo) {
      const db = screenBox(this.camShown, vw, vh, { x: 0, y: 0, w: this.geo.width, h: this.geo.height });
      px = db.x + db.w - pw;
      py = db.y - ph - 6;
    }
    px = clamp(px, 8, Math.max(8, vw - pw - 8));
    py = clamp(py, 8, Math.max(8, vh - ph - 8));
    this.puck.style.transform = `translate(${Math.round(px)}px, ${Math.round(py)}px)`;
    const hint = this.hasAttribute('empty-hint') && this.getAttribute('empty-hint') !== 'false' && !this.readonly_ && !this.error;
    this.kickstarterEl.hidden = !hint;
    this.kickstarterEl.firstElementChild!.textContent = this.touchContext ? 'Tap Add node' : 'Double-click anywhere';
    (this.kickstarterEl.lastElementChild as HTMLElement).hidden = this.touchContext;
    this.kickstarterEl.classList.toggle('off', this._doc.nodes.length > 0);
    this.kickstarterEl.setAttribute('aria-hidden', String(!hint || this._doc.nodes.length > 0));
    if (hint && !this._doc.nodes.length) {
      const hw = this.kickstarterEl.offsetWidth;
      const hh = this.kickstarterEl.offsetHeight;
      this.kickstarterEl.style.transform = `translate(${Math.round((vw - hw) / 2)}px, ${Math.round(Math.max(8, py - hh - 18))}px)`;
    }

    this.uiRects = [{ x: px, y: py, w: pw, h: ph }];
    this.puckBox = { x: px, y: py, w: pw, h: ph };

    this.drawRing();

    // ---- selection magnet ----
    const sel = this.view.sel;
    const showNode = sel.length > 0 && !this.editing && !this.gesture && !this.helpOpen && !this.linker;
    const bounds = showNode ? this.selectionBounds() : null;
    if (!bounds) this.keepFocus(this.nodeMag, () => (this.nodeMag.hidden = true));
    else {
      this.renderNodeMagnet();
      this.nodeMag.hidden = false;
      const sb = screenBox(this.camShown, vw, vh, bounds);
      if (!this.magSizes) {
        this.nodeMag.classList.remove('narrow');
        const wide = { w: this.nodeMag.offsetWidth, h: this.nodeMag.offsetHeight, cost: 0 };
        this.nodeMag.classList.add('narrow');
        const narrow = { w: this.nodeMag.offsetWidth, h: this.nodeMag.offsetHeight, cost: 400 };
        this.magSizes = narrow.w < wide.w - 20 ? [wide, narrow] : [wide];
      }
      const at = this.placeNear(sb, 0, 0, new Set(sel), this.magSizes);
      this.nodeMag.classList.toggle('narrow', at.v === 1);
      const { x, y } = at;
      this.magAt = { x, y };
      const far = sb.x + sb.w < 0 || sb.y + sb.h < 0 || sb.x > vw || sb.y > vh;
      this.nodeMag.classList.toggle('far', far);
      const loc = this.nodeMag.querySelector('[data-act="locate"]') as HTMLElement | null;
      if (loc) loc.hidden = !far;
      this.nodeMag.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    }

    if (!this.nodeMag.hidden) this.uiRects.push({ x: this.magAt.x, y: this.magAt.y, w: this.nodeMag.offsetWidth, h: this.nodeMag.offsetHeight });
    // ---- link list, clinging to its source ----
    if (this.linker) this.placeLinker();

    // ---- view panel ----
    if (this.panel) {
      this.panelEl.hidden = false;
      const w = this.panelEl.offsetWidth;
      const hh = this.panelEl.offsetHeight;
      let x: number;
      let y: number;
      if (this.panel.at === 'puck') {
        x = px + pw - w;
        y = py + ph + 6;
        if (y + hh > vh - 8) y = py - hh - 6;
      } else {
        x = this.panel.at.x + 6;
        y = this.panel.at.y + 6;
      }
      this.panelEl.style.transform = `translate(${Math.round(clamp(x, 8, Math.max(8, vw - w - 8)))}px, ${Math.round(clamp(y, 8, Math.max(8, vh - hh - 8)))}px)`;
    } else this.panelEl.hidden = true;

    // ---- help ----
    if (this.helpOpen) {
      const w = this.helpEl.offsetWidth;
      const hh = this.helpEl.offsetHeight;
      this.helpEl.style.transform = `translate(${Math.round(Math.max(8, (vw - w) / 2))}px, ${Math.round(Math.max(8, (vh - hh) / 2))}px)`;
    }
  }

  private btn(act: string, icon: string, text: string, chord: string, extra = ''): string {
    const title = chord && !this.touchContext ? `${text} (${chord})` : text;
    return `<button class="mb ${extra}" data-act="${act}" title="${title}" aria-label="${title}">${icon}<span>${text}</span>${kbd(chord)}</button>`;
  }

  /**
   * One button for an action and its reverse (Link / link into it; next / previous edge). Its words
   * never change: while ⇧ is held its icon turns around and its ⇧ key lights up, both in place, so
   * nothing on the bar moves. ⇧-click does the reverse, as ⇧ with its key does. The reverse key
   * is ⇧ + the key unless it has its own (Dive J, Surface K).
   */
  private flipBtn(act: string, back: string, icon: string, backIcon: string, text: string, chord: string, tip: string, backTip: string, backChord = '⇧' + chord): string {
    const title = this.touchContext ? tip : `${tip} (${chord}); ⇧-click: ${backTip} (${backChord})`;
    return `<button class="mb flip" data-act="${act}" data-back="${back}" title="${title}" aria-label="${title}"><span class="fl">${icon}${backIcon}</span><span>${text}</span><span class="keys">${kbd(chord)}${kbd(backChord)}</span></button>`;
  }

  private renderNodeMagnet() {
    const sel = this.view.sel;
    const doc = this._doc;
    const nodes = sel.filter((id) => M.nodeById(doc, id));
    const groups = sel.filter((id) => M.groupById(doc, id));
    const edges = sel.filter((id) => M.edgeById(doc, id));
    const ro = this.readonly_;
    // S / ⇧S step through a node's edges: offered on a lone node that has some, and on a lone edge.
    const one = sel.length === 1;
    const steps = one && (edges.length === 1 || (nodes.length === 1 && doc.edges.some((e) => e.from === nodes[0] || e.to === nodes[0])));
    const stepBtns = () => (steps ? this.flipBtn('nextedge', 'prevedge', ICON.nextEdge, ICON.prevEdge, 'Select edge', 'S', 'Select its next edge', 'the edge before') : '');
    // ↵ / ⇧↵ dive into and surface out of groups: offered wherever either would move the selection,
    // except on a lone node or edge, where ↵ edits (there is nothing inside it to dive into).
    const same = (a: string[]) => sameList(a, sel);
    const levels = !(one && (nodes.length || edges.length)) && (!same(M.dive(doc, sel)) || !same(M.surface(doc, sel)));
    const levelBtns = () => (levels ? this.flipBtn('dive', 'surface', ICON.dive, ICON.surface, 'Dive', 'J', 'Select what is inside, opening a collapsed group', 'select the group around it', 'K') : '');
    const key = [sel.join(','), ro, steps, levels, groups.map((g) => M.groupById(doc, g)?.collapsed).join(','), edges.map((e) => M.connectionOf(doc, e)?.trunk.label ?? '').join(',')].join('|');
    if (key === this.nodeMagKey) return;
    this.nodeMagKey = key;
    let html = '';
    if (!ro) {
      let del = 'Delete';
      if (nodes.length === 1 && groups.length === 0 && edges.length === 0) {
        html += this.btn('edit', ICON.edit, 'Edit', '↵');
        html += this.flipBtn('after', 'before', ICON.node, ICON.node, 'Add node', 'N', 'Add a node after it', 'a node before it');
        html += this.flipBtn('link', 'linkin', ICON.link, ICON.linkIn, 'Link', 'E', 'Link it to a node or an edge', 'link a node into it');
        html += stepBtns();
        html += this.btn('group', ICON.group, 'Group', 'G');
      } else if (groups.length === 1 && nodes.length === 0 && edges.length === 0) {
        const g = M.groupById(doc, groups[0])!;
        html += this.btn('edit', ICON.edit, 'Rename', '↵');
        html += levelBtns();
        html += this.btn('collapse', g.collapsed ? ICON.expand : ICON.collapse, g.collapsed ? 'Expand' : 'Collapse', 'C');
        html += this.btn('inside', ICON.plus, 'Node inside', 'N');
        html += this.btn('ungroup', ICON.ungroup, 'Ungroup', '⇧G');
      } else if (edges.length === 1 && nodes.length === 0 && groups.length === 0) {
        const c = M.connectionOf(doc, edges[0])!;
        html += this.btn('edit', ICON.label, c.trunk.label ? 'Edit label' : 'Label', '↵');
        if (c.trunk.label) html += this.btn('unlabel', ICON.unlabel, 'Remove label', '⇧⌫');
        html += this.btn('split', ICON.plus, 'Insert node', 'N');
        html += this.btn('cause', ICON.before, 'Add cause', '⇧N');
        html += stepBtns();
        // A merge's trunk takes the whole merge with it; a branch takes only its own cause.
        if (c.junction && c.trunk.id === edges[0]) del = 'Delete merge';
      } else {
        html += `<span class="count-chip">${sel.length} selected</span>`;
        html += levelBtns();
        if (nodes.length || groups.length) html += this.btn('group', ICON.group, 'Group', 'G');
      }
      html += this.btn('delete', ICON.trash, del, '⌫', 'danger');
    } else {
      html += `<span class="count-chip">${sel.length === 1 ? '1 selected' : `${sel.length} selected`}</span>`;
      // Stepping, diving and surfacing only move the selection, so a read-only diagram offers them too.
      html += levelBtns();
      html += stepBtns();
    }
    html += `<button class="mb" data-act="locate" hidden title="${this.touchContext ? 'Show the selection' : 'Show the selection (F)'}" aria-label="${this.touchContext ? 'Show the selection' : 'Show the selection (F)'}">${ICON.locate}<span>Show</span>${kbd('F')}</button>`;
    this.keepFocus(this.nodeMag, () => {
      this.nodeMagBar.innerHTML = html;
      this.nodeMagBar.querySelectorAll<HTMLButtonElement>('button[data-act]').forEach((b) =>
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          this.action(e.shiftKey && b.dataset.back ? b.dataset.back : b.dataset.act!);
        }),
      );
    });
    this.magSizes = null;
  }

  /**
   * Rebuilding or hiding a control that has keyboard focus drops focus out of the diagram, onto the
   * page, and every key stops working until the next click on the diagram. This runs such a change
   * and then puts focus back on the same control if it was rebuilt, else on the diagram. If focus
   * has moved somewhere else meanwhile (an editor, the link list's filter), it stays there.
   */
  private keepFocus(box: HTMLElement, change: () => void) {
    const a = this.root.activeElement as HTMLElement | null;
    if (!a || !box.contains(a)) return change();
    const d = a.dataset;
    const same = d.act ? `[data-act="${d.act}"]` : d.set ? `[data-set="${d.set}"][data-v="${d.v}"]` : null;
    change();
    const now = this.root.activeElement;
    if (now && !box.contains(now)) return;
    if (now && now.isConnected && !now.closest('[hidden]')) return;
    const again = same ? box.querySelector<HTMLButtonElement>(same) : null;
    (again && !again.disabled && !again.closest('[hidden]') ? again : this.vp).focus({ preventScroll: true });
  }

  private renderPuck() {
    this.syncLinkerReceipt();
    const u = this.undoDisplay === 'active' ? this.hist.peekUndo() : null;
    const r = this.hist.peekRedo();
    // Add stays available in the diagram toolbar and follows N's selection context.
    const add = !this.readonly_;
    const layout = this._doc.nodes.length > 0;
    const key = [u?.label, r?.label, !!this.panel, this.helpOpen, this.saveProblem, add, layout].join('|');
    if (key === this.puckKey) return;
    this.puckKey = key;
    const undoTitle = u ? `Undo ${esc(u.label)}${this.touchContext ? '' : ` (${K.undo})`}` : '';
    const redoTitle = r ? `Redo ${esc(r.label)}${this.touchContext ? '' : ` (${K.redo})`}` : '';
    const undo = u
      ? `<button class="mb" data-act="undo" title="${undoTitle}" aria-label="${undoTitle}">${ICON.undo}<span>${esc(u.label)}</span>${kbd(K.undo)}</button>`
      : '';
    const redo = r
      ? `<button class="mb" data-act="redo" title="${redoTitle}" aria-label="${redoTitle}">${ICON.redo}${kbd(K.redo)}</button>`
      : '';
    const saveNote = this.saveProblem ? `<span class="save-problem" role="status" title="${esc(this.saveProblem)}">Not saved</span>` : '';
    const addBtn = add ? layout
      ? this.flipBtn('addnode', 'addpick', ICON.node, ICON.node, 'Add node', 'N', 'Add a node', 'add before, or choose nodes to link to')
      : this.btn('addnode', ICON.node, 'Add node', 'N') : '';
    this.keepFocus(this.puck, () => this.fillPuck(addBtn, undo, redo, saveNote, layout));
  }

  private fillPuck(addBtn: string, undo: string, redo: string, saveNote: string, layout: boolean) {
    const layoutBtn = layout ? `<button class="mb ${this.panel ? 'on' : ''}" data-act="panel" aria-expanded="${!!this.panel}" title="Layout and view" aria-label="Layout and view">${ICON.magnet}<span>Layout</span>${kbd('/')}</button>` : '';
    this.puck.innerHTML = `<div class="bar"><div class="puck-actions">${addBtn}${layoutBtn}${undo}${redo}${saveNote}</div><button class="mb help-toggle ${this.helpOpen ? 'on' : ''}" data-act="help" title="Help" aria-label="Help" aria-expanded="${this.helpOpen}"><span aria-hidden="true">?</span></button></div>`;
    this.puck.querySelectorAll<HTMLButtonElement>('button[data-act]').forEach((b) => this.keepEditorFocus(b));
    this.puck.querySelectorAll<HTMLButtonElement>('button[data-act]').forEach((b) =>
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        const act = b.dataset.act!;
        if (act === 'panel') this.panel ? this.closePanel() : this.openPanel('puck');
        else this.action(e.shiftKey && b.dataset.back ? b.dataset.back : act);
      }),
    );
  }

  /**
   * Pressing a control while a node is being edited must not first end the edit by taking focus:
   * Undo on a just-added empty node would otherwise see the node already gone and undo the step before.
   */
  private keepEditorFocus(b: HTMLElement) {
    const hold = (e: Event) => {
      if (this.editing) e.preventDefault();
    };
    b.addEventListener('pointerdown', hold);
    b.addEventListener('mousedown', hold);
  }

  private openPanel(at: 'puck' | Pt) {
    this.panel = { at };
    this.renderPanel();
    this.puckKey = '';
    this.schedule();
    requestAnimationFrame(() => (this.panelEl.querySelector('button[aria-pressed="true"]') as HTMLElement | null)?.focus({ preventScroll: true }));
  }

  private closePanel(refocus = false) {
    if (!this.panel) return;
    this.panel = null;
    this.panelEl.hidden = true;
    this.puckKey = '';
    this.schedule();
    if (refocus) this.vp.focus({ preventScroll: true });
  }

  private renderPanel() {
    const s = this._doc.settings;
    const resolved = this.geo?.orient;
    const seg = (name: string, items: { v: string; label: string; icon?: string; title?: string }[], cur: string) =>
      `<div class="seg" role="group" aria-label="${name}">${items
        .map(
          (i) =>
            `<button data-set="${name}" data-v="${i.v}" aria-pressed="${i.v === cur}" title="${esc(i.title ?? i.label)}" aria-label="${esc(i.title ?? i.label)}">${i.icon ?? ''}${i.icon ? '' : esc(i.label)}</button>`,
        )
        .join('')}</div>`;
    const orientItems = M.ORIENTATIONS.map((o) => ({ v: o, label: ORIENT_LABEL[o], icon: ORIENT_ICON[o], title: ORIENT_LABEL[o] }));
    const rot = Math.round((((this.view.cam.r * 180) / Math.PI) % 360 + 360) % 360);
    const zoom = Math.round(this.view.cam.z * 100);
    let html = `
      <h3><span>Orientation</span>${kbd('O')}</h3>
      <div class="row2">${seg('orientation', orientItems, s.orientation)}
        <div class="hint">${esc(ORIENT_LABEL[s.orientation])}${s.orientation === 'auto' && resolved ? ` · now ${esc(ORIENT_LABEL[resolved].toLowerCase())}` : ''}</div></div>
      <h3><span>Bias</span>${kbd('B')}</h3>
      <div class="row2">${seg('bias', [{ v: 'start', label: 'Start', title: 'Push entities toward the start of the flow' }, { v: 'end', label: 'End', title: 'Push entities toward the end of the flow' }], s.bias)}</div>
      <h3><span>Density</span>${kbd('D')}</h3>
      <div class="row2">${seg('compactness', [{ v: 'relaxed', label: 'Relaxed' }, { v: 'comfortable', label: 'Comfortable' }, { v: 'compact', label: 'Compact' }], s.compactness)}</div>
      <h3><span>Incremental layout</span>${kbd('I')}</h3>
      <div class="row2"><button class="sw" role="switch" data-act="incremental" aria-checked="${s.incremental}"><span class="track"></span><span>${s.incremental ? 'On — changes keep the current order' : 'Off — every change lays out from scratch'}</span></button></div>
      <h3><span>Tight groups</span>${kbd('T')}</h3>
      <div class="row2"><button class="sw" role="switch" data-act="tight" aria-checked="${s.tightGroups}"><span class="track"></span><span>${s.tightGroups ? 'On — members with room to move close ranks inside their group' : 'Off — ranks come from cause and effect alone'}</span></button></div>
      <h3><span>Untangle</span>${kbd('U')}</h3>
      <div class="row2"><button class="sw" role="switch" data-act="untangle" aria-checked="${s.untangle}"><span class="track"></span><span>${s.untangle ? 'On — a node with room to move may shift a rank to remove crossing lines' : 'Off — bias alone decides where such nodes go'}</span></button></div>
      <div class="bar" style="padding:0;margin-top:2px">
        ${this.btn('fit', ICON.fit, this.view.follow ? 'Fitting' : 'Fit', '0', this.view.follow ? 'on' : '')}
        ${this.btn('zoom100', ICON.locate, `${zoom}%`, '1')}
        ${rot ? this.btn('upright', ICON.upright, `Upright (${rot}°)`, 'R') : ''}
      </div>
      <button class="disc" data-act="exhaustive" aria-expanded="${this.exhaustive}"><span>${this.exhaustive ? 'Fewer values' : `All ${TUNABLE_META.length} values`}</span><span>${this.exhaustive ? '‹' : '›'}</span></button>
      <div class="exh" ${this.exhaustive ? '' : 'hidden'}>
        ${TUNABLE_META.map(
          (m) =>
            `<div class="num"><label for="tun-${m.key}">${esc(m.label)}</label><input id="tun-${m.key}" type="number" inputmode="decimal" min="${m.min}" max="${m.max}" step="${m.step}" value="${this.tun[m.key]}" data-tun="${m.key}"></div>`,
        ).join('')}
        <div class="bar" style="padding:0">${this.btn('tun-reset', ICON.undo, 'Reset values', '')}</div>
      </div>`;
    html = html.replace(/<kbd><\/kbd>/g, '');
    this.panelEl.innerHTML = html;
    this.panelEl.querySelectorAll<HTMLButtonElement>('button[data-set]').forEach((b) =>
      b.addEventListener('click', () => this.changeSetting(b.dataset.set as keyof M.FlowSettings, b.dataset.v!)),
    );
    this.panelEl.querySelectorAll<HTMLButtonElement>('button[data-act]').forEach((b) =>
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        this.action(b.dataset.act!);
      }),
    );
    this.panelEl.querySelectorAll<HTMLInputElement>('input[data-tun]').forEach((inp) =>
      inp.addEventListener('input', () => {
        const key = inp.dataset.tun as keyof Tunables;
        const v = Number(inp.value);
        const meta = TUNABLE_META.find((m) => m.key === key)!;
        if (!Number.isFinite(v)) return;
        this.tun[key] = clamp(v, meta.min, meta.max);
        if (key === 'nodeWidth') this.applyNodeWidth();
        this.invalidate(false);
        this.persist();
      }),
    );
    // Arrow keys move within a segmented control (one Tab stop each).
    this.panelEl.querySelectorAll<HTMLDivElement>('.seg').forEach((segEl) => {
      const btns = [...segEl.querySelectorAll<HTMLButtonElement>('button')];
      btns.forEach((b) => (b.tabIndex = b.getAttribute('aria-pressed') === 'true' ? 0 : -1));
      if (!btns.some((b) => b.tabIndex === 0) && btns[0]) btns[0].tabIndex = 0;
      segEl.addEventListener('keydown', (e) => {
        const i = btns.indexOf(e.target as HTMLButtonElement);
        if (i < 0) return;
        let j = -1;
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') j = (i + 1) % btns.length;
        if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') j = (i - 1 + btns.length) % btns.length;
        if (j >= 0) {
          e.preventDefault();
          e.stopPropagation();
          btns[j].focus();
          btns[j].click();
        }
      });
    });
  }

  private changeSetting(key: keyof M.FlowSettings, value: string) {
    const v: any = key === 'incremental' || key === 'tightGroups' || key === 'untangle' ? value === 'true' : value;
    if (this._doc.settings[key] === v) return;
    const names: Record<string, string> = { orientation: 'Orientation', bias: 'Bias', compactness: 'Density', incremental: 'Incremental layout', tightGroups: 'Tight groups', untangle: 'Untangle' };
    const pretty = key === 'orientation' ? ORIENT_LABEL[v as Orientation].split(' (')[0].split(' —')[0] : typeof v === 'boolean' ? (v ? 'on' : 'off') : String(v);
    this.commit(`${names[key]}: ${pretty}`, 'settings', { doc: M.setSettings(this._doc, { [key]: v }) }, { anchor: this.defaultAnchor() });
    if (key === 'orientation') this.autoPick = null;
    if (this.panel) {
      const focused = (this.root.activeElement as HTMLElement | null)?.dataset;
      this.renderPanel();
      if (focused?.set) (this.panelEl.querySelector(`button[data-set="${focused.set}"][data-v="${focused.v}"]`) as HTMLElement | null)?.focus({ preventScroll: true });
    }
  }

  private openHelp() {
    const wasOpen = this.helpOpen;
    this.helpOpen = true;
    const row = (k: string, d: string) => `<tr><td>${k}</td><td>${d}</td></tr>`;
    this.helpEl.innerHTML = this.touchContext ? `<h2><span>Gestures</span><button class="mb" data-act="close-help" title="Close" aria-label="Close">${ICON.close}</button></h2>
      <table>
      ${row('Tap', 'Select a node, group or edge')}
      ${row('Tap again', 'Edit its text (an edge: its label). Tap the canvas to keep the words and finish editing')}
      ${row('Add node', 'Add after the selected node, inside the selected group, or in the middle of the selected edge. With nothing selected, add a free node')}
      ${row('Drag', 'Pan the diagram')}
      ${row('Pinch / two-finger twist', 'Zoom / rotate the view')}
      ${row('Long-press', 'Open layout controls right where you are')}
      ${row('Link', 'Select a node, tap Link, then tap a node or an edge in the list. An edge joins its merge')}
      ${row('List checkboxes', 'Check several rows, then tap Link or Add node to act on them together')}
      ${row('Groups', 'Tap a group’s chevron to fold or unfold it. Its selection controls also offer Dive, Expand or Collapse')}
      ${row('Delete', 'Delete the selection. The diagram toolbar’s Undo brings it back')}
      ${row('Layout', 'Change flow direction, spacing and grouping, or fit the diagram into view')}
      ${row('Undo / redo', 'Take back or repeat content and view changes from the diagram toolbar')}
      </table>` : `<h2><span>Gestures and keys</span><button class="mb" data-act="close-help" title="Close (Esc)" aria-label="Close (Esc)">${ICON.close}${kbd('Esc')}</button></h2>
      <h4>Pointer</h4><table>
      ${row('Click', 'Select a node, group or edge')}
      ${row('Click again', 'Edit its text (an edge: its label)')}
      ${row('⇧ / ' + (IS_MAC ? '⌘' : 'Ctrl') + ' click', 'Add to or remove from the selection')}
      ${row('Drag from a node', 'Link it: drop on another node, or on an edge to merge into it (Esc cancels). Hold it near the frame’s edge and the view moves that way, to reach nodes out of view. With a mouse; touch uses E’s list')}
      ${row('Drag elsewhere', 'Pan (layout places things, so nothing is dragged out of place). Touch: any drag pans')}
      ${row('⇧ drag', 'Select with a box')}
      ${row('Double-click', 'Add a node there (inside a group when over one)')}
      ${row((IS_MAC ? '⌘' : 'Ctrl') + ' click · ⇧ click, in a list', 'Check one more row (or click its box) · check every row between it and the last one checked; ↵ or a click then acts on them all')}
      ${row('Scroll / two fingers', 'Pan (once the diagram has focus)')}
      ${row((IS_MAC ? '⌘' : 'Ctrl') + ' scroll / pinch', 'Zoom at the pointer')}
      ${row('⌥ scroll / two-finger twist', 'Rotate the view')}
      ${row('Right-click / long-press', 'Layout controls, right where you are')}
      </table>
      <h4>Keys</h4><table>
      ${row('Arrows', 'Move the selection to the nearest item that way (⇧ adds)')}
      ${row('↵ · F2', 'Edit the selected item (a group: its title) · then ↵ saves, ⇧↵ new line, Esc saves, and the item stays selected (Esc again deselects all), ' + K.addNext + ' saves and adds the next node')}
      ${row('J (or ↵ with several or none selected)', 'Dive: each selected group gives the selection over to what is inside it, one level down, opening a collapsed group; nodes stay selected. Nothing selected (thick blue frame): the top level')}
      ${row('K (or ⇧↵)', 'Surface: the deepest selected items give way to the group around them, one level up; items higher up stay until the level reaches them. A group Dive opened closes again. From the top level: the whole diagram, nothing selected')}
      ${row('N / ⇧N', 'Add a node after / before the selected node. Nothing selected: N adds a node; ⇧N lists nodes for a new node to link before (↵) or after (⇧↵). An edge selected: N inserts a node in its middle and ⇧N adds a new cause that merges into it')}
      ${row('E / ⇧E (L / H)', 'Link the selected node: pick a node or an edge from a list, nearest first / pick a node to link into it')}
      ${row('S / ⇧S', 'Select the selected node’s next edge / the edge before')}
      ${row('G / ⇧G', 'Group the selection / ungroup')}
      ${row('C', 'Collapse or expand the selected group')}
      ${row('⌫', 'Delete the selection (a merge’s shared edge deletes the merge)')}
      ${row('⇧⌫', 'Remove the selected edge’s label; the edge stays')}
      ${row(K.undo + ' / ' + K.redo, 'Undo / redo — content and view changes alike')}
      ${row(K.rewind + ' / ' + K.fastForward, 'Express rewind / fast-forward — undo / redo changes, skipping zoom and other camera moves, so the view stays put. Zoom out, rewind, then fast-forward to watch a change with more of the diagram in view')}
      ${row(K.all + ' · Esc', 'Select everything · deselect all')}
      ${row('= / − / 0 / 1', 'Zoom in / out (⇧ doubles the step) / fit (and follow) / 100%')}
      ${row('[ / ] / R', 'Rotate the view / set it upright')}
      ${row('⌥ arrows', 'Pan')}
      ${row('O · B · D · I · T · U', 'Orientation · bias · density · incremental layout · tight groups · untangle')}
      ${row('/', 'Open the layout controls')}
      ${row('F', 'Bring the selection into view')}
      </table>`;
    this.helpEl.insertAdjacentHTML('beforeend', '<slot name="help" class="help-extra"></slot>');
    const slot = this.helpEl.querySelector<HTMLSlotElement>('slot')!;
    const syncSlot = () => { slot.hidden = slot.assignedElements().length === 0; };
    slot.addEventListener('slotchange', syncSlot);
    syncSlot();
    this.helpEl.querySelector('[data-act="close-help"]')!.addEventListener('click', () => this.closeHelp());
    this.helpEl.hidden = false;
    if (!wasOpen) this.helpEl.scrollTop = 0;
    this.schedule();
    requestAnimationFrame(() => (this.helpEl.querySelector('button') as HTMLElement | null)?.focus({ preventScroll: true }));
  }

  private closeHelp(refocus = true) {
    if (!this.helpOpen) return;
    this.helpOpen = false;
    this.helpEl.hidden = true;
    if (refocus) this.vp.focus({ preventScroll: true });
    this.schedule();
  }

  // =====================================================================
  // Actions (buttons and keys share these)
  // =====================================================================

  private action(act: string): void {
    const sel = this.view.sel;
    const doc = this._doc;
    const one = sel.length === 1 ? sel[0] : null;
    switch (act) {
      case 'undo':
        return this.undo();
      case 'redo':
        return this.redo();
      case 'edit':
        if (one) this.startEdit(one);
        return;
      case 'split':
        if (one && M.edgeById(doc, one)) return this.splitEdge(one);
        return;
      case 'unlabel':
        if (one && M.edgeById(doc, one)) return this.removeLabel(one);
        return;
      case 'cause':
        if (one && M.edgeById(doc, one)) return this.addCause(one);
        return;
      case 'after':
      case 'before':
        if (one && M.nodeById(doc, one)) return this.addLinked(one, act);
        // On an edge, N inserts a node into it; ⇧N adds a new cause that merges into it.
        if (one && M.edgeById(doc, one)) return act === 'after' ? this.splitEdge(one) : this.addCause(one);
        // Nothing selected: N adds a free node (as a double-click does); ⇧N picks nodes to link it to.
        if (!sel.length && act === 'before') return this.openAdder(this.lastPointerType !== 'touch');
        if (!one || !M.groupById(doc, one)) return this.addFree(null, null);
        return;
      case 'addnode':
      case 'addpick':
        // The diagram toolbar advertises N / ⇧N and follows those keys in every selection.
        if (one && M.groupById(doc, one)) return this.addFree(one, null);
        return this.action(act === 'addnode' ? 'after' : 'before');
      case 'dive':
        return this.diveSelection();
      case 'surface':
        return this.surfaceSelection();
      case 'inside':
        if (one && M.groupById(doc, one)) return this.addFree(one, null);
        return;
      case 'nextedge':
      case 'prevedge':
        return this.stepEdges(act === 'nextedge' ? 1 : -1);
      case 'link':
      case 'linkin':
        if (one && M.nodeById(doc, one)) return this.openLinker(one, this.lastPointerType !== 'touch', act === 'link' ? 'out' : 'in');
        return;
      case 'tight':
        return this.changeSetting('tightGroups', String(!doc.settings.tightGroups));
      case 'untangle':
        return this.changeSetting('untangle', String(!doc.settings.untangle));
      case 'group':
        return this.groupSelection();
      case 'ungroup':
        return this.ungroupSelection();
      case 'collapse':
        return this.toggleCollapse();
      case 'delete':
        return this.deleteSelection();
      case 'locate':
        return this.locateSelection();
      case 'fit':
        return this.fit();
      case 'zoom100':
        return this.zoomTo(1);
      case 'upright':
        return this.rotateTo(0);
      case 'incremental':
        return this.changeSetting('incremental', String(!doc.settings.incremental));
      case 'help':
        this.closePanel();
        return this.openHelp();
      case 'exhaustive':
        this.exhaustive = !this.exhaustive;
        this.renderPanel();
        (this.panelEl.querySelector('[data-act="exhaustive"]') as HTMLElement | null)?.focus({ preventScroll: true });
        this.schedule();
        return;
      case 'tun-reset':
        this.tun = this.attrTunables();
        this.applyNodeWidth();
        this.renderPanel();
        this.invalidate(false);
        this.persist();
        return;
    }
  }

  private addFree(group: string | null, at: Pt | null, where: Pt | null = null) {
    if (this.readonly_) return;
    const { doc, id } = M.addNode(this._doc, '', group);
    const screen = at ?? where ?? (this.lastPointer && this.inViewport(this.lastPointer) ? this.lastPointer : { x: this.vw / 2, y: this.vh / 2 });
    const e = this.commit('Add node', 'add', { doc, view: { sel: [id], follow: at ? false : this.view.follow } }, { anchor: { id, screen } });
    if (!e) return;
    this.startEdit(id, true, e);
  }

  private addLinked(anchor: string, dir: 'after' | 'before') {
    if (this.readonly_) return;
    const { doc, id } = M.addLinked(this._doc, anchor, dir);
    const s = this.shownScreen(anchor);
    const e = this.commit(dir === 'after' ? 'Add node after' : 'Add node before', 'add', { doc, view: { sel: [id] } }, { anchor: s && !this.view.follow ? { id: anchor, screen: s } : null });
    if (!e) return;
    this.startEdit(id, true, e);
  }

  /** A new node linked before (new → each) or after (each → new) the nodes picked in the list. */
  private addLinkedTo(anchors: string[], dir: 'after' | 'before') {
    if (this.readonly_) return;
    const r = M.addLinkedTo(this._doc, anchors, dir);
    if (!r) return;
    const names = anchors.map((a) => M.label(M.nodeById(this._doc, a)?.text ?? ''));
    const label = `Add node ${dir} ${anchors.length === 1 ? names[0] : `${anchors.length} nodes`}`;
    const s = this.shownScreen(anchors[0]);
    const e = this.commit(label, 'add', { doc: r.doc, view: { sel: [r.id] } }, { anchor: s && !this.view.follow ? { id: anchors[0], screen: s } : null });
    if (!e) return;
    this.announce(`${label}: ${joinAnd(names)}. Type its text.`);
    this.startEdit(r.id, true, e);
  }

  /**
   * J (or ↵ when more or less than one item is selected): each selected group gives the selection
   * over to its own members. A collapsed group opens first, as an undo step of its own (Al, Q9),
   * and is remembered so that surfacing out of it closes it again.
   */
  private diveSelection() {
    const plan = M.divePlan(this._doc, this.view.sel);
    if (sameList(plan.sel, this.view.sel)) return this.nudge(this.hintPoint(), 'Nothing inside to select');
    if (plan.open.length && !this.readonly_) {
      let doc = this._doc;
      for (const g of plan.open) doc = M.setCollapsed(doc, g, false);
      this.commit(this.groupsLabel('Expand', plan.open), 'collapse', { doc });
      plan.open.forEach((g) => this.diveOpened.add(g));
    } else if (plan.open.length) return this.nudge(this.hintPoint(), 'This diagram is read-only, so a collapsed group stays shut');
    this.commit('Dive', 'select', { view: { sel: plan.sel } });
    this.announce(`Selected ${plan.sel.length} item${plan.sel.length === 1 ? '' : 's'} inside.`);
  }

  /**
   * K (or ⇧↵): the deepest selected items give way to the group around them; from the top level, the
   * diagram itself (nothing selected, the thick focus ring). A group Dive opened closes again as its
   * own undo step, and stays selected, so the next K carries on up the chain.
   */
  private surfaceSelection() {
    const next = M.surface(this._doc, this.view.sel);
    if (sameList(next, this.view.sel)) return this.nudge(this.hintPoint(), 'Already at the whole diagram');
    this.commit('Surface', 'select', { view: { sel: next } });
    const close = next.filter((id) => this.diveOpened.has(id) && M.groupById(this._doc, id)?.collapsed === false);
    if (close.length && !this.readonly_) {
      let doc = this._doc;
      for (const g of close) doc = M.setCollapsed(doc, g, true);
      this.commit(this.groupsLabel('Collapse', close), 'collapse', { doc });
    }
    close.forEach((g) => this.diveOpened.delete(g));
    this.announce(`${next.length ? `Selected ${next.length} item${next.length === 1 ? '' : 's'}, one level up` : 'Up to the whole diagram; nothing selected'}${close.length ? `; closed ${close.length === 1 ? 'the group' : `${close.length} groups`} Dive opened` : ''}.`);
  }

  private groupsLabel(verb: 'Expand' | 'Collapse', ids: string[]): string {
    return ids.length === 1 ? `${verb} ${M.label(M.groupById(this._doc, ids[0])?.text ?? '', 'a group')}` : `${verb} ${ids.length} groups`;
  }

  /** A new node in the middle of the selected edge, with a caret in it (one undo step with its text). */
  private splitEdge(edgeId: string) {
    if (this.readonly_) return;
    const r = M.splitEdge(this._doc, edgeId);
    if (!r) return;
    const s = this.shownScreen(edgeId);
    const e = this.commit('Insert node', 'add', { doc: r.doc, view: { sel: [r.id] } }, { anchor: s && !this.view.follow ? { id: r.id, screen: s } : null });
    if (!e) return;
    this.startEdit(r.id, true, e);
  }

  /** Takes the label off the selected edge (a merge's shared label for a branch); the edge stays. */
  private removeLabel(edgeId: string) {
    if (this.readonly_) return;
    const c = M.connectionOf(this._doc, edgeId);
    if (!c?.trunk.label) return this.nudge(this.hintPoint(), 'This edge has no label');
    this.commit('Remove label', 'edit', { doc: M.setEdgeLabel(this._doc, edgeId, '') });
  }

  /** A new node that joins the selected edge as another cause of its effect, with a caret in it. */
  private addCause(edgeId: string) {
    if (this.readonly_) return;
    const r = M.addCause(this._doc, edgeId);
    if (!r) return;
    const s = this.shownScreen(edgeId);
    const e = this.commit('Add cause', 'add', { doc: r.doc, view: { sel: [r.id] } }, { anchor: s && !this.view.follow ? { id: r.id, screen: s } : null });
    if (!e) return;
    this.startEdit(r.id, true, e);
  }

  private groupSelection() {
    if (this.readonly_ || !this.view.sel.length) return;
    const r = M.groupItems(this._doc, this.view.sel);
    if (!r) return;
    const e = this.commit(`Group ${this.view.sel.length} item${this.view.sel.length === 1 ? '' : 's'}`, 'group', { doc: r.doc, view: { sel: [r.id] } });
    if (!e) return;
    this.startEdit(r.id, true, e);
  }

  private ungroupSelection() {
    if (this.readonly_) return;
    const gs = this.view.sel.filter((id) => M.groupById(this._doc, id));
    if (!gs.length) return;
    let doc = this._doc;
    const members: string[] = [];
    for (const g of gs) {
      members.push(...doc.nodes.filter((n) => n.group === g).map((n) => n.id), ...doc.groups.filter((x) => x.parent === g).map((x) => x.id));
      doc = M.ungroup(doc, g);
    }
    this.commit(gs.length === 1 ? 'Ungroup' : `Ungroup ${gs.length} groups`, 'ungroup', { doc, view: { sel: members } });
  }

  private toggleCollapse() {
    if (this.readonly_) return;
    const gs = this.view.sel.filter((id) => M.groupById(this._doc, id));
    if (!gs.length) return;
    const collapse = !M.groupById(this._doc, gs[0])!.collapsed;
    let doc = this._doc;
    for (const g of gs) doc = M.setCollapsed(doc, g, collapse);
    this.commit(collapse ? 'Collapse group' : 'Expand group', 'collapse', { doc });
  }

  private toggleCollapseOf(gid: string) {
    if (this.readonly_) return;
    const g = M.groupById(this._doc, gid);
    if (!g) return;
    const s = this.shownScreen(gid);
    this.diveOpened.delete(gid);
    this.commit(g.collapsed ? 'Expand group' : 'Collapse group', 'collapse', { doc: M.setCollapsed(this._doc, gid, !g.collapsed), view: { sel: [gid] } }, { anchor: s ? { id: gid, screen: s } : null });
  }

  private deleteSelection() {
    if (this.readonly_ || !this.view.sel.length) return;
    const doc = this._doc;
    const sel = [...this.view.sel];
    const b = this.selectionBounds();
    const where = b ? { x: b.x + b.w / 2, y: b.y + b.h / 2 } : { x: this.view.cam.x, y: this.view.cam.y };
    // Anchor on a surviving neighbour so the spot stays put.
    const doomed = new Set(sel);
    for (const id of sel) if (M.groupById(doc, id)) M.groupContents(doc, id).nodes.forEach((n) => doomed.add(n));
    let anchor: string | null = null;
    for (const id of sel) {
      const c = M.connectionOf(doc, id);
      if (c && !doomed.has(c.inputs[0])) anchor = anchor ?? c.inputs[0];
    }
    for (const e of doc.edges) {
      if (doomed.has(e.from) && !doomed.has(e.to)) anchor = anchor ?? e.to;
      if (doomed.has(e.to) && !doomed.has(e.from)) anchor = anchor ?? e.from;
    }
    if (anchor && !M.nodeById(doc, anchor)) anchor = null;
    const r = M.deleteItems(doc, sel);
    const words: string[] = [];
    if (r.nodes) words.push(`${r.nodes} node${r.nodes === 1 ? '' : 's'}`);
    if (r.groups) words.push(`${r.groups} group${r.groups === 1 ? '' : 's'}`);
    if (r.edges) words.push(`${r.edges} edge${r.edges === 1 ? '' : 's'}`);
    const singleNode = sel.length === 1 ? M.nodeById(doc, sel[0]) : null;
    const singleEdge = sel.length === 1 ? M.connectionOf(doc, sel[0]) : null;
    const what = singleNode
      ? M.label(singleNode.text)
      : singleEdge
        ? `the edge ${singleEdge.junction && singleEdge.trunk.id !== sel[0] ? M.describeConnection(doc, { ...singleEdge, inputs: [M.edgeById(doc, sel[0])!.from] }) : M.describeConnection(doc, singleEdge)}`
        : words.join(' and ');
    const aScreen = anchor ? this.shownScreen(anchor) : null;
    this.commit(`Delete ${words.join(' and ')}`, 'delete', { doc: r.doc, view: { sel: [] } }, { where, anchor: anchor && aScreen ? { id: anchor, screen: aScreen } : null });
    this.announce(`Deleted ${what}. ${this.touchContext ? 'Undo' : K.undo} brings it back.`);
  }

  private locateSelection() {
    const b = this.selectionBounds();
    if (!b) return;
    const c = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
    this.commit('Show selection', 'pan', { view: { cam: pin(this.view.cam, this.vw, this.vh, c, { x: this.vw / 2, y: this.vh / 2 }), follow: false } });
  }

  private revealGraphSelection() {
    this.pendingGraphReveal = null;
    const bounds = this.selectionBounds(true);
    if (!bounds || !this.graphPresentation) return;
    const b = screenBox(this.view.cam, this.vw, this.vh, bounds);
    const shift = (start: number, size: number, extent: number) => size > extent - 32 ? extent / 2 - start - size / 2 : start < 16 ? 16 - start : start + size > extent - 16 ? extent - 16 - start - size : 0;
    const dx = shift(b.x, b.w, this.vw);
    const dy = shift(b.y, b.h, this.vh);
    if (dx || dy) {
      this.view = { ...this.view, cam: panBy(this.view.cam, dx, dy), follow: false };
      this.animateCamera();
    }
    this.pendingGraphReveal = 'scroll';
  }

  private zoomTo(z: number, at?: Pt, coalesce = 0) {
    const s = at ?? { x: this.vw / 2, y: this.vh / 2 };
    const w = toWorld(this.view.cam, this.vw, this.vh, s);
    const z2 = clamp(z, 0.08, 6);
    this.commit(`Zoom ${Math.round(z2 * 100)}%`, 'zoom', { view: { cam: pin(this.view.cam, this.vw, this.vh, w, s, z2), follow: false } }, { coalesce });
  }

  private rotateTo(r: number, at?: Pt, coalesce = 0) {
    const s = at ?? { x: this.vw / 2, y: this.vh / 2 };
    const w = toWorld(this.view.cam, this.vw, this.vh, s);
    const deg = Math.round((((r * 180) / Math.PI) % 360 + 360) % 360);
    this.commit(deg ? `Rotate ${deg}°` : 'Rotate upright', 'rotate', { view: { cam: pin(this.view.cam, this.vw, this.vh, w, s, this.view.cam.z, r) } }, { coalesce });
  }

  private panScreen(dx: number, dy: number, coalesce = 0) {
    this.commit('Pan', 'pan', { view: { cam: panBy(this.view.cam, dx, dy), follow: false } }, { coalesce, animateCam: coalesce === 0 });
  }

  // =====================================================================
  // Editing
  // =====================================================================

  private startEdit(id: string, isNew = false, entry: Entry | null = null) {
    if (this.readonly_) return;
    this.finishEdit('save');
    const node = M.nodeById(this._doc, id);
    const group = node ? null : M.groupById(this._doc, id);
    // An edge's label lives on its connection's trunk: a branch edits its merge's shared label.
    const conn = node || group ? null : M.connectionOf(this._doc, id);
    if (!node && !group && !conn) return;
    if (conn) {
      const hadCarrier = !!this.carrierOfEdge(conn.trunk.id);
      const at = this.edgeAnchor(conn.trunk.id) ?? this.edgeAnchor(id);
      this.labelDraft = { edge: conn.trunk.id, text: conn.trunk.label ?? '' };
      this.syncDom();
      const key = plan(this._doc, this.labelDraft).carrierOf.get(conn.trunk.id);
      const el = key ? this.carrierEls.get(key) : null;
      // A new label grows out of the middle of its edge.
      if (el && key && !hadCarrier && at) {
        this.shown.carriers.set(key, { x: at.x, y: at.y, o: 1 });
        el.style.transform = `translate(${at.x - 30}px, ${at.y - 12}px)`;
      }
    }
    // A node created a moment ago has no element until the next frame: build it now.
    if ((node && !this.nodeEls.has(id)) || (group && !this.groupEls.has(id))) this.syncDom();
    let host: HTMLElement | null = null;
    if (node) host = this.nodeEls.get(id)?.querySelector('.t') ?? null;
    else if (group) {
      const els = this.groupEls.get(id)!;
      host = group.collapsed ? (els.proxy.querySelector('.t') as HTMLElement) : (els.label.querySelector('.gt') as HTMLElement);
    } else if (conn) {
      const key = plan(this._doc, this.labelDraft).carrierOf.get(conn.trunk.id);
      host = (key && (this.carrierEls.get(key)?.querySelector('.t') as HTMLElement | null)) || null;
    }
    if (!host) {
      this.labelDraft = null;
      return;
    }
    const kind: EditState['kind'] = node ? 'node' : group ? 'group' : 'edge';
    const original = node ? node.text : group ? group.text : conn!.trunk.label ?? '';
    const ta = h('textarea', 'ed', {
      rows: '1',
      'aria-label': { node: 'Node text', group: 'Group title', edge: 'Edge label' }[kind],
      placeholder: { node: 'Type…', group: 'Untitled group', edge: 'Label…' }[kind],
      spellcheck: 'true',
    });
    ta.value = original;
    host.textContent = '';
    host.append(ta);
    const container = node ? this.nodeEls.get(id)! : conn ? host.closest('.carrier')! : host.closest('.glabel, .proxy')!;
    container.classList.add('editing');
    this.editing = { id: conn ? conn.trunk.id : id, kind, original, isNew, entry, ta };
    const fitHeight = () => {
      ta.style.height = '0px';
      ta.style.height = `${ta.scrollHeight}px`;
    };
    fitHeight();
    ta.addEventListener('input', () => {
      fitHeight();
      if (kind === 'edge' && this.labelDraft) this.labelDraft.text = ta.value;
      // Most keystrokes leave the box the same size: re-lay out only when it changed.
      if (this.sizeChanged(container as HTMLElement)) {
        this.dirtyLayout = true;
        this.schedule();
      }
    });
    ta.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') {
        // Esc keeps the words as last typed and leaves Edit mode; the item stays selected (a second
        // Esc deselects all).
        e.preventDefault();
        this.finishEdit('save');
      } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        const nid = this.editing?.kind === 'node' ? this.editing.id : null;
        this.finishEdit('save');
        if (nid && M.nodeById(this._doc, nid)) this.addLinked(nid, e.shiftKey ? 'before' : 'after');
      } else if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.finishEdit('save');
      }
    });
    ta.addEventListener('blur', () => {
      // Switching to another window or tab leaves Edit mode open: the box keeps focus for the
      // return, so typing carries on (ending it there left focus on the page and keys went nowhere).
      if (typeof document !== 'undefined' && !document.hasFocus()) return;
      if (this.editing?.ta === ta) this.finishEdit('save', false);
    });
    ta.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.nodeMag.hidden = true;
    this.redraw = true;
    // A hidden element cannot take focus: show the edited item right away, then focus.
    (container as HTMLElement).style.visibility = '';
    if (Number((container as HTMLElement).style.opacity || '1') < 0.5) (container as HTMLElement).style.opacity = '1';
    const focusIt = () => {
      if (this.editing?.ta !== ta || this.root.activeElement === ta) return;
      ta.focus({ preventScroll: true });
      const n = ta.value.length;
      ta.setSelectionRange(n, n);
    };
    focusIt();
    requestAnimationFrame(focusIt);
    this.dirtyLayout = true;
    this.schedule();
  }

  /** End the edit in progress (see `FinishEdit`). */
  private finishEdit(how: FinishEdit, refocus = true) {
    const ed = this.editing;
    if (!ed) return;
    this.editing = null;
    const save = how !== 'discard';
    const text = save ? ed.ta.value : ed.original;
    const container = ed.ta.closest('.node, .glabel, .proxy, .carrier');
    container?.classList.remove('editing');
    ed.ta.remove();
    this.redraw = true;
    if (ed.kind === 'edge') {
      this.labelDraft = null;
      if (save && text !== ed.original && M.edgeById(this._doc, ed.id)) {
        this.commit(text.trim() ? `Label ${M.label(text, '')}` : 'Remove label', 'edit', { doc: M.setEdgeLabel(this._doc, ed.id, text) });
      } else {
        this.dirtyDom = true;
        this.invalidate(true);
      }
      this.syncDom();
      if (refocus) this.vp.focus({ preventScroll: true });
      return;
    }
    const setText = (d: FlowDoc) => (ed.kind === 'node' ? M.setNodeText(d, ed.id, text) : M.setGroupText(d, ed.id, text));
    if (ed.isNew) {
      const abandoned = ed.kind === 'node' && (!save || !text.trim());
      const last = this.hist.peekUndo();
      if (abandoned) {
        // A new node left empty disappears again, and its "Add" leaves no trace in history: it is
        // the last step, or only view steps (a scroll, a zoom) came after it.
        const prior = ed.entry?.before.doc;
        const keep = (x: string) => !!prior && !!(M.nodeById(prior, x) || M.groupById(prior, x) || M.edgeById(prior, x));
        const forgotten = (ed.entry && last === ed.entry && !this.hist.canRedo && this.hist.dropLast()) || (ed.entry && this._doc === ed.entry.after.doc && this.hist.forget(ed.entry, ed.entry.after.doc, ed.entry.before.doc, keep));
        if (ed.entry && forgotten) {
          this._doc = ed.entry.before.doc;
          this.view = { ...this.view, sel: ed.entry.before.view.sel.filter((id) => this.exists(id)) };
          this.pendingAnchor = this.defaultAnchor();
          this.invalidate(true);
          this.emit('lode-change', { doc: this._doc, label: 'Discard empty node' });
          this.emit('lode-select', { selection: [...this.view.sel] });
          this.emitHistory();
          this.persist();
        } else if (ed.entry && this._doc === ed.entry.after.doc) {
          // Only view changes came after the add, but its step cannot be forgotten (there is
          // something to redo): put the document back exactly, so an edge that was split is whole
          // again, label and all.
          this.commit('Discard empty node', 'delete', { doc: ed.entry.before.doc, view: { sel: ed.entry.before.view.sel.filter((x) => M.nodeById(ed.entry!.before.doc, x) || M.groupById(ed.entry!.before.doc, x) || M.edgeById(ed.entry!.before.doc, x)) } });
        } else {
          this.commit('Discard empty node', 'delete', { doc: M.dissolveNode(this._doc, ed.id), view: { sel: [] } });
        }
      } else if (text !== ed.original) {
        if (ed.entry && last === ed.entry && !this.hist.canRedo) {
          this._doc = setText(this._doc);
          const base = ed.entry.label;
          this.hist.amendLast(this.snapshot(), ed.kind === 'node' ? `${base} ${M.label(text)}` : base);
          this.dirtyDom = true;
          this.invalidate(true);
          this.emit('lode-change', { doc: this._doc, label: ed.entry.label });
          this.emitHistory();
          this.persist();
        } else {
          this.commit(`Edit ${M.label(text)}`, 'edit', { doc: setText(this._doc) });
        }
      } else {
        this.invalidate(true);
      }
    } else if (save && text !== ed.original) {
      this.commit(ed.kind === 'node' ? `Edit ${M.label(text)}` : 'Rename group', 'edit', { doc: setText(this._doc) });
    } else {
      this.dirtyDom = true;
      this.invalidate(true);
    }
    // Put the text back into the display element.
    this.syncDom();
    if (refocus) this.vp.focus({ preventScroll: true });
  }

  // =====================================================================
  // Pointer input
  // =====================================================================

  private local(e: { clientX: number; clientY: number }): Pt {
    const r = this.vp.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private inViewport(p: Pt) {
    return p.x >= 0 && p.y >= 0 && p.x <= this.vw && p.y <= this.vh;
  }

  private hit(t: EventTarget | null): Hit {
    const el = t as Element | null;
    if (!el || !el.closest) return { type: 'empty', id: null };
    const chev = el.closest('[data-chev]') as HTMLElement | null;
    if (chev) return { type: 'chev', id: chev.dataset.chev! };
    const car = el.closest('.carrier[data-eid]') as HTMLElement | null;
    if (car) return { type: 'edge', id: car.dataset.eid! };
    const node = el.closest('.node[data-id]') as HTMLElement | null;
    if (node) return { type: 'node', id: node.dataset.id! };
    const g = el.closest('[data-gid]') as Element | null;
    if (g) return { type: 'group', id: g.getAttribute('data-gid') };
    return { type: 'empty', id: null };
  }

  /**
   * An edge near `p` wins over empty canvas and over a group's background (lines run inside and
   * across boxes), but not over a node, a label, a group's title or its chevron.
   */
  private withEdge(t: EventTarget | null, target: Hit, p: Pt, touch = false): Hit {
    const el = t as Element | null;
    const background = target.type === 'empty' || (target.type === 'group' && !!el?.closest?.('.gbox'));
    if (!background) return target;
    const eid = this.edgeAt(p, touch ? EDGE_HIT_TOUCH : EDGE_HIT);
    return eid ? { type: 'edge', id: eid } : target;
  }

  /** Nearest edge route within `tol` screen pixels of `p`. */
  private edgeAt(p: Pt, tol = EDGE_HIT): string | null {
    let best: string | null = null;
    let bd = tol;
    for (const [id, e] of this.shown.edges) {
      if (e.o < 0.5) continue;
      const s = e.s;
      let a = toScreen(this.camShown, this.vw, this.vh, { x: s[0], y: s[1] });
      for (let i = 2; i < s.length; i += 2) {
        const b = toScreen(this.camShown, this.vw, this.vh, { x: s[i], y: s[i + 1] });
        const d = segDist(p, a, b);
        if (d < bd) {
          bd = d;
          best = id;
        }
        a = b;
      }
    }
    return best;
  }

  /** What is under screen point `p`, by geometry (works mid-drag, whatever holds the pointer). */
  private pickAt(p: Pt): Hit {
    const cam = this.camShown;
    const w = toWorld(cam, this.vw, this.vh, p);
    const pad = 4 / cam.z;
    const inside = (x: number, y: number, sz: { w: number; h: number }) => Math.abs(w.x - x) <= sz.w / 2 + pad && Math.abs(w.y - y) <= sz.h / 2 + pad;
    for (const [id, n] of this.shown.nodes) {
      const sz = this.sizes.get(id);
      if (n.o > 0.5 && sz && inside(n.x, n.y, sz)) return { type: 'node', id };
    }
    for (const [key, c] of this.shown.carriers) {
      const sz = this.sizes.get(key);
      const eid = this.carrierEls.get(key)?.dataset.eid;
      // Junction dots are small: give them a finger-sized target.
      if (c.o > 0.5 && sz && eid && inside(c.x, c.y, { w: Math.max(sz.w, 22 / cam.z), h: Math.max(sz.h, 22 / cam.z) })) return { type: 'edge', id: eid };
    }
    for (const [id, g] of this.shown.groups) {
      if (g.po > 0.5 && g.shape.kind === 'proxy' && inside(g.shape.x, g.shape.y, this.sizes.get(id) ?? g.shape)) return { type: 'group', id };
    }
    const eid = this.edgeAt(p);
    return eid ? { type: 'edge', id: eid } : { type: 'empty', id: null };
  }

  /** Hovering an edge (mouse) marks it, so edges read as something you can click. */
  private updateHover(t: EventTarget | null, p: Pt) {
    const hit = this.withEdge(t, this.hit(t), p);
    const eid = hit.type === 'edge' ? hit.id : null;
    if (eid === this.hoverEdge) return;
    this.hoverEdge = eid;
    this.vp.classList.toggle('over-edge', !!eid);
    this.applyEdgeClasses();
  }

  private onPointerDown(e: PointerEvent) {
    if (this.graphPresentation) return;
    const p = this.local(e);
    this.lastPointer = p;
    if ((e.target as Element).closest?.('textarea')) return;
    // What was pressed, judged before an edit ends (ending it redraws the diagram).
    const pressed = this.withEdge(e.target, this.hit(e.target), p, e.pointerType !== 'mouse');
    const endedEdit = this.document_activeIsEditor();
    if (endedEdit) this.finishEdit('save', false);
    this.vp.focus({ preventScroll: true });
    this.pointers.set(e.pointerId, p);
    try {
      this.vp.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    if (this.pointers.size === 2 && e.pointerType === 'touch') {
      // Two fingers: pinch to zoom, twist to rotate.
      const [a, b] = [...this.pointers.values()];
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const before = this.gesture?.before ?? this.snapshot();
      if (this.gesture?.longPress) clearTimeout(this.gesture.longPress);
      this.gesture = {
        kind: 'pinch',
        id: e.pointerId,
        start: mid,
        last: mid,
        before,
        target: { type: 'empty', id: null },
        shift: false,
        toggle: false,
        button: 0,
        pointerType: 'touch',
        longPress: 0,
        pinch: {
          d0: Math.hypot(b.x - a.x, b.y - a.y),
          a0: Math.atan2(b.y - a.y, b.x - a.x),
          cam0: { ...this.view.cam },
          mid0: mid,
          world0: toWorld(this.view.cam, this.vw, this.vh, mid),
          rotating: false,
          zoomed: false,
        },
      };
      return;
    }
    if (this.pointers.size > 1) return;
    const target = pressed;
    const g = {
      kind: 'pending' as const,
      id: e.pointerId,
      start: p,
      last: p,
      before: this.snapshot(),
      target,
      shift: e.shiftKey,
      toggle: e.metaKey || e.ctrlKey,
      button: e.button,
      pointerType: e.pointerType,
      longPress: 0,
      endedEdit,
    };
    if (e.pointerType !== 'mouse' && (target.type === 'empty' || target.type === 'group')) {
      g.longPress = window.setTimeout(() => {
        if (this.gesture === g && g.kind === 'pending') {
          this.gesture = null;
          this.pointers.delete(g.id);
          this.openPanel(g.start);
        }
      }, 550);
    }
    this.gesture = g;
    if (e.button === 1 || this.spaceDown) {
      this.gesture.kind = 'pan';
      this.vp.classList.add('panning');
    }
  }

  private document_activeIsEditor() {
    return !!this.editing;
  }

  private onPointerMove(e: PointerEvent) {
    if (this.graphPresentation) return;
    const p = this.local(e);
    this.lastPointer = p;
    if (!this.pointers.has(e.pointerId)) {
      if (e.pointerType === 'mouse' && !this.gesture) this.updateHover(e.target, p);
      return;
    }
    this.pointers.set(e.pointerId, p);
    const g = this.gesture;
    if (!g) return;
    if (g.kind === 'pinch' && g.pinch && this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()];
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const d = Math.hypot(b.x - a.x, b.y - a.y);
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      const pc = g.pinch;
      const z = clamp(pc.cam0.z * (d / Math.max(1, pc.d0)), 0.08, 6);
      let dAng = ang - pc.a0;
      while (dAng > Math.PI) dAng -= 2 * Math.PI;
      while (dAng < -Math.PI) dAng += 2 * Math.PI;
      if (!pc.rotating && Math.abs(dAng) > (14 * Math.PI) / 180) pc.rotating = true;
      if (Math.abs(z / pc.cam0.z - 1) > 0.03) pc.zoomed = true;
      const r = pc.rotating ? pc.cam0.r + dAng : pc.cam0.r;
      this.view = { ...this.view, cam: pin(pc.cam0, this.vw, this.vh, pc.world0, mid, z, r), follow: false };
      this.camShown = { ...this.view.cam };
      this.camFrom = null;
      g.last = mid;
      this.schedule();
      return;
    }
    if (e.pointerId !== g.id) return;
    const dx = p.x - g.last.x;
    const dy = p.y - g.last.y;
    if (g.kind === 'pending') {
      const moved = Math.hypot(p.x - g.start.x, p.y - g.start.y);
      // A firm trackpad click can wobble a few pixels: under 8 (9 on touch) it is still a click.
      if (moved > (g.pointerType === 'mouse' ? 8 : 9)) {
        if (g.longPress) clearTimeout(g.longPress);
        if (g.target.type === 'node' && g.pointerType === 'mouse' && g.button === 0 && !g.shift && !this.readonly_ && !this.spaceDown) {
          // A mouse drag that starts on a node draws a link; touch keeps one-finger pan.
          g.kind = 'link';
          this.vp.classList.add('linking');
          this.closeLinker(false);
          this.hoverEdge = null;
          this.applyEdgeClasses();
        } else {
          g.kind = g.shift && g.pointerType !== 'touch' ? 'marquee' : 'pan';
          if (g.kind === 'pan') this.vp.classList.add('panning');
        }
      }
    }
    if (g.kind === 'link' && g.target.id) {
      this.updateLinkOver(p);
      g.last = p;
      this.edgePanCheck();
      this.schedule();
      return;
    }
    if (g.kind === 'pan') {
      this.view = { ...this.view, cam: panBy(this.view.cam, p.x - g.last.x, p.y - g.last.y), follow: false };
      this.camShown = { ...this.view.cam };
      this.camFrom = null;
      this.schedule();
    } else if (g.kind === 'marquee') {
      const x = Math.min(g.start.x, p.x);
      const y = Math.min(g.start.y, p.y);
      this.marqueeEl.hidden = false;
      this.marqueeEl.style.cssText = `left:${x}px;top:${y}px;width:${Math.abs(p.x - g.start.x)}px;height:${Math.abs(p.y - g.start.y)}px`;
    }
    void dx;
    void dy;
    g.last = p;
  }

  private onPointerUp(e: PointerEvent, cancelled = false) {
    if (this.graphPresentation) return;
    const p = this.local(e);
    this.pointers.delete(e.pointerId);
    const g = this.gesture;
    if (!g) return;
    if (g.longPress) clearTimeout(g.longPress);
    if (g.kind === 'pinch') {
      if (this.pointers.size === 0) {
        this.gesture = null;
        const pc = g.pinch!;
        const kind: EntryKind = pc.rotating ? 'rotate' : pc.zoomed ? 'zoom' : 'pan';
        this.commit(kind === 'rotate' ? 'Rotate' : kind === 'zoom' ? `Zoom ${Math.round(this.view.cam.z * 100)}%` : 'Pan', kind, {}, { before: g.before, animateCam: false });
      }
      return;
    }
    if (e.pointerId !== g.id) return;
    this.gesture = null;
    this.vp.classList.remove('panning');
    if (g.kind === 'link') {
      this.vp.classList.remove('linking');
      this.markLinkTarget(null);
      this.endEdgePan(g);
      this.schedule();
      const over = g.over;
      if (cancelled || !g.target.id) return;
      if (over?.ok && over.hit.id) this.performLink(g.target.id, over.hit as { type: 'node' | 'edge'; id: string }, 'drag');
      else if (over?.why) this.nudge(p, over.why);
      else if (Math.hypot(p.x - g.start.x, p.y - g.start.y) > 40) this.nudge(p, 'Drop on a node to link, or on an edge to merge');
      return;
    }
    if (cancelled) {
      this.schedule();
      return;
    }
    if (g.kind === 'pan') {
      this.commit('Pan', 'pan', {}, { before: g.before, animateCam: false });
      return;
    }
    if (g.kind === 'marquee') {
      this.marqueeEl.hidden = true;
      const r = { x: Math.min(g.start.x, p.x), y: Math.min(g.start.y, p.y), w: Math.abs(p.x - g.start.x), h: Math.abs(p.y - g.start.y) };
      const picked: string[] = [];
      for (const [id, n] of this.shown.nodes) {
        if (n.o < 0.5) continue;
        const s = toScreen(this.camShown, this.vw, this.vh, n);
        if (s.x >= r.x && s.x <= r.x + r.w && s.y >= r.y && s.y <= r.y + r.h) picked.push(id);
      }
      const sel = [...new Set([...this.view.sel, ...picked])];
      this.commit(picked.length ? `Select ${sel.length}` : 'Select', 'select', { view: { sel } });
      return;
    }
    // A click or tap.
    if (g.button === 2) return;
    const t = now();
    const key = g.target.id ?? '';
    const dbl = !!(this.lastTap && t - this.lastTap.t < 380 && Math.hypot(p.x - this.lastTap.x, p.y - this.lastTap.y) < 10 && this.lastTap.target === key);
    this.lastTap = dbl ? null : { t, x: p.x, y: p.y, target: key };
    this.handleClick(g.target, p, g.shift || g.toggle, dbl, !!g.endedEdit);
  }

  private handleClick(target: Hit, at: Pt, toggle: boolean, dbl: boolean, endedEdit = false) {
    if (this.eventActivation && target.type === 'node' && target.id && !toggle) return this.activateNode(target.id, 'pointer');
    const sel = this.view.sel;
    // The press ended an edit that removed what it landed on (the rim of a new node left empty):
    // it counts as a click on the bare canvas.
    if (target.id && target.type !== 'empty' && !this.exists(target.id)) target = { type: 'empty', id: null };
    if (target.type === 'chev' && target.id) return this.toggleCollapseOf(target.id);
    if (target.type === 'edge' && target.id) {
      const id = target.id;
      if (toggle) {
        const next = sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id];
        this.commit(next.length > sel.length ? 'Add to selection' : 'Remove from selection', 'select', { view: { sel: next } });
        return;
      }
      if (sel.length === 1 && sel[0] === id) {
        // Click on the selected edge: write its label.
        if (!this.readonly_) this.startEdit(id);
        return;
      }
      const c = M.connectionOf(this._doc, id);
      this.commit(c ? `Select ${M.describeConnection(this._doc, c)}` : 'Select edge', 'select', { view: { sel: [id] } });
      return;
    }
    if ((target.type === 'node' || target.type === 'group') && target.id) {
      const id = target.id;
      if (target.type === 'group' && dbl && !this.readonly_) {
        // Double-click on a group's empty area adds a node inside it.
        const g = M.groupById(this._doc, id);
        if (g && !g.collapsed) return this.addFree(id, at);
      }
      if (toggle) {
        const next = sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id];
        this.commit(next.length > sel.length ? 'Add to selection' : 'Remove from selection', 'select', { view: { sel: next } });
        return;
      }
      if (sel.length === 1 && sel[0] === id) {
        // Click on the selected item: edit it.
        if (!this.readonly_) this.startEdit(id);
        return;
      }
      const item = M.nodeById(this._doc, id);
      this.commit(item ? `Select ${M.label(item.text)}` : 'Select group', 'select', { view: { sel: [id] } });
      return;
    }
    // Empty canvas. A click that ended an edit only leaves Edit mode: the item stays selected, and
    // the next click on the canvas deselects (Al, 2026-10-04).
    if (dbl && !this.readonly_) return this.addFree(null, at);
    if (sel.length && !endedEdit) this.deselectAll();
  }

  private deselectAll() {
    this.commit('Deselect all', 'select', { view: { sel: [] } });
  }

  private onContextMenu(e: MouseEvent) {
    if (this.graphPresentation) return;
    e.preventDefault();
    const p = this.local(e);
    const target = this.withEdge(e.target, this.hit(e.target), p);
    if (target.type === 'node' || target.type === 'group' || target.type === 'edge') {
      if (target.id && !this.view.sel.includes(target.id)) this.commit('Select', 'select', { view: { sel: [target.id] } });
      return;
    }
    this.openPanel(p);
  }

  private onWheel(e: WheelEvent) {
    if (this.graphPresentation) return;
    const p = this.local(e);
    this.lastPointer = p;
    const zoomIntent = e.ctrlKey || e.metaKey;
    const rotateIntent = e.altKey;
    const focused = this.root.activeElement != null;
    if (!zoomIntent && !rotateIntent) {
      if (this.wheelMode === 'modifier' || (this.wheelMode === 'auto' && !focused)) {
        this.nudge(p, this.touchContext ? 'Tap the diagram to scroll it' : `Click the diagram to scroll it · ${IS_MAC ? '⌘' : 'Ctrl'}-scroll zooms`);
        return; // let the page scroll
      }
    }
    e.preventDefault();
    let dx = e.deltaX;
    let dy = e.deltaY;
    if (e.deltaMode === 1) {
      dx *= 16;
      dy *= 16;
    } else if (e.deltaMode === 2) {
      dx *= this.vh;
      dy *= this.vh;
    }
    if (zoomIntent) {
      const z = this.view.cam.z * Math.exp(-dy * 0.0022 * this.tun.wheelZoom);
      this.zoomTo(z, p, 500);
    } else if (rotateIntent) {
      const d = Math.abs(dy) > Math.abs(dx) ? dy : dx;
      this.rotateTo(this.view.cam.r + d * 0.003, p, 500);
    } else {
      this.panScreen(-dx, -dy, 500);
      this.camShown = { ...this.view.cam };
      this.camFrom = null;
    }
  }

  private nudge(p: Pt, text: string) {
    this.nudgeEl.textContent = text;
    this.nudgeEl.hidden = false;
    const w = this.nudgeEl.offsetWidth;
    this.nudgeEl.style.transform = `translate(${Math.round(clamp(p.x - w / 2, 8, Math.max(8, this.vw - w - 8)))}px, ${Math.round(clamp(p.y + 14, 8, this.vh - 40))}px)`;
    clearTimeout(this.nudgeTimer);
    this.nudgeTimer = window.setTimeout(() => (this.nudgeEl.hidden = true), 1400);
  }

  // =====================================================================
  // Linking
  // =====================================================================

  /** What dropping a link from `source` at screen point `p` would do. */
  private linkTargetAt(source: string, p: Pt): { hit: Hit; ok: boolean; why: string | null } {
    const hit = this.pickAt(p);
    if (hit.type === 'node' && hit.id) {
      if (hit.id === source) return { hit, ok: false, why: null };
      const why = M.linkProblem(this._doc, source, hit.id);
      return { hit, ok: !why, why };
    }
    if (hit.type === 'edge' && hit.id) {
      const why = M.mergeProblem(this._doc, source, hit.id);
      return { hit, ok: !why, why };
    }
    return { hit, ok: false, why: null };
  }

  /**
   * Re-checks what a link drag would land on at `p`, saying a refusal once as the target changes.
   * Only inside the frame: past its edge a node is out of sight, and edge pan is bringing it in.
   */
  private updateLinkOver(p: Pt) {
    const g = this.gesture;
    if (!g || g.kind !== 'link' || !g.target.id) return;
    const prev = g.over;
    const inFrame = p.x >= 0 && p.y >= 0 && p.x <= this.vw && p.y <= this.vh;
    g.over = inFrame ? this.linkTargetAt(g.target.id, p) : { hit: { type: 'empty', id: null }, ok: false, why: null };
    const moved = prev?.hit.id !== g.over.hit.id || prev?.hit.type !== g.over.hit.type;
    if (moved && g.over.why) this.nudge(p, g.over.why);
    else if (moved && prev?.why) this.nudgeEl.hidden = true;
  }

  /** The view's speed toward the frame edge a drag is held near; slowed and stopped where the diagram ends. */
  private edgePanSpeed(p: Pt): Pt | null {
    if (!this.geo || !this.vw || !this.vh) return null;
    const band = Math.min(EDGE_PAN_BAND, Math.min(this.vw, this.vh) / 4);
    const box = screenBox(this.camShown, this.vw, this.vh, { x: 0, y: 0, w: this.geo.width, h: this.geo.height });
    const v = edgePanStop(edgePanVelocity(p, this.vw, this.vh, band, EDGE_PAN_MAX), box, this.vw, this.vh, EDGE_PAN_MARGIN);
    return v.x || v.y ? v : null;
  }

  /** Starts edge pan once a link drag reaches the band along the frame's edge; it stops itself. */
  private edgePanCheck() {
    const g = this.gesture;
    if (this.edgePan || !g || g.kind !== 'link' || !this.edgePanSpeed(g.last)) return;
    const t = now();
    this.edgePan = { raf: requestAnimationFrame(() => this.edgePanFrame()), t, since: t };
  }

  /**
   * One frame of edge pan. It runs on time, not on pointer events, so a still pointer keeps the
   * view moving; it eases in over EDGE_PAN_RAMP, so a pointer passing through the band barely
   * moves it. The loose end stays under the pointer and the target is re-checked as nodes slide by.
   */
  private edgePanFrame() {
    const ep = this.edgePan;
    if (!ep) return;
    const g = this.gesture;
    const v = this.connected && g && g.kind === 'link' ? this.edgePanSpeed(g.last) : null;
    if (!g || !v) {
      this.edgePan = null;
      return;
    }
    const t = now();
    const k = ease(clamp((t - ep.since) / EDGE_PAN_RAMP, 0, 1)) * Math.min(0.05, (t - ep.t) / 1000);
    ep.t = t;
    this.view = { ...this.view, cam: panBy(this.view.cam, -v.x * k, -v.y * k), follow: false };
    this.camShown = { ...this.view.cam };
    this.camFrom = null;
    g.panned = true;
    this.updateLinkOver(g.last);
    this.schedule();
    ep.raf = requestAnimationFrame(() => this.edgePanFrame());
  }

  /** Ends edge pan. A view it moved becomes one Pan step, recorded before the link it led to. */
  private endEdgePan(g: { before: Snapshot; panned?: boolean }) {
    if (this.edgePan) cancelAnimationFrame(this.edgePan.raf);
    this.edgePan = null;
    if (g.panned) this.commit('Pan', 'pan', {}, { before: g.before, animateCam: false });
  }

  /**
   * Links `source` to a node, or merges it into an edge. After a drag the new edge is selected,
   * so ↵ labels it straight away; the list keeps its source selected so you can link again.
   * `keep` stays still on screen while the layout moves (the list's node, for a reverse link).
   */
  private performLink(source: string, target: { type: 'node' | 'edge'; id: string }, via: 'drag' | 'list', keep = source): M.LinkResult | null {
    if (this.readonly_) return null;
    const doc = this._doc;
    const r = target.type === 'node' ? M.linkNodes(doc, source, target.id) : M.linkToEdge(doc, source, target.id);
    const at = this.lastPointer ?? { x: this.vw / 2, y: this.vh / 2 };
    if ('error' in r) {
      this.nudge(at, r.error);
      return null;
    }
    const src = M.label(M.nodeById(doc, source)?.text ?? '');
    const conn = target.type === 'edge' ? M.connectionOf(doc, target.id) : null;
    const what =
      target.type === 'node'
        ? `Link ${src} → ${M.label(M.nodeById(doc, target.id)?.text ?? '')}`
        : `Merge ${src} into ${conn ? M.describeConnection(doc, conn) : 'the edge'}`;
    const s = this.shownScreen(keep);
    if (!this.commit(what, 'link', { doc: r.doc, view: { sel: via === 'drag' ? [r.trunk] : this.view.sel } }, { anchor: s && !this.view.follow ? { id: keep, screen: s } : null })) return null;
    this.announce(`${what}. ${this.touchContext ? 'Undo' : K.undo} undoes it.`);
    return r;
  }

  /**
   * Several links from the list in one step (one undo). Links an earlier one made impossible are
   * skipped and named; when none can be made, nothing changes and the reason is shown.
   */
  private performLinks(keep: string, links: { from: string; to: { type: 'node' | 'edge'; id: string } }[], picks: LinkItem[], back: boolean): boolean {
    if (this.readonly_) return false;
    const r = M.linkEach(this._doc, links);
    const at = this.lastPointer ?? { x: this.vw / 2, y: this.vh / 2 };
    if (!r.made) {
      this.nudge(at, r.problems[0] ?? 'Nothing to link');
      return false;
    }
    const src = M.label(M.nodeById(this._doc, keep)?.text ?? '');
    const what = back ? `Link ${r.made} nodes → ${src}` : `Link ${src} → ${r.made} item${r.made === 1 ? '' : 's'}`;
    const s = this.shownScreen(keep);
    if (!this.commit(what, 'link', { doc: r.doc, view: { sel: this.view.sel } }, { anchor: s && !this.view.follow ? { id: keep, screen: s } : null })) return false;
    const skipped = r.problems.length ? ` ${r.problems.length} skipped: ${[...new Set(r.problems)].join('; ')}.` : '';
    if (skipped) this.nudge(at, skipped.trim());
    this.announce(`${what}: ${joinAnd(picks.map((x) => M.label(x.text)))}.${skipped} ${this.touchContext ? 'Undo' : K.undo} undoes it.`);
    return true;
  }

  /** World point a link would end at: the target node's border facing the source, or the edge's anchor. */
  private hitAnchor(hit: Hit, source: string): Pt | null {
    if (!hit.id) return null;
    if (hit.type === 'node') {
      const n = this.shown.nodes.get(hit.id);
      const sz = this.sizes.get(hit.id);
      const s = this.shown.nodes.get(source);
      if (!n || !sz) return null;
      return s ? rectExit(n, sz, s) : { x: n.x, y: n.y };
    }
    return hit.type === 'edge' ? this.edgeAnchor(hit.id) : null;
  }

  /** The rubber band while dragging a link, or the preview of the link list's active row. */
  private drawLinkLine() {
    let src: string | null = null;
    let end: Pt | null = null;
    let mark: { hit: Hit; ok: boolean; why: string | null } | null = null;
    const g = this.gesture;
    if (g && g.kind === 'link' && g.target.id) {
      src = g.target.id;
      mark = g.over ?? null;
      end = mark?.ok ? this.hitAnchor(mark.hit, src) : toWorld(this.camShown, this.vw, this.vh, g.last);
    } else if (this.linker) {
      const it = this.linker.items[this.linker.active];
      if (it) {
        // The row under the cursor is marked either way; a reverse link's line runs from it. A new
        // node has no place yet, so its list draws no line.
        const back = this.linker.dir === 'in';
        mark = { hit: { type: it.kind, id: it.id }, ok: true, why: null };
        if (this.linker.dir !== 'new') {
          src = back ? it.id : this.linker.source;
          end = this.hitAnchor(back ? { type: 'node', id: this.linker.source } : mark.hit, src);
        }
      }
    }
    this.markLinkTarget(mark);
    const n = src ? this.shown.nodes.get(src) : null;
    const sz = src ? this.sizes.get(src) : null;
    if (!n || !sz || !end) {
      this.linkLine.setAttribute('d', '');
      this.linkHead.setAttribute('d', '');
      return;
    }
    const a = rectExit(n, sz, end);
    const f = (v: number) => Math.round(v * 10) / 10;
    this.linkLine.setAttribute('d', `M${f(a.x)} ${f(a.y)}L${f(end.x)} ${f(end.y)}`);
    this.linkHead.setAttribute('d', mark?.ok ? arrowData(Float64Array.of(a.x, a.y, end.x, end.y)) : '');
    this.linkLine.classList.toggle('ok', !!mark?.ok);
  }

  /** Marks the node or edge a link would land on (blue) or refuse (struck). */
  private markLinkTarget(over: { hit: Hit; ok: boolean; why: string | null } | null) {
    let el: Element | null = null;
    let cls = '';
    if (over && over.hit.id && (over.ok || over.why)) {
      cls = over.ok ? 'link-ok' : 'link-no';
      if (over.hit.type === 'node') el = this.nodeEls.get(over.hit.id) ?? null;
      else if (over.hit.type === 'edge') el = this.edgeEls.get(over.hit.id)?.path ?? null;
    }
    if (this.linkMark && (this.linkMark.el !== el || this.linkMark.cls !== cls)) {
      this.linkMark.el.classList.remove(this.linkMark.cls);
      this.linkMark = null;
    }
    if (el && cls && !this.linkMark) {
      el.classList.add(cls);
      this.linkMark = { el, cls };
    }
  }

  /**
   * S (⇧S backwards): select the next edge touching the selected node (from an edge, keep
   * circling the same node). S goes clockwise on screen, as its icon shows, starting from 12
   * o'clock; ⇧S goes the other way.
   */
  private stepEdges(step: 1 | -1) {
    const doc = this._doc;
    const one = this.view.sel.length === 1 ? this.view.sel[0] : null;
    const around = (pivot: string) => {
      const out: string[] = [];
      for (const c of M.connections(doc)) {
        const i = c.inputs.indexOf(pivot);
        if (i >= 0) out.push(c.junction ? c.branches[i].id : c.trunk.id);
        else if (c.target === pivot) out.push(c.trunk.id);
      }
      return out;
    };
    let pivot: string | null = null;
    if (one && M.nodeById(doc, one)) pivot = one;
    else if (one && M.edgeById(doc, one)) {
      pivot = this.edgeCycle && around(this.edgeCycle.pivot).includes(one) ? this.edgeCycle.pivot : M.connectionOf(doc, one)?.inputs[0] ?? null;
    }
    if (!pivot) return this.nudge(this.hintPoint(), 'Select a node, then S steps through its edges');
    const list = this.clockwise(pivot, around(pivot));
    if (!list.length) return this.nudge(this.hintPoint(), 'This node has no edges yet — E links it');
    const cur = one ? list.indexOf(one) : -1;
    const at = cur < 0 ? (step > 0 ? 0 : list.length - 1) : (cur + step + list.length) % list.length;
    const next = list[at];
    this.edgeCycle = { pivot, at };
    const c = M.connectionOf(doc, next);
    this.commit(c ? `Select ${M.describeConnection(doc, c)}` : 'Select edge', 'nav', { view: { sel: [next] } }, { coalesce: 900 });
    this.announce(`Edge ${this.edgeCycle.at + 1} of ${list.length}: ${c ? M.describeConnection(doc, c) : ''}${c?.trunk.label ? `, labelled ${c.trunk.label}` : ''}`);
  }

  /**
   * Orders edges touching `node` clockwise on screen from 12 o'clock, by the direction each one
   * leaves the node: the drawn route about 20 px out from the node's border. Hidden edges go last.
   */
  private clockwise(node: string, ids: string[]): string[] {
    const c = this.shown.nodes.get(node);
    if (!c) return ids;
    const at = toScreen(this.camShown, this.vw, this.vh, c);
    const angle = (id: string) => {
      const se = this.shown.edges.get(id);
      const r = se?.s;
      if (!se || !r || r.length < 4 || se.o < 0.05) return Infinity;
      const n = r.length / 2;
      const near = Math.hypot(r[0] - c.x, r[1] - c.y) <= Math.hypot(r[n * 2 - 2] - c.x, r[n * 2 - 1] - c.y);
      const pt = (k: number) => (near ? { x: r[k * 2], y: r[k * 2 + 1] } : { x: r[(n - 1 - k) * 2], y: r[(n - 1 - k) * 2 + 1] });
      const end = pt(0);
      let k = 1;
      while (k < n - 1 && Math.hypot(pt(k).x - end.x, pt(k).y - end.y) < 20) k++;
      const p = toScreen(this.camShown, this.vw, this.vh, pt(k));
      // Screen y grows downwards, so a growing angle turns clockwise; 12 o'clock comes first.
      return (Math.atan2(p.y - at.y, p.x - at.x) + Math.PI * 2.5) % (Math.PI * 2);
    };
    const key = new Map(ids.map((id) => [id, angle(id)]));
    return [...ids].sort((a, b) => {
      const ka = key.get(a)!;
      const kb = key.get(b)!;
      return ka === kb ? 0 : ka - kb;
    });
  }

  private hintPoint(): Pt {
    return this.lastPointer && this.inViewport(this.lastPointer) ? this.lastPointer : { x: this.vw / 2, y: this.vh / 2 };
  }

  // ---------- the link list (E, or Link on the selection magnet) ----------

  private linkerEntry: Entry | null = null;
  /** Groups Dive opened; surfacing out of one closes it again. Any other fold or a new document forgets them. */
  private diveOpened = new Set<string>();
  /** Where the Layout pill sits on screen this frame (a new node's list hangs from it). */
  private puckBox: Rect | null = null;

  /** ⇧N (or ⇧-click on Add node) with nothing selected: pick nodes for a new node to link to. */
  private openAdder(focusInput: boolean) {
    this.openLinker('', focusInput, 'new');
  }

  private openLinker(source: string, focusInput: boolean, dir: Linker['dir'] = 'out') {
    const n = dir === 'new' ? null : M.nodeById(this._doc, source);
    if (this.readonly_ || (dir !== 'new' && !n)) return;
    if (this.linker?.source === source && this.linker.dir === dir) {
      (this.linkerEl.querySelector('input') as HTMLInputElement | null)?.focus({ preventScroll: true });
      return;
    }
    this.closePanel();
    this.linker = { source, dir, filter: '', active: 0, items: [], receipt: null, focusInput, checked: [], anchor: null };
    this.linkerEntry = null;
    const back = dir === 'in';
    const name = n ? M.label(n.text) : '';
    const title = dir === 'new' ? 'Add a node linked to…' : back ? `Link … to ${name}` : `Link ${name} to…`;
    const filter = dir === 'out' ? 'Filter nodes and edges' : 'Filter nodes';
    const listName = dir === 'new' ? 'Nodes for the new node to link to' : back ? 'Nodes to link into it' : 'Link targets';
    // A pick acts on every checked row too; the commit bar says so and acts on the checked rows alone.
    const act = dir === 'new' ? `${kbd('↵')} before · ${kbd('⇧↵')} after` : `${kbd('↵')} link`;
    this.linkerEl.setAttribute('aria-label', title);
    this.linkerEl.innerHTML = `<div class="lk-head"><span class="lk-title">${esc(title)}</span><button class="mb" data-act="close-linker" title="${this.touchContext ? 'Close' : 'Close (Esc)'}" aria-label="${this.touchContext ? 'Close' : 'Close (Esc)'}">${ICON.close}${kbd('Esc')}</button></div>
      <input class="lk-filter" type="text" role="combobox" aria-expanded="true" aria-controls="lk-list" aria-autocomplete="list" autocomplete="off" spellcheck="false" placeholder="${filter}" aria-label="${filter}">
      <div class="lk-receipt" role="status" hidden></div>
      <div class="lk-checked" hidden></div>
      <ul class="lk-list" id="lk-list" role="listbox" aria-multiselectable="true" aria-label="${listName}, nearest first"></ul>
      <div class="lk-foot key-hint">${kbd('↑')}${kbd('↓')} choose · ${act} · ${IS_MAC ? '⌘' : 'Ctrl'}-click or ${kbd(K.addNext)} check more · ⇧-click ticks every row between · ${kbd('Esc')} close</div>`;
    const input = this.linkerEl.querySelector('input')!;
    input.addEventListener('input', () => {
      if (!this.linker) return;
      this.linker.filter = input.value;
      this.linker.active = 0;
      this.refreshLinker();
    });
    this.linkerEl.querySelector('[data-act="close-linker"]')!.addEventListener('click', (e) => {
      e.stopPropagation();
      this.closeLinker(true);
    });
    const list = this.linkerEl.querySelector('ul')!;
    list.addEventListener('pointermove', (e) => {
      const li = (e.target as Element).closest?.('[data-i]') as HTMLElement | null;
      if (!li || !this.linker) return;
      const i = Number(li.dataset.i);
      if (i !== this.linker.active) {
        this.linker.active = i;
        this.markLinkerActive(false);
        this.schedule();
      }
    });
    // A click on a row keeps the keys in the filter (so ↵ acts on the checked rows next), and a
    // ⇧-click never selects text across rows.
    list.addEventListener('mousedown', (e) => e.preventDefault());
    list.addEventListener('click', (e) => {
      const li = (e.target as Element).closest?.('[data-i]') as HTMLElement | null;
      if (!li || !this.linker) return;
      const i = Number(li.dataset.i);
      // ⌘-click (or a click on its box) checks one more row; ⇧-click, once a row is checked,
      // checks (or unchecks) a run.
      if (e.metaKey || e.ctrlKey || (e.target as Element).closest?.('.lk-ck')) return this.checkRow(i);
      if (e.shiftKey && this.linker.checked.length) return this.checkRun(i);
      this.pickLink(i, e.shiftKey);
    });
    this.refreshLinker();
    this.linkerEl.hidden = false;
    this.nodeMagKey = '';
    this.schedule();
    // On touch, focusing the filter would raise the keyboard over the list: the rows are tappable instead.
    if (focusInput) requestAnimationFrame(() => input.focus({ preventScroll: true }));
  }

  private closeLinker(refocus: boolean) {
    if (!this.linker) return;
    this.linker = null;
    this.linkerEntry = null;
    this.linkerEl.hidden = true;
    this.linkerEl.innerHTML = '';
    this.markLinkTarget(null);
    this.nodeMagKey = '';
    this.schedule();
    if (refocus) this.vp.focus({ preventScroll: true });
  }

  private onLinkerKey(e: KeyboardEvent) {
    const L = this.linker;
    if (!L) return;
    const k = e.key;
    const input = this.linkerEl.querySelector('input') as HTMLInputElement;
    const stop = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    if (k === 'Escape') return stop(), this.closeLinker(true);
    if (k === 'ArrowDown' || k === 'ArrowUp') {
      stop();
      const n = L.items.length;
      if (!n) return;
      // ⇧↓ / ⇧↑ check the row being left and the row arrived at.
      if (e.shiftKey) this.checkRow(L.active, true);
      L.active = (L.active + (k === 'ArrowDown' ? 1 : -1) + n) % n;
      if (e.shiftKey) this.checkRow(L.active, true);
      this.markLinkerActive(true);
      return this.schedule();
    }
    if (k === 'Enter' && (e.target as HTMLElement).tagName !== 'BUTTON') {
      stop();
      if (e.metaKey || e.ctrlKey) return this.checkRow(L.active);
      return this.pickLink(L.active, e.shiftKey);
    }
    if ((e.metaKey || e.ctrlKey) && e.altKey && e.code === 'KeyZ' && !input.value) {
      stop();
      return e.shiftKey ? this.fastForward() : this.rewind();
    }
    if ((e.metaKey || e.ctrlKey) && (k === 'z' || k === 'Z' || k === 'y') && !input.value) {
      stop();
      return e.shiftKey || k === 'y' ? this.redo() : this.undo();
    }
    if (k === 'Tab') {
      // Focus cycles inside the list until it is closed.
      const f = [...this.linkerEl.querySelectorAll<HTMLElement>('input, button:not([hidden])')].filter((x) => !x.closest('[hidden]'));
      const i = f.indexOf(e.target as HTMLElement);
      if (f.length) {
        stop();
        f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus();
      }
      return;
    }
    e.stopPropagation();
  }

  /**
   * Acts on the checked rows plus row `i` (-1: the checked rows alone). In the link lists it links
   * them all in one step and stays open; for a new node it links one new node before (or, with
   * `shift`, after) them all, closes, and opens the new node for its text.
   */
  private pickLink(i: number, shift = false) {
    const L = this.linker;
    if (!L) return;
    const it = L.items[i];
    const key = (x: LinkItem) => `${x.kind}:${x.id}`;
    const byKey = new Map(L.items.map((x) => [key(x), x]));
    for (const c of L.checked) if (!byKey.has(c)) byKey.set(c, this.linkItemOf(c));
    const picks = [...new Set([...L.checked, ...(it ? [key(it)] : [])])].map((c) => byKey.get(c)!).filter((x) => x && x.id);
    if (!picks.length) return;
    if (L.dir === 'new') {
      const anchors = picks.filter((x) => x.kind === 'node').map((x) => x.id);
      this.closeLinker(false);
      return this.addLinkedTo(anchors, shift ? 'after' : 'before');
    }
    const back = L.dir === 'in';
    let ok: boolean;
    if (picks.length === 1) {
      const one = picks[0];
      ok = !!(back ? this.performLink(one.id, { type: 'node', id: L.source }, 'list', L.source) : this.performLink(L.source, { type: one.kind, id: one.id }, 'list'));
    } else {
      ok = this.performLinks(
        L.source,
        picks.map((x) => (back ? { from: x.id, to: { type: 'node' as const, id: L.source } } : { from: L.source, to: { type: x.kind, id: x.id } })),
        picks,
        back,
      );
    }
    if (!ok || !this.linker) return;
    this.linkerEntry = this.hist.peekUndo();
    const name = (x: LinkItem) => (x.kind === 'node' ? M.label(x.text, 'an empty node') : `the edge ${x.sub || x.text}`);
    const nodes = picks.filter((x) => x.kind === 'node');
    const edges = picks.filter((x) => x.kind === 'edge');
    if (back) this.linker.receipt = `Linked from ${joinAnd(picks.map(name))}`;
    else if (!nodes.length) this.linker.receipt = `Merged into ${joinAnd(edges.map((x) => x.sub || x.text))}`;
    else this.linker.receipt = `Linked to ${joinAnd(nodes.map(name))}${edges.length ? `; merged into ${joinAnd(edges.map((x) => x.sub || x.text))}` : ''}`;
    this.linker.checked = [];
    this.linker.anchor = null;
    this.linker.filter = '';
    this.linker.active = 0;
    const input = this.linkerEl.querySelector('input') as HTMLInputElement | null;
    if (input) input.value = '';
    this.refreshLinker();
  }

  /** A checked row filtered out of view still acts: rebuild its words from the document. */
  private linkItemOf(k: string): LinkItem {
    const [kind, ...rest] = k.split(':');
    const id = rest.join(':');
    if (kind === 'node') {
      const n = M.nodeById(this._doc, id);
      return { kind: 'node', id: n ? id : '', text: n?.text || 'Empty node', sub: '', empty: !n?.text.trim() };
    }
    const c = M.connectionOf(this._doc, id);
    return { kind: 'edge', id: c ? id : '', text: c ? c.trunk.label?.trim() || M.describeConnection(this._doc, c) : '', sub: c && c.trunk.label?.trim() ? M.describeConnection(this._doc, c) : '', empty: false };
  }

  /** ⌘-click / ⌘↵ (or ⇧↑↓ with `on`): check or uncheck one row; it becomes the start of a ⇧-click run. */
  private checkRow(i: number, on?: boolean) {
    const L = this.linker;
    const it = L?.items[i];
    if (!L || !it) return;
    const k = `${it.kind}:${it.id}`;
    const has = L.checked.includes(k);
    const want = on ?? !has;
    if (want && !has) L.checked.push(k);
    else if (!want && has) L.checked = L.checked.filter((x) => x !== k);
    L.anchor = k;
    L.active = i;
    this.markLinkerActive(false);
    this.schedule();
  }

  /** ⇧-click: every row from the last one checked or unchecked to this one takes that row's state. */
  private checkRun(i: number) {
    const L = this.linker;
    if (!L || !L.items[i]) return;
    const keys = L.items.map((x) => `${x.kind}:${x.id}`);
    const from = L.anchor ? keys.indexOf(L.anchor) : -1;
    const start = from < 0 ? i : from;
    const on = from < 0 || L.checked.includes(L.anchor!);
    const run = keys.slice(Math.min(start, i), Math.max(start, i) + 1);
    L.checked = on ? [...new Set([...L.checked, ...run])] : L.checked.filter((x) => !run.includes(x));
    L.active = i;
    this.markLinkerActive(false);
    this.schedule();
  }

  /**
   * Rebuilds the rows: other nodes, then edges, each nearest-to-furthest from the source on screen.
   * A reverse link lists nodes only (an edge cannot be a cause).
   */
  private refreshLinker() {
    const L = this.linker;
    if (!L) return;
    const doc = this._doc;
    this.linkerDoc = doc;
    const back = L.dir === 'in';
    const fresh = L.dir === 'new';
    // A new node's list is ordered from the middle of the view (it has no place of its own yet).
    const from = (L.source && this.shownScreen(L.source)) || { x: this.vw / 2, y: this.vh / 2 };
    const dist = (p: Pt | null) => (p ? Math.hypot(p.x - from.x, p.y - from.y) : Infinity);
    const nodes: (LinkItem & { d: number })[] = [];
    for (const n of doc.nodes) {
      if (!fresh && (n.id === L.source || (back ? M.linked(doc, n.id, L.source) : M.linked(doc, L.source, n.id)))) continue;
      // Hidden in a collapsed group: judged by the current layout, not the frame still on screen.
      if (this.geo?.nodes.get(n.id)?.visible === false) continue;
      nodes.push({ kind: 'node', id: n.id, text: n.text.trim() ? n.text : 'Empty node', sub: '', empty: !n.text.trim(), d: dist(this.shownScreen(n.id)) });
    }
    const edges: (LinkItem & { d: number })[] = [];
    for (const c of L.dir === 'out' ? M.connections(doc) : []) {
      // The same checks a pick makes (mergeProblem), so the list never offers a refusal.
      if (c.target === L.source || c.inputs.includes(L.source) || M.linked(doc, L.source, c.target)) continue;
      if (this.geo?.edges.get(c.trunk.id)?.hidden) continue;
      const words = M.describeConnection(doc, c);
      const lbl = c.trunk.label?.trim();
      edges.push({ kind: 'edge', id: c.trunk.id, text: lbl ? c.trunk.label! : words, sub: lbl ? words : '', empty: false, d: dist(this.shownScreen(c.trunk.id)) });
    }
    const f = L.filter.trim().toLowerCase();
    const keep = (it: LinkItem) => !f || `${it.text} ${it.sub}`.toLowerCase().includes(f);
    const byDist = (a: { d: number }, b: { d: number }) => a.d - b.d;
    L.items = [...nodes.filter(keep).sort(byDist), ...edges.filter(keep).sort(byDist)].map(({ d: _d, ...it }) => it);
    L.active = Math.min(L.active, Math.max(0, L.items.length - 1));
    // A checked row whose node or edge is gone (an undo, a delete) is no longer checked.
    L.checked = L.checked.filter((k) => this.linkItemOf(k).id);
    this.renderLinkerList();
  }

  private renderLinkerList() {
    const L = this.linker;
    if (!L) return;
    const list = this.linkerEl.querySelector('ul');
    if (!list) return;
    let html = '';
    let lastKind = '';
    L.items.forEach((it, i) => {
      if (it.kind !== lastKind) {
        html += `<li class="lk-h" role="presentation">${it.kind === 'node' ? 'Nodes' : 'Edges — joining one merges into it'}</li>`;
        lastKind = it.kind;
      }
      html += `<li class="lk-item${it.empty ? ' empty' : ''}${it.kind === 'edge' ? ' is-edge' : ''}" role="option" id="lk-${i}" data-i="${i}" data-k="${esc(`${it.kind}:${it.id}`)}" aria-selected="false"><span class="lk-ck" aria-hidden="true"></span><span class="lk-tx"><span class="lk-t">${esc(it.text)}</span>${it.sub ? `<span class="lk-s">${esc(it.sub)}</span>` : ''}</span></li>`;
    });
    const none = L.dir === 'in' ? 'Nothing else to link into it yet.' : L.dir === 'new' ? 'No nodes yet: N adds one.' : 'Nothing else to link to yet.';
    if (!L.items.length) html = `<li class="lk-none" role="presentation">${L.filter.trim() ? `Nothing matches ${esc(M.label(L.filter))}.` : none}</li>`;
    list.innerHTML = html;
    this.syncLinkerReceipt();
    this.markLinkerActive(true);
  }

  /**
   * The list's "Linked to … · Undo" receipt lasts only while that link is still the step Undo
   * would take back. Checked every frame (a pan or zoom pushes a step without touching the list).
   */
  private syncLinkerReceipt() {
    const L = this.linker;
    const receipt = L && (this.linkerEl.querySelector('.lk-receipt') as HTMLDivElement | null);
    if (!L || !receipt) return;
    const live = !!(L.receipt && this.linkerEntry && this.hist.peekUndo() === this.linkerEntry);
    const key = live ? L.receipt! : '';
    if (receipt.dataset.k === key && receipt.hidden === !live) return;
    receipt.dataset.k = key;
    receipt.hidden = !live;
    receipt.innerHTML = '';
    if (!live) return;
    receipt.innerHTML = `<span>${esc(L.receipt!)}</span>${this.btn('undo', ICON.undo, 'Undo', K.undo)}`;
    receipt.querySelector('button')!.addEventListener('click', (e) => {
      e.stopPropagation();
      this.undo();
      (this.linkerEl.querySelector('input') as HTMLInputElement | null)?.focus({ preventScroll: true });
    });
  }

  private markLinkerActive(scroll: boolean) {
    const L = this.linker;
    if (!L) return;
    const input = this.linkerEl.querySelector('input');
    // The active row is the cursor (aria-activedescendant); aria-selected says which rows are checked.
    this.linkerEl.querySelectorAll<HTMLElement>('[data-i]').forEach((li) => {
      li.classList.toggle('act', Number(li.dataset.i) === L.active);
      li.setAttribute('aria-selected', String(L.checked.includes(li.dataset.k!)));
    });
    this.renderLinkerChecked();
    const cur = this.linkerEl.querySelector<HTMLElement>(`#lk-${L.active}`);
    if (input) {
      if (cur) input.setAttribute('aria-activedescendant', cur.id);
      else input.removeAttribute('aria-activedescendant');
    }
    if (scroll && cur) {
      // Reveal the active row inside the list only; never scroll the page.
      const list = cur.parentElement as HTMLElement;
      if (cur.offsetTop < list.scrollTop) list.scrollTop = cur.offsetTop - 24;
      else if (cur.offsetTop + cur.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = cur.offsetTop + cur.offsetHeight - list.clientHeight;
    }
  }

  /**
   * While rows are checked, a bar names how many and acts on them alone (a row click would add
   * itself to them): Link for the link lists, Add node (⇧-click: after) for a new node.
   */
  private renderLinkerChecked() {
    const L = this.linker;
    const bar = L && (this.linkerEl.querySelector('.lk-checked') as HTMLDivElement | null);
    if (!L || !bar) return;
    const n = L.checked.length;
    const key = `${n}`;
    if (bar.dataset.k === key) return;
    bar.dataset.k = key;
    bar.hidden = !n;
    if (!n) return void (bar.innerHTML = '');
    const go =
      L.dir === 'new'
        ? this.flipBtn('lk-go', 'lk-go-after', ICON.node, ICON.node, 'Add node', '↵', 'Add a node before the checked nodes', 'after them')
        : this.btn('lk-go', L.dir === 'in' ? ICON.linkIn : ICON.link, 'Link', '↵');
    bar.innerHTML = `<span>${n} checked</span>${go}<button class="mb" data-act="lk-clear" title="Uncheck all" aria-label="Uncheck all">${ICON.close}<span>Uncheck</span></button>`;
    bar.querySelectorAll<HTMLButtonElement>('button[data-act]').forEach((b) =>
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!this.linker) return;
        if (b.dataset.act === 'lk-clear') {
          this.linker.checked = [];
          this.linker.anchor = null;
          this.markLinkerActive(false);
          (this.linkerEl.querySelector('input') as HTMLInputElement | null)?.focus({ preventScroll: true });
          return;
        }
        this.pickLink(-1, e.shiftKey);
        // The bar hides once its rows are linked: keep the keys in the list, not on the page.
        if (this.linker) (this.linkerEl.querySelector('input') as HTMLInputElement | null)?.focus({ preventScroll: true });
      }),
    );
  }

  private placeLinker() {
    const L = this.linker!;
    const n = this.shown.nodes.get(L.source);
    const sz = this.sizes.get(L.source);
    const list = this.linkerEl.querySelector('ul') as HTMLElement | null;
    const w = this.linkerEl.offsetWidth;
    if (list) {
      // The title, receipt, checked-row bar and footer wrap independently. Measure their real
      // height instead of reserving a fixed allowance that leaves Close underneath Layout.
      list.style.maxHeight = `${Math.max(0, Math.min(300, this.vh - 16))}px`;
      const chrome = this.linkerEl.offsetHeight - list.offsetHeight;
      const p = this.puckBox;
      const fitsBeside = p && (p.x - w - 10 >= 8 || p.x + p.w + 10 + w <= this.vw - 8);
      const available = p && !fitsBeside ? Math.max(p.y - 18, this.vh - p.y - p.h - 18) : this.vh - 16;
      list.style.maxHeight = `${Math.max(0, Math.min(300, available - chrome))}px`;
    }
    const hh = this.linkerEl.offsetHeight;
    let at: Pt;
    if (n && sz) at = this.placeNear(screenBox(this.camShown, this.vw, this.vh, { x: n.x - sz.w / 2, y: n.y - sz.h / 2, w: sz.w, h: sz.h }), w, hh, new Set([L.source]));
    else if (L.dir === 'new' && this.puckBox) {
      // A new node's list hangs from the Layout pill, where its Add node button is.
      const p = this.puckBox;
      const below = p.y + p.h + 6;
      at = { x: clamp(p.x + p.w - w, 8, Math.max(8, this.vw - w - 8)), y: below + hh <= this.vh - 8 ? below : clamp(p.y - hh - 6, 8, Math.max(8, this.vh - hh - 8)) };
    } else at = { x: (this.vw - w) / 2, y: 8 };
    this.linkerEl.style.transform = `translate(${Math.round(at.x)}px, ${Math.round(at.y)}px)`;
    this.uiRects.push({ x: at.x, y: at.y, w, h: hh });
  }

  // =====================================================================
  // Keyboard
  // =====================================================================

  private onKeyDown(e: KeyboardEvent) {
    // Slotted Help controls belong to the host, including their native keyboard behavior.
    if (e.target instanceof Element && this.contains(e.target)) {
      if (e.key === 'Escape' && this.helpOpen) { e.preventDefault(); this.closeHelp(); }
      return;
    }
    const actionNode = (e.target as Element).closest?.('.node.action[data-id],.group-action[data-gid]') as HTMLButtonElement | null;
    if (actionNode && ['Enter', ' ', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Enter' || e.key === ' ') {
        if (!e.repeat && !actionNode.disabled) {
          if (actionNode.dataset.id) this.activateNode(actionNode.dataset.id, 'keyboard');
          else this.activateGroup(actionNode.dataset.gid!, 'keyboard');
        }
      } else {
        const nodes = [...this.root.querySelectorAll<HTMLButtonElement>('.node.action[data-id],.group-action[data-gid]')].filter((n) => !n.disabled && n.tabIndex >= 0 && getComputedStyle(n).visibility !== 'hidden');
        const index = nodes.indexOf(actionNode);
        const at = e.key === 'Home' ? 0 : e.key === 'End' ? nodes.length - 1 : clamp(index + (e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1), 0, nodes.length - 1);
        nodes[at]?.focus({ preventScroll: true });
        nodes[at]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
      return;
    }
    if (this.graphPresentation) return;
    if (this.editing && e.target === this.editing.ta) return;
    const t = e.target as HTMLElement;
    // The link list handles its own keys.
    if (this.linker && t && this.linkerEl.contains(t)) return;
    if (t && t.tagName === 'INPUT') {
      if (e.key === 'Escape') {
        e.preventDefault();
        this.closePanel(true);
      }
      return;
    }
    const mod = e.metaKey || e.ctrlKey;
    const k = e.key;
    if (k === ' ' || e.code === 'Space') {
      // Space + drag pans; Space never triggers controls here.
      if (t === this.vp) {
        this.spaceDown = true;
        e.preventDefault();
      }
      return;
    }
    const done = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    if (mod && e.altKey && e.code === 'KeyZ') {
      done();
      return e.shiftKey ? this.fastForward() : this.rewind();
    }
    if (mod && (k === 'z' || k === 'Z')) {
      done();
      return e.shiftKey ? this.redo() : this.undo();
    }
    if (mod && (k === 'y' || k === 'Y')) {
      done();
      return this.redo();
    }
    if (mod && (k === 'a' || k === 'A')) {
      done();
      const all = [...this._doc.nodes.filter((n) => this.geo?.nodes.get(n.id)?.visible !== false).map((n) => n.id)];
      return void this.commit('Select all', 'select', { view: { sel: all } });
    }
    if (k === 'Escape') {
      if (this.gesture?.kind === 'link') {
        done();
        const g = this.gesture;
        this.gesture = null;
        this.endEdgePan(g);
        this.pointers.clear();
        this.vp.classList.remove('linking');
        this.markLinkTarget(null);
        this.nudgeEl.hidden = true;
        this.schedule();
        return;
      }
      if (this.helpOpen) return done(), this.closeHelp();
      if (this.panel) return done(), this.closePanel(true);
      if (this.linker) return done(), this.closeLinker(true);
      if (this.view.sel.length) {
        done();
        return this.deselectAll();
      }
      return;
    }
    if (mod) return;
    // Buttons handle their own Enter; everything else below is canvas vocabulary.
    const onButton = t && t.tagName === 'BUTTON';
    if (onButton && (k === 'Enter' || k === ' ')) return;
    if (t !== this.vp && !onButton) return;
    const one = this.view.sel.length === 1 ? this.view.sel[0] : null;
    switch (k) {
      case 'ArrowLeft':
      case 'ArrowRight':
      case 'ArrowUp':
      case 'ArrowDown': {
        done();
        const dir = { ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 }, ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 } }[k]!;
        if (e.altKey) return this.panScreen(-dir.x * 90, -dir.y * 90, 700);
        return this.navigate(dir, e.shiftKey);
      }
      case 'Enter': {
        done();
        if (e.shiftKey) return this.surfaceSelection();
        // ↵ edits one selected item (a group: its title); with several or none, it dives (Al, Q7).
        if (one && this.eventActivation && M.nodeById(this._doc, one)) return this.activateNode(one, 'keyboard');
        if (one) return this.startEdit(one);
        return this.diveSelection();
      }
      case 'j':
      case 'J':
        done();
        return this.diveSelection();
      case 'k':
      case 'K':
        done();
        return this.surfaceSelection();
      case 'F2':
        done();
        if (one) this.startEdit(one);
        return;
      case 'n':
      case 'N':
        done();
        return this.action(e.shiftKey ? 'addpick' : 'addnode');
      case 'e':
      case 'E':
      case 'l':
      case 'L':
      case 'h':
      case 'H': {
        done();
        // ⇧E is the reverse link: the picked node links into the selected one. L is E (onward, to the
        // right in a left-to-right flow) and H is ⇧E (back); ⇧ turns either around.
        const back = (k === 'h' || k === 'H') !== e.shiftKey;
        if (one && M.nodeById(this._doc, one) && !this.readonly_) return this.openLinker(one, true, back ? 'in' : 'out');
        return this.nudge(this.hintPoint(), this.readonly_ ? 'This diagram is read-only' : `Select a node, then press ${back ? '⇧E (or H) to link another node into it' : 'E (or L) to link it'}`);
      }
      case 's':
      case 'S':
        done();
        return this.stepEdges(e.shiftKey ? -1 : 1);
      case 't':
      case 'T':
        done();
        return this.changeSetting('tightGroups', String(!this._doc.settings.tightGroups));
      case 'u':
      case 'U':
        done();
        return this.changeSetting('untangle', String(!this._doc.settings.untangle));
      case 'g':
      case 'G':
        done();
        return e.shiftKey ? this.ungroupSelection() : this.groupSelection();
      case 'c':
      case 'C':
        done();
        return this.toggleCollapse();
      case 'Delete':
      case 'Backspace':
        done();
        // ⇧⌫ on an edge removes its label and keeps the edge.
        if (e.shiftKey && one && M.edgeById(this._doc, one)) return this.removeLabel(one);
        return this.deleteSelection();
      case '=':
      case '+':
        done();
        return this.zoomTo(this.view.cam.z * (e.shiftKey ? 2 : 1.5), undefined, 600);
      case '-':
      case '_':
        done();
        return this.zoomTo(this.view.cam.z / (e.shiftKey ? 2 : 1.5), undefined, 600);
      case '0':
        done();
        return this.fit();
      case '1':
        done();
        return this.zoomTo(1);
      case '[':
        done();
        return this.rotateTo(this.view.cam.r - Math.PI / 12, undefined, 700);
      case ']':
        done();
        return this.rotateTo(this.view.cam.r + Math.PI / 12, undefined, 700);
      case 'r':
      case 'R':
        done();
        return this.rotateTo(0);
      case 'o':
      case 'O': {
        done();
        const list = M.ORIENTATIONS;
        const i = list.indexOf(this._doc.settings.orientation);
        return this.changeSetting('orientation', list[(i + (e.shiftKey ? list.length - 1 : 1)) % list.length]);
      }
      case 'b':
      case 'B':
        done();
        return this.changeSetting('bias', this._doc.settings.bias === 'start' ? 'end' : 'start');
      case 'd':
      case 'D': {
        done();
        const list = M.COMPACTNESS;
        const i = list.indexOf(this._doc.settings.compactness);
        return this.changeSetting('compactness', list[(i + (e.shiftKey ? list.length - 1 : 1)) % list.length]);
      }
      case 'i':
      case 'I':
        done();
        return this.changeSetting('incremental', String(!this._doc.settings.incremental));
      case '/':
        done();
        return this.panel ? this.closePanel(true) : this.openPanel(this.lastPointer && this.inViewport(this.lastPointer) ? this.lastPointer : 'puck');
      case '?':
        done();
        return this.helpOpen ? this.closeHelp() : this.openHelp();
      case 'f':
      case 'F':
        done();
        return this.locateSelection();
    }
  }

  /** Move the selection to the nearest item in a screen direction (works under any rotation). */
  private navigate(dir: Pt, extend: boolean) {
    const items: { id: string; s: Pt }[] = [];
    for (const [id, n] of this.shown.nodes) if (n.o > 0.5) items.push({ id, s: toScreen(this.camShown, this.vw, this.vh, n) });
    for (const [id, g] of this.shown.groups) {
      if (g.po > 0.5 && g.shape.kind === 'proxy') items.push({ id, s: toScreen(this.camShown, this.vw, this.vh, { x: g.shape.x, y: g.shape.y }) });
    }
    if (!items.length) return;
    const cur = this.view.sel[this.view.sel.length - 1];
    const from = cur ? this.shownScreen(cur) : null;
    let pick: string | null = null;
    if (!from) {
      // Nothing selected: start at the item nearest the middle.
      let bd = Infinity;
      for (const it of items) {
        const d = Math.hypot(it.s.x - this.vw / 2, it.s.y - this.vh / 2);
        if (d < bd) {
          bd = d;
          pick = it.id;
        }
      }
    } else {
      let best = Infinity;
      for (const it of items) {
        if (it.id === cur) continue;
        const vx = it.s.x - from.x;
        const vy = it.s.y - from.y;
        const along = vx * dir.x + vy * dir.y;
        if (along <= 4) continue;
        const across = Math.abs(vx * dir.y - vy * dir.x);
        const score = along + across * 2.2;
        if (score < best) {
          best = score;
          pick = it.id;
        }
      }
    }
    if (!pick) return;
    const sel = extend ? [...this.view.sel.filter((x) => x !== pick), pick] : [pick];
    // Keep the new selection on screen.
    let cam = this.view.cam;
    const s = this.shownScreen(pick);
    let follow = this.view.follow;
    if (s && (s.x < 40 || s.y < 40 || s.x > this.vw - 40 || s.y > this.vh - 40)) {
      cam = panBy(cam, clamp(this.vw / 2 - s.x, -Infinity, Infinity) * 0.6, (this.vh / 2 - s.y) * 0.6);
      follow = false;
    }
    const item = M.nodeById(this._doc, pick);
    this.commit(item ? `Select ${M.label(item.text)}` : 'Select group', 'nav', { view: { sel, cam, follow } }, { coalesce: 900 });
    this.announce(item ? `Selected ${item.text || 'empty node'}` : 'Selected group');
  }
}

// ---------- helpers ----------

/** Distance from `p` to the segment a–b. */
function segDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 ? clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / l2, 0, 1) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Where the line from a box's centre toward `to` leaves the box. */
function rectExit(c: Pt, sz: { w: number; h: number }, to: Pt): Pt {
  const dx = to.x - c.x;
  const dy = to.y - c.y;
  if (!dx && !dy) return { x: c.x, y: c.y };
  const t = Math.min(dx ? sz.w / 2 / Math.abs(dx) : Infinity, dy ? sz.h / 2 / Math.abs(dy) : Infinity, 1);
  return { x: c.x + dx * t, y: c.y + dy * t };
}

/** `fit-min="0.6"` or `fit-min="60%"`; null when absent or out of range. */
function parseFitMin(v: string | null): number | null {
  if (v == null || v.trim() === '') return null;
  const t = v.trim();
  const z = t.endsWith('%') ? Number(t.slice(0, -1)) / 100 : Number(t);
  return Number.isFinite(z) && z >= 0.1 && z <= 1 ? z : null;
}

function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/** ‘A’, ‘B’ and ‘C’. */
function joinAnd(parts: string[]): string {
  return parts.length < 2 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** Two layouts that put every node, label, line and group in the same place. */
function sameGeo(a: Geo, b: Geo): boolean {
  if (a.orient !== b.orient || a.width !== b.width || a.height !== b.height) return false;
  const same = <T,>(x: Map<string, T>, y: Map<string, T>, eq: (p: T, q: T) => boolean) => {
    if (x.size !== y.size) return false;
    for (const [k, v] of x) {
      const w = y.get(k);
      if (w === undefined || !eq(v, w)) return false;
    }
    return true;
  };
  const box = (p: GeoNode | GeoCarrier, q: GeoNode | GeoCarrier) => p.x === q.x && p.y === q.y && p.w === q.w && p.h === q.h && p.visible === q.visible;
  const arr = (p: Float64Array, q: Float64Array) => p.length === q.length && p.every((v, i) => v === q[i]);
  return (
    same(a.nodes, b.nodes, box) &&
    same(a.carriers, b.carriers, box) &&
    same(a.edges, b.edges, (p, q) => p.back === q.back && p.hidden === q.hidden && p.from === q.from && p.to === q.to && p.arrow === q.arrow && arr(p.path, q.path)) &&
    same(a.groups, b.groups, (p, q) => JSON.stringify(p) === JSON.stringify(q)) &&
    same(a.carrierOf, b.carrierOf, (p, q) => p === q)
  );
}

/** What a failed layout says. Past the engine's memory (about 7,000 nodes) it says so plainly. */
function layoutFailure(err: unknown): string {
  const msg = (err as Error)?.message ?? String(err);
  if (/unreachable|out of bounds|memory/i.test(msg)) return 'Layout failed: this diagram is too large for the layout engine’s memory (the limit is about 6,000 to 7,000 nodes).';
  return `Layout failed: ${msg}`;
}

function cloneShown(s: Shown): Shown {
  return {
    nodes: new Map([...s.nodes].map(([k, v]) => [k, { ...v }])),
    carriers: new Map([...s.carriers].map(([k, v]) => [k, { ...v }])),
    edges: new Map([...s.edges].map(([k, v]) => [k, { s: v.s, o: v.o }])),
    groups: new Map([...s.groups].map(([k, v]) => [k, { ...v, shape: { ...v.shape } as GroupShape, label: { ...v.label }, pc: { ...v.pc } }])),
  };
}

function shapeBounds(s: GroupShape): Rect | null {
  switch (s.kind) {
    case 'rect':
      return { x: s.x, y: s.y, w: s.w, h: s.h };
    case 'proxy':
      return { x: s.x - s.w / 2, y: s.y - s.h / 2, w: s.w, h: s.h };
    case 'sector': {
      let x0 = Infinity,
        y0 = Infinity,
        x1 = -Infinity,
        y1 = -Infinity;
      for (let i = 0; i <= 16; i++) {
        const a = s.a0 + ((s.a1 - s.a0) * i) / 16;
        for (const r of [s.r0, s.r1]) {
          const x = s.cx + r * Math.cos(a);
          const y = s.cy + r * Math.sin(a);
          x0 = Math.min(x0, x);
          y0 = Math.min(y0, y);
          x1 = Math.max(x1, x);
          y1 = Math.max(y1, y);
        }
      }
      return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    }
    default:
      return null;
  }
}

function centerOf(s: GroupShape): Pt | null {
  const b = shapeBounds(s);
  return b ? { x: b.x + b.w / 2, y: b.y + b.h / 2 } : null;
}

function lerpShape(a: GroupShape, b: GroupShape, k: number): GroupShape {
  const l = (x: number, y: number) => x + (y - x) * k;
  if (a.kind === 'rect' && b.kind === 'rect') return { kind: 'rect', x: l(a.x, b.x), y: l(a.y, b.y), w: l(a.w, b.w), h: l(a.h, b.h) };
  if (a.kind === 'proxy' && b.kind === 'proxy') return { kind: 'proxy', x: l(a.x, b.x), y: l(a.y, b.y), w: l(a.w, b.w), h: l(a.h, b.h) };
  if (a.kind === 'sector' && b.kind === 'sector')
    return { kind: 'sector', cx: l(a.cx, b.cx), cy: l(a.cy, b.cy), r0: l(a.r0, b.r0), r1: l(a.r1, b.r1), a0: l(a.a0, b.a0), a1: l(a.a1, b.a1) };
  return b;
}

/** An outline reduced to the collapsed group's center, retaining its shape for interpolation. */
function foldShape(s: GroupShape, pc: Pt): GroupShape {
  if (s.kind === 'rect') return { kind: 'rect', x: pc.x, y: pc.y, w: 0, h: 0 };
  if (s.kind === 'sector') return { kind: 'sector', cx: pc.x, cy: pc.y, r0: 0, r1: 0, a0: s.a0, a1: s.a1 };
  return s;
}

/** Arrowhead at the end of a sampled route. */
function arrowData(s: Float64Array): string {
  const n = s.length / 2;
  if (n < 2) return '';
  const tx = s[(n - 1) * 2];
  const ty = s[(n - 1) * 2 + 1];
  let i = n - 2;
  let dx = 0;
  let dy = 0;
  while (i >= 0) {
    dx = tx - s[i * 2];
    dy = ty - s[i * 2 + 1];
    if (Math.hypot(dx, dy) > 3) break;
    i--;
  }
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const L = 9;
  const W = 4.6;
  const bx = tx - ux * L;
  const by = ty - uy * L;
  const f = (v: number) => Math.round(v * 10) / 10;
  return `M${f(tx)} ${f(ty)}L${f(bx - uy * W)} ${f(by + ux * W)}L${f(bx + uy * W)} ${f(by - ux * W)}Z`;
}

export function defineLodeFlow(tag = 'lode-flow') {
  if (typeof customElements !== 'undefined' && !customElements.get(tag)) customElements.define(tag, LodeFlowElement);
}

declare global {
  interface HTMLElementTagNameMap {
    'lode-flow': LodeFlowElement;
  }
}
