// Vendored copy; do not edit here. Canonical: theditor (projects/theditor/src/core/icons.ts).
// Refresh with `node projects/theditor/src/scripts/vendor-sync.mjs`; `--check` reports drift.
/**
 * Which artwork each magnet wears: file names in theditor's shared icon set
 * (`icons/*.svg`, dark copies in `icons/dark/`). Each renderer turns a name
 * into a source: the fork serves the set at `/formatting/<name>.svg`;
 * lodeflow inlines it (generated `icons.ts`).
 */
import type { FormattedImageAlign } from "../../common-models";
import type { FormatActionId } from "./actions";

/** Figma 181:1455 assets, with Callout revised in 142:1115. SVGs retain their
 * dimensions; the 36.1792px design slot positions the smaller glyph layers.
 * Numbered list is drawn from three line layers (`ORDERED_LIST_LINES`). */
export const FORMAT_ICONS: Record<
    Exclude<FormatActionId, "orderedList" | "details">,
    string
> = {
    bold: "bold",
    italic: "italic",
    code: "code",
    link: "link",
    heading1: "heading-1",
    heading2: "heading-2",
    heading3: "heading-3",
    heading4: "heading-4",
    bulletList: "bullet-list",
    taskList: "task-list",
    indent: "indent",
    outdent: "outdent",
    blockquote: "blockquote",
    callout: "callout",
    codeBlock: "code-block",
    horizontalRule: "horizontal-rule",
    plainText: "plain-text",
    // Drawn in the set's style for inline images (2026-10-24), not from Figma.
    image: "image",
};

export const ORDERED_LIST_LINES = [1, 2, 3] as const;
export const orderedListIcon = (line: 1 | 2 | 3) => `ordered-list-${line}`;

/** One glyph per placement, 24px, the size of an image's magnets. */
export const ALIGN_ICONS: Record<FormattedImageAlign, string> = {
    left: "align-left",
    center: "align-center",
    right: "align-right",
    "wrap-left": "align-wrap-left",
    "wrap-right": "align-wrap-right",
};

/** The Tweak magnet's face: ⟳ drawn lying on a horizontal plane (CSS). */
export const TWEAK_GLYPH = "⟳";
/** A row's way back to what the look draws. */
export const RESET_GLYPH = "↺";
