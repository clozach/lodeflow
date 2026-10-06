// React wrapper: typed props and callbacks over the <lode-flow> custom element.
import { createElement, forwardRef, useEffect, useImperativeHandle, useRef, type CSSProperties } from 'react';
import type { LodeFlowElement, LodeFlowLayoutInfo } from './lode-flow';
import type { Bias, Compactness, FlowDoc, Orientation } from './model';

export interface LodeFlowProps {
  /** Controlled document. Pass back what onChange gives you; identical objects are ignored. */
  doc?: FlowDoc;
  orientation?: Orientation;
  bias?: Bias;
  compactness?: Compactness;
  incremental?: boolean;
  /** Group members with room to move close ranks inside their group (default on). */
  tightGroups?: boolean;
  /** Nodes with room to move change rank when that removes crossing lines (default on). */
  untangle?: boolean;
  nodeWidth?: number;
  /** Smallest zoom fitting may use before the view scrolls instead: 0.6 or '60%' (default 0.7). */
  fitMin?: number | string;
  readOnly?: boolean;
  /** Keep content and undo history in localStorage under this key. */
  storageKey?: string;
  /** Built-in appearance; omitted follows the page's light/dark preference. */
  theme?: 'light' | 'dark' | 'blueprint';
  /** Combined nodes, edges, groups and junctions; omitted leaves the editor uncapped. */
  maxItems?: number;
  /** JSON URL to load. */
  src?: string;
  /** 'auto' (scroll pans once focused), 'always', or 'modifier' (only ⌘/Ctrl-scroll zooms). */
  wheel?: 'auto' | 'always' | 'modifier';
  className?: string;
  style?: CSSProperties;
  onChange?: (doc: FlowDoc, label: string) => void;
  onSelectionChange?: (ids: string[]) => void;
  onLayout?: (info: LodeFlowLayoutInfo) => void;
  onHistory?: (h: { canUndo: boolean; canRedo: boolean; undoLabel: string | null; redoLabel: string | null }) => void;
  onLimit?: (detail: { maxItems: number; itemCount: number; attemptedCount: number; message: string }) => void;
}

export const LodeFlow = forwardRef<LodeFlowElement | null, LodeFlowProps>(function LodeFlow(props, ref) {
  const el = useRef<LodeFlowElement | null>(null);
  useImperativeHandle(ref, () => el.current as LodeFlowElement, []);

  // Register the element in the browser only (keeps SSR happy).
  useEffect(() => {
    import('./index');
  }, []);

  useEffect(() => {
    if (el.current && props.doc && el.current.doc !== props.doc) el.current.doc = props.doc;
  }, [props.doc]);

  const handlers = useRef(props);
  handlers.current = props;
  useEffect(() => {
    const node = el.current;
    if (!node) return;
    const on = (type: string, fn: (d: any) => void) => {
      const h = (e: Event) => fn((e as CustomEvent).detail);
      node.addEventListener(type, h);
      return () => node.removeEventListener(type, h);
    };
    const offs = [
      on('lode-change', (d) => handlers.current.onChange?.(d.doc, d.label)),
      on('lode-select', (d) => handlers.current.onSelectionChange?.(d.selection)),
      on('lode-layout', (d) => handlers.current.onLayout?.(d)),
      on('lode-history', (d) => handlers.current.onHistory?.(d)),
      on('lode-limit', (d) => handlers.current.onLimit?.(d)),
    ];
    return () => offs.forEach((f) => f());
  }, []);

  const attrs: Record<string, unknown> = { ref: el, class: props.className, style: props.style };
  if (props.orientation) attrs.orientation = props.orientation;
  if (props.bias) attrs.bias = props.bias;
  if (props.compactness) attrs.compactness = props.compactness;
  if (props.incremental !== undefined) attrs.incremental = String(props.incremental);
  if (props.tightGroups !== undefined) attrs['tight-groups'] = String(props.tightGroups);
  if (props.untangle !== undefined) attrs.untangle = String(props.untangle);
  if (props.nodeWidth) attrs['node-width'] = String(props.nodeWidth);
  if (props.fitMin !== undefined) attrs['fit-min'] = String(props.fitMin);
  if (props.readOnly) attrs.readonly = '';
  if (props.storageKey) attrs['storage-key'] = props.storageKey;
  if (props.theme) attrs.theme = props.theme;
  if (props.maxItems !== undefined) attrs['max-items'] = String(props.maxItems);
  if (props.src) attrs.src = props.src;
  if (props.wheel) attrs.wheel = props.wheel;
  return createElement('lode-flow', attrs);
});

declare module 'react' {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      'lode-flow': Record<string, unknown>;
    }
  }
}
