// Vendored copy; do not edit here. Canonical: theditor (projects/theditor/src/core/lozenge-placement.ts).
// Refresh with `node projects/theditor/src/scripts/vendor-sync.mjs`; `--check` reports drift.
export interface Box {
    top: number;
    bottom: number;
}

/** Room kept between an open lozenge and the edge of what can show it. */
export const LOZENGE_MARGIN = 4;

/**
 * Which way a formatting lozenge stretches from its anchor, and how far
 * apart its choices sit (Al, 2026-10-05 and 2026-10-10). Up, over whatever
 * sits above the toolbar, while it fits in the surface that holds the anchor
 * (its dialog or page, or the screen); then down, over the words. A fixed
 * layer is not clipped by that surface, so next it may use the whole screen.
 * When neither side fits, keep the original control positions on the roomier
 * side. A bounded choices window scrolls rather than squeezing their targets.
 */
export function lozengePlacement({
    anchor,
    choices,
    pitch,
    frame,
    screen,
}: {
    anchor: Box;
    /** Choices besides the anchor. */
    choices: number;
    pitch: number;
    frame: Box;
    screen: Box;
}): { direction: "up" | "down"; pitch: number } {
    const height = anchor.bottom - anchor.top;
    const need = height + choices * pitch;
    const room = (box: Box) => ({
        up: anchor.bottom - box.top - LOZENGE_MARGIN,
        down: box.bottom - anchor.top - LOZENGE_MARGIN,
    });
    for (const box of [frame, screen]) {
        const { up, down } = room(box);
        if (up >= need) return { direction: "up", pitch };
        if (down >= need) return { direction: "down", pitch };
    }
    const { up, down } = room(screen);
    const direction = up >= down ? "up" : "down";
    return { direction, pitch };
}

/** The pill wraps the original circles; only its visible window is bounded. */
export function lozengeWindow({
    anchor,
    choices,
    pitch,
    direction,
    screen,
}: {
    anchor: Box;
    choices: number;
    pitch: number;
    direction: "up" | "down";
    screen: Box;
}): { height: number; contentHeight: number } {
    const anchorHeight = anchor.bottom - anchor.top;
    const contentHeight = anchorHeight + choices * pitch;
    const room =
        (direction === "up"
            ? anchor.bottom - screen.top
            : screen.bottom - anchor.top) - LOZENGE_MARGIN;
    return {
        height: Math.min(contentHeight, Math.max(anchorHeight, room)),
        contentHeight,
    };
}
