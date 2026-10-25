// Vendored copy; do not edit here. Canonical: theditor (projects/theditor/src/core/image-tools.ts).
// Refresh with `node projects/theditor/src/scripts/vendor-sync.mjs`; `--check` reports drift.
/**
 * The magnets of a selected inline image (Al, 2026-10-23), as data and pure
 * functions: their chords, their order, their choices and labels, where the
 * column sits beside the picture, and which rung of the Escape ladder a press
 * takes. The fork's React image tools and lodeflow's vanilla ones read this.
 */
import {
    FORMATTED_IMAGE_ALIGNS,
    FORMATTED_IMAGE_LOOKS,
    MAGNET_GAP,
    type FormattedImageAlign,
    type FormattedImageLook,
} from "../../common-models";
import { chordMatches, type Chord } from "./chords";
import { FORMATTING_COPY as copy } from "./copy";

export type ImageTool = "style" | "alignment" | "tweak";
export type ImageChoiceTool = Exclude<ImageTool, "tweak">;

/** Top to bottom in the column; each is one magnet. */
export const IMAGE_TOOL_ORDER: readonly ImageTool[] = [
    "style",
    "alignment",
    "tweak",
];

export const IMAGE_TOOL_INDEX = Object.fromEntries(IMAGE_TOOL_ORDER.map((tool,index) => [tool,index])) as Record<ImageTool, number>;

/** The image magnets' chords: ⌃⌥⌘ like the block formats. While an image is
 * selected they answer before the formatting actions, so ⌃⌥⌘T tweaks the
 * image rather than wrapping its line in a toggle. */
export const IMAGE_TOOL_CHORDS: Record<ImageTool, Chord> = {
    style: { shape: "block", code: "KeyS" },
    alignment: { shape: "block", code: "KeyL" },
    tweak: { shape: "block", code: "KeyT" },
};

export function imageToolForKey(event: {
    code: string;
    metaKey: boolean;
    ctrlKey: boolean;
    altKey: boolean;
    shiftKey: boolean;
}): ImageTool | null {
    for (const tool of IMAGE_TOOL_ORDER)
        if (chordMatches(IMAGE_TOOL_CHORDS[tool], event)) return tool;
    return null;
}

/** A magnet's name, as its label and tooltip say it. */
export const IMAGE_TOOL_LABELS: Record<ImageTool, string> = {
    style: copy.imageStyle,
    alignment: copy.imageAlignment,
    tweak: copy.imageTweak,
};

/** What Style and Alignment open: their choices, in order, with labels. */
export const IMAGE_CHOICES: {
    style: readonly { value: FormattedImageLook; label: string }[];
    alignment: readonly { value: FormattedImageAlign; label: string }[];
} = {
    style: FORMATTED_IMAGE_LOOKS.map((value) => ({
        value,
        label: copy.imageLooks[value],
    })),
    alignment: FORMATTED_IMAGE_ALIGNS.map((value) => ({
        value,
        label: copy.imageAligns[value],
    })),
};

/** An anchor's accessible name: the tool and the image's current value. */
export function imageAnchorLabel(
    tool: ImageChoiceTool,
    attrs: { look: string; align: string },
): string {
    return tool === "style"
        ? `${copy.imageStyle}: ${copy.imageLooks[attrs.look as FormattedImageLook]}`
        : `${copy.imageAlignment}: ${copy.imageAligns[attrs.align as FormattedImageAlign]}`;
}

/** The selection ring's reach past the painted image (image-css.ts). */
export const IMAGE_RING = 4;
/** The column turning over into the kitchen sink, and the sink growing. */
export const TURN_MS = 110;
export const GROW_MS = 160;
export const SINK_WIDTH = 220;

export interface Rect {
    top: number;
    left: number;
    bottom: number;
    right: number;
}

/**
 * Where the column goes: at the image's left edge, top-aligned, MAGNET_GAP
 * outside its painted bounds and selection ring (the right edge when the
 * left has no room and the right has more), clamped into `room` (the
 * surface that can show it). `below` is the height it may grow to there.
 */
export function imageToolsPlacement({
    image,
    room,
    width,
    height,
}: {
    image: Rect;
    room: Rect;
    width: number;
    height: number;
}): { side: "left" | "right"; x: number; y: number; below: number } {
    const outside = IMAGE_RING + MAGNET_GAP;
    const left = image.left - outside - width;
    const right = image.right + outside;
    const side =
        left >= room.left ||
        (right + width > room.right &&
            image.left - room.left >= room.right - image.right)
            ? "left"
            : "right";
    const x =
        side === "left"
            ? Math.max(room.left, left)
            : Math.min(right, room.right - width);
    // Top-aligned, unless that would run off the bottom.
    const y = Math.max(room.top, Math.min(image.top, room.bottom - height));
    return { side, x, y, below: Math.max(120, room.bottom - y - 8) };
}

/**
 * One rung of Escape at a time, inside the image tools: a field with an
 * unsubmitted number or a live scrub reverts itself first (`field`), then
 * unsubmitted words go back (`revert-text`), then the sink's filter clears
 * (`clear-filter`), then the sink turns back to the column, an open lozenge
 * closes to its anchor, and last focus returns to the words.
 */
export type ImageEscapeRung =
    | "field"
    | "revert-text"
    | "clear-filter"
    | "turn-to-column"
    | "close-lozenge"
    | "editor";

export function imageEscapeRung(state: {
    fieldPending: boolean;
    textReverted: boolean;
    filterHasText: boolean;
    face: "column" | "sink";
    open: ImageChoiceTool | null;
}): ImageEscapeRung {
    if (state.fieldPending) return "field";
    if (state.textReverted) return "revert-text";
    if (state.filterHasText) return "clear-filter";
    if (state.face === "sink") return "turn-to-column";
    if (state.open) return "close-lozenge";
    return "editor";
}

/** ↑ ↓ along an open column: away from its anchor and back, in the direction
 * its lozenge stretched. `index` is the focused button in [anchor, ...choices]. */
export function columnStep(
    index: number,
    count: number,
    key: string,
    direction: "up" | "down",
): number | null {
    if (key !== "ArrowUp" && key !== "ArrowDown") return null;
    const away = (key === "ArrowUp") === (direction === "up");
    return Math.max(0, Math.min(count - 1, index + (away ? 1 : -1)));
}
