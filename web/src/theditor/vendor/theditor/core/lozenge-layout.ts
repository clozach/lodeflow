// Vendored copy; do not edit here. Canonical: theditor (projects/theditor/src/core/lozenge-layout.ts).
// Refresh with `node projects/theditor/src/scripts/vendor-sync.mjs`; `--check` reports drift.
/**
 * A lozenge's layout for one frame (Al, 2026-10-10): the fixed layer over its
 * anchor, stretched up or down, its pitch, its bounded window and the side
 * its chord badges take. Framework-free DOM: the fork's React lozenge and
 * lodeflow's vanilla one call this every frame while a lozenge is open, so
 * both draw the same geometry from the same rules (lozenge-placement.ts).
 */
import { CONTROL_SIZE_TOUCH } from "../../common-models";
import { clippingFrame, fixedLayerBounds, placeFixedLayer } from "./fixed-layer";
import { imageToolsPlacement } from "./image-tools";
import { lozengePlacement, lozengeWindow } from "./lozenge-placement";

/** The Figma slots overlap: a 25.18px pitch within a 36.1792px circle. */
export const FIGMA_PITCH = 25.18 / 36.1792;

/** What a box shows of an element: the frame it may paint in. */
export type VisibleBounds = (
    element: HTMLElement,
) => { top: number; left: number; bottom: number; right: number } | null;

/** Without a host's own test: the surface that clips the element. */
export const clippedBounds: VisibleBounds = (element) => clippingFrame(element);

export interface LozengeMemory {
    direction: string;
    bounded: boolean;
}

/**
 * Lay out `element` (the `.kk-fm-lozenge` layer) over `owner` (its anchor)
 * with `count` slots, the anchor's included. `choices` is its scrolling
 * viewport. `pitchRatio`: the choice pitch as a share of the anchor's height
 * on a fine pointer (the toolbar's slots overlap; an image's magnets sit edge
 * to edge, 1); touch always keeps separate 44px targets. Returns what the
 * next frame compares against.
 */
