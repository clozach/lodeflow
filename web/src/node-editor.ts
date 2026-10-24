// The editor seam: what edits an item's words in Edit mode. The plain editor (a textarea) is built
// in; a host or theditor (`lodeflow/theditor`) registers another for nodes.
import type { FormattedDoc } from './model';

/**
 * What an editor holds: the words, and a formatted document when the words alone cannot hold it.
 * A formatting editor always includes the `content` key (undefined while the words are plain), so
 * a save replaces the node's formatting; the plain editor leaves the key out, so unchanged words
 * keep a node's formatting and changed words drop it.
 */
export interface NodeEditorValue {
  text: string;
  content?: FormattedDoc;
}

/** The element's side of an editor: called by the editor, never by the host. */
export interface NodeEditorHooks {
  /** After every change to what is written (the element re-measures the item). */
  onInput(): void;
  /** Every key first. True: the element handled it (↵, Esc) and the editor does nothing more with it. */
  onKeydown(e: KeyboardEvent): boolean;
  /** Focus left the editor. */
  onBlur(): void;
}

export interface NodeEditorOptions {
  /** The item's text box: the editor mounts `el` into it. */
  host: HTMLElement;
  kind: 'node' | 'group' | 'edge';
  initial: NodeEditorValue;
  placeholder: string;
  /** Accessible name of the editing area. */
  label: string;
  hooks: NodeEditorHooks;
}

export interface NodeEditor {
  /** The editor's outermost element, inside `host`. */
  el: HTMLElement;
  focus(): void;
  /** Select everything written (Edit mode opens this way). */
  selectAll(): void;
  value(): NodeEditorValue;
  hasFocus(): boolean;
  /** Tear down; the element removes `el` afterwards. */
  destroy(): void;
}

export type NodeEditorFactory = (options: NodeEditorOptions) => NodeEditor;

/**
 * A node editor to use instead of the plain one, with what it needs around it. The element still
 * owns Edit mode: when it starts and ends, saving, history and layout.
 */
export interface NodeEditorKit {
  create: NodeEditorFactory;
  /**
   * Draw a node's formatted content into its (empty) text box; `links`: web links may be clickable.
   * False: it could not, and the node shows its words.
   */
  render?(target: HTMLElement, content: FormattedDoc, links: boolean): boolean;
  /** Stylesheet text added to every diagram's shadow root. */
  css?: string;
  /** Help rows, [what to press or type, what it does], shown while this editor is registered. */
  help?: [string, string][];
}

let kit: NodeEditorKit | null = null;
const listeners = new Set<() => void>();

export function nodeEditorKit(): NodeEditorKit | null {
  return kit;
}

export function setNodeEditorKit(next: NodeEditorKit | null) {
  kit = next;
  for (const fn of listeners) fn();
}

/** Calls `fn` whenever the registered kit changes; returns the unsubscribe. */
export function onNodeEditorKit(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** The built-in editor: a textarea that grows with its words. ↵ saves, ⇧↵ is a new line. */
export const plainEditor: NodeEditorFactory = ({ host, initial, placeholder, label, hooks }) => {
  const ta = document.createElement('textarea');
  ta.className = 'ed';
  ta.rows = 1;
  ta.setAttribute('aria-label', label);
  ta.placeholder = placeholder;
  ta.spellcheck = true;
  ta.value = initial.text;
  host.append(ta);
  const fitHeight = () => {
    ta.style.height = '0px';
    ta.style.height = `${ta.scrollHeight}px`;
  };
  fitHeight();
  ta.addEventListener('input', () => {
    fitHeight();
    hooks.onInput();
  });
  ta.addEventListener('keydown', (e) => {
    e.stopPropagation();
    hooks.onKeydown(e);
  });
  ta.addEventListener('blur', () => hooks.onBlur());
  return {
    el: ta,
    focus: () => ta.focus({ preventScroll: true }),
    selectAll: () => ta.select(),
    value: () => ({ text: ta.value }),
    hasFocus: () => (ta.getRootNode() as Document | ShadowRoot).activeElement === ta,
    destroy: () => {},
  };
};
