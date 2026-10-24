// Vendored copy; do not edit here. Canonical: the swamikk CourseLit fork, https://github.com/clozach/swamikk, apps/web/components/feedback/formatting/extensions.ts
// Refresh with `node scripts/sync-theditor.mjs`; `--check` reports drift.
import {
    Extension,
    InputRule,
    markInputRule,
    markPasteRule,
    mergeAttributes,
    Node,
    textblockTypeInputRule,
    wrappingInputRule,
    type AnyExtension,
} from "@tiptap/core";
import { Fragment, type Node as PMNode } from "@tiptap/pm/model";
import {
    NodeSelection,
    Plugin,
    PluginKey,
    TextSelection,
    type EditorState,
    type Transaction,
} from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import Blockquote from "@tiptap/extension-blockquote";
import Bold, {
    starInputRegex as doubleStarInput,
    starPasteRegex as doubleStarPaste,
} from "@tiptap/extension-bold";
import Code from "@tiptap/extension-code";
import CodeBlock from "@tiptap/extension-code-block";
import Document from "@tiptap/extension-document";
import HardBreak from "@tiptap/extension-hard-break";
import Heading from "@tiptap/extension-heading";
import HorizontalRule from "@tiptap/extension-horizontal-rule";
import Italic, {
    underscoreInputRegex,
    underscorePasteRegex,
} from "@tiptap/extension-italic";
import Link from "@tiptap/extension-link";
import {
    BulletList,
    ListItem,
    ListKeymap,
    OrderedList,
    TaskItem,
    TaskList,
} from "@tiptap/extension-list";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import { Dropcursor, Gapcursor, UndoRedo } from "@tiptap/extensions";
import {
    canonicalImageAttrs,
    FORMATTED_IMAGE_DEFAULTS,
    isFormattedHref,
    isFormattedImageSrc,
    type FormattedImageAttrs,
} from "./common-models";
import { imageElementAttributes, imageSpanAttributes } from "./image-css";

declare module "@tiptap/core" {
    interface Commands<ReturnType> {
        formattedBlocks: {
            /** Wrap the current blocks in a toggle (its first line becomes
             * the summary), or unwrap the toggle the cursor is in. */
            toggleDetails: () => ReturnType;
            toggleCallout: () => ReturnType;
            /** The block control on the cursor's line (Al, 2026-10-24):
             * ticks or unticks its to-do, or closes or opens its toggle.
             * False on a line with neither. No chord here: a host binds it
             * (⌘↩ in tools that embed theditor; the composer keeps ⌘↩ for
             * send). */
            toggleBlockControl: () => ReturnType;
        };
        formattedImage: {
            /** An inline image at the cursor; the cursor stays after it, so
             * the next one joins the row. */
            setImage: (attrs: FormattedImageAttrs) => ReturnType;
            /** Change the selected image's attributes, keeping it selected
             * (one step ⌘Z takes back). */
            updateImageAttrs: (
                patch: Partial<FormattedImageAttrs>,
            ) => ReturnType;
        };
    }
}

