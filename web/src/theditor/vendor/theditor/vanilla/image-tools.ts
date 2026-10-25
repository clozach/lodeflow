// Vendored copy; do not edit here. Canonical: theditor (projects/theditor/src/vanilla/image-tools.ts).
// Refresh with `node projects/theditor/src/scripts/vendor-sync.mjs`; `--check` reports drift.
import { focusClosedAnchor, restoringAnchorFocus } from "../core/dismiss";
/**
 * The magnets of a selected inline image in plain DOM (Al, 2026-10-23), over
 * the same core as the fork's React image tools: a column at the image's left
 * edge, top-aligned, 9px outside its painted bounds and selection ring, out of
 * flow, so showing it moves no words. Style opens the four looks; Alignment
 * the five placements; the skewed ⟳ turns the column over into the
 * kitchen-sink editor, and Escape turns it back.
 */
import type { Editor } from "@tiptap/core";
import type { FormattedImageAttrs } from "../../common-models";
import { selectedImage, storedImageAttrs } from "../../extensions";
import { imageStyleText } from "../../image-css";
import { FORMATTING_COPY as copy } from "../core/copy";
import { ALIGN_ICONS, TWEAK_GLYPH } from "../core/icons";
import {
    GROW_MS,
    IMAGE_CHOICES,
    IMAGE_TOOL_CHORDS,
    IMAGE_TOOL_ORDER,
    IMAGE_TOOL_INDEX,
    IMAGE_TOOL_LABELS,
    TURN_MS,
    columnStep,
    imageAnchorLabel,
    imageEscapeRung,
    imageToolForKey,
    type ImageChoiceTool,
    type ImageTool,
} from "../core/image-tools";
import { fullImageAttrs, type FullImageAttrs, type TweakContext } from "../core/image-tweaks";
import { followImage, type VisibleBounds } from "../core/lozenge-layout";
import { createHoverGrace } from "../../hover-grace/controller";
import { tunerFor } from "./bloom-tuner";
import { activeIn, badge, h, keyshortcuts, play, type Skin } from "./dom";
import { createKitchenSink, TEXT_REVERTS } from "./kitchen-sink";
import { createLozenge, type Lozenge } from "./lozenge";

type Face = "column" | "sink";

export interface ImageTools {
    el: HTMLElement;
    /** A chord or a host asks for a tool (⌃⌥⌘S, ⌃⌥⌘L, ⌃⌥⌘T). */
    open(tool: ImageTool): void;
    /** Re-read the selection, the image and focus (after every transaction). */
    refresh(): void;
    /** Shown now: a picture is selected and the tools are in play. */
    visible(): boolean;
    /** The first magnet takes the keyboard. */
    focus(): void;
    destroy(): void;
}

