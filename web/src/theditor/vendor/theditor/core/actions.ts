// Vendored copy; do not edit here. Canonical: theditor (projects/theditor/src/core/actions.ts).
// Refresh with `node projects/theditor/src/scripts/vendor-sync.mjs`; `--check` reports drift.
import type { Editor } from "@tiptap/core";
import { FORMATTING_COPY as copy } from "./copy";
import type { Chord } from "./chords";
import { plainText } from "./plain-text";

export type FormatActionId =
    | "bold"
    | "italic"
    | "code"
    | "link"
    | "heading1"
    | "heading2"
    | "heading3"
    | "heading4"
    | "bulletList"
    | "orderedList"
    | "taskList"
    | "indent"
    | "outdent"
    | "blockquote"
    | "details"
    | "callout"
    | "codeBlock"
    | "horizontalRule"
    | "image"
    | "plainText";

/**
 * One formatting action, as the toolbar shows it and the keyboard reaches
 * it: its name, chord, the shortcut a person can also type, and what
 * it does. The toolbar and the editor's keys read this one list, so a magnet
 * and its chord can never disagree. `run` is absent for Link, which asks
 * for an address first, and for Image, which asks for a picture (the field
 * owns both steps).
 */
export interface FormatAction {
    id: FormatActionId;
    label: string;
    /** What typing does the same, shown in the tooltip ("`*words*`"). */
    typed?: string;
    chord: Chord;
    /** Where the toolbar starts a new group. */
    group: "inline" | "heading" | "list" | "block" | "media" | "clear";
    run?: (editor: Editor) => boolean;
    isActive?: (editor: Editor) => boolean;
    isAvailable?: (editor: Editor) => boolean;
}

/** Commands from a magnet reached by keyboard bring the cursor back to the
 * words; from the words themselves they leave focus alone, since Tiptap's
 * focus() lands a frame later and would take it from the link step. */
const chain = (editor: Editor) =>
    editor.view.hasFocus() ? editor.chain() : editor.chain().focus();

const heading = (level: 1 | 2 | 3 | 4): FormatAction => ({
    id: `heading${level}`,
    label: copy.heading[level - 1],
    typed: `${"#".repeat(level)} `,
    chord: { shape: "block", code: `Digit${level}` },
    group: "heading",
    run: (editor) => chain(editor).toggleHeading({ level }).run(),
    isActive: (editor) => editor.isActive("heading", { level }),
});

export const FORMAT_ACTIONS: readonly FormatAction[] = [
    {
        id: "bold",
        label: copy.bold,
        typed: "*words*",
        chord: { shape: "mod", code: "KeyB" },
        group: "inline",
        run: (editor) => chain(editor).toggleBold().run(),
        isActive: (editor) => editor.isActive("bold"),
    },
    {
        id: "italic",
        label: copy.italic,
        typed: "_words_",
        chord: { shape: "mod", code: "KeyI" },
        group: "inline",
        run: (editor) => chain(editor).toggleItalic().run(),
        isActive: (editor) => editor.isActive("italic"),
    },
    {
        id: "code",
        label: copy.code,
        typed: "`words`",
        chord: { shape: "mod", code: "KeyE" },
        group: "inline",
        run: (editor) => chain(editor).toggleCode().run(),
        isActive: (editor) => editor.isActive("code"),
    },
    {
        id: "link",
        label: copy.link,
        typed: "[words](https://…)",
        chord: { shape: "mod", code: "KeyK" },
        group: "inline",
        isActive: (editor) => editor.isActive("link"),
    },
    heading(1),
    heading(2),
    heading(3),
    heading(4),
    {
        id: "bulletList",
        label: copy.bulletList,
        typed: "- ",
        chord: { shape: "mod-shift", code: "Digit8" },
        group: "list",
        run: (editor) => chain(editor).toggleBulletList().run(),
        isActive: (editor) => editor.isActive("bulletList"),
    },
    {
        id: "orderedList",
        label: copy.orderedList,
        typed: "1. ",
        chord: { shape: "mod-shift", code: "Digit7" },
        group: "list",
        run: (editor) => chain(editor).toggleOrderedList().run(),
        isActive: (editor) => editor.isActive("orderedList"),
    },
    {
        id: "taskList",
        label: copy.taskList,
        typed: "- [ ] ",
        chord: { shape: "mod-shift", code: "Digit9" },
        group: "list",
        run: (editor) => chain(editor).toggleTaskList().run(),
        isActive: (editor) => editor.isActive("taskList"),
    },
    {
        id: "indent",
        label: copy.indent,
        chord: { shape: "mod", code: "BracketRight" },
        group: "block",
        run: (editor) =>
            chain(editor)
                .sinkListItem(
                    editor.isActive("taskItem") ? "taskItem" : "listItem",
                )
                .run(),
        isAvailable: (editor) =>
            editor
                .can()
                .sinkListItem(
                    editor.isActive("taskItem") ? "taskItem" : "listItem",
                ),
    },
    {
        id: "outdent",
        label: copy.outdent,
        chord: { shape: "mod", code: "BracketLeft" },
        group: "block",
        run: (editor) =>
            chain(editor)
                .liftListItem(
                    editor.isActive("taskItem") ? "taskItem" : "listItem",
                )
                .run(),
        isAvailable: (editor) =>
            editor
                .can()
                .liftListItem(
                    editor.isActive("taskItem") ? "taskItem" : "listItem",
                ),
    },
    {
        id: "blockquote",
        label: copy.blockquote,
        typed: "> ",
        chord: { shape: "block", code: "Quote" },
        group: "block",
        run: (editor) => chain(editor).toggleBlockquote().run(),
        isActive: (editor) => editor.isActive("blockquote"),
    },
    {
        id: "details",
        label: copy.details,
        typed: ">v ",
        chord: { shape: "block", code: "KeyT" },
        group: "block",
        run: (editor) => chain(editor).toggleDetails().run(),
        isActive: (editor) => editor.isActive("details"),
    },
    {
        id: "callout",
        label: copy.callout,
        typed: ">! ",
        chord: { shape: "block", code: "KeyC" },
        group: "block",
        run: (editor) => chain(editor).toggleCallout().run(),
        isActive: (editor) => editor.isActive("callout"),
    },
    {
        id: "codeBlock",
        label: copy.codeBlock,
        typed: "```words```",
        chord: { shape: "block", code: "KeyE" },
        group: "block",
        run: (editor) => chain(editor).toggleCodeBlock().run(),
        isActive: (editor) => editor.isActive("codeBlock"),
    },
    {
        id: "horizontalRule",
        label: copy.horizontalRule,
        typed: "--- ",
        chord: { shape: "block", code: "Minus" },
        group: "block",
        run: (editor) => chain(editor).setHorizontalRule().run(),
    },
    {
        id: "image",
        label: copy.image,
        chord: { shape: "block", code: "KeyI" },
        group: "media",
        // A picture goes where words go: not into a code block.
        isAvailable: (editor) => !editor.isActive("codeBlock"),
    },
    {
        id: "plainText",
        label: copy.plainText,
        chord: { shape: "hyper", code: "Backspace" },
        group: "clear",
        run: plainText,
    },
];
