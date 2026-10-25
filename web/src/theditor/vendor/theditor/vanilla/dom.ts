// Vendored copy; do not edit here. Canonical: theditor (projects/theditor/src/vanilla/dom.ts).
// Refresh with `node projects/theditor/src/scripts/vendor-sync.mjs`; `--check` reports drift.
/**
 * The few DOM helpers the vanilla renderer needs: building elements, the
 * chord badge every magnet carries, and focus inside a shadow root.
 */
import { chordAria, chordLabel, type Chord } from "../core/chords";

type Attrs = Record<string, string | number | boolean | undefined | null>;

/** An element with attributes (false/null/undefined leave one out), a class
 * name, and children. */
export function h<K extends keyof HTMLElementTagNameMap>(
    doc: Document,
    tag: K,
    attrs: Attrs = {},
    children: (Node | string | null | undefined | false)[] = [],
): HTMLElementTagNameMap[K] {
    const node = doc.createElement(tag);
    for (const [name, value] of Object.entries(attrs)) setAttr(node, name, value);
    for (const child of children)
        if (child !== null && child !== undefined && child !== false) node.append(child);
    return node;
}

export function setAttr(node: Element, name: string, value: Attrs[string]) {
    if (value === false || value === null || value === undefined) node.removeAttribute(name);
    else node.setAttribute(name === "className" ? "class" : name, value === true ? "" : String(value));
}

/** The chord a magnet carries in its label (`.kk-key`, shown while ⌘ is held). */
export function badge(doc: Document, chord: Chord) {
    return h(doc, "kbd", { className: "kk-key", "aria-hidden": "true" }, [chordLabel(chord)]);
}

export const keyshortcuts = chordAria;

/** The focused element, seen from inside a shadow root as well as outside. */
export function activeIn(node: Node): Element | null {
    const root = node.getRootNode() as Document | ShadowRoot;
    return root.activeElement ?? null;
}

export const reducedMotion = (win: Window) => !!win.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** A Web Animation, resolved when it ends (at once with reduced motion). */
export function play(element: HTMLElement | null, frames: Keyframe[], duration: number): Promise<void> {
    if (!element) return Promise.resolve();
    const win = element.ownerDocument.defaultView;
    if (!win || reducedMotion(win) || typeof element.animate !== "function") return Promise.resolve();
    return element.animate(frames, { duration, easing: "ease-in-out" }).finished.then(
        () => undefined,
        () => undefined,
    );
}

/** Everything a renderer asks of its host. */
export interface Skin {
    /** A shared icon's source by name ("bold", "dark/bold"). */
    iconUrl(name: string): string;
}
