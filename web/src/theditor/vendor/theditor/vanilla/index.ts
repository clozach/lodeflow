// Vendored copy; do not edit here. Canonical: theditor (projects/theditor/src/vanilla/index.ts).
// Refresh with `node projects/theditor/src/scripts/vendor-sync.mjs`; `--check` reports drift.
/**
 * theditor's magnets in plain DOM, mounted around one editor: the formatting
 * toolbar (floated MAGNET_GAP above what it formats, revealed just in time),
 * the Link step, and a selected picture's three magnets with the kitchen
 * sink. Everything they do and say comes from the shared core (../core), the
 * same the fork's React chrome reads; this file is only the wiring.
 *
 * Keyboard: Tab from the words enters the toolbar (one Tab stop; ← → between
 * magnets), Tab again the picture's magnets when shown, then the words; ⇧Tab
 * goes back. Escape climbs one rung at a time (lozenge → toolbar → words).
 * ⌘Z is the editor's own history: every magnet writes through the editor.
 */
import type { Editor } from "@tiptap/core";
import { selectedImage } from "../../extensions";
import type { FormatAction } from "../core/actions";
import { consumeFormattingEscape } from "../core/dismiss";
import { fixedLayerBounds, placeFixedLayer } from "../core/fixed-layer";
import { editorChord } from "../core/keys";
import { toolbarPlacement } from "../core/toolbar";
import type { VisibleBounds } from "../core/lozenge-layout";
import { activeIn, h, type Skin } from "./dom";
import { createImageTools } from "./image-tools";
import { createLinkStep } from "./link-step";
import { createToolbar } from "./toolbar";

export { HOST_CSS } from "./host-css";
export { FIELD_CSS } from "./bloom-tuner";
export type { Skin } from "./dom";

export interface MagnetsOptions {
    editor: Editor;
    /** Where the fixed layers mount: a shadow root, or the page's body. */
    layer: Node & ParentNode;
    /** The painted box the toolbar floats above (a node, a field). */
    anchor: () => HTMLElement | null;
    /** The host's own floating controls, which the toolbar keeps clear of. */
    avoid?: () => readonly DOMRect[];
    skin: Skin;
    /** Choose a picture to add at the cursor; absent: no Image column. */
    pickImage?: () => void;
    /** The host is drawn dark now (the shared stylesheets' `.dark`). */
    dark?: () => boolean;
    /** What the image tools may paint in (default: the surface that clips it). */
    visibleBounds?: VisibleBounds;
    /** Focus left the words and every magnet. */
    onLeave?: () => void;
}

export interface Magnets {
    root: HTMLElement;
    /** A key from the words, before the editor's own keymap: true when a
     * magnet took it (a chord, or Tab into the toolbar). */
    handleEditorKey(event: KeyboardEvent): boolean;
    /** `node` is one of the magnets (focus moving there keeps editing). */
    contains(node: Node | null): boolean;
    destroy(): void;
}

const MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || "");

