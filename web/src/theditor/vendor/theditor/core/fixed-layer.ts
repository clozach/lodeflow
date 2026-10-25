// Vendored copy; do not edit here. Canonical: theditor (projects/theditor/src/core/fixed-layer.ts).
// Refresh with `node projects/theditor/src/scripts/vendor-sync.mjs`; `--check` reports drift.
/**
 * A position: fixed layer that follows a point on the page. Inside a
 * transformed dialog the layer's frame is that dialog (its offsetParent), so
 * viewport coordinates are converted into the dialog's own pixels. The layer
 * never takes space in the page, whatever it shows.
 */
export function placeFixedLayer(layer: HTMLElement, x: number, y: number) {
    const parent = layer.offsetParent as HTMLElement | null;
    const bounds = parent?.getBoundingClientRect();
    const scaleX = parent ? bounds!.width / parent.offsetWidth || 1 : 1;
    const scaleY = parent ? bounds!.height / parent.offsetHeight || 1 : 1;
    layer.style.left = `${
        (x - (bounds?.left ?? 0)) / scaleX -
        (parent?.clientLeft ?? 0) +
        (parent?.scrollLeft ?? 0)
    }px`;
    layer.style.top = `${
        (y - (bounds?.top ?? 0)) / scaleY -
        (parent?.clientTop ?? 0) +
        (parent?.scrollTop ?? 0)
    }px`;
}

/** A surface's outer edge hides what passes it; a scrolling body does not
 * bound an overlay that floats above it. */
const BOUNDS = /hidden|clip/;

/** The visual viewport, in the page's client coordinates. */
function viewportBox() {
    const view = window.visualViewport;
    return {
        top: view?.offsetTop ?? 0,
        left: view?.offsetLeft ?? 0,
        bottom: (view?.offsetTop ?? 0) + (view?.height ?? window.innerHeight),
        right: (view?.offsetLeft ?? 0) + (view?.width ?? window.innerWidth),
    };
}

/** The surface an overlay for this element belongs to: the visual viewport
 * cut, axis by axis, by every ancestor that hides its overflow (a dialog or
 * page edge). Scrolling bodies inside it are left out on purpose: a lozenge
 * may rise over a title or header within its surface rather than cover the
 * words it formats (Al, 2026-10-10: the columns rise above). */
export function clippingFrame(from: HTMLElement) {
    let box = viewportBox();
    for (
        let node = from.parentElement;
        node && node !== document.body && node !== document.documentElement;
        node = node.parentElement
    ) {
        const style = getComputedStyle(node);
        const clipX = BOUNDS.test(style.overflowX);
        const clipY = BOUNDS.test(style.overflowY);
        if (!clipX && !clipY) continue;
        const rect = node.getBoundingClientRect();
        box = {
            left: clipX ? Math.max(box.left, rect.left) : box.left,
            right: clipX ? Math.min(box.right, rect.right) : box.right,
            top: clipY ? Math.max(box.top, rect.top) : box.top,
            bottom: clipY ? Math.min(box.bottom, rect.bottom) : box.bottom,
        };
    }
    return box;
}

/** The part of the screen a fixed layer can paint in: the visual viewport,
 * cut by its frame when that frame clips what it holds. */
export function fixedLayerBounds(layer: HTMLElement) {
    let box = viewportBox();
    const parent = layer.offsetParent as HTMLElement | null;
    if (parent && getComputedStyle(parent).overflow !== "visible") {
        const frame = parent.getBoundingClientRect();
        box = {
            top: Math.max(box.top, frame.top),
            left: Math.max(box.left, frame.left),
            bottom: Math.min(box.bottom, frame.bottom),
            right: Math.min(box.right, frame.right),
        };
    }
    return box;
}
