// Vendored copy; do not edit here. Canonical: the swamikk CourseLit fork, https://github.com/clozach/swamikk, apps/web/components/feedback/formatting/image-css.ts
// Refresh with `node scripts/sync-theditor.mjs`; `--check` reports drift.
/**
 * Inline images in a formatted message (Al, 2026-10-23): round-rect thumbs
 * proportional to the original, a third of the text's width by default, three
 * side by side before the fourth wraps. Framework-free on purpose: the fork's
 * editor and renderer use it, and lodeflow vendors this file by copy
 * (`scripts/sync-theditor.mjs --check` there fails on drift). Its only import
 * is the shared model.
 *
 * Every style lives on the image itself, as inline HTML: a wrapper span
 * carries `data-align`, `data-look`, the width as a custom property and the
 * kitchen-sink overrides (already canonical, `parseImageStyle`), which follow
 * the custom property so they win over the look's rules.
 */
import {
    FORMATTED_IMAGE_DEFAULTS,
    isFormattedImageSrc,
    parseImageStyle,
    type FormattedImageAttrs,
} from "./common-models";

/** Space between images in a row and below each, in CSS pixels. */
export const IMAGE_GAP = 8;

/** What each look draws before any override (the rules below), as the
 * kitchen-sink editor shows a row's value when nothing is tweaked. Shadow is
 * the first outer layer: y offset, blur, black's alpha. */
export const IMAGE_LOOK_BASE = {
    plain: { radius: 10, padding: 4, frame: 0, shadow: [0, 0, 0] },
    inset: { radius: 12, padding: 5, frame: 0, shadow: [0, 0, 0] },
    floating: { radius: 12, padding: 0, frame: 0, shadow: [2, 6, 0.18] },
    physical: { radius: 4, padding: 6, frame: 1, shadow: [1, 2, 0.25] },
} as const;

/** Rows of images: n images and n gaps fill the text width plus one gap, so
 * the block holding images lends that gap back on its trailing side. Three
 * images at width .333 fit; a fourth wraps; one at width 1 is full width. */
