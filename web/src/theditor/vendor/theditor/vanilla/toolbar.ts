// Vendored copy; do not edit here. Canonical: theditor (projects/theditor/src/vanilla/toolbar.ts).
// Refresh with `node projects/theditor/src/scripts/vendor-sync.mjs`; `--check` reports drift.
/**
 * The formatting toolbar in plain DOM, over the same core as the fork's
 * React toolbar (core/toolbar.ts): the permanent row of anchors, one Tab
 * stop, ← → between magnets, ↑ ↓ along an open column, each column's choices
 * in a lozenge pinned over its anchor, out of flow, so revealing them moves
 * nothing. A magnet names its action, says what typing does the same in its
 * tooltip, and carries its chord.
 */
import type { Editor } from "@tiptap/core";
import type { FormatAction } from "../core/actions";
import { FORMATTING_COPY as copy } from "../core/copy";
import { FORMAT_ICONS, ORDERED_LIST_LINES, orderedListIcon } from "../core/icons";
import { actionAvailable } from "../core/keys";
import {
    actionTitle,
    closeGroup,
    groupOf,
    revealGroup,
    toolbarKey,
    toolbarLayout,
    type ToolbarState,
} from "../core/toolbar";
import { activeIn, badge, h, keyshortcuts, type Skin } from "./dom";
import { createLozenge, type Lozenge } from "./lozenge";

export interface Toolbar {
    /** The writing-tools dock that holds the row (a fixed layer). */
    el: HTMLElement;
    /** The row itself (role=toolbar). */
    row: HTMLElement;
    /** Put the keyboard on the one Tab stop. */
    focus(): void;
    /** Re-read pressed and available states from the editor. */
    refresh(): void;
    /** Show the link step in place of the row (null: the row again). */
    setLinkStep(step: HTMLElement | null): void;
    /** A column is open, or the link step. */
    expanded(): boolean;
    destroy(): void;
}

function icon(doc: Document, skin: Skin, action: FormatAction) {
    const img = (name: string, line?: number) =>
        h(doc, "img", {
            src: skin.iconUrl(name),
            "data-file": name,
            alt: "",
            draggable: "false",
            "data-list-line": line,
        });
    return h(
        doc,
        "span",
        { className: "kk-fm-figma-icon", "data-icon": action.id, "aria-hidden": "true" },
        action.id === "orderedList"
            ? ORDERED_LIST_LINES.map((line) => img(orderedListIcon(line), line))
            : [img(FORMAT_ICONS[action.id as keyof typeof FORMAT_ICONS])],
    );
}

