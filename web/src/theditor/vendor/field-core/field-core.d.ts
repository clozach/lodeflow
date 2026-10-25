/* field-core.d.ts — types for the vault's canonical propsheet field.
 *
 * CANONICAL SOURCE: pixel-reveal/src/component/field-core.js
 * These declarations describe field-core.mjs (the ESM face). A TS consumer
 * whose tsconfig has no `allowJs` cannot import the .js at all; importing
 * "./field-core.mjs" picks this file up automatically.
 *
 * Keep in sync by hand — field-core.js is plain ES5 with no build step.
 */

/** A concept name from the shared icon registry (icons.js). Any string is
 *  accepted; these are the ones that exist today. A miss falls back to
 *  `ratio`, then to the built-in ⇔ glyph, and warns once. */
export type IconConcept =
  | "duration" | "distance" | "speed" | "height"
  | "scale" | "ratio" | "position" | "count" | "drag"
  | (string & {});

export interface FieldClasses {
  field?: string;
  label?: string;
  control?: string;
  knob?: string;
  input?: string;
  dragging?: string;
}

export type ErrorPhase = "preview" | "commit";

export interface FieldErrorInfo {
  /** The value the callback was handed. */
  attempted: number;
  /** The value held immediately before it — what a failed commit restores. */
  previous: number;
  phase: ErrorPhase;
}

/** The shape every pure helper accepts. All members optional. */
export interface NumberSpecBase {
  min?: number;
  max?: number;
  /** Value per drag pixel and per ↑/↓. Default 1. */
  step?: number;
  /** Explicit decimal places; derived from `step` when omitted. */
  decimals?: number;
  /** Whole numbers only (decimals 0, step defaults to 1). */
  integer?: boolean;
  /** Appended inline to the value, no space: "ms", "px/s", "×". */
  unit?: string;
  /** Wholesale display override. Supply the inverse `parse` whenever this
   *  emits digits the value did not — see the header's KNOWN LOSSAGE. */
  format?: (value: number, spec: NumberSpecBase) => string;
  /** Wholesale entry override. Return null for "not a number". */
  parse?: (text: string, spec: NumberSpecBase) => number | null;
}

export interface NumberFieldSpec extends NumberSpecBase {
  /** Shown above the control. Never truncated — it wraps. */
  label?: string;
  icon?: IconConcept;

  /** Ownership shape A: the consumer owns the number. May return a Promise —
   *  the cached value paints immediately and repaints on resolve. */
  get?: () => number | Promise<number>;
  /** Ownership shape B: the field owns the number (React/ref path). */
  value?: number;
  /** Seed used only when neither `value` nor `get` supplies one. */
  initial?: number;

  /** Every value change, drag pixels included. Cheap live redraw. */
  onPreview?: (value: number) => unknown;
  /** Once per interaction, and only when the value moved. Durable work. */
  onCommit?: (value: number) => unknown;
  /** A callback threw or returned a rejecting promise. Without this the
   *  failure is logged; it is never re-thrown and never escapes as an
   *  unhandled rejection. */
  onError?: (error: unknown, info: FieldErrorInfo) => unknown;

  /** Build in this Document (defaults to the ambient one). */
  document?: Document;
  /** Icon registry override (defaults to globalThis.Icons). */
  icons?: Record<string, string>;
  classes?: FieldClasses;
  /** false → do not write the contract stylesheet into `document`. */
  injectCSS?: boolean;
  /** Knob tooltip override. */
  title?: string;
  /** Input aria-label override. Keep the visible label as its prefix, or
   *  speech control loses the name the user can see (WCAG 2.5.3). */
  ariaLabel?: string;
}

export interface FieldNodes {
  field: HTMLDivElement;
  label: HTMLLabelElement;
  control: HTMLDivElement;
  knob: HTMLSpanElement;
  input: HTMLInputElement;
}

export interface SetValueOptions {
  /** Fire onPreview. Default true. */
  preview?: boolean;
  /** Fire onCommit. Default false. */
  commit?: boolean;
  /** Fire both even when the value did not move. Default false. */
  force?: boolean;
}

export interface UpdateOptions {
  /** Repaint even over an unsubmitted edit. Default false. */
  force?: boolean;
}

export type KeyAction = "submit" | "revert" | "cancel" | "nudge" | "pass" | "type";

