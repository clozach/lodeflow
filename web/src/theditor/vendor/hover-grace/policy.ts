// Vendored copy; do not edit here. Canonical: the swamikk CourseLit fork, https://github.com/clozach/swamikk, apps/web/lib/hover-grace/policy.ts
// Refresh with `node scripts/sync-theditor.mjs`; `--check` reports drift.
export type Point = { x: number; y: number };
export type Bounds = {
    left: number;
    right: number;
    top: number;
    bottom: number;
};

/** ClipEdge's exit policy, in CSS pixels and milliseconds. Measure from the
 * unexpanded interaction bounds, independently of the safe pointer margin. */
export function hoverGraceDelay(distance: number, maximum = 500) {
    const limit = Number.isFinite(maximum)
        ? Math.min(3000, Math.max(0, maximum))
        : 500;
    return limit * Math.max(0, 1 - Math.max(0, distance) / 200);
}

/** The smallest full surface containing the actual owner and its controls.
 * Blank space between them is traversable, like ClipEdge's drawer body. */
export function interactionBounds(
    regions: readonly Bounds[],
): Bounds | undefined {
    const rects = regions.filter(
        (rect) =>
            [rect.left, rect.right, rect.top, rect.bottom].every(
                Number.isFinite,
            ) &&
            rect.right > rect.left &&
            rect.bottom > rect.top,
    );
    if (!rects.length) return;
    return {
        left: Math.min(...rects.map((rect) => rect.left)),
        right: Math.max(...rects.map((rect) => rect.right)),
        top: Math.min(...rects.map((rect) => rect.top)),
        bottom: Math.max(...rects.map((rect) => rect.bottom)),
    };
}

/** ClipEdge's preview counts its frame and an eight-point surrounding gap as
 * inside. CSS pixels are the corresponding logical unit in the browser. */
export function containsInteraction(point: Point, bounds: Bounds) {
    return (
        point.x >= bounds.left - 8 &&
        point.x <= bounds.right + 8 &&
        point.y >= bounds.top - 8 &&
        point.y <= bounds.bottom + 8
    );
}

export function distanceToRegions(point: Point, regions: readonly Bounds[]) {
    return Math.min(
        ...regions.map((rect) =>
            Math.hypot(
                Math.max(rect.left - point.x, 0, point.x - rect.right),
                Math.max(rect.top - point.y, 0, point.y - rect.bottom),
            ),
        ),
    );
}