export const IMAGE_CSS = `
.kk-fm-image {
    position: relative;
    --kk-fm-image-gap: ${IMAGE_GAP}px;
    display: inline-block;
    vertical-align: top;
    box-sizing: border-box;
    max-width: 100%;
    width: calc(var(--kk-fm-image-width, ${FORMATTED_IMAGE_DEFAULTS.width}) * 100% - var(--kk-fm-image-gap));
    margin: 0 var(--kk-fm-image-gap) var(--kk-fm-image-gap) 0;
    border-radius: 10px;
    padding: 4px;
    background: color-mix(in srgb, currentColor 6%, transparent);
    line-height: 0;
}
/* (The :not() lifts this over a host's own block margins, such as
   ".kk-fm-content p { margin: 0 }".) */
:not(.kk-fm-image):has(> .kk-fm-image) {
    margin-inline-end: -${IMAGE_GAP}px;
}
.kk-fm-image > img {
    display: block;
    width: 100%;
    height: auto;
    max-width: none;
    margin: 0;
    border-radius: inherit;
    object-fit: inherit;
    object-position: inherit;
}
.kk-fm-caption {
    display: grid;
    position: relative;
    min-height: 1.4em;
    margin-top: 4px;
    font-family: inherit;
    font-weight: 400;
    font-size: 12px;
    line-height: 1.4;
    color: var(--kk-fm-caption-color, #595959);
    text-align: center;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
}
.dark .kk-fm-image { --kk-fm-caption-color: #b8b8b8; --kk-fm-caption-prompt: #a8a8a8; }
.kk-fm-caption-input, .kk-fm-caption-mirror, .kk-fm-caption-add {
    grid-area: 1 / 1;
    display: block;
    box-sizing: border-box;
    width: 100%;
    min-width: 0;
    margin: 0;
    padding: 0;
    border: 0;
    font: inherit;
    color: inherit;
    line-height: inherit;
    text-align: inherit;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
}
.kk-fm-caption-input {
    min-height: 0;
    resize: none;
    overflow: hidden;
    height: 100%;
    background: transparent;
    border-radius: 2px;
    outline: none;
}
.kk-fm-caption-input:disabled { opacity: 1; color: inherit; -webkit-text-fill-color: currentColor; cursor: default; }
.kk-fm-caption-mirror { visibility: hidden; pointer-events: none; }
.kk-fm-caption-add {
    color: var(--kk-fm-caption-prompt, #6b6b6b);
    background: transparent;
    cursor: text;
    appearance: none;
    border-radius: 0 0 6px 6px;
}
.kk-fm-caption-add:focus-visible { outline: 1px solid currentColor; outline-offset: -1px; }
/* Only the area below the picture reveals the prompt. At rest this transparent
   target reaches below the thin frame; hover/tap grows the gray frame itself.
   The empty row is a temporary layer: it never moves the image or adjacent
   words. Prompt and editing share a mirror, so activation keeps its size. */
.kk-fm-caption[data-empty="true"] {
    position: absolute;
    top: calc(100% - 4px);
    left: 0;
    right: 0;
    margin: 0;
    padding: 4px 4px 8px;
    box-sizing: border-box;
    background: inherit;
    border-bottom-left-radius: inherit;
    border-bottom-right-radius: inherit;
    z-index: 1;
}
.kk-fm-caption[data-state="rest"] {
    display: block;
    height: 0;
    min-height: 0;
    padding: 0;
    background: transparent;
}
.kk-fm-caption[data-state="rest"] > .kk-fm-caption-mirror { display: none; }
.kk-fm-caption[data-state="rest"] > .kk-fm-caption-add {
    position: absolute;
    left: 0;
    right: 0;
    top: 0;
    min-height: calc(1.4em + 8px);
    padding: 4px;
    color: transparent;
}
.kk-fm-caption[data-state="rest"] > .kk-fm-caption-input,
.kk-fm-caption[data-state="prompt"] > .kk-fm-caption-input {
    visibility: hidden;
    pointer-events: none;
}
.kk-fm-caption[data-state="editing"] > .kk-fm-caption-add,
.kk-fm-caption[data-state="caption"] > .kk-fm-caption-add {
    opacity: 0;
    pointer-events: none;
}
.kk-fm-caption[data-empty="true"][data-state="editing"] > .kk-fm-caption-input {
    align-self: center;
    height: 1.4em;
    padding-block: 0;
}
/* Read-only: an empty caption is nothing at all. */
.kk-fm-caption[data-empty="true"]:has(> .kk-fm-caption-input:disabled) { display: none; }
.kk-fm-image[style*="aspect-ratio"] > img {
    height: 100%;
}
.kk-fm-image[data-look="inset"] {
    border-radius: 12px;
    padding: 5px;
    box-shadow: inset 0 1px 3px rgb(0 0 0 / 0.18), inset 0 0 0 1px rgb(0 0 0 / 0.08);
}
.kk-fm-image[data-look="floating"] {
    border-radius: 12px;
    padding: 0;
    background: transparent;
    box-shadow: 0 2px 6px rgb(0 0 0 / 0.18), 0 8px 20px rgb(0 0 0 / 0.1);
}
.kk-fm-image[data-look="physical"] {
    border-radius: 4px;
    padding: 6px 6px 10px;
    background: var(--kk-fm-image-paper, #fffefa);
    border: 1px solid rgb(0 0 0 / 0.06);
    box-shadow: 0 1px 2px rgb(0 0 0 / 0.25), 0 6px 14px rgb(0 0 0 / 0.12);
}
.kk-fm-image[data-look="physical"] > img {
    border-radius: 2px;
}
:not(.kk-fm-image):has(> .kk-fm-image[data-align="center"]) {
    text-align: center;
}
:not(.kk-fm-image):has(> .kk-fm-image[data-align="right"]) {
    text-align: right;
}
.kk-fm-image[data-align="wrap-left"] {
    float: left;
    margin: 0.2em var(--kk-fm-image-gap) var(--kk-fm-image-gap) 0;
}
.kk-fm-image[data-align="wrap-right"] {
    float: right;
    margin: 0.2em 0 var(--kk-fm-image-gap) var(--kk-fm-image-gap);
}
.dark .kk-fm-image {
    --kk-fm-image-paper: #f3ede2;
}
.dark .kk-fm-image[data-look="inset"] {
    box-shadow: inset 0 1px 4px rgb(0 0 0 / 0.5), inset 0 0 0 1px rgb(255 255 255 / 0.08);
}
.dark .kk-fm-image[data-look="floating"],
.dark .kk-fm-image[data-look="physical"] {
    box-shadow: 0 2px 6px rgb(0 0 0 / 0.5), 0 10px 24px rgb(0 0 0 / 0.4);
}
.ProseMirror .kk-fm-image {
    cursor: default;
}
.ProseMirror-selectednode.kk-fm-image {
    outline: 2px solid var(--kk-composer-accent, #91462f);
    outline-offset: 2px;
}
`;

