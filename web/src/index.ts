// lodeflow — self-organizing flow diagrams for the web.
// Importing this module registers <lode-flow> (browser only; safe to import during SSR).
import { defineLodeFlow, LodeFlowElement } from './lode-flow';

export { LodeFlowElement, defineLodeFlow };
export type { LodeFlowActivation, LodeFlowLayoutInfo, LodeFlowTiming } from './lode-flow';
export * from './model';
export type { Camera, ViewState, Entry, Snapshot } from './history';
export { LayoutEngine, engine } from './engine';
export type { EngineInput, EngineOptions, EngineOrientation, LayoutResult, GroupShape } from './engine';

defineLodeFlow();
