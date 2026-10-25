// Vendored copy; do not edit here. Canonical: theditor (projects/theditor/src/core/link.ts).
// Refresh with `node projects/theditor/src/scripts/vendor-sync.mjs`; `--check` reports drift.
/**
 * The Link magnet's address step (⌘K): what the step starts with, and what
 * applying a typed address does. Both renderers' link bars call these.
 */
import type { Editor } from "@tiptap/core";
import { isFormattedHref } from "../../common-models";

/** A link's address as typed: a bare domain gets https://. */
export function linkAddress(typed: string): string {
    const href = typed.trim();
    if (!href) return "";
    return /^[a-z][a-z0-9+.-]*:/i.test(href) ? href : `https://${href}`;
}

/** The address the step opens with: the link under the cursor, if any. */
export const linkStart = (editor: Editor): string =>
    (editor.getAttributes("link").href as string | undefined) || "";

/**
 * Apply what was typed: an empty address removes the link; one the model
 * refuses is `invalid` (the step says so and stays open); otherwise the
 * selected words (or the link under the cursor) link to it, and with nothing
 * selected the address itself is written, linked.
 */
export function applyLinkAddress(
    editor: Editor,
    typed: string,
): "applied" | "removed" | "invalid" {
    const href = linkAddress(typed);
    if (!href) {
        editor.chain().extendMarkRange("link").unsetLink().run();
        return "removed";
    }
    if (!isFormattedHref(href)) return "invalid";
    const { empty } = editor.state.selection;
    if (empty && !editor.isActive("link"))
        editor
            .chain()
            .insertContent({
                type: "text",
                text: href,
                marks: [{ type: "link", attrs: { href } }],
            })
            .unsetMark("link")
            .run();
    else editor.chain().extendMarkRange("link").setLink({ href }).run();
    return "applied";
}

/** Remove the link under the cursor. */
export function removeLink(editor: Editor) {
    editor.chain().extendMarkRange("link").unsetLink().run();
}