/** Marks the stylesheet so a host that already rendered it (React's own
 * `<style href>`) is not given a second copy. */
export const IMAGE_CSS_ID = "kk-fm-image-css";

/** Put IMAGE_CSS into a document (or shadow root) once. */
export function ensureImageCss(root: Document | ShadowRoot): void {
    const holder: ParentNode =
        "head" in root && root.head ? root.head : (root as ParentNode);
    if (
        holder.querySelector?.(
            `style#${IMAGE_CSS_ID}, style[data-href="${IMAGE_CSS_ID}"]`,
        )
    )
        return;
    const owner = "createElement" in root ? root : root.ownerDocument;
    const style = owner.createElement("style");
    style.id = IMAGE_CSS_ID;
    style.textContent = IMAGE_CSS;
    holder.appendChild(style);
}

/** The wrapper's inline style: the width first, then the overrides. */
export function imageStyleText(attrs: FormattedImageAttrs): string {
    const width = attrs.width ?? FORMATTED_IMAGE_DEFAULTS.width;
    const overrides = attrs.style ? parseImageStyle(attrs.style) : "";
    return `--kk-fm-image-width: ${width}${overrides ? `; ${overrides}` : ""}`;
}

/** The wrapper span's attributes as HTML would carry them, defaults left
 * out. Both renderers emit exactly these. */
export function imageSpanAttributes(
    attrs: FormattedImageAttrs,
): Record<string, string> {
    return {
        class: "kk-fm-image",
        ...(attrs.align && attrs.align !== FORMATTED_IMAGE_DEFAULTS.align
            ? { "data-align": attrs.align }
            : {}),
        ...(attrs.look && attrs.look !== FORMATTED_IMAGE_DEFAULTS.look
            ? { "data-look": attrs.look }
            : {}),
        style: imageStyleText(attrs),
    };
}

/** The image's own attributes. A source the model refuses is never emitted. */
export function imageElementAttributes(
    attrs: FormattedImageAttrs,
): Record<string, string> {
    return {
        src: isFormattedImageSrc(attrs.src) ? attrs.src : "",
        alt: attrs.alt ?? "",
        loading: "lazy",
        draggable: "false",
    };
}

/** An inline style string as a property map (for React's `style`), custom
 * properties kept as written, the rest camel-cased. */
export function styleObject(text: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const declaration of text.split(";")) {
        const colon = declaration.indexOf(":");
        if (colon < 0) continue;
        const property = declaration.slice(0, colon).trim();
        const value = declaration.slice(colon + 1).trim();
        if (!property || !value) continue;
        out[
            property.startsWith("--")
                ? property
                : property.replace(/-([a-z])/g, (_, letter: string) =>
                      letter.toUpperCase(),
                  )
        ] = value;
    }
    return out;
}
