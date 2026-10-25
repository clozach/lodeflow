// Vendored copy; do not edit here. Canonical: theditor (projects/theditor/src/vanilla/link-step.ts).
// Refresh with `node projects/theditor/src/scripts/vendor-sync.mjs`; `--check` reports drift.
/**
 * The Link magnet's address step in plain DOM: an address field, Apply, and
 * Remove when the cursor is on a link. It covers the toolbar row; Enter
 * applies, and Escape or a press outside goes back to the words (no dismiss
 * button: AGENTS.md § Overlays have no dismiss button). What applying does is
 * the core's (core/link.ts), as in the fork's link bar.
 */
import type { Editor } from "@tiptap/core";
import { FORMATTING_COPY as copy } from "../core/copy";
import { applyLinkAddress, linkStart, removeLink } from "../core/link";
import { h } from "./dom";

const CHECK = '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8.5l3.2 3L13 4.5"/></svg>';
const UNLINK = '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6.5 9.5l-1.8 1.8a2.1 2.1 0 01-3-3L3.5 6.5M9.5 6.5l1.8-1.8a2.1 2.1 0 013 3L12.5 9.5M2 2l12 12"/></svg>';

export function createLinkStep({
    doc,
    editor,
    onClose,
}: {
    doc: Document;
    editor: Editor;
    /** The step is done: back to the words. */
    onClose: () => void;
}): { el: HTMLElement; focus(): void } {
    const hasLink = editor.isActive("link");
    const input = h(doc, "input", {
        type: "url",
        inputmode: "url",
        "aria-label": copy.linkAddress,
        placeholder: "https://",
        autocomplete: "off",
    });
    input.value = linkStart(editor);
    const problem = h(doc, "p", { role: "alert", className: "kk-fm-link-problem", hidden: true }, [copy.linkInvalid]);
    const apply = () => {
        const done = applyLinkAddress(editor, input.value);
        if (done === "invalid") {
            problem.hidden = false;
            input.setAttribute("aria-invalid", "true");
            input.focus();
            return;
        }
        onClose();
    };
    const applyButton = h(doc, "button", {
        type: "button",
        className: "kk-composer-magnet",
        "aria-label": copy.linkApply,
        title: copy.linkApply,
        "aria-keyshortcuts": "Enter",
    });
    applyButton.innerHTML = CHECK;
    applyButton.addEventListener("click", apply);
    const removeButton = hasLink
        ? h(doc, "button", { type: "button", className: "kk-composer-magnet", "aria-label": copy.linkRemove, title: copy.linkRemove })
        : null;
    if (removeButton) {
        removeButton.innerHTML = UNLINK;
        removeButton.addEventListener("click", () => {
            removeLink(editor);
            onClose();
        });
    }
    input.addEventListener("input", () => {
        problem.hidden = true;
        input.removeAttribute("aria-invalid");
    });
    const el = h(doc, "div", { className: "kk-fm-link-bar", role: "group", "aria-label": copy.link }, [input, applyButton, removeButton, problem]);
    for (const button of [applyButton, removeButton]) button?.addEventListener("mousedown", (event) => event.preventDefault());
    el.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && event.target === input) {
            event.preventDefault();
            event.stopPropagation();
            apply();
        } else if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onClose();
        }
    });
    return { el, focus: () => input.focus({ preventScroll: true }) };
}
