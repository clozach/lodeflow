// Vendored copy; do not edit here. Canonical: theditor (projects/theditor/src/vanilla/bloom-tuner.ts).
// Refresh with `node projects/theditor/src/scripts/vendor-sync.mjs`; `--check` reports drift.
/**
 * A bloom tuner (vault glossary) in plain DOM: the vendored field-core
 * builds it, as in the fork's React wrapper (bloom-tuner.tsx). The field's
 * contract stylesheet goes where the renderer's styles go (`FIELD_CSS`), not
 * the page's head, so it reaches a shadow root.
 */
import { CSS as FIELD_CSS, createNumberField, type NumberFieldHandle } from "../../field-core/field-core.mjs";
// The shared concept glyphs; field-core reads the registry this installs.
import "../../field-core/icons.js";

export { FIELD_CSS };

/** The live fields, by their input, so the Escape ladder can give a field
 * with an unsubmitted edit or a live scrub first refusal. */
const FIELDS = new WeakMap<Element, NumberFieldHandle>();

export function tunerFor(element: Element | null) {
    return element ? FIELDS.get(element) : undefined;
}

export interface TunerSpec {
    label: string;
    value: number;
    min: number;
    max: number;
    step: number;
    unit: string;
    icon: string;
}

/** `onPreview` runs every pixel of a drag; `onCommit` once. */
export function createBloomTuner(
    doc: Document,
    spec: TunerSpec,
    onPreview: (value: number) => void,
    onCommit: (value: number) => void,
) {
    const host = doc.createElement("div");
    host.className = "kk-fm-tuner";
    const handle = createNumberField({ ...spec, document: doc, injectCSS: false, onPreview, onCommit });
    host.append(handle.el);
    FIELDS.set(handle.nodes.input, handle);
    return {
        el: host,
        /** Never over an unsubmitted edit or a live drag (field-core's rule). */
        update: (next: Partial<TunerSpec>) => handle.update(next),
        destroy() {
            FIELDS.delete(handle.nodes.input);
            handle.destroy();
        },
    };
}
