// Vendored copy; do not edit here. Canonical: theditor (projects/theditor/src/core/dismiss.ts).
// Refresh with `node projects/theditor/src/scripts/vendor-sync.mjs`; `--check` reports drift.
/** Formatting is a child surface even when focus remains in the writing field.
 * Hosts call this before their own Escape handling, including Radix's document
 * capture handler. The toolbar acknowledges dismissal through preventDefault. */
const formattingPointers = new WeakSet<Event>();

/** A child formatting surface can consume a click outside every parent layer.
 * Retain its original event so each ancestor preserves itself for that click. */
export function markFormattingPointer(event: Event) {
    formattingPointers.add(event);
}

export function formattingOwnsPointer(event: Event) {
    return formattingPointers.has(event);
}

export function expandedFormatting(container: ParentNode | null) {
    return container?.querySelector<HTMLElement>(
        '[data-kk-formatting-expanded="true"]',
    );
}

export function consumeFormattingEscape(
    event: KeyboardEvent,
    container: ParentNode | null,
): boolean {
    if (event.key !== "Escape") return false;
    const toolbar = expandedFormatting(container);
    if (!toolbar) return false;
    const dismiss = new CustomEvent("kk-formatting-dismiss", {
        cancelable: true,
        detail: { reason: "escape" },
    });
    toolbar.dispatchEvent(dismiss);
    if (!dismiss.defaultPrevented) return false;
    event.preventDefault();
    event.stopPropagation();
    return true;
}

/** Restoring the closed magnet's focus must not reopen its choices. Focus
 * dispatch is synchronous in both DOM and React; keep the guard scoped to it. */
const restoredAnchors = new WeakSet<HTMLElement>();
export const restoringAnchorFocus = (anchor: HTMLElement) => restoredAnchors.has(anchor);
export function focusClosedAnchor(anchor: HTMLElement | null | undefined) {
    if (!anchor) return;
    restoredAnchors.add(anchor);
    try { anchor.focus({preventScroll:true}); }
    finally { restoredAnchors.delete(anchor); }
}