export interface KeyVerdict {
  action: KeyAction;
  preventDefault: boolean;
  stopPropagation: boolean;
  /** Present when action === "nudge". */
  direction?: 1 | -1;
  /** Present when action === "nudge". */
  shift?: boolean;
}

export interface ClassifyKeyOptions {
  /** An unsubmitted edit is on screen. */
  pending?: boolean;
  /** A scrub is live. */
  dragging?: boolean;
}

export interface NumberFieldHandle {
  /** The field root. Mount this. */
  el: HTMLDivElement;
  nodes: FieldNodes;
  /** The field's OWN shallow copy of the spec — patch it through update(). */
  spec: NumberFieldSpec;

  /** Re-read from get()/value and repaint, unless an edit is in progress. */
  render(): string;
  focus(): HTMLInputElement;
  getValue(): number;
  setValue(value: number, opts?: SetValueOptions): number;
  update(patch?: Partial<NumberFieldSpec>, opts?: UpdateOptions): string;

  hasPendingEdit(): boolean;
  isDragging(): boolean;
  isDestroyed(): boolean;

  /** Give the focused field first refusal on a key from a host listener.
   *  Idempotent per event object. */
  handleKeydown(ev: KeyboardEvent | { key?: string; shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean }): KeyVerdict;

  submit(): number;
  revert(): string;
  /** Flushes a pending drag commit, releases every listener, removes `el`. */
  destroy(): void;
}

export interface ScrubberHandlers {
  start?: () => number;
  preview?: (value: number) => unknown;
  commit?: (value: number) => unknown;
}

export interface Scrubber {
  isActive(): boolean;
  value(): number;
  startValue(): number;
  begin(x: number): number;
  move(x: number, mods?: { shiftKey?: boolean; shift?: boolean }): number;
  /** Ends the drag, committing if the value moved. */
  end(): number;
  /** Abandons the drag, restoring the start value with one preview. */
  cancel(): number;
}

export declare const VERSION: string;
/** The contract stylesheet (knob sizing, label wrap, ≥2px focus indicator). */
export declare const CSS: string;
/** The ⇔ scrub glyph, inlined — iconMarkup's last resort. */
export declare const FALLBACK_ICON: string;

/** Write CSS into a document once. Returns true if it wrote a <style>. */
export declare function injectCSS(doc: Document): boolean;

export declare function createNumberField(spec?: NumberFieldSpec): NumberFieldHandle;
export declare function createScrubber(spec: NumberSpecBase, handlers?: ScrubberHandlers): Scrubber;
export declare function classifyKey(ev: unknown, opts?: ClassifyKeyOptions): KeyVerdict;
export declare function clampTo(value: unknown, spec?: NumberSpecBase): number;
export declare function formatValue(value: unknown, spec?: NumberSpecBase): string;
export declare function parseTyped(text: unknown, spec?: NumberSpecBase): number | null;
export declare function stepFor(spec?: NumberSpecBase, mods?: { shiftKey?: boolean; shift?: boolean }): number;
export declare function decimalsFor(spec?: NumberSpecBase): number;
export declare function decimalsForStep(step: number): number;
export declare function iconMarkup(name?: string, registry?: Record<string, string> | null): string;

/** The single API object: what module.exports carries, what the UMD tail puts
 *  on globalThis, and what both entry points default-export. */
export interface PropsheetFieldAPI {
  VERSION: string;
  CSS: string;
  FALLBACK_ICON: string;
  injectCSS: typeof injectCSS;
  createNumberField: typeof createNumberField;
  createScrubber: typeof createScrubber;
  classifyKey: typeof classifyKey;
  clampTo: typeof clampTo;
  formatValue: typeof formatValue;
  parseTyped: typeof parseTyped;
  stepFor: typeof stepFor;
  decimalsFor: typeof decimalsFor;
  decimalsForStep: typeof decimalsForStep;
  iconMarkup: typeof iconMarkup;
}

declare const PropsheetField: PropsheetFieldAPI;
export default PropsheetField;

declare global {
  /** The UMD tail sets this unconditionally, so a bundler that refuses to
   *  transform CJS can side-effect-import field-core.js and read it here. */
  // eslint-disable-next-line no-var
  var PropsheetField: PropsheetFieldAPI;
}
