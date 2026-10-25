// Vendored copy; do not edit here. Canonical: theditor (projects/theditor/src/core/toolbar.ts).
// Refresh with `node projects/theditor/src/scripts/vendor-sync.mjs`; `--check` reports drift.
/**
 * The formatting toolbar's shape and keyboard, as data and pure functions
 * (Al's columns, 2026-10-05; the lozenge, 2026-10-10): which actions it shows
 * in which order, which group each opens, what a magnet's tooltip says, and
 * where a key moves the one Tab stop. Both renderers (the fork's React
 * toolbar and lodeflow's vanilla one) read this, so they cannot disagree.
 */
import { MAGNET_GAP } from "../../common-models";
import { FORMAT_ACTIONS, type FormatAction, type FormatActionId } from "./actions";
import { FORMATTING_COPY as copy, fillCopy } from "./copy";

/** Only the first of each column is an anchor in the permanent row; the
 * rest open in a lozenge pinned over it. */
export const TOOLBAR_COLUMNS: readonly (readonly FormatActionId[])[] = [
    ["italic", "bold", "plainText"],
    ["link", "code"],
    ["heading1", "heading2", "heading3", "heading4", "horizontalRule"],
    ["indent", "outdent", "blockquote", "callout", "codeBlock"],
    ["bulletList", "orderedList", "taskList"],
];
/** A sixth column, only where the host can upload a picture: an action that
 * cannot work is not shown (visible means available). */
export const IMAGE_COLUMN: readonly FormatActionId[] = ["image"];

export interface ToolbarLayout {
    /** Every action the toolbar shows, by tool index (column by column). */
    actions: readonly FormatAction[];
    /** Each column's tool indexes; the first is its anchor. */
    groups: readonly (readonly number[])[];
}

export function toolbarLayout(images: boolean): ToolbarLayout {
    const columns = images ? [...TOOLBAR_COLUMNS, IMAGE_COLUMN] : TOOLBAR_COLUMNS;
    const actions = columns
        .flat()
        .map((id) => FORMAT_ACTIONS.find((action) => action.id === id)!);
    const groups = columns.map((column) =>
        column.map((id) => actions.findIndex((action) => action.id === id)),
    );
    return { actions, groups };
}

/** A magnet's tooltip: what it does, and what typing does the same. */
export function actionTitle(action: FormatAction): string {
    if (action.id === "plainText") return copy.plainTextHint;
    if (action.id === "image") return copy.imageHint;
    if (action.typed)
        return fillCopy(copy.typedHint, {
            label: action.label,
            typed: action.typed,
        });
    return action.label;
}

/** The toolbar's one Tab stop (`current`) and its open column, if any. */
export interface ToolbarState {
    current: number;
    open: number | null;
}

export const groupOf = (layout: ToolbarLayout, index: number) =>
    layout.groups.findIndex((items) => items.includes(index));

/** Pointing at or focusing a column opens it. The Tab stop stays on a tool
 * of that column; `moved` says it had to move (to the anchor), so a
 * keyboard inside the toolbar follows it there. */
export function revealGroup(
    layout: ToolbarLayout,
    state: ToolbarState,
    group: number,
): { state: ToolbarState; moved: boolean } {
    const items = layout.groups[group];
    const moved = !items.includes(state.current);
    return {
        state: { open: group, current: moved ? items[0] : state.current },
        moved,
    };
}

/** Closing a column hands the Tab stop back to its anchor. */
export function closeGroup(
    layout: ToolbarLayout,
    state: ToolbarState,
): ToolbarState {
    if (state.open === null) return state;
    return { current: layout.groups[state.open][0], open: null };
}

/** What a key does in the toolbar: nothing it knows (`pass`), nothing more
 * to do (`stay`: the key is still spent), or a new state with the tool that
 * takes focus. */
export type ToolbarStep =
    | { kind: "pass" }
    | { kind: "stay" }
    | { kind: "move"; state: ToolbarState; focus: number };

/**
 * A key pressed in the toolbar. ← → walk every tool (opening each column as
 * it is reached), Home and End jump to the ends, ↑ ↓ walk along the open
 * column away from its anchor and back, in the direction its lozenge
 * stretched (`stretched(group)`, the renderer's measured "up" or "down"),
 * and Escape closes an open column back to its anchor.
 */
export function toolbarKey(
    layout: ToolbarLayout,
    state: ToolbarState,
    key: string,
    stretched: (group: number) => "up" | "down",
): ToolbarStep {
    const { actions, groups } = layout;
    const { current, open } = state;
    if (key === "Escape") {
        if (open === null) return { kind: "pass" };
        const closed = closeGroup(layout, state);
        return { kind: "move", state: closed, focus: closed.current };
    }
    if (key === "ArrowUp" || key === "ArrowDown") {
        const group = groupOf(layout, current);
        const items = groups[group];
        const level = items.indexOf(current);
        const away = open !== group || (key === "ArrowUp") === (stretched(group) === "up");
        const next =
            items[Math.max(0, Math.min(items.length - 1, level + (away ? 1 : -1)))];
        // At the column's end there is nowhere further.
        if (next === current && open === group) return { kind: "stay" };
        return { kind: "move", state: { open: group, current: next }, focus: next };
    }
    const moves: Record<string, number> = {
        ArrowRight: 1,
        ArrowLeft: -1,
        Home: -Infinity,
        End: Infinity,
    };
    const move = moves[key];
    if (move === undefined) return { kind: "pass" };
    // Home on the first action or End on the last: nowhere to go.
    if (
        (move === -Infinity && current === 0) ||
        (move === Infinity && current === actions.length - 1)
    )
        return { kind: "stay" };
    const next =
        move === -Infinity
            ? 0
            : move === Infinity
              ? actions.length - 1
              : (current + move + actions.length) % actions.length;
    return {
        kind: "move",
        state: { open: groupOf(layout, next), current: next },
        focus: next,
    };
}

/**
 * Where a host that floats the toolbar over what it formats puts it
 * (lodeflow's nodes): MAGNET_GAP above the painted top of `anchor`, its left
 * edge aligned, out of flow and clamped into `screen`; below the anchor when
 * there is no room above or the host's own floating controls (`avoid`) are
 * there. The row never moves for what it opens: lozenges float over it
 * (lozenge-layout.ts).
 */
export function toolbarPlacement({
    anchor,
    width,
    height,
    screen,
    avoid = [],
    margin = 4,
}: {
    anchor: { top: number; left: number; bottom: number };
    width: number;
    height: number;
    screen: { top: number; left: number; bottom: number; right: number };
    /** The host's own floating controls, to keep clear of. */
    avoid?: readonly { top: number; left: number; bottom: number; right: number }[];
    margin?: number;
}): { x: number; y: number; edge: "above" | "below" } {
    const x = Math.max(
        screen.left + margin,
        Math.min(anchor.left, screen.right - margin - width),
    );
    const at = {
        above: anchor.top - MAGNET_GAP - height,
        below: anchor.bottom + MAGNET_GAP,
    };
    const fits = (y: number) =>
        y >= screen.top + margin && y + height <= screen.bottom - margin;
    const clear = (y: number) =>
        !avoid.some(
            (box) =>
                box.left < x + width &&
                box.right > x &&
                box.top < y + height &&
                box.bottom > y,
        );
    const edge =
        (["above", "below"] as const).find((e) => fits(at[e]) && clear(at[e])) ??
        (["above", "below"] as const).find((e) => fits(at[e])) ??
        "above";
    const y = Math.max(
        screen.top + margin,
        Math.min(at[edge], screen.bottom - margin - height),
    );
    return { x, y, edge };
}
