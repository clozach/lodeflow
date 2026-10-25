// Vendored copy; do not edit here. Canonical: theditor (projects/theditor/src/core/plain-text.ts).
// Refresh with `node projects/theditor/src/scripts/vendor-sync.mjs`; `--check` reports drift.
import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import {
    AllSelection,
    TextSelection,
    type Transaction,
} from "@tiptap/pm/state";
import { liftTarget } from "@tiptap/pm/transform";

/**
 * Plain text (⌃⌥⇧⌘⌫, Al 2026-10-04): every format goes, from the whole
 * message when nothing or everything is selected, else from the selection
 * alone. Each touched line becomes a plain paragraph, lifted out of lists,
 * quotes, callouts and toggles (which split around it); a code block's
 * lines become paragraphs; hair lines go; bold, italic, code and links go.
 * The words and the selection stay exactly where they were: both are kept
 * as character offsets, which none of these changes alter.
 */

/** A hard break is one character, as is an inline image (one position, kept
 * by Plain text); a hair line, none. */
const leafText = (node: PMNode) =>
    node.type.name === "hardBreak"
        ? "\n"
        : node.type.name === "image"
          ? "\uFFFC"
          : "";

function offsetAt(doc: PMNode, pos: number): number {
    return doc.textBetween(0, pos, "\n", leafText).length;
}

function totalOffset(doc: PMNode): number {
    return offsetAt(doc, doc.content.size);
}

/** The position of a character offset: the same textblocks, in the same
 * order, before and after, so an offset names the same place. */
function positionAt(doc: PMNode, offset: number): number {
    let remaining = offset;
    let found: number | null = null;
    let first = true;
    let last = 0;
    doc.descendants((node, pos) => {
        if (found !== null) return false;
        if (!node.isTextblock) return true;
        if (!first) remaining -= 1;
        first = false;
        const length = node.textBetween(
            0,
            node.content.size,
            "\n",
            leafText,
        ).length;
        last = pos + 1 + node.content.size;
        if (remaining <= length) {
            found = pos + 1 + Math.max(0, remaining);
            return false;
        }
        remaining -= length;
        return false;
    });
    return found ?? last;
}

/** The textblocks and hair lines that overlap [from, to], document order. */
function touched(doc: PMNode, from: number, to: number) {
    const nodes: { node: PMNode; pos: number }[] = [];
    doc.nodesBetween(from, to, (node, pos) => {
        if (node.isTextblock || node.type.name === "horizontalRule") {
            nodes.push({ node, pos });
            return false;
        }
        return true;
    });
    return nodes;
}

/** Whether a touched node still has a format to lose. */
function formatted(doc: PMNode, node: PMNode, pos: number) {
    return node.type.name !== "paragraph" || doc.resolve(pos).depth > 0;
}

/** One step closer to a top-level plain paragraph. */
function flattenOnce(tr: Transaction, node: PMNode, pos: number) {
    const schema = tr.doc.type.schema;
    const $pos = tr.doc.resolve(pos);
    for (let depth = $pos.depth; depth > 0; depth--) {
        const ancestor = $pos.node(depth);
        if (ancestor.type.name !== "details") continue;
        const blocks: PMNode[] = [
            schema.nodes.paragraph.create(null, ancestor.child(0).content),
        ];
        ancestor.child(1).forEach((block) => blocks.push(block));
        tr.replaceWith($pos.before(depth), $pos.after(depth), blocks);
        return;
    }
    if ($pos.depth > 0) {
        const range = tr.doc
            .resolve(pos)
            .blockRange(tr.doc.resolve(pos + node.nodeSize));
        const target = range && liftTarget(range);
        if (range && target !== null && target !== undefined) {
            tr.lift(range, target);
            return;
        }
        // No clean lift: rebuild the whole top-level block as paragraphs.
        const top = $pos.before(1);
        const block = tr.doc.resolve(pos).node(1);
        tr.replaceWith(top, top + block.nodeSize, paragraphsOf(block, schema));
        return;
    }
    if (node.type.name === "horizontalRule") {
        if (tr.doc.childCount === 1)
            tr.replaceWith(
                pos,
                pos + node.nodeSize,
                schema.nodes.paragraph.create(),
            );
        else tr.delete(pos, pos + node.nodeSize);
        return;
    }
    if (node.type.name === "codeBlock") {
        tr.replaceWith(
            pos,
            pos + node.nodeSize,
            node.textContent
                .split("\n")
                .map((line) =>
                    schema.nodes.paragraph.create(
                        null,
                        line ? schema.text(line) : undefined,
                    ),
                ),
        );
        return;
    }
    tr.setNodeMarkup(pos, schema.nodes.paragraph);
}

function paragraphsOf(
    block: PMNode,
    schema: PMNode["type"]["schema"],
): PMNode[] {
    const paragraphs: PMNode[] = [];
    block.descendants((node) => {
        if (!node.isTextblock) return true;
        if (node.type.name === "codeBlock")
            node.textContent
                .split("\n")
                .forEach((line) =>
                    paragraphs.push(
                        schema.nodes.paragraph.create(
                            null,
                            line ? schema.text(line) : undefined,
                        ),
                    ),
                );
        else paragraphs.push(schema.nodes.paragraph.create(null, node.content));
        return false;
    });
    return paragraphs.length ? paragraphs : [schema.nodes.paragraph.create()];
}

export function plainTextTransaction(editor: Editor): Transaction {
    const { state } = editor;
    const { selection } = state;
    const total = totalOffset(state.doc);
    const anchor = offsetAt(state.doc, selection.anchor);
    const head = offsetAt(state.doc, selection.head);
    const start = Math.min(anchor, head);
    const end = Math.max(anchor, head);
    const everything =
        selection instanceof AllSelection ||
        selection.empty ||
        (start === 0 && end === total);
    const range = everything ? { start: 0, end: total } : { start, end };
    const tr = state.tr;
    // Words picked inside one line lose their marks and keep their line's
    // format; a selection reaching across lines, or a whole line, turns
    // those lines into plain paragraphs.
    const lines = touched(state.doc, selection.from, selection.to).filter(
        ({ node }) => node.isTextblock,
    );
    const wholeLine =
        lines.length === 1 &&
        selection.from <= lines[0].pos + 1 &&
        selection.to >= lines[0].pos + 1 + lines[0].node.content.size;
    const flattenLines = everything || lines.length > 1 || wholeLine;
    for (let guard = 0; flattenLines && guard < 10_000; guard++) {
        const from = positionAt(tr.doc, range.start);
        const to = positionAt(tr.doc, range.end);
        const pending = touched(tr.doc, from, to).filter(({ node, pos }) =>
            formatted(tr.doc, node, pos),
        );
        if (!pending.length) break;
        const { node, pos } = pending[pending.length - 1];
        flattenOnce(tr, node, pos);
    }
    tr.removeMark(
        positionAt(tr.doc, range.start),
        positionAt(tr.doc, range.end),
    );
    tr.setStoredMarks([]);
    tr.setSelection(
        selection instanceof AllSelection
            ? new AllSelection(tr.doc)
            : TextSelection.create(
                  tr.doc,
                  positionAt(tr.doc, anchor),
                  positionAt(tr.doc, head),
              ),
    );
    return tr;
}

export function plainText(editor: Editor): boolean {
    editor.view.dispatch(plainTextTransaction(editor));
    editor.view.focus();
    return true;
}
