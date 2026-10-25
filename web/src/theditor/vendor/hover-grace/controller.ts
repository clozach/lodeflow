// Vendored copy; do not edit here. Canonical: the swamikk CourseLit fork, https://github.com/clozach/swamikk, apps/web/lib/hover-grace/controller.ts
// Refresh with `node scripts/sync-theditor.mjs`; `--check` reports drift.
import {
    containsInteraction,
    distanceToRegions,
    hoverGraceDelay,
    interactionBounds,
    type Point,
} from "./policy";

type ExitEvent = { clientX: number; clientY: number; pointerType?: string };
export type HoverGraceOptions = {
    regions: () => readonly (HTMLElement | null | undefined)[];
    onExpire: () => void;
    held?: () => boolean;
};
type ExitState =
    | { kind: "idle" }
    | { kind: "inside"; point: Point; frame: number | null }
    | {
          kind: "outside";
          startedAt: number;
          point: Point;
          frame: number | null;
      };

/** Track the entire interaction surface after a painted region's exit. Safe
 * gaps reset the deadline while observation continues, so leaving blank space
 * later starts a finite budget without needing another DOM pointerleave. */
export function createHoverGrace(options: HoverGraceOptions) {
    let state: ExitState = { kind: "idle" };
    const cancel = () => {
        if (state.kind !== "idle" && state.frame !== null)
            cancelAnimationFrame(state.frame);
        state = { kind: "idle" };
        document.removeEventListener("pointermove", moved);
        window.removeEventListener("blur", lostWindow);
    };
    const expire = () => {
        cancel();
        if (!options.held?.()) options.onExpire();
    };
    const sample = () => {
        if (state.kind === "idle") return;
        if (options.held?.()) return cancel();
        const bounds = interactionBounds(
            options
                .regions()
                .filter((node): node is HTMLElement => !!node?.isConnected)
                .map((node) => node.getBoundingClientRect()),
        );
        if (!bounds) return expire();
        const { point, frame } = state;
        if (containsInteraction(point, bounds)) {
            state = { kind: "inside", point, frame };
            return;
        }
        const now = performance.now();
        const startedAt = state.kind === "outside" ? state.startedAt : now;
        const distance = distanceToRegions(point, [bounds]);
        if (now - startedAt >= hoverGraceDelay(distance)) return expire();
        state = { kind: "outside", startedAt, point, frame };
    };
    function schedule() {
        if (state.kind !== "idle" && state.frame === null)
            state.frame = requestAnimationFrame(tick);
    }
    function tick() {
        if (state.kind === "idle") return;
        state.frame = null;
        sample();
        schedule();
    }
    function moved(event: PointerEvent) {
        if (state.kind === "idle" || event.pointerType === "touch") return;
        state.point = { x: event.clientX, y: event.clientY };
        sample();
    }
    function lostWindow() {
        expire();
    }
    const leave = (event?: ExitEvent) => {
        if (event?.pointerType === "touch") return;
        if (options.held?.()) return cancel();
        // A focus exit has no cursor coordinates. Its owner's focus rules
        // decide retention; it doesn't acquire incidental pointer grace.
        if (
            !event ||
            !Number.isFinite(event.clientX) ||
            !Number.isFinite(event.clientY)
        )
            return expire();
        const point = { x: event.clientX, y: event.clientY };
        if (state.kind !== "idle") {
            state.point = point;
            sample();
            schedule();
            return;
        }
        state = {
            kind: "inside",
            point,
            frame: null,
        };
        document.addEventListener("pointermove", moved, { passive: true });
        window.addEventListener("blur", lostWindow);
        tick();
    };
    return { leave, cancel };
}