/** `*words*` → bold (Al, 2026-10-04); `**words**` too. */
const singleStarInput = /(?:^|\s)(\*(?!\s+\*)((?:[^*]+))\*(?!\s+\*))$/;
/** ```words``` in a line → those words as a code block. */
const fencedPairInput = /```([^`\n]+)```$/;
/** `[words](https://…)` → a link on the words. */
const markdownLinkInput = /\[([^\]\n]+)\]\(([^()\s]+)\)$/;
/** `<https://…>` → the address, linked. */
const angleLinkInput = /<(https?:\/\/[^\s<>]+)>$/;
/** `- [ ] ` / `- [x] ` (the bullet already typed) or `[ ] ` → a to-do. */
const taskInput = /^\s*\[([ xX])?\]\s$/;
/** `--- ` (space) → a hair line; `—-` covers a smart dash. */
const hairLineInput = /^(?:---|—-|–-)\s$/;
/** `" ` → a quote, beside the usual `> `. */
const quoteMarkInput = /^\s*["“]\s$/;
/** ``` then a space at a line's start → a code block for several lines.
 * (Tiptap's own rule also reads a language, ```js , which would swallow
 * the first word of a ```words``` pair.) */
const fenceLineInput = /^```\s$/;
/** `>v ` → a toggle; `>! ` → a callout. */
const toggleInput = /^\s*>[vV]\s$/;
const calloutInput = /^\s*>!\s$/;

/** The default chords that would shadow the conversation's own (⌥⌘1–3
 * marks, ⌥⌘C Copy prompt, ⌘↩ send) or a formatting chord's new home. */
const DROPPED_CHORD = /Alt|Mod-Shift|Shift-Mod|Mod-Enter/;

function keepingOwnChords<T extends AnyExtension>(extension: T): T {
    return extension.extend({
        addKeyboardShortcuts() {
            const inherited = this.parent?.() || {};
            return Object.fromEntries(
                Object.entries(inherited).filter(
                    ([chord]) => !DROPPED_CHORD.test(chord),
                ),
            );
        },
    }) as T;
}

/** Replace a toggle with its summary as a paragraph and its contents after,
 * leaving the cursor where the summary's words begin. */
function unwrapDetails(tr: Transaction, pos: number, details: PMNode) {
    const schema = tr.doc.type.schema;
    const [summary, body] = [details.child(0), details.child(1)];
    const blocks: PMNode[] = [
        schema.nodes.paragraph.create(null, summary.content),
    ];
    body.forEach((block) => blocks.push(block));
    tr.replaceWith(pos, pos + details.nodeSize, blocks);
    tr.setSelection(TextSelection.create(tr.doc, pos + 1));
}

const DetailsSummary = Node.create({
    name: "detailsSummary",
    content: "inline*",
    defining: true,
    isolating: true,
    selectable: false,
    parseHTML: () => [
        { tag: 'div[data-type="details-summary"]' },
        { tag: "summary" },
    ],
    renderHTML: ({ HTMLAttributes }) => [
        "div",
        mergeAttributes(HTMLAttributes, {
            "data-type": "details-summary",
            class: "kk-fm-summary",
        }),
        0,
    ],
});

const DetailsContent = Node.create({
    name: "detailsContent",
    content: "block+",
    defining: true,
    isolating: true,
    selectable: false,
    parseHTML: () => [{ tag: 'div[data-type="details-content"]' }],
    renderHTML: ({ HTMLAttributes }) => [
        "div",
        mergeAttributes(HTMLAttributes, {
            "data-type": "details-content",
            class: "kk-fm-details-content",
        }),
        0,
    ],
});

/** Which toggles are closed in this editor, by position. View state, as
 * the thread's own <details> is: never in the document, the stored message
 * or its undo history, so every toggle opens again on the next load. */
const closedDetailsKey = new PluginKey<readonly number[]>(
    "formattedClosedDetails",
);

/** Where a toggle's contents start and end. */
function detailsContentRange(details: PMNode, pos: number) {
    const from = pos + 1 + details.child(0).nodeSize;
    return { from, to: from + details.child(1).nodeSize };
}

export function closedDetails(state: EditorState): readonly number[] {
    return closedDetailsKey.getState(state) || [];
}

/** Keeps the closed toggles' positions through edits and hides their
 * contents. A selection that reaches inside a closed toggle opens it, so
 * nothing being written stays hidden. */
function closedDetailsPlugin() {
    return new Plugin<readonly number[]>({
        key: closedDetailsKey,
        state: {
            init: () => [],
            apply(tr, closed, _old, state) {
                const flip = tr.getMeta(closedDetailsKey) as number | undefined;
                if (flip === undefined && !closed.length) return closed;
                let next = closed.flatMap((pos) => {
                    const mapped = tr.mapping.mapResult(pos);
                    return mapped.deleted ? [] : [mapped.pos];
                });
                if (flip !== undefined)
                    next = next.includes(flip)
                        ? next.filter((pos) => pos !== flip)
                        : [...next, flip];
                const { from, to } = state.selection;
                return Array.from(new Set(next)).filter((pos) => {
                    const node = state.doc.nodeAt(pos);
                    if (node?.type.name !== "details") return false;
                    const contents = detailsContentRange(node, pos);
                    return !(to > contents.from && from < contents.to);
                });
            },
        },
        props: {
            decorations(state) {
                const closed = closedDetails(state);
                if (!closed.length) return null;
                return DecorationSet.create(
                    state.doc,
                    closed.flatMap((pos) => {
                        const node = state.doc.nodeAt(pos);
                        if (!node) return [];
                        const contents = detailsContentRange(node, pos);
                        return [
                            Decoration.node(pos, pos + node.nodeSize, {
                                "data-open": "false",
                            }),
                            Decoration.node(contents.from, contents.to, {
                                style: "display: none",
                            }),
                        ];
                    }),
                );
            },
        },
    });
}

/** A toggle: a summary line and what it opens to. In the editor it starts
 * open, so nothing being written is hidden; toggleBlockControl closes it. */
const Details = Node.create({
    name: "details",
    // Its Enter and Backspace answer before the editor's general ones.
    priority: 200,
    group: "block",
    content: "detailsSummary detailsContent",
    defining: true,
    parseHTML: () => [{ tag: 'div[data-type="details"]' }],
    renderHTML: ({ HTMLAttributes }) => [
        "div",
        mergeAttributes(HTMLAttributes, {
            "data-type": "details",
            class: "kk-fm-details",
        }),
        0,
    ],
    addCommands() {
        return {
            toggleDetails:
                () =>
                ({ state, tr, dispatch }) => {
                    const { $from, $to } = state.selection;
                    for (let depth = $from.depth; depth > 0; depth--) {
                        const node = $from.node(depth);
                        if (node.type.name !== this.name) continue;
                        if (dispatch)
                            unwrapDetails(tr, $from.before(depth), node);
                        return true;
                    }
                    const range = $from.blockRange($to);
                    if (!range) return false;
                    const nodes: PMNode[] = [];
                    for (
                        let index = range.startIndex;
                        index < range.endIndex;
                        index++
                    )
                        nodes.push(range.parent.child(index));
                    const [first, ...rest] = nodes;
                    const titled =
                        first.isTextblock && first.type.name !== "codeBlock";
                    const schema = state.schema;
                    const summary = schema.nodes.detailsSummary.create(
                        null,
                        titled ? first.content : Fragment.empty,
                    );
                    const body = titled ? rest : nodes;
                    const details = schema.nodes.details.create(null, [
                        summary,
                        schema.nodes.detailsContent.create(
                            null,
                            body.length
                                ? body
                                : schema.nodes.paragraph.create(),
                        ),
                    ]);
                    if (
                        !range.parent.canReplace(
                            range.startIndex,
                            range.endIndex,
                            Fragment.from(details),
                        )
                    )
                        return false;
                    if (dispatch) {
                        tr.replaceWith(range.start, range.end, details);
                        tr.setSelection(
                            TextSelection.create(
                                tr.doc,
                                range.start + 2 + summary.content.size,
                            ),
                        );
                    }
                    return true;
                },
            toggleBlockControl:
                () =>
                ({ state, tr, dispatch }) => {
                    const { $from, to } = state.selection;
                    for (let depth = $from.depth; depth > 0; depth--) {
                        const node = $from.node(depth);
                        const pos = $from.before(depth);
                        // A bullet or numbered line has no control of its
                        // own, and never reaches its parent's.
                        if (node.type.name === "listItem") return false;
                        if (node.type.name === "taskItem") {
                            if (dispatch)
                                tr.setNodeAttribute(
                                    pos,
                                    "checked",
                                    !node.attrs.checked,
                                );
                            return true;
                        }
                        if (node.type.name !== this.name) continue;
                        if (dispatch) {
                            tr.setMeta(closedDetailsKey, pos);
                            const closing = !closedDetails(state).includes(pos);
                            // Closing from inside: the cursor waits at the
                            // summary's end, not in hidden contents.
                            if (
                                closing &&
                                to > detailsContentRange(node, pos).from
                            )
                                tr.setSelection(
                                    TextSelection.create(
                                        tr.doc,
                                        pos + 2 + node.child(0).content.size,
                                    ),
                                );
                        }
                        return true;
                    }
                    return false;
                },
        };
    },
    addProseMirrorPlugins() {
        return [closedDetailsPlugin()];
    },
    addKeyboardShortcuts() {
        return {
            // Enter on the summary opens its first line.
            Enter: ({ editor }) => {
                const { $from, empty } = editor.state.selection;
                if (!empty || $from.parent.type.name !== "detailsSummary")
                    return false;
                const details = $from.node(-1);
                const start = $from.before(-1);
                const contentStart = start + 1 + details.child(0).nodeSize + 1;
                return editor.commands.setTextSelection(contentStart + 1);
            },
            // Backspace at the start of the summary is the way back out.
            Backspace: ({ editor }) => {
                const { $from, empty } = editor.state.selection;
                if (
                    !empty ||
                    $from.parent.type.name !== "detailsSummary" ||
                    $from.parentOffset !== 0
                )
                    return false;
                return editor.commands.toggleDetails();
            },
        };
    },
    addInputRules() {
        return [
            new InputRule({
                find: toggleInput,
                handler: ({ range, chain }) => {
                    chain().deleteRange(range).toggleDetails().run();
                },
            }),
        ];
    },
});

/** A callout: a highlighted box, like a quote that asks to be noticed. */
const Callout = Node.create({
    name: "callout",
    group: "block",
    content: "block+",
    defining: true,
    parseHTML: () => [{ tag: 'aside[data-type="callout"]' }],
    renderHTML: ({ HTMLAttributes }) => [
        "aside",
        mergeAttributes(HTMLAttributes, {
            "data-type": "callout",
            class: "kk-fm-callout",
        }),
        0,
    ],
    addCommands() {
        return {
            toggleCallout:
                () =>
                ({ commands }) =>
                    commands.toggleWrap(this.name),
        };
    },
    addInputRules() {
        return [wrappingInputRule({ find: calloutInput, type: this.type })];
    },
});

/** The selected inline image and its position, if the selection is one. */
export function selectedImage(selection: unknown) {
    return selection instanceof NodeSelection &&
        selection.node.type.name === "image"
        ? { node: selection.node, pos: selection.from }
        : null;
}

/** The node's attributes as the model stores them (defaults dropped), or
 * null when something in them is not one the model names. */
export function storedImageAttrs(attrs: Record<string, unknown>) {
    return canonicalImageAttrs({
        src: attrs.src,
        alt: attrs.alt,
        width: attrs.width,
        align: attrs.align,
        look: attrs.look,
        style: attrs.style,
    });
}

/** Attributes read from pasted or copied HTML: the wrapper span this editor
 * writes, or a bare <img>. A source the model refuses makes no image. */
function imageFromElement(element: HTMLElement) {
    const img =
        element.tagName === "IMG"
            ? element
            : element.querySelector<HTMLImageElement>("img");
    const src = img?.getAttribute("src") || "";
    if (!isFormattedImageSrc(src)) return false;
    const width = parseFloat(
        element.style?.getPropertyValue("--kk-fm-image-width") || "",
    );
    const overrides = (element.getAttribute("style") || "")
        .split(";")
        .filter((part) => part.trim() && !part.trim().startsWith("--"))
        .join(";");
    const attrs = canonicalImageAttrs({
        src,
        alt: img?.getAttribute("alt") || "",
        ...(element.tagName === "IMG"
            ? {}
            : {
                  width: Number.isFinite(width) ? width : undefined,
                  align: element.dataset.align,
                  look: element.dataset.look,
                  style: overrides,
              }),
    });
    // A pasted wrapper with something the model refuses keeps its picture.
    const kept = attrs || canonicalImageAttrs({ src, alt: "" });
    return kept ? { ...FORMATTED_IMAGE_DEFAULTS, ...kept } : false;
}

/** An inline image (Al, 2026-10-23): a round-rect thumb proportional to the
 * original, a third of the text's width by default; three share a row. */
const FormattedImageNode = Node.create({
    name: "image",
    inline: true,
    group: "inline",
    atom: true,
    draggable: true,
    selectable: true,
    addAttributes() {
        // Read from HTML by the node's own rule (imageFromElement), never
        // attribute by attribute: the span's whole `style` is not the
        // overrides, and its `width` is not the image's.
        const plain = (name: keyof typeof FORMATTED_IMAGE_DEFAULTS) => ({
            default: FORMATTED_IMAGE_DEFAULTS[name],
            rendered: false,
            parseHTML: () => null,
        });
        return {
            src: { default: "", rendered: false, parseHTML: () => null },
            alt: plain("alt"),
            width: plain("width"),
            align: plain("align"),
            look: plain("look"),
            style: plain("style"),
        };
    },
    parseHTML() {
        return [
            {
                tag: "span.kk-fm-image",
                getAttrs: (element) => imageFromElement(element as HTMLElement),
            },
            {
                tag: "img[src]",
                getAttrs: (element) => imageFromElement(element as HTMLElement),
            },
        ];
    },
    renderHTML({ node }) {
        const attrs = storedImageAttrs(node.attrs) || {
            src: "",
        };
        return [
            "span",
            imageSpanAttributes(attrs),
            ["img", imageElementAttributes(attrs)],
        ];
    },
    renderText: ({ node }) => `![${node.attrs.alt || ""}]`,
    addCommands() {
        return {
            setImage:
                (attrs) =>
                ({ commands }) => {
                    const stored = canonicalImageAttrs(attrs);
                    if (!stored) return false;
                    return commands.insertContent({
                        type: this.name,
                        attrs: { ...FORMATTED_IMAGE_DEFAULTS, ...stored },
                    });
                },
            updateImageAttrs:
                (patch) =>
                ({ state, tr, dispatch }) => {
                    const image = selectedImage(state.selection);
                    if (!image) return false;
                    const next = canonicalImageAttrs({
                        ...image.node.attrs,
                        ...patch,
                    });
                    if (!next) return false;
                    if (dispatch) {
                        const full: Record<string, unknown> = {
                            ...FORMATTED_IMAGE_DEFAULTS,
                            ...next,
                        };
                        for (const [key, value] of Object.entries(full))
                            if (image.node.attrs[key] !== value)
                                tr.setNodeAttribute(image.pos, key, value);
                    }
                    return true;
                },
        };
    },
});

/** The rules that read a line's start or a closing delimiter and format
 * what was typed: the parts no single extension owns. */
const TypedShortcuts = Extension.create({
    name: "formattedTypedShortcuts",
    addInputRules() {
        const { schema } = this.editor;
        const link = schema.marks.link;
        const linkedText = (text: string, href: string) =>
            schema.text(text, [link.create({ href })]);
        return [
            new InputRule({
                find: markdownLinkInput,
                handler: ({ state, range, match }) => {
                    if (!isFormattedHref(match[2])) return null;
                    state.tr
                        .replaceWith(
                            range.from,
                            range.to,
                            linkedText(match[1], match[2]),
                        )
                        .removeStoredMark(link);
                },
            }),
            new InputRule({
                find: angleLinkInput,
                handler: ({ state, range, match }) => {
                    if (!isFormattedHref(match[1])) return null;
                    state.tr
                        .replaceWith(
                            range.from,
                            range.to,
                            linkedText(match[1], match[1]),
                        )
                        .removeStoredMark(link);
                },
            }),
            new InputRule({
                find: fencedPairInput,
                handler: ({ state, range, match }) => {
                    const { tr } = state;
                    const $start = tr.doc.resolve(range.from);
                    if ($start.parent.type.name !== "paragraph") return null;
                    tr.delete(range.from, range.to);
                    let at = range.from;
                    if ($start.parentOffset > 0) {
                        tr.split(at);
                        at += 2;
                    }
                    tr.setBlockType(at, at, schema.nodes.codeBlock);
                    tr.insertText(match[1], at);
                    tr.setSelection(
                        TextSelection.create(tr.doc, at + match[1].length),
                    );
                },
            }),
            new InputRule({
                find: taskInput,
                handler: ({ state, range, match, chain }) => {
                    const checked = (match[1] || "").toLowerCase() === "x";
                    const $from = state.doc.resolve(range.from);
                    const item =
                        $from.depth >= 2 ? $from.node(-1).type.name : "";
                    // Already a to-do: the brackets set its box, nothing more.
                    if (item === "taskItem") {
                        chain()
                            .deleteRange(range)
                            .updateAttributes("taskItem", { checked })
                            .run();
                        return;
                    }
                    const bulleted =
                        item === "listItem" &&
                        $from.node(-2).type.name === "bulletList";
                    let steps = chain().deleteRange(range);
                    if (bulleted) steps = steps.liftListItem("listItem");
                    steps
                        .toggleList("taskList", "taskItem")
                        .updateAttributes("taskItem", { checked })
                        .run();
                },
            }),
            new InputRule({
                find: hairLineInput,
                handler: ({ range, chain }) => {
                    chain().deleteRange(range).setHorizontalRule().run();
                },
            }),
        ];
    },
});

const FormattedBold = Bold.extend({
    addInputRules() {
        return [
            markInputRule({ find: doubleStarInput, type: this.type }),
            markInputRule({ find: singleStarInput, type: this.type }),
        ];
    },
    addPasteRules() {
        return [markPasteRule({ find: doubleStarPaste, type: this.type })];
    },
});

const FormattedItalic = Italic.extend({
    addInputRules() {
        return [markInputRule({ find: underscoreInputRegex, type: this.type })];
    },
    addPasteRules() {
        return [markPasteRule({ find: underscorePasteRegex, type: this.type })];
    },
});

const FormattedBlockquote = keepingOwnChords(Blockquote).extend({
    addInputRules() {
        return [
            ...(this.parent?.() || []),
            wrappingInputRule({ find: quoteMarkInput, type: this.type }),
        ];
    },
});

const FormattedCodeBlock = keepingOwnChords(CodeBlock).extend({
    addInputRules() {
        return [
            textblockTypeInputRule({ find: fenceLineInput, type: this.type }),
        ];
    },
});

const FormattedTaskItem = TaskItem.extend({
    // The to-do rule is TypedShortcuts', so `- [ ] ` converts a bullet.
    addInputRules: () => [],
});

/** The horizontal rule's own `---` rule fires on the third dash; ours waits
 * for the space, as every other line-start shortcut does. */
const FormattedHorizontalRule = HorizontalRule.extend({
    addInputRules: () => [],
});

/** Everything the formatted message editor understands, and nothing more:
 * the stored model (common-models/formatted-message) names the same set. */
export function formattedExtensions(): AnyExtension[] {
    return [
        Document,
        keepingOwnChords(Paragraph),
        Text,
        keepingOwnChords(HardBreak),
        FormattedBold,
        FormattedItalic,
        Code,
        // Pasting an address onto words links them (linkOnPaste). Tiptap's
        // paste rule, which links addresses inside pasted text, is off: it
        // linked part of an address glued to a word, and the thread links
        // every bare address anyway.
        Link.extend({ addPasteRules: () => [] }).configure({
            openOnClick: false,
            autolink: false,
            linkOnPaste: true,
            defaultProtocol: "https",
            HTMLAttributes: { target: null, rel: null, class: "kk-fm-link" },
            isAllowedUri: (url) => isFormattedHref(url),
            shouldAutoLink: (url) => isFormattedHref(url),
        }),
        keepingOwnChords(Heading).configure({ levels: [1, 2, 3, 4] }),
        FormattedBlockquote,
        FormattedCodeBlock.configure({ enableTabIndentation: false }),
        FormattedHorizontalRule,
        keepingOwnChords(BulletList),
        keepingOwnChords(OrderedList),
        ListItem,
        keepingOwnChords(TaskList),
        FormattedTaskItem.configure({ nested: true }),
        ListKeymap,
        Details,
        DetailsSummary,
        DetailsContent,
        Callout,
        FormattedImageNode,
        TypedShortcuts,
        UndoRedo,
        Dropcursor,
        Gapcursor,
    ];
}