export function createToolbar({
    doc,
    editor,
    images,
    skin,
    label,
    onAction,
    onDismissLink,
}: {
    doc: Document;
    editor: Editor;
    /** The host can add pictures: show the Image column. */
    images: boolean;
    skin: Skin;
    /** What the toolbar formats (aria-controls). */
    label?: string;
    onAction: (action: FormatAction) => unknown;
    onDismissLink?: (restoreFocus: boolean) => void;
}): Toolbar {
    const layout = toolbarLayout(images);
    const { actions, groups } = layout;
    let state: ToolbarState = { current: 0, open: null };
    let hovered: number | null = null;
    let focused: number | null = null;
    let closing = false;
    let linkStep: HTMLElement | null = null;

    const buttons: HTMLButtonElement[] = [];
    const lozenges: Lozenge[] = [];
    const groupEls: HTMLElement[] = [];
    const row = h(doc, "div", {
        role: "toolbar",
        "aria-label": copy.toolbar,
        "aria-controls": label,
        className: "kk-fm-toolbar kk-fm-figma",
    });
    const el = h(
        doc,
        "div",
        {
            className: "kk-message-tools-dock kk-message-writing-tools",
            "data-writing-tools": "formatting",
            "data-feedback-ui": true,
            "data-revealed": "true",
        },
        [row],
    );
    row.append(h(doc, "span", { className: "kk-fm-choice-backdrop", "aria-hidden": "true" }));

    const sync = () => {
        const open = linkStep ? null : state.open;
        row.toggleAttribute("data-link-open", !!linkStep);
        if (open === null) row.removeAttribute("data-open-group");
        else row.dataset.openGroup = String(open);
        if (state.open !== null || linkStep) row.dataset.kkFormattingExpanded = "true";
        else delete row.dataset.kkFormattingExpanded;
        const tracking = hovered ?? focused;
        buttons.forEach((button, index) => {
            button.tabIndex = index === state.current ? 0 : -1;
            button.toggleAttribute("data-tracking", tracking === index);
        });
        groupEls.forEach((group, index) => {
            group.toggleAttribute("data-open", open === index);
            lozenges[index].setOpen(open === index);
        });
    };
    const refresh = () => {
        const editable = editor.isEditable && !editor.isDestroyed;
        buttons.forEach((button, index) => {
            const action = actions[index];
            if (action.isActive) button.setAttribute("aria-pressed", String(!!action.isActive(editor)));
            button.disabled = !editable;
            if (action.isAvailable) button.setAttribute("aria-disabled", String(!action.isAvailable(editor)));
        });
    };
    const focusTool = (index: number) => buttons[index]?.focus({ preventScroll: true });
    const holdsFocus = () => {
        const active = activeIn(row);
        return !!active && row.contains(active);
    };
    const reveal = (group: number) => {
        if (linkStep) return;
        const next = revealGroup(layout, state, group);
        state = next.state;
        sync();
        // With the keyboard in the toolbar, focus follows the pointer to the
        // revealed anchor: a choice in a closing lozenge cannot keep it.
        if (next.moved && holdsFocus()) focusTool(state.current);
    };
    const close = (restoreFocus = false) => {
        if (state.open === null) return;
        const refocus = restoreFocus || holdsFocus();
        state = closeGroup(layout, state);
        sync();
        if (refocus) {
            closing = true;
            focusTool(state.current);
            closing = false;
        }
    };

    const button = (index: number, group: number, level = 0) => {
        const action = actions[index];
        const node = h(
            doc,
            "button",
            {
                type: "button",
                className: "kk-composer-magnet kk-fm-magnet",
                "data-format": action.id,
                "data-tool-index": index,
                "aria-label": action.label,
                "aria-keyshortcuts": keyshortcuts(action.chord),
                title: actionTitle(action),
                style: level ? `--kk-fm-level: ${level}` : undefined,
            },
            [icon(doc, skin, action), badge(doc, action.chord)],
        );
        node.addEventListener("mousedown", (event) => event.preventDefault());
        node.addEventListener("pointerenter", () => {
            hovered = index;
            reveal(group);
            sync();
        });
        node.addEventListener("pointerleave", () => {
            if (hovered === index) hovered = null;
            sync();
        });
        node.addEventListener("pointerdown", () => reveal(group));
        node.addEventListener("focus", () => {
            focused = index;
            state = { ...state, current: index };
            if (closing) closing = false;
            else reveal(group);
            sync();
        });
        node.addEventListener("blur", () => {
            if (focused === index) focused = null;
            sync();
        });
        node.addEventListener("click", () => {
            if (actionAvailable(action, editor)) onAction(action);
            refresh();
        });
        buttons[index] = node;
        return node;
    };

    groups.forEach((items, group) => {
        const lozenge = createLozenge({ doc, owner: () => buttons[items[0]] ?? null, count: () => items.length });
        const span = h(doc, "span", { className: "kk-fm-group", "data-group": group }, [button(items[0], group), lozenge.el]);
        items.slice(1).forEach((index, level) => lozenge.track.append(button(index, group, level + 1)));
        lozenges[group] = lozenge;
        groupEls[group] = span;
        row.append(span);
    });

    row.addEventListener("keydown", (event) => {
        if (linkStep) return;
        hovered = null;
        const step = toolbarKey(layout, state, event.key, (group) =>
            (row.querySelector<HTMLElement>(`.kk-fm-group[data-group="${group}"] .kk-fm-lozenge`)?.dataset.direction as "up" | "down") ?? "up",
        );
        if (step.kind === "pass") return;
        event.preventDefault();
        event.stopPropagation();
        if (step.kind === "stay") return;
        const wasOpen = state.open;
        state = step.state;
        sync();
        if (event.key === "Escape" && wasOpen !== null) closing = true;
        focusTool(step.focus);
        closing = false;
    });

    // A press outside closes an open column (or the link step); leaving the
    // row and its open lozenge downward closes the column.
    const composed = (event: Event) => event.composedPath().includes(row);
    const outside = (event: PointerEvent) => {
        if (state.open === null && !linkStep) return;
        if (composed(event)) return;
        if (state.open !== null) state = closeGroup(layout, state);
        sync();
        if (linkStep) onDismissLink?.(false);
    };
    const below = (event: PointerEvent) => {
        if (state.open === null || event.pointerType === "touch" || linkStep) return;
        const faces = row.querySelectorAll<HTMLElement>(".kk-fm-group[data-open] > button, .kk-fm-group[data-open] .kk-fm-lozenge-face");
        const base = Math.max(row.getBoundingClientRect().bottom, ...Array.from(faces, (face) => face.getBoundingClientRect().bottom));
        if (event.clientY > base) close();
    };
    const dismiss = (event: Event) => {
        event.preventDefault();
        if (linkStep) onDismissLink?.(true);
        else close(true);
    };
    doc.addEventListener("pointerdown", outside, true);
    doc.addEventListener("pointermove", below);
    row.addEventListener("kk-formatting-dismiss", dismiss);

    sync();
    refresh();
    return {
        el,
        row,
        focus: () => focusTool(state.current),
        refresh,
        setLinkStep(step) {
            linkStep?.remove();
            linkStep = step;
            if (step) {
                if (state.open !== null) state = closeGroup(layout, state);
                row.append(step);
            }
            sync();
        },
        expanded: () => state.open !== null || !!linkStep,
        destroy() {
            doc.removeEventListener("pointerdown", outside, true);
            doc.removeEventListener("pointermove", below);
            lozenges.forEach((lozenge) => lozenge.destroy());
            el.remove();
        },
    };
}

export { groupOf };