export function mountMagnets(options: MagnetsOptions): Magnets {
    const { editor, layer, anchor, avoid, skin, pickImage, dark, visibleBounds, onLeave } = options;
    const doc = editor.view.dom.ownerDocument;
    const win = doc.defaultView!;
    const root = h(doc, "div", { className: "kk-theditor", "data-feedback-ui": true });
    const focusEditor = () => editor.view.focus();

    let disposed = false;
    let leaveFrame = 0;
    let linkOpen = false;
    const closeLink = (restoreFocus = true) => {
        if (!linkOpen) return;
        linkOpen = false;
        toolbar.setLinkStep(null);
        if (restoreFocus) focusEditor();
    };
    const openLink = () => {
        const step = createLinkStep({ doc, editor, onClose: () => closeLink(true) });
        linkOpen = true;
        toolbar.setLinkStep(step.el);
        step.focus();
    };
    /** What a magnet or its chord does: its own command, the Link step, or
     * the host's picture picker. */
    const trigger = (action: FormatAction) => {
        if (action.run) return action.run(editor);
        if (action.id === "image") {
            if (!pickImage || (action.isAvailable && !action.isAvailable(editor))) return false;
            pickImage();
            return true;
        }
        openLink();
        return true;
    };

    const toolbar = createToolbar({
        doc,
        editor,
        images: !!pickImage,
        skin,
        onAction: trigger,
        onDismissLink: (restore) => closeLink(restore),
    });
    const imageTools = createImageTools({ doc, editor, skin, visibleBounds, onFocusEditor: focusEditor, focusWithin: () => !!activeIn(root) && root.contains(activeIn(root)) });
    root.append(toolbar.el, imageTools.el);
    layer.appendChild(root);

    // Just in time: the row shows for a selection, the pointer or the keyboard.
    let pointerIn = false;
    toolbar.el.addEventListener("pointerenter", () => (pointerIn = true));
    toolbar.el.addEventListener("pointerleave", () => (pointerIn = false));
    const holds = (el: HTMLElement) => {
        const active = activeIn(el);
        return !!active && el.contains(active);
    };
    const reveal = () => {
        const selected = editor.view.hasFocus() && !editor.state.selection.empty;
        const shown = selected || pointerIn || holds(toolbar.el) || toolbar.expanded();
        toolbar.el.dataset.revealed = String(shown);
    };

    let frame = 0;
    const place = () => {
        const box = anchor();
        if (box && box.isConnected) {
            const rect = box.getBoundingClientRect();
            const dock = toolbar.el;
            const at = toolbarPlacement({ anchor: rect, width: dock.offsetWidth, height: dock.offsetHeight, screen: fixedLayerBounds(dock), avoid: avoid?.() });
            dock.dataset.edge = at.edge;
            placeFixedLayer(dock, at.x, at.y);
        }
        root.classList.toggle("dark", !!dark?.());
        reveal();
        frame = win.requestAnimationFrame(place);
    };
    place();

    const refresh = () => {
        toolbar.refresh();
        imageTools.refresh();
        reveal();
    };
    root.addEventListener("focusin", refresh);
    editor.on("transaction", refresh);
    editor.on("focus", refresh);
    editor.on("blur", refresh);

    // The chords' badges show while ⌘ (Ctrl off the Mac) is held on its own.
    const modifier = (event: KeyboardEvent) => (MAC ? event.key === "Meta" : event.key === "Control");
    const keysDown = (event: KeyboardEvent) => {
        if (modifier(event)) root.dataset.kkKeys = "shown";
        else delete root.dataset.kkKeys;
    };
    const keysUp = () => delete root.dataset.kkKeys;
    doc.addEventListener("keydown", keysDown, true);
    doc.addEventListener("keyup", keysUp, true);
    win.addEventListener("blur", keysUp);

    const stops = () => [toolbar.row, ...(imageTools.visible() ? [imageTools.el] : [])];
    root.addEventListener("keydown", (event) => {
        if (event.defaultPrevented) {
            event.stopPropagation();
            return;
        }
        if (event.key === "Escape" && holds(toolbar.el)) {
            // The toolbar's rung: back to the words.
            event.preventDefault();
            focusEditor();
        } else if (event.key === "Tab" && !event.metaKey && !event.ctrlKey && !event.altKey) {
            // A link bar and the kitchen sink are forms. Traverse their actual
            // visible fields/buttons before moving to the next tools surface.
            const active = activeIn(root) as HTMLElement | null;
            const form = active?.closest<HTMLElement>(".kk-fm-link-bar, .kk-fm-sink");
            if (form) {
                const fields = Array.from(form.querySelectorAll<HTMLElement>(
                    'input:not([disabled]):not([type="hidden"]), select:not([disabled]), button:not([disabled]), textarea:not([disabled]), [tabindex="0"]',
                )).filter((field) => field.tabIndex >= 0 && field.getClientRects().length && win.getComputedStyle(field).visibility !== "hidden");
                const next = fields.indexOf(active!) + (event.shiftKey ? -1 : 1);
                if (next >= 0 && next < fields.length) {
                    event.preventDefault();
                    event.stopPropagation();
                    fields[next].focus({ preventScroll: true });
                    return;
                }
            }
            // The magnets' Tab stops, then the words again (a contained cycle).
            const list = stops();
            const at = list.findIndex((el) => holds(el));
            const next = at + (event.shiftKey ? -1 : 1);
            event.preventDefault();
            if (next < 0 || next >= list.length) focusEditor();
            else if (list[next] === toolbar.row) toolbar.focus();
            else imageTools.focus();
        }
        // Keys in the magnets are theirs: none reach the host's shortcuts.
        event.stopPropagation();
    });
    root.addEventListener("pointerdown", (event) => event.stopPropagation());
    root.addEventListener("focusout", (event) => {
        const next = event.relatedTarget as Node | null;
        if (next && (root.contains(next) || editor.view.dom.contains(next))) return;
        // Focus left for nowhere in particular (a press outside): the host decides.
        win.cancelAnimationFrame(leaveFrame);
        leaveFrame = win.requestAnimationFrame(() => {
            if (disposed || editor.isDestroyed) return;
            if (!holds(root) && !editor.view.hasFocus()) onLeave?.();
        });
    });

    const listItem = () => (editor.isActive("taskItem") ? "taskItem" : "listItem");
    return {
        root,
        handleEditorKey(event) {
            if (event.isComposing) return false;
            // An open lozenge or link step takes Escape before the host does.
            if (consumeFormattingEscape(event, root)) return true;
            if (event.key === "Tab" && !event.metaKey && !event.ctrlKey && !event.altKey) {
                // A list line indents and outdents with Tab, as it always has.
                if (event.shiftKey ? editor.can().liftListItem(listItem()) : editor.can().sinkListItem(listItem())) return false;
                event.preventDefault();
                if (event.shiftKey && imageTools.visible()) imageTools.focus();
                else toolbar.focus();
                return true;
            }
            const chord = editorChord(event, { imageSelected: !!selectedImage(editor.state.selection) });
            if (!chord) return false;
            event.preventDefault();
            if (chord.kind === "image") imageTools.open(chord.tool);
            else trigger(chord.action);
            refresh();
            return true;
        },
        contains: (node) => !!node && root.contains(node),
        destroy() {
            disposed = true;
            win.cancelAnimationFrame(leaveFrame);
            win.cancelAnimationFrame(frame);
            editor.off("transaction", refresh);
            editor.off("focus", refresh);
            editor.off("blur", refresh);
            doc.removeEventListener("keydown", keysDown, true);
            doc.removeEventListener("keyup", keysUp, true);
            win.removeEventListener("blur", keysUp);
            toolbar.destroy();
            imageTools.destroy();
            root.remove();
        },
    };
}
