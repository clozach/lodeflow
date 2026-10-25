// Vendored copy; do not edit here. Canonical: the swamikk CourseLit fork, https://github.com/clozach/swamikk, packages/common-models/src/design-measurements.ts
// Refresh with `node scripts/sync-theditor.mjs`; `--check` reports drift.
/** Shared design roles. Equal numbers do not imply interchangeable roles.
 * Numeric exports serve pure geometry; the same values emit CSS and the
 * human design reference through DESIGN_MEASUREMENTS. */
export const MAGNET_GAP = 9;
export const MAGNET_SIBLING_GAP = 9;
export const MAGNET_STACK_GAP = 4;
export const CONTROL_SIZE_ROUND = 32;
export const CONTROL_SIZE_FORMAT = 36;
export const CONTROL_SIZE_TOUCH = 44;
export const GLYPH_SIZE_SMALL = 16;
export const GLYPH_SIZE_MEDIUM = 18;
export const GLYPH_SIZE_CONTROL = 20;
export const ANCHOR_OUTLINE_WIDTH = 7;
export const ANCHOR_RADIUS = 9;
export const ANCHOR_TEXT_PAD = 4;
export const EDIT_SURFACE_RADIUS = 9;
export const EDIT_SURFACE_PAD_INLINE = 6;
export const EDIT_SURFACE_PAD_BLOCK = 8;
export const EDIT_SURFACE_OUTLINE_WIDTH = 1;
export const EDIT_SURFACE_SHADOW = "0 8px 24px #39271c26, 0 2px 6px #39271c18";
export const MESSAGE_FIELD_PAD_INLINE = 12;
export const MESSAGE_FIELD_PAD_BLOCK = 10;
export const MESSAGE_FIELD_RADIUS = 8;
export const MESSAGE_FIELD_MIN_HEIGHT = 9.5;
export const MESSAGE_BODY_GAP = 14;
export const TOOL_SCROLL_INSET = 6;
export const MOTION_DURATION_LIFT = 180;
export const MAGNET_FADE = 0;
/** Interaction tolerance, independent of the visual fade duration. */
export const POINTER_BRIDGE_GRACE_MS = 120;
export const COMPOSER_MIN_WRITING_WIDTH = 240;
export const LAYER_PAGE_OUTLINE = 41;
export const LAYER_PAGE_MAGNET = 42;
export const LAYER_EDIT_HEADER = 43;
export const LAYER_HEADER_CONTROL = 44;
export const LAYER_EDIT_BAR = 45;
export const LAYER_FEEDBACK_MAGNET = 46;
export const LAYER_CONVERSATION_BACKDROP = 49;
export const LAYER_CONVERSATION = 50;
export const LAYER_NOTICE = 60;
export const LAYER_TEXT_TIP = 70;
export const LAYER_REFERENCE_COLLECTOR = 130;
export const LAYER_MESSAGE_TOOLS = 10025;
export const LAYER_MESSAGE_LINK = 10026;

export type DesignMeasurement = {
    name: string;
    css: string;
    value: number | string;
    unit: "px" | "em" | "ms" | "";
    role: string;
    group: string;
};

const token = (
    name: string,
    css: string,
    value: number | string,
    unit: DesignMeasurement["unit"],
    role: string,
    group: string,
): DesignMeasurement => ({ name, css, value, unit, role, group });

