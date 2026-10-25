// Vendored copy; do not edit here. Canonical: theditor (projects/theditor/src/vanilla/lozenge.ts).
// Refresh with `node projects/theditor/src/scripts/vendor-sync.mjs`; `--check` reports drift.
/**
 * A category's choices in plain DOM (Al, 2026-10-10): one lozenge that
 * stretches open from its anchor, a fixed layer laid out every frame by the
 * core's `layoutLozenge` while open, so it takes no space and moves nothing.
 */
import { FIGMA_PITCH, layoutLozenge, scrollChoiceIntoView, type LozengeMemory, type VisibleBounds } from "../core/lozenge-layout";
import { h } from "./dom";

export interface Lozenge {
    /** The layer: append it beside its anchor. */
    el: HTMLElement;
    /** Where the choices go. */
    track: HTMLElement;
    setOpen(open: boolean): void;
    destroy(): void;
}

export function createLozenge({
    doc,
    owner,
    count,
    pitchRatio = FIGMA_PITCH,
    visible,
}: {
    doc: Document;
    owner: () => HTMLElement | null;
    count: () => number;
    pitchRatio?: number;
    visible?: VisibleBounds;
}): Lozenge {
    const track = h(doc, "span", { className: "kk-fm-lozenge-track" });
    const choices = h(doc, "span", { className: "kk-fm-lozenge-choices" }, [track]);
    const el = h(doc, "span", { className: "kk-fm-lozenge", hidden: true }, [
        h(doc, "span", { className: "kk-fm-lozenge-face", "aria-hidden": "true" }),
        choices,
    ]);
    choices.addEventListener("focusin", (event) => {
        if (event.target instanceof Element) scrollChoiceIntoView(choices, event.target);
    });
    let frame = 0;
    let memory: LozengeMemory = { direction: "", bounded: false };
    const win = doc.defaultView!;
    const update = () => {
        const anchor = owner();
        if (anchor) memory = layoutLozenge({ element: el, owner: anchor, choices, count: count(), pitchRatio, visible, memory });
        frame = win.requestAnimationFrame(update);
    };
    const stop = () => {
        win.cancelAnimationFrame(frame);
        frame = 0;
    };
    return {
        el,
        track,
        setOpen(open) {
            if (open === !el.hidden) return;
            el.hidden = !open;
            stop();
            if (open) {
                memory = { direction: "", bounded: false };
                update();
            }
        },
        destroy: stop,
    };
}
