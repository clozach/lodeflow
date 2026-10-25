// Vendored copy; do not edit here. Canonical: theditor (projects/theditor/src/vanilla/kitchen-sink.ts).
// Refresh with `node projects/theditor/src/scripts/vendor-sync.mjs`; `--check` reports drift.
/**
 * The kitchen-sink editor in plain DOM: every tweakable style of the selected
 * image in one tight column, filtered as you type (the core's registry and
 * search, core/image-tweaks.ts, as in the fork). Each row shows its effective
 * value; a tweak previews on the image as you drag and is written once, as one
 * canonical inline override, when you let go. ↺ clears that row's override.
 * Applying never closes it.
 */
import type { FormattedImageAttrs } from "../../common-models";
import { FORMATTING_COPY as copy, fillCopy } from "../core/copy";
import { RESET_GLYPH } from "../core/icons";
import { resetRow, rowOverridden, searchTweaks, type TweakContext, type TweakControl, type TweakRow } from "../core/image-tweaks";
import { createBloomTuner } from "./bloom-tuner";
import { h } from "./dom";

type Patch = Partial<FormattedImageAttrs>;

/** Each words field's way back from an unsubmitted edit, by its input (true
 * when it put words back): the Escape ladder's first rung after the tuners. */
export const TEXT_REVERTS = new WeakMap<Element, () => boolean>();

interface ControlView {
    el: HTMLElement;
    update(): void;
    destroy?(): void;
}

function controlView(doc: Document, control: TweakControl, ctx: () => TweakContext, preview: (p: Patch) => void, apply: (p: Patch) => void): ControlView {
    switch (control.kind) {
        case "number": {
            const tuner = createBloomTuner(
                doc,
                { label: control.label, value: control.get(ctx()), min: control.min, max: control.max, step: control.step, unit: control.unit, icon: control.icon },
                (value) => preview(control.set(ctx(), value)),
                (value) => apply(control.set(ctx(), value)),
            );
            return { el: tuner.el, update: () => tuner.update({ value: control.get(ctx()) }), destroy: tuner.destroy };
        }
        case "choice": {
            const select = h(doc, "select", {}, control.options.map((option) => h(doc, "option", { value: option }, [option === "none" ? copy.tweakChoiceNone : option])));
            select.value = control.get(ctx());
            select.addEventListener("change", () => apply(control.set(ctx(), select.value)));
            return { el: h(doc, "label", { className: "kk-fm-tweak-choice" }, [h(doc, "span", {}, [control.label]), select]), update: () => void (select.value = control.get(ctx())) };
        }
        case "text": {
            let committed = control.get(ctx());
            const input = h(doc, "textarea", { maxlength: control.maxLength, placeholder: control.placeholder, autocomplete: "off" });
            input.value = committed;
            const commit = () => {
                const next = control.set(ctx(), input.value);
                if ((next.alt ?? input.value) !== committed) apply(next);
                else input.value = committed;
            };
            input.addEventListener("blur", commit);
            input.addEventListener("keydown", (event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                commit();
            });
            TEXT_REVERTS.set(input, () => {
                if (input.value === committed) return false;
                input.value = committed;
                return true;
            });
            return {
                el: h(doc, "label", { className: "kk-fm-tweak-text", title: control.hint }, [h(doc, "span", {}, [control.label]), input]),
                // Written words (here, by ⌘Z or elsewhere) replace what the field shows.
                update: () => {
                    const now = control.get(ctx());
                    if (now !== committed) input.value = committed = now;
                },
                destroy: () => TEXT_REVERTS.delete(input),
            };
        }
        case "color": {
            const input = h(doc, "input", { type: "color" });
            input.value = control.get(ctx());
            // The picker previews while it moves and writes once when it settles.
            input.addEventListener("input", () => preview(control.set(ctx(), input.value)));
            input.addEventListener("change", () => apply(control.set(ctx(), input.value)));
            return { el: h(doc, "label", { className: "kk-fm-tweak-color" }, [h(doc, "span", {}, [control.label]), input]), update: () => void (input.value = control.get(ctx())) };
        }
    }
}

function rowView(doc: Document, row: TweakRow, ctx: () => TweakContext, preview: (p: Patch) => void, apply: (p: Patch) => void) {
    const controls = row.controls.map((control) => controlView(doc, control, ctx, preview, apply));
    const el = h(doc, "div", { className: "kk-fm-tweak-row", "data-row": row.id, "data-controls": row.controls.length }, controls.map((c) => c.el));
    const label = fillCopy(copy.tweakReset, { name: row.name });
    const reset = h(doc, "button", { type: "button", className: "kk-fm-tweak-reset", "aria-label": label, title: label }, [RESET_GLYPH]);
    reset.addEventListener("click", () => apply(resetRow(row, ctx().attrs)));
    const update = () => {
        const overridden = rowOverridden(row, ctx().attrs);
        el.toggleAttribute("data-overridden", overridden);
        if (overridden && !reset.isConnected) el.append(reset);
        else if (!overridden && reset.isConnected) reset.remove();
        controls.forEach((c) => c.update());
    };
    update();
    return { el, update, destroy: () => controls.forEach((c) => c.destroy?.()) };
}

export function createKitchenSink({
    doc,
    context,
    preview,
    apply,
}: {
    doc: Document;
    /** The image as it now is (read afresh on every use). */
    context: () => TweakContext;
    preview: (patch: Patch) => void;
    apply: (patch: Patch) => void;
}) {
    const filter = h(doc, "input", {
        className: "kk-fm-sink-filter",
        type: "search",
        placeholder: copy.tweakFilter,
        "aria-label": copy.tweakFilterLabel,
        autocomplete: "off",
        spellcheck: "false",
    });
    const rowsEl = h(doc, "div", { className: "kk-fm-sink-rows" });
    const el = h(doc, "div", { className: "kk-fm-sink" }, [filter, rowsEl]);
    let rows: ReturnType<typeof rowView>[] = [];
    const render = () => {
        rows.forEach((row) => row.destroy());
        const found = searchTweaks(filter.value);
        rows = found.map((row) => rowView(doc, row, context, preview, apply));
        rowsEl.replaceChildren(...(rows.length ? rows.map((row) => row.el) : [h(doc, "p", { className: "kk-fm-sink-empty" }, [fillCopy(copy.tweakNoMatch, { query: filter.value })])]));
    };
    filter.addEventListener("input", render);
    filter.addEventListener("kk-fm-sink-clear", () => {
        filter.value = "";
        render();
    });
    filter.addEventListener("keydown", (event) => {
        if (event.key !== "ArrowDown" && event.key !== "Enter") return;
        const first = rowsEl.querySelector<HTMLElement>(".kk-fm-tweak-row input, .kk-fm-tweak-row textarea, .kk-fm-tweak-row select");
        if (!first) return;
        event.preventDefault();
        first.focus();
    });
    render();
    return {
        el,
        filter,
        /** The image changed (a commit, ⌘Z): every row shows its new value. */
        update: () => rows.forEach((row) => row.update()),
        destroy: () => rows.forEach((row) => row.destroy()),
    };
}