export const DESIGN_MEASUREMENTS = {
    version: 1,
    tokens: [
        token(
            "MAGNET_GAP",
            "--kk-magnet-gap",
            MAGNET_GAP,
            "px",
            "Clearance from a magnet to its owner's painted edge.",
            "Magnets",
        ),
        token(
            "MAGNET_SIBLING_GAP",
            "--kk-magnet-sibling-gap",
            MAGNET_SIBLING_GAP,
            "px",
            "Horizontal spacing between sibling magnets; separate from anchor clearance.",
            "Magnets",
        ),
        token(
            "MAGNET_STACK_GAP",
            "--kk-magnet-stack-gap",
            MAGNET_STACK_GAP,
            "px",
            "Vertical spacing between stacked magnets.",
            "Magnets",
        ),
        token(
            "CONTROL_SIZE_ROUND",
            "--kk-control-round-size",
            CONTROL_SIZE_ROUND,
            "px",
            "Round page-edit magnet minimum on a fine pointer.",
            "Magnets",
        ),
        token(
            "CONTROL_SIZE_FORMAT",
            "--kk-control-format-size",
            CONTROL_SIZE_FORMAT,
            "px",
            "Formatting control size and compact Reply minimum.",
            "Magnets",
        ),
        token(
            "CONTROL_SIZE_TOUCH",
            "--kk-control-touch-size",
            CONTROL_SIZE_TOUCH,
            "px",
            "Shared minimum interactive target for touch.",
            "Magnets",
        ),
        token(
            "GLYPH_SIZE_SMALL",
            "--kk-glyph-small",
            GLYPH_SIZE_SMALL,
            "px",
            "Small inline and formatting action glyph.",
            "Glyphs",
        ),
        token(
            "GLYPH_SIZE_MEDIUM",
            "--kk-glyph-medium",
            GLYPH_SIZE_MEDIUM,
            "px",
            "Medium dialog and routing action glyph.",
            "Glyphs",
        ),
        token(
            "GLYPH_SIZE_CONTROL",
            "--kk-glyph-control",
            GLYPH_SIZE_CONTROL,
            "px",
            "Standalone control glyph.",
            "Glyphs",
        ),
        token(
            "ANCHOR_OUTLINE_WIDTH",
            "--kk-anchor-outline-width",
            ANCHOR_OUTLINE_WIDTH,
            "px",
            "Centered page-selection stroke; geometry derives half its width.",
            "Anchor outline",
        ),
        token(
            "ANCHOR_RADIUS",
            "--kk-anchor-radius",
            ANCHOR_RADIUS,
            "px",
            "Page-selection corner cap; images retain their own exposed corners.",
            "Anchor outline",
        ),
        token(
            "ANCHOR_TEXT_PAD",
            "--kk-anchor-text-pad",
            ANCHOR_TEXT_PAD,
            "px",
            "Breathing room outside selected page text.",
            "Anchor outline",
        ),
        token(
            "EDIT_SURFACE_RADIUS",
            "--kk-edit-surface-radius",
            EDIT_SURFACE_RADIUS,
            "px",
            "One saved-message corner in hover and edit states.",
            "Editing surface",
        ),
        token(
            "EDIT_SURFACE_PAD_INLINE",
            "--kk-edit-surface-pad-inline",
            EDIT_SURFACE_PAD_INLINE,
            "px",
            "Painted surface outset beside saved words; no glyph displacement.",
            "Editing surface",
        ),
        token(
            "EDIT_SURFACE_PAD_BLOCK",
            "--kk-edit-surface-pad-block",
            EDIT_SURFACE_PAD_BLOCK,
            "px",
            "Painted surface outset above and below saved words.",
            "Editing surface",
        ),
        token(
            "EDIT_SURFACE_OUTLINE_WIDTH",
            "--kk-edit-surface-outline-width",
            EDIT_SURFACE_OUTLINE_WIDTH,
            "px",
            "Hover-state inset outline that gives way to the editing shadow.",
            "Editing surface",
        ),
        token(
            "EDIT_SURFACE_SHADOW",
            "--kk-edit-surface-shadow",
            EDIT_SURFACE_SHADOW,
            "",
            "Lifted paper shadow; geometry stays fixed.",
            "Editing surface",
        ),
        token(
            "MESSAGE_FIELD_PAD_INLINE",
            "--kk-editor-pad-inline",
            MESSAGE_FIELD_PAD_INLINE,
            "px",
            "Horizontal padding shared by plain and formatted draft fields.",
            "Message field",
        ),
        token(
            "MESSAGE_FIELD_PAD_BLOCK",
            "--kk-editor-pad-block",
            MESSAGE_FIELD_PAD_BLOCK,
            "px",
            "Vertical padding shared by plain and formatted draft fields.",
            "Message field",
        ),
        token(
            "MESSAGE_FIELD_RADIUS",
            "--kk-editor-radius",
            MESSAGE_FIELD_RADIUS,
            "px",
            "Draft field corners; distinct from a saved-message surface.",
            "Message field",
        ),
        token(
            "MESSAGE_FIELD_MIN_HEIGHT",
            "--kk-editor-min-height",
            MESSAGE_FIELD_MIN_HEIGHT,
            "em",
            "Initial plain/formatted draft writing area.",
            "Message field",
        ),
        token(
            "MESSAGE_BODY_GAP",
            "--kk-message-body-gap",
            MESSAGE_BODY_GAP,
            "px",
            "Separation of message attribution and body.",
            "Message field",
        ),
        token(
            "TOOL_SCROLL_INSET",
            "--kk-tool-scroll-inset",
            TOOL_SCROLL_INSET,
            "px",
            "Visible breathing room when scrolling a focused dock control.",
            "Magnets",
        ),
        token(
            "MOTION_DURATION_LIFT",
            "--kk-motion-lift",
            MOTION_DURATION_LIFT,
            "ms",
            "Outline-to-shadow transition; disabled by reduced motion.",
            "Motion",
        ),
        token(
            "MAGNET_FADE",
            "--kk-motion-reveal",
            MAGNET_FADE,
            "ms",
            "Instant reveal and dismissal keep visible controls opaque.",
            "Motion",
        ),
        token(
            "POINTER_BRIDGE_GRACE_MS",
            "--kk-pointer-bridge-grace",
            POINTER_BRIDGE_GRACE_MS,
            "ms",
            "Pointer travel tolerance across the anchor gap, not visual motion.",
            "Interaction",
        ),
        token(
            "COMPOSER_MIN_WRITING_WIDTH",
            "--kk-composer-min-writing-width",
            COMPOSER_MIN_WRITING_WIDTH,
            "px",
            "Narrowest sideways writing panel reserved beside developer peers.",
            "Message field",
        ),
        token(
            "LAYER_PAGE_OUTLINE",
            "--kk-layer-page-outline",
            LAYER_PAGE_OUTLINE,
            "",
            "Page selection outline.",
            "Layers",
        ),
        token(
            "LAYER_PAGE_MAGNET",
            "--kk-layer-page-magnet",
            LAYER_PAGE_MAGNET,
            "",
            "Page-edit controls above the outline.",
            "Layers",
        ),
        token(
            "LAYER_EDIT_HEADER",
            "--kk-layer-edit-header",
            LAYER_EDIT_HEADER,
            "",
            "Header while page editing is active.",
            "Layers",
        ),
        token(
            "LAYER_HEADER_CONTROL",
            "--kk-layer-header-control",
            LAYER_HEADER_CONTROL,
            "",
            "Header-associated outline and magnets.",
            "Layers",
        ),
        token(
            "LAYER_EDIT_BAR",
            "--kk-layer-edit-bar",
            LAYER_EDIT_BAR,
            "",
            "Page editing bar and navigation lane.",
            "Layers",
        ),
        token(
            "LAYER_FEEDBACK_MAGNET",
            "--kk-layer-feedback-magnet",
            LAYER_FEEDBACK_MAGNET,
            "",
            "Feedback action controls.",
            "Layers",
        ),
        token(
            "LAYER_CONVERSATION_BACKDROP",
            "--kk-layer-conversation-backdrop",
            LAYER_CONVERSATION_BACKDROP,
            "",
            "Conversation backdrop immediately below its page.",
            "Layers",
        ),
        token(
            "LAYER_CONVERSATION",
            "--kk-layer-conversation",
            LAYER_CONVERSATION,
            "",
            "Conversation page and attached panels.",
            "Layers",
        ),
        token(
            "LAYER_NOTICE",
            "--kk-layer-notice",
            LAYER_NOTICE,
            "",
            "Feedback notices above conversation chrome.",
            "Layers",
        ),
        token(
            "LAYER_TEXT_TIP",
            "--kk-layer-text-tip",
            LAYER_TEXT_TIP,
            "",
            "Full-text tooltip.",
            "Layers",
        ),
        token(
            "LAYER_REFERENCE_COLLECTOR",
            "--kk-layer-reference-collector",
            LAYER_REFERENCE_COLLECTOR,
            "",
            "Collected references cursor control.",
            "Layers",
        ),
        token(
            "LAYER_MESSAGE_TOOLS",
            "--kk-layer-message-tools",
            LAYER_MESSAGE_TOOLS,
            "",
            "Writing controls inside their portal's stacking context.",
            "Layers",
        ),
        token(
            "LAYER_MESSAGE_LINK",
            "--kk-layer-message-link",
            LAYER_MESSAGE_LINK,
            "",
            "Link entry above the writing controls.",
            "Layers",
        ),
    ],
} as const;

/** Pure CSS projection, shared by the server layout and design reference. */
export const measurementStyles = () =>
    `:root{${DESIGN_MEASUREMENTS.tokens
        .map(({ css, value, unit }) => `${css}:${value}${unit};`)
        .join("")}}`;