export function createImageTools({
    doc,
    editor,
    skin,
    visibleBounds,
    onFocusEditor,
    focusWithin,
}: {
    doc: Document;
    editor: Editor;
    skin: Skin;
    visibleBounds?: VisibleBounds;
    /** The ladder's last rung: back to the words. */
    onFocusEditor: () => void;
    focusWithin?: () => boolean;
}): ImageTools {
    const win = doc.defaultView!;
    const el = h(doc, "div", { className: "kk-fm-image-tools", "data-face": "column", "data-feedback-ui": true, role: "group", "aria-label": copy.imageTools });
    el.hidden = true;
    let open: ImageChoiceTool | null = null;
    let face: Face = "column";
    let focused = false;
    let turning = false;
    let disposed = false;
    let grownFrom: number | null = null;
    let imageKey: number | null = null;
    let frame = 0;
    let anchors: HTMLButtonElement[] = [];
    let choiceButtons: Record<ImageChoiceTool, HTMLButtonElement[]> = { style: [], alignment: [] };
    let lozenges: Partial<Record<ImageChoiceTool, Lozenge>> = {};
    let sink: ReturnType<typeof createKitchenSink> | null = null;
    let attrs: FullImageAttrs = fullImageAttrs({ src: "" });

    const image = () => selectedImage(editor.state.selection);
    const target = () => {
        const found = image();
        return found ? (editor.view.nodeDOM(found.pos) as HTMLElement | null) : null;
    };
    const apply = (patch: Partial<FormattedImageAttrs>) => editor.commands.updateImageAttrs(patch);
    const context = (): TweakContext => {
        const span = target();
        const img = span?.querySelector("img");
        return {
            attrs,
            computed: {
                borderColor: span ? win.getComputedStyle(span).borderTopColor : undefined,
                aspect: img && img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : undefined,
            },
        };
    };
    /** A drag shows on the image itself; nothing is written until it ends. */
    const preview = (patch: Partial<FormattedImageAttrs>) => target()?.setAttribute("style", imageStyleText({ ...attrs, ...patch }));
    const holds = () => {
        const active = activeIn(el);
        return !!active && el.contains(active);
    };

    const grace = createHoverGrace({
        regions: () => [open === "style" ? anchors[IMAGE_TOOL_INDEX.style] : anchors[IMAGE_TOOL_INDEX.alignment], el.querySelector<HTMLElement>(".kk-fm-lozenge:not([hidden]) .kk-fm-lozenge-face")],
        onExpire: () => setOpen(null),
        held: () => holds() && activeIn(el) !== anchors[IMAGE_TOOL_INDEX.tweak],
    });

    const setOpen = (tool: ImageChoiceTool | null) => {
        open = tool;
        for (const name of ["style", "alignment"] as const) {
            lozenges[name]?.setOpen(open === name);
            anchors[name === "style" ? 0 : 1]?.parentElement?.toggleAttribute("data-open", open === name);
            anchors[name === "style" ? 0 : 1]?.setAttribute("aria-expanded", String(open === name));
        }
        syncExpanded();
    };
    const syncExpanded = () => {
        if (open !== null || face === "sink" || focused) el.dataset.kkFormattingExpanded = "true";
        else delete el.dataset.kkFormattingExpanded;
    };

    const swatch = (look: string) => h(doc, "span", { className: "kk-fm-look-swatch", "data-look": look, "aria-hidden": "true" }, [h(doc, "span")]);
    const alignIcon = (align: keyof typeof ALIGN_ICONS) =>
        h(doc, "img", { className: "kk-fm-align-icon", src: skin.iconUrl(ALIGN_ICONS[align]), "data-file": ALIGN_ICONS[align], alt: "", "aria-hidden": "true", draggable: "false" });

    const buildColumn = () => {
        anchors = [];
        choiceButtons = { style: [], alignment: [] };
        lozenges = {};
        const group = (tool: ImageChoiceTool, index: number) => {
            const anchor = h(doc, "button", {
                type: "button",
                className: "kk-fm-image-magnet",
                "data-image-tool": tool,
                "aria-haspopup": "true",
                "aria-expanded": "false",
                "aria-keyshortcuts": keyshortcuts(IMAGE_TOOL_CHORDS[tool]),
                title: IMAGE_TOOL_LABELS[tool],
            });
            anchor.addEventListener("mousedown", (event) => event.preventDefault());
            anchor.addEventListener("pointerenter", () => {
                grace.cancel();
                if (face === "column") setOpen(tool);
            });
            anchor.addEventListener("pointerleave", (event) => grace.leave(event));
            anchor.addEventListener("focus", () => !restoringAnchorFocus(anchor) && face === "column" && setOpen(tool));
            anchor.addEventListener("click", () => setOpen(tool));
            anchors[index] = anchor;
            const choices = IMAGE_CHOICES[tool];
            const lozenge = createLozenge({ doc, owner: () => anchors[index] ?? null, count: () => choices.length + 1, pitchRatio: 1, visible: visibleBounds });
            lozenges[tool] = lozenge;
            choices.forEach(({ value, label }, i) => {
                const choice = h(
                    doc,
                    "button",
                    { type: "button", className: "kk-fm-magnet kk-fm-image-choice", style: `--kk-fm-level: ${i + 1}`, tabindex: "-1", "aria-label": label, title: label, [tool === "style" ? "data-look" : "data-align"]: value },
                    [tool === "style" ? swatch(value) : alignIcon(value as keyof typeof ALIGN_ICONS)],
                );
                choice.addEventListener("mousedown", (event) => event.preventDefault());
                choice.addEventListener("pointerenter", () => grace.cancel());
                choice.addEventListener("pointerleave", (event) => grace.leave(event));
                // Applying never closes: compare looks one after another.
                choice.addEventListener("click", () => apply(tool === "style" ? { look: value as FullImageAttrs["look"] } : { align: value as FullImageAttrs["align"] }));
                choiceButtons[tool][i] = choice;
                lozenge.track.append(choice);
            });
            return h(doc, "span", { className: "kk-fm-image-group" }, [anchor, lozenge.el]);
        };
        const tweak = h(
            doc,
            "button",
            { type: "button", className: "kk-fm-image-magnet", "data-image-tool": "tweak", "aria-label": IMAGE_TOOL_LABELS.tweak, title: IMAGE_TOOL_LABELS.tweak, "aria-keyshortcuts": keyshortcuts(IMAGE_TOOL_CHORDS.tweak), "aria-expanded": "false" },
            [h(doc, "span", { className: "kk-fm-tweak-glyph", "aria-hidden": "true" }, [TWEAK_GLYPH]), badge(doc, IMAGE_TOOL_CHORDS.tweak)],
        );
        tweak.addEventListener("mousedown", (event) => event.preventDefault());
        tweak.addEventListener("pointerenter", () => setOpen(null));
        tweak.addEventListener("focus", () => setOpen(null));
        tweak.addEventListener("click", () => void turn("sink"));
        anchors[IMAGE_TOOL_INDEX.tweak] = tweak;
        el.replaceChildren(...IMAGE_TOOL_ORDER.map((tool,index) => tool === "tweak" ? tweak : group(tool,index)));
        paintColumn();
    };
    /** The anchors wear the image's current look and placement. */
    const paintColumn = () => {
        const style = anchors[IMAGE_TOOL_INDEX.style], alignment = anchors[IMAGE_TOOL_INDEX.alignment];
        if (!style || !alignment) return;
        style.setAttribute("aria-label", imageAnchorLabel("style", attrs));
        style.replaceChildren(swatch(attrs.look), badge(doc, IMAGE_TOOL_CHORDS.style));
        alignment.setAttribute("aria-label", imageAnchorLabel("alignment", attrs));
        alignment.replaceChildren(alignIcon(attrs.align as keyof typeof ALIGN_ICONS), badge(doc, IMAGE_TOOL_CHORDS.alignment));
        choiceButtons.style.forEach((b, i) => b.setAttribute("aria-pressed", String(attrs.look === IMAGE_CHOICES.style[i].value)));
        choiceButtons.alignment.forEach((b, i) => b.setAttribute("aria-pressed", String(attrs.align === IMAGE_CHOICES.alignment[i].value)));
    };
    const buildSink = () => {
        Object.values(lozenges).forEach((l) => l?.destroy());
        lozenges = {};
        sink?.destroy();
        sink = createKitchenSink({ doc, context, preview, apply });
        el.replaceChildren(sink.el);
    };
    const showFace = () => {
        el.dataset.face = face;
        if (face === "sink") buildSink();
        else {
            sink?.destroy();
            sink = null;
            buildColumn();
        }
    };

    const turn = async (to: Face) => {
        if (turning || disposed) return;
        turning = true;
        const refocus = holds();
        setOpen(null);
        if (to === "column") {
            const column = grownFrom ?? el.offsetHeight;
            await play(el, [{ height: `${el.offsetHeight}px` }, { height: `${column}px` }], GROW_MS);
        }
        await play(el, [{ transform: "perspective(600px) rotateY(0deg)" }, { transform: "perspective(600px) rotateY(90deg)" }], TURN_MS);
        if (disposed) return;
        if (to === "sink") grownFrom = el.offsetHeight;
        face = to;
        showFace();
        syncExpanded();
        turning = false;
        const from = grownFrom;
        // The new face turns in, then the sink grows to its rows.
        if (face === "sink") sink?.filter.focus({ preventScroll: true });
        else if (refocus) anchors[IMAGE_TOOL_INDEX.tweak]?.focus({ preventScroll: true });
        await play(el, [{ transform: "perspective(600px) rotateY(-90deg)" }, { transform: "perspective(600px) rotateY(0deg)" }], TURN_MS);
        if (!disposed && face === "sink" && from !== null)
            await play(el, [{ height: `${from}px`, overflow: "hidden" }, { height: `${el.offsetHeight}px`, overflow: "hidden" }], GROW_MS);
    };

    const openTool = (tool: ImageTool) => {
        if (!image()) return;
        if (tool === "tweak") {
            void turn(face === "sink" ? "column" : "sink");
            return;
        }
        if (face === "sink") return;
        setOpen(tool);
        // Keyboard arrival: the current choice takes focus, so arrows walk.
        win.requestAnimationFrame(() => {
            if (disposed) return;
            const current = choiceButtons[tool].find((b) => b.getAttribute("aria-pressed") === "true") ?? anchors[IMAGE_TOOL_INDEX[tool]];
            current?.focus({ preventScroll: true });
        });
    };

    // One rung of Escape at a time; the host may route it here first.
    el.addEventListener("kk-formatting-dismiss", (event) => {
        const active = activeIn(el);
        const tuner = tunerFor(active);
        const filter = sink?.filter;
        const rung = imageEscapeRung({
            fieldPending: !!tuner && (tuner.hasPendingEdit() || tuner.isDragging()),
            textReverted: !!active && !!TEXT_REVERTS.get(active)?.(),
            filterHasText: !!filter && active === filter && !!filter.value,
            face,
            open,
        });
        // An unsubmitted number or a live scrub: the field reverts itself.
        if (rung === "field") return;
        event.preventDefault();
        if (rung === "revert-text") return;
        if (rung === "clear-filter") filter!.dispatchEvent(new CustomEvent("kk-fm-sink-clear", { bubbles: true }));
        else if (rung === "turn-to-column") void turn("column");
        else if (rung === "close-lozenge") {
            const anchor = anchors[IMAGE_TOOL_INDEX[open!]];
            setOpen(null);
            focusClosedAnchor(anchor);
        } else onFocusEditor();
    });
    el.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && !event.defaultPrevented) {
            const dismiss = new CustomEvent("kk-formatting-dismiss", { cancelable: true, detail: { reason: "escape" } });
            el.dispatchEvent(dismiss);
            if (dismiss.defaultPrevented) {
                event.preventDefault();
                event.stopPropagation();
            }
            return;
        }
        const tool = imageToolForKey(event);
        if (tool) {
            event.preventDefault();
            event.stopPropagation();
            openTool(tool);
            return;
        }
        if (face !== "column" || !open) return;
        const list = [anchors[IMAGE_TOOL_INDEX[open!]], ...choiceButtons[open]].filter(Boolean);
        const index = list.indexOf(activeIn(el) as HTMLButtonElement);
        if (index < 0) return;
        const direction = (el.querySelector<HTMLElement>(".kk-fm-lozenge:not([hidden])")?.dataset.direction as "up" | "down") ?? "up";
        const next = columnStep(index, list.length, event.key, direction);
        if (next === null) return;
        event.preventDefault();
        list[next].focus({ preventScroll: true });
    });
    el.addEventListener("focusin", () => {
        focused = true;
        refresh();
    });
    el.addEventListener("focusout", (event) => {
        if (!el.contains(event.relatedTarget as Node | null)) {
            focused = false;
            refresh();
        }
    });
    // A press outside the open lozenge closes it (the image stays selected).
    const outside = (event: PointerEvent) => {
        if (open && !event.composedPath().includes(el)) setOpen(null);
    };
    doc.addEventListener("pointerdown", outside, true);

    const follow = () => {
        const span = target();
        if (span && span.isConnected) followImage({ element: el, target: span, visible: visibleBounds });
        frame = win.requestAnimationFrame(follow);
    };
    const stopFollow = () => {
        win.cancelAnimationFrame(frame);
        frame = 0;
    };

    const isVisible = () => {
        const found = image();
        return !!found && editor.isEditable && (editor.isFocused || focused || focusWithin?.() || face === "sink" || open !== null);
    };
    function refresh() {
        const found = image();
        const key = found ? found.pos : null;
        if (key !== imageKey) {
            // Another image, or none: the tools start over as a column.
            imageKey = key;
            open = null;
            face = "column";
            grownFrom = null;
            if (found) {
                attrs = fullImageAttrs(storedImageAttrs(found.node.attrs) ?? { src: "" });
                showFace();
            }
        } else if (found) {
            attrs = fullImageAttrs(storedImageAttrs(found.node.attrs) ?? { src: "" });
            if (face === "column") paintColumn();
            else sink?.update();
        }
        const show = isVisible();
        if (show === el.hidden) {
            el.hidden = !show;
            stopFollow();
            if (show) follow();
            else setOpen(null);
        }
        syncExpanded();
    }

    return {
        el,
        open: openTool,
        refresh,
        visible: () => !el.hidden,
        focus: () => (face === "sink" ? sink?.filter : anchors[IMAGE_TOOL_INDEX.style])?.focus({ preventScroll: true }),
        destroy() {
            disposed = true;
            stopFollow();
            grace.cancel();
            doc.removeEventListener("pointerdown", outside, true);
            sink?.destroy();
            Object.values(lozenges).forEach((l) => l?.destroy());
            el.remove();
        },
    };
}
