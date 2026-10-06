// One budget for every stored diagram item. Labels and view/history steps are not items.
import type { FlowDoc } from './model';

export interface ItemLimitDetail {
  maxItems: number;
  itemCount: number;
  attemptedCount: number;
  message: string;
}

export const countItems = (doc: FlowDoc): number => doc.nodes.length + doc.edges.length + doc.groups.length + (doc.junctions?.length ?? 0);

/** Missing or invalid values leave ordinary embeds uncapped; zero permits an empty diagram. */
export function parseMaxItems(value: string | null): number | null {
  if (value === null || !value.trim()) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}

/** A lower cap on an already-open diagram preserves it while permitting edits and removals. */
export function itemLimitProblem(doc: FlowDoc, maxItems: number | null, itemCount: number, preserveExisting = false): ItemLimitDetail | null {
  const attemptedCount = countItems(doc);
  if (maxItems === null || attemptedCount <= maxItems || (preserveExisting && attemptedCount <= itemCount)) return null;
  return {
    maxItems, itemCount, attemptedCount,
    message: `This diagram is limited to ${maxItems} items (nodes, edges, groups and junctions). This change needs ${attemptedCount}; remove some items first.`,
  };
}
