// Vendored copy; do not edit here. Canonical: theditor (projects/theditor/src/core/copy.ts).
// Refresh with `node projects/theditor/src/scripts/vendor-sync.mjs`; `--check` reports drift.
/**
 * theditor's words for its magnets: labels, hints and templates, one source
 * for every renderer (the fork's React chrome re-exports this as
 * `formattingUi` from `@config/strings`; lodeflow's vanilla chrome reads it
 * directly). Moved verbatim from the fork's `config/strings.ts`, 2026-10-24.
 */
export const FORMATTING_COPY = {
    toolbar: "Formatting",
    bold: "Bold",
    italic: "Italic",
    code: "Inline code",
    link: "Link",
    heading: ["Heading 1", "Heading 2", "Heading 3", "Heading 4"],
    bulletList: "Bulleted list",
    orderedList: "Numbered list",
    taskList: "To-do",
    blockquote: "Quote",
    details: "Toggle",
    callout: "Callout",
    codeBlock: "Code block",
    horizontalRule: "Hair line",
    plainText: "Plain text",
    /** `{label}` an action's name, `{typed}` what typing does the same. */
    typedHint: "{label} · or type {typed}",
    plainTextHint:
        "Plain text: clears every format, from the selection or the whole message",
    linkAddress: "Link address",
    linkApply: "Apply",
    linkRemove: "Remove link",
    linkCancel: "Cancel",
    linkInvalid: "Use a web address starting with https:// or http://",
    toggleSummary: "Toggle",
    taskDone: "Done",
    taskOpen: "Not done",
    indent: "Indent",
    outdent: "Outdent",
    image: "Image",
    imageHint: "Image: a picture in the words, a third of their width",
    /** The magnets beside a selected image. */
    imageTools: "Image",
    imageStyle: "Style",
    imageAlignment: "Alignment",
    imageTweak: "Tweak",
    imageLooks: {
        plain: "Plain",
        inset: "Inset",
        floating: "Floating",
        physical: "Printed photo",
    },
    imageAligns: {
        left: "Left",
        center: "Centre",
        right: "Right",
        "wrap-left": "Left, words beside",
        "wrap-right": "Right, words beside",
    },
    /** The kitchen-sink editor. */
    tweakFilter: "Tweak…",
    tweakFilterLabel: "Find a style to tweak",
    tweakNoMatch: "No style matches “{query}”.",
    /** `{name}` a row's name. */
    tweakReset: "Reset {name}",
    tweakDefault: "As the look draws it",
    tweakChoiceNone: "None",
    imageUploading: "Adding the image…",
};

export type FormattingCopy = typeof FORMATTING_COPY;

/** `{name}` placeholders in a template, filled from `values` (an unknown
 * name stays as written). */
export function fillCopy(
    template: string,
    values: Record<string, string>,
): string {
    return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
        name in values ? values[name] : whole,
    );
}