export function layoutLozenge({
    element,
    owner,
    choices,
    count,
    pitchRatio = FIGMA_PITCH,
    visible = clippedBounds,
    memory,
}: {
    element: HTMLElement;
    owner: HTMLElement;
    choices: HTMLElement | null;
    count: number;
    pitchRatio?: number;
    visible?: VisibleBounds;
    memory: LozengeMemory;
}): LozengeMemory {
    const rect = owner.getBoundingClientRect();
    // Layout pixels; a transformed dialog may scale the screen's.
    const slot = owner.offsetHeight;
    const scale = rect.height / slot || 1;
    const selectionLayer = owner.closest<HTMLElement>("[data-kk-selection-tools]");
    const screen = fixedLayerBounds(element);
    const selectionFrame = selectionLayer
        ? selectionLayer.dataset.edge === "below"
            ? { ...screen, top: rect.top }
            : { ...screen, bottom: rect.bottom }
        : null;
    const placement = lozengePlacement({
        anchor: rect,
        choices: count - 1,
        pitch: slot >= CONTROL_SIZE_TOUCH ? rect.height : rect.height * pitchRatio,
        frame: selectionFrame ?? clippingFrame(owner),
        screen: selectionFrame ?? screen,
    });
    const direction = selectionLayer
        ? selectionLayer.dataset.edge === "below"
            ? "down"
            : "up"
        : placement.direction;
    const pitch = placement.pitch;
    const { height, contentHeight } = lozengeWindow({
        anchor: rect,
        choices: count - 1,
        pitch,
        direction,
        screen: selectionFrame ?? screen,
    });
    const bounded = height + 0.5 < contentHeight;
    element.dataset.direction = direction;
    element.toggleAttribute("data-scroll", bounded);
    element.style.setProperty("--kk-fm-anchor", `${slot}px`);
    element.style.setProperty("--kk-fm-width", `${owner.offsetWidth}px`);
    element.style.setProperty("--kk-fm-pitch", `${pitch / scale}px`);
    element.style.setProperty(
        "--kk-fm-choices-reach",
        `${(contentHeight - pitch) / scale}px`,
    );
    element.style.width = `${owner.offsetWidth}px`;
    element.style.height = `${height / scale}px`;
    // A bounded scroller also clips horizontally. Give shortcut badges their
    // measured exterior room without widening the pill or moving any circle,
    // and choose the available side.
    const legendSpace = Math.max(
        0,
        ...Array.from(element.querySelectorAll<HTMLElement>(".kk-key"), (badge) => {
            if (!badge.offsetWidth) return 0;
            const box = badge.getBoundingClientRect();
            const button = badge.parentElement!.getBoundingClientRect();
            return Math.max(button.left - box.left, box.right - button.right) / scale;
        }),
    );
    element.style.setProperty("--kk-fm-legend-space", `${legendSpace}px`);
    element.dataset.legendEdge =
        screen.right - rect.right >= legendSpace * scale ||
        screen.right - rect.right >= rect.left - screen.left
            ? "right"
            : "left";
    placeFixedLayer(element, rect.left, direction === "up" ? rect.bottom - height : rect.top);
    if (choices && (memory.direction !== direction || memory.bounded !== bounded))
        choices.scrollTop = direction === "up" ? choices.scrollHeight : 0;
    // An anchor with no box is not laid out at all (its toolbar is not shown),
    // so there is no scrolled-away edge to test.
    const laidOut = rect.width > 0 && rect.height > 0;
    // Selection tools float outside the text's scroller. Its clipping bounds
    // must not hide an otherwise visible pill.
    const seen = laidOut && (selectionLayer ? screen : visible(owner));
    const shown =
        !laidOut ||
        (!!seen &&
            seen.top <= rect.top + 0.5 &&
            seen.bottom >= rect.bottom - 0.5 &&
            seen.left <= rect.left + 0.5 &&
            seen.right >= rect.right - 0.5);
    element.style.visibility = shown ? "" : "hidden";
    // A hidden choice cannot keep the keyboard; its anchor can.
    const active = (element.getRootNode() as Document | ShadowRoot).activeElement;
    if (!shown && active && element.contains(active)) owner.focus({ preventScroll: true });
    return { direction, bounded };
}

/** Keeps a focused choice inside a bounded window (the viewport's focus
 * capture handler in both renderers). */
export function scrollChoiceIntoView(viewport: HTMLElement, target: Element) {
    if (viewport.scrollHeight <= viewport.clientHeight) return;
    const bounds = viewport.getBoundingClientRect();
    const box = target.getBoundingClientRect();
    const scale = bounds.height / viewport.clientHeight || 1;
    if (box.top < bounds.top) viewport.scrollTop += (box.top - bounds.top) / scale;
    else if (box.bottom > bounds.bottom)
        viewport.scrollTop += (box.bottom - bounds.bottom) / scale;
}

/**
 * The image magnets' layer for one frame: beside the picture `target` per
 * `imageToolsPlacement`, hidden while the picture is scrolled out of its
 * writing area.
 */
export function followImage({
    element,
    target,
    visible = clippedBounds,
}: {
    element: HTMLElement;
    target: HTMLElement;
    visible?: VisibleBounds;
}) {
    const rect = target.getBoundingClientRect();
    const { side, x, y, below } = imageToolsPlacement({
        image: rect,
        room: clippingFrame(target),
        width: element.offsetWidth,
        height: element.offsetHeight,
    });
    element.dataset.side = side;
    element.style.setProperty("--kk-fm-room", `${below}px`);
    placeFixedLayer(element, x, y);
    // Scrolled out of its writing area, the image takes its magnets with it.
    // (No box at all: not laid out, so there is no edge to test.)
    const laidOut = rect.width > 0 && rect.height > 0;
    const seen = laidOut && visible(target);
    element.style.visibility =
        !laidOut || (seen && seen.bottom > seen.top && seen.right > seen.left)
            ? ""
            : "hidden";
}
