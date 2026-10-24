// Vendored copy; do not edit here. Canonical: the swamikk CourseLit fork, https://github.com/clozach/swamikk, apps/web/components/feedback/formatting/doc.ts
// Refresh with `node scripts/sync-theditor.mjs`; `--check` reports drift.
import type { JSONContent } from "@tiptap/core";
import {
    canonicalImageAttrs,
    formattedFromText,
    formattedIsPlain,
    formattedText,
    isFormattedHref,
    parseFormattedDoc,
    type ConversationMessageContent,
    type FormattedBlock,
    type FormattedDoc,
    type FormattedInline,
    type FormattedListItem,
    type FormattedMark,
    type FormattedTaskItem,
} from "./common-models";

/** What a message is made of on its way to the server: its text, and its
 * document when the text alone cannot hold its formatting. */
export interface FormattedWording {
    text: string;
    content?: Extract<ConversationMessageContent, { kind: "formatted" }>;
}

const EMPTY_PARAGRAPH: FormattedBlock = { type: "paragraph" };

function marksOf(marks: JSONContent["marks"]): FormattedMark[] | undefined {
    const kept: FormattedMark[] = [];
    for (const mark of marks || []) {
        if (kept.some((item) => item.type === mark.type)) continue;
        if (
            mark.type === "bold" ||
            mark.type === "italic" ||
            mark.type === "code"
        )
            kept.push({ type: mark.type });
        else if (
            mark.type === "link" &&
            typeof mark.attrs?.href === "string" &&
            isFormattedHref(mark.attrs.href)
        )
            kept.push({ type: "link", attrs: { href: mark.attrs.href } });
    }
    return kept.length ? kept : undefined;
}

function inlineOf(
    content: JSONContent[] | undefined,
): FormattedInline[] | undefined {
    const inline: FormattedInline[] = [];
    for (const node of content || []) {
        if (node.type === "hardBreak") inline.push({ type: "hardBreak" });
        else if (node.type === "image") {
            // Defaults dropped; an image the model refuses is left out.
            const attrs = canonicalImageAttrs(node.attrs);
            if (attrs) inline.push({ type: "image", attrs });
        } else if (node.type === "text" && node.text) {
            const marks = marksOf(node.marks);
            inline.push(
                marks
                    ? { type: "text", text: node.text, marks }
                    : { type: "text", text: node.text },
            );
        }
    }
    return inline.length ? inline : undefined;
}

function blocksOf(content: JSONContent[] | undefined): FormattedBlock[] {
    const blocks = (content || []).flatMap(blockOf);
    return blocks.length ? blocks : [EMPTY_PARAGRAPH];
}

function itemsOf(content: JSONContent[] | undefined): FormattedListItem[] {
    const items = (content || [])
        .filter((item) => item.type === "listItem")
        .map(
            (item): FormattedListItem => ({
                type: "listItem",
                content: blocksOf(item.content),
            }),
        );
    return items.length
        ? items
        : [{ type: "listItem", content: [EMPTY_PARAGRAPH] }];
}

function tasksOf(content: JSONContent[] | undefined): FormattedTaskItem[] {
    const items = (content || [])
        .filter((item) => item.type === "taskItem")
        .map(
            (item): FormattedTaskItem => ({
                type: "taskItem",
                attrs: { checked: item.attrs?.checked === true },
                content: blocksOf(item.content),
            }),
        );
    return items.length
        ? items
        : [
              {
                  type: "taskItem",
                  attrs: { checked: false },
                  content: [EMPTY_PARAGRAPH],
              },
          ];
}

function withInline<T extends { type: string }>(
    block: T,
    content: FormattedInline[] | undefined,
): T & { content?: FormattedInline[] } {
    return content ? { ...block, content } : block;
}

function blockOf(node: JSONContent): FormattedBlock[] {
    switch (node.type) {
        case "paragraph":
            return [
                withInline(
                    { type: "paragraph" as const },
                    inlineOf(node.content),
                ),
            ];
        case "heading": {
            const level = Math.min(
                4,
                Math.max(1, Number(node.attrs?.level) || 1),
            );
            return [
                withInline(
                    {
                        type: "heading" as const,
                        attrs: { level: level as 1 | 2 | 3 | 4 },
                    },
                    inlineOf(node.content),
                ),
            ];
        }
        case "codeBlock": {
            const text = (node.content || [])
                .map((item) => item.text || "")
                .join("");
            return [
                text
                    ? { type: "codeBlock", content: [{ type: "text", text }] }
                    : { type: "codeBlock" },
            ];
        }
        case "horizontalRule":
            return [{ type: "horizontalRule" }];
        case "blockquote":
        case "callout":
            return [{ type: node.type, content: blocksOf(node.content) }];
        case "details": {
            const summary = node.content?.find(
                (item) => item.type === "detailsSummary",
            );
            const body = node.content?.find(
                (item) => item.type === "detailsContent",
            );
            const summaryInline = inlineOf(summary?.content);
            return [
                {
                    type: "details",
                    content: [
                        summaryInline
                            ? { type: "detailsSummary", content: summaryInline }
                            : { type: "detailsSummary" },
                        {
                            type: "detailsContent",
                            content: blocksOf(body?.content),
                        },
                    ],
                },
            ];
        }
        case "bulletList":
            return [{ type: "bulletList", content: itemsOf(node.content) }];
        case "orderedList": {
            const start = Number(node.attrs?.start);
            return [
                {
                    type: "orderedList",
                    attrs: {
                        start:
                            Number.isInteger(start) &&
                            start >= 0 &&
                            start <= 1_000_000
                                ? start
                                : 1,
                    },
                    content: itemsOf(node.content),
                },
            ];
        }
        case "taskList":
            return [{ type: "taskList", content: tasksOf(node.content) }];
        default:
            // Nothing else is in the editor's schema; keep any words it holds.
            return node.content ? node.content.flatMap(blockOf) : [];
    }
}

/** The editor's JSON as the stored model: default attributes dropped, a link
 * to anything but a web address unwrapped to its words. */
export function docFromEditor(json: JSONContent): FormattedDoc {
    const doc: FormattedDoc = { type: "doc", content: blocksOf(json.content) };
    // The model and this conversion are written together; a mismatch is a
    // bug, and the safe fallback is the words alone.
    return parseFormattedDoc(doc) || formattedFromText(formattedText(doc));
}

/** The wording a send or save carries: text alone while it is plain, the
 * text and its document once anything is formatted. */
export function wordingFromDoc(doc: FormattedDoc): FormattedWording {
    const text = formattedText(doc);
    return formattedIsPlain(doc)
        ? { text }
        : { text, content: { kind: "formatted", doc } };
}

/** The document an editor opens with for some saved wording. */
export function docFromWording(
    text: string,
    content?: ConversationMessageContent,
): FormattedDoc {
    return content?.kind === "formatted"
        ? content.doc
        : formattedFromText(text);
}
