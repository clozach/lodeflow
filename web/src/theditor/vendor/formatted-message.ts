// Vendored copy; do not edit here. Canonical: the swamikk CourseLit fork, https://github.com/clozach/swamikk, packages/common-models/src/formatted-message.ts
// Refresh with `node scripts/sync-theditor.mjs`; `--check` reports drift.
/**
 * A formatted message: the document a person writes in the Site projects
 * message editor (Al, 2026-10-04). It is plain data, never HTML: every node
 * and mark is named here, and anything else is refused. The message's
 * `text` is derived from it (`formattedText`), so search, previews, mail and
 * agent feeds read Markdown-style words without knowing about the document.
 */

export type FormattedHeadingLevel = 1 | 2 | 3 | 4;

export type FormattedMark =
    | { type: "bold" }
    | { type: "italic" }
    | { type: "code" }
    | { type: "link"; attrs: { href: string } };

export interface FormattedText {
    type: "text";
    text: string;
    marks?: FormattedMark[];
}

/** Where an inline image sits (Al, 2026-10-23): on its own line at the
 * left, centre or right (text above and below), or floated with the words
 * wrapping beside it. */
export type FormattedImageAlign =
    | "left"
    | "center"
    | "right"
    | "wrap-left"
    | "wrap-right";

/** The composite looks an inline image can wear. */
export type FormattedImageLook = "plain" | "inset" | "floating" | "physical";

export const FORMATTED_IMAGE_ALIGNS: readonly FormattedImageAlign[] = [
    "left",
    "center",
    "right",
    "wrap-left",
    "wrap-right",
];
export const FORMATTED_IMAGE_LOOKS: readonly FormattedImageLook[] = [
    "plain",
    "inset",
    "floating",
    "physical",
];

/** An image's attributes as stored: only what differs from the defaults
 * below is present, so a plain image is `{ src }`. */
export interface FormattedImageAttrs {
    src: string;
    /** The visible caption and accessible alt text share these words; ≤ 500 characters. */
    alt?: string;
    /** A fraction of the text's width, 0.05–1, three decimals. */
    width?: number;
    align?: FormattedImageAlign;
    look?: FormattedImageLook;
    /** Kitchen-sink overrides, canonical (`parseImageStyle`). */
    style?: string;
}

export const FORMATTED_IMAGE_DEFAULTS = {
    alt: "",
    width: 0.333,
    align: "left",
    look: "plain",
    style: "",
} as const;

export interface FormattedImage {
    type: "image";
    attrs: FormattedImageAttrs;
}

export type FormattedInline =
    | FormattedText
    | { type: "hardBreak" }
    | FormattedImage;

export interface FormattedListItem {
    type: "listItem";
    content: FormattedBlock[];
}

export interface FormattedTaskItem {
    type: "taskItem";
    attrs: { checked: boolean };
    content: FormattedBlock[];
}

export interface FormattedDetailsSummary {
    type: "detailsSummary";
    content?: FormattedInline[];
}

export interface FormattedDetailsContent {
    type: "detailsContent";
    content: FormattedBlock[];
}

export type FormattedBlock =
    | { type: "paragraph"; content?: FormattedInline[] }
    | {
          type: "heading";
          attrs: { level: FormattedHeadingLevel };
          content?: FormattedInline[];
      }
    | { type: "codeBlock"; content?: { type: "text"; text: string }[] }
    | { type: "horizontalRule" }
    | { type: "blockquote"; content: FormattedBlock[] }
    | { type: "callout"; content: FormattedBlock[] }
    | {
          type: "details";
          content: [FormattedDetailsSummary, FormattedDetailsContent];
      }
    | { type: "bulletList"; content: FormattedListItem[] }
    | {
          type: "orderedList";
          attrs: { start: number };
          content: FormattedListItem[];
      }
    | { type: "taskList"; content: FormattedTaskItem[] };

export interface FormattedDoc {
    type: "doc";
    content: FormattedBlock[];
}

/** The document's own byte budget, apart from the derived text's. */
export const CONVERSATION_FORMATTED_MAX_BYTES = 64 * 1024;
const MAX_DEPTH = 16;
const MAX_NODES = 8000;

/** Links reach a web address, as plain-text links do, never a script. */
const WEB_ADDRESS = /^https?:\/\/[^\s<>"'`\\\u0000-\u001f\u007f]+$/i;
export function isFormattedHref(href: string): boolean {
    return href.length <= 2048 && WEB_ADDRESS.test(href);
}

/** An image comes from the web (a named host), from this site (a path from
 * its root: its media and its /api routes), or is carried inside the
 * document as a bitmap. Nothing else: no protocol-relative address, no
 * script, no SVG. */
const IMAGE_WEB_ADDRESS =
    /^https?:\/\/[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::\d{1,5})?(?:[/?#][^\s<>"'`\\\u0000-\u001f\u007f]*)?$/i;
const IMAGE_SITE_PATH = /^\/(?![/\\])[^\s<>"'`\\\u0000-\u001f\u007f]*$/;
const IMAGE_BITMAP =
    /^data:image\/(?:png|jpeg|gif|webp|avif);base64,[a-z0-9+/]+={0,2}$/i;
/** A carried bitmap's own ceiling, in characters (the fork's 64 KB document
 * budget refuses large ones well before this; lodeflow keeps them). */
export const FORMATTED_IMAGE_DATA_MAX_CHARS = 8 * 1024 * 1024;
export function isFormattedImageSrc(src: string): boolean {
    if (typeof src !== "string" || !src) return false;
    if (src.startsWith("data:"))
        return (
            src.length <= FORMATTED_IMAGE_DATA_MAX_CHARS &&
            IMAGE_BITMAP.test(src)
        );
    return (
        src.length <= 2048 &&
        (IMAGE_WEB_ADDRESS.test(src) || IMAGE_SITE_PATH.test(src))
    );
}

/* ---- The image's inline style: a whitelist, refused whole on any slip ---- */

export const FORMATTED_IMAGE_STYLE_MAX_BYTES = 1200;

const STYLE_REFUSED =
    /url\(|var\(|attr\(|expression\(|javascript|[<>\\@]|\/\*|!important/i;
const NUMBER = /^[-+]?(?:\d{1,4}(?:\.\d{1,4})?|\.\d{1,4})$/;
const DIMENSION = /^([-+]?(?:\d{1,4}(?:\.\d{1,4})?|\.\d{1,4}))([a-z%]*)$/;

type Dimension = { value: number; unit: string };
function dimension(token: string): Dimension | null {
    const match = DIMENSION.exec(token);
    return match ? { value: parseFloat(match[1]), unit: match[2] } : null;
}

/** A length: px, em, rem (and % where `percent`), or a bare 0. */
function isLength(
    token: string,
    { percent = false, negative = false } = {},
): boolean {
    const d = dimension(token);
    if (!d) return false;
    if (!negative && d.value < 0) return false;
    if (d.unit === "") return d.value === 0;
    if (d.unit === "px") return Math.abs(d.value) <= 2000;
    if (d.unit === "em" || d.unit === "rem") return Math.abs(d.value) <= 100;
    if (d.unit === "%") return percent && Math.abs(d.value) <= 100;
    return false;
}

function numberIn(token: string, min: number, max: number): boolean {
    if (!NUMBER.test(token)) return false;
    const value = parseFloat(token);
    return value >= min && value <= max;
}

/** Split at depth 0 of parentheses: on `separator`, or on runs of spaces. */
function splitTop(value: string, separator: "," | " "): string[] | null {
    const parts: string[] = [];
    let depth = 0;
    let current = "";
    for (const character of value) {
        if (character === "(") depth++;
        if (character === ")") depth--;
        if (depth < 0) return null;
        if (depth === 0 && character === separator) {
            if (separator === "," || current) parts.push(current);
            current = "";
            continue;
        }
        current += character;
    }
    if (depth !== 0) return null;
    if (separator === "," || current) parts.push(current);
    return parts.map((part) => part.trim());
}

/** A CSS function call `name(args)` with no nesting in its arguments. */
function call(token: string): { name: string; args: string } | null {
    const match = /^([a-z-]+)\(([^()]*)\)$/.exec(token);
    return match ? { name: match[1], args: match[2].trim() } : null;
}

const NAMED_COLORS = new Set(
    (
        "aliceblue antiquewhite aqua aquamarine azure beige bisque black " +
        "blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse " +
        "chocolate coral cornflowerblue cornsilk crimson cyan darkblue " +
        "darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki " +
        "darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon " +
        "darkseagreen darkslateblue darkslategray darkslategrey darkturquoise " +
        "darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick " +
        "floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod " +
        "gray green greenyellow grey honeydew hotpink indianred indigo ivory " +
        "khaki lavender lavenderblush lawngreen lemonchiffon lightblue " +
        "lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen " +
        "lightgrey lightpink lightsalmon lightseagreen lightskyblue " +
        "lightslategray lightslategrey lightsteelblue lightyellow lime " +
        "limegreen linen magenta maroon mediumaquamarine mediumblue " +
        "mediumorchid mediumpurple mediumseagreen mediumslateblue " +
        "mediumspringgreen mediumturquoise mediumvioletred midnightblue " +
        "mintcream mistyrose moccasin navajowhite navy oldlace olive " +
        "olivedrab orange orangered orchid palegoldenrod palegreen " +
        "paleturquoise palevioletred papayawhip peachpuff peru pink plum " +
        "powderblue purple rebeccapurple red rosybrown royalblue saddlebrown " +
        "salmon sandybrown seagreen seashell sienna silver skyblue slateblue " +
        "slategray slategrey snow springgreen steelblue tan teal thistle " +
        "tomato turquoise violet wheat white whitesmoke yellow yellowgreen " +
        "transparent currentcolor"
    ).split(" "),
);
const COLOR_ARGUMENT = /^[-+]?(?:\d{1,4}(?:\.\d{1,4})?|\.\d{1,4})(?:%|deg)?$/;

function isColor(token: string): boolean {
    if (NAMED_COLORS.has(token)) return true;
    if (/^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.test(token)) return true;
    const fn = call(token);
    if (!fn || !["rgb", "rgba", "hsl", "hsla"].includes(fn.name)) return false;
    const args = fn.args.split(/\s*[,/]\s*|\s+/).filter((arg) => arg !== "");
    return (
        args.length >= 3 &&
        args.length <= 4 &&
        args.every((arg) => COLOR_ARGUMENT.test(arg))
    );
}

/** `[inset] <len> <len> [<len>] [<len>] <color>`, or `none`. */
function isShadowLayer(layer: string): boolean {
    const tokens = splitTop(layer, " ");
    if (!tokens || !tokens.length) return false;
    let rest = tokens;
    if (rest[0] === "inset") rest = rest.slice(1);
    const color = rest[rest.length - 1];
    const lengths = rest.slice(0, -1);
    return (
        !!color &&
        isColor(color) &&
        lengths.length >= 2 &&
        lengths.length <= 4 &&
        lengths.every((token, index) =>
            isLength(token, { negative: index < 2 || index === 3 }),
        )
    );
}

const AMOUNT_FILTERS = new Set([
    "brightness",
    "contrast",
    "grayscale",
    "invert",
    "saturate",
    "sepia",
]);
function isFilterAmount(arg: string): boolean {
    const d = dimension(arg);
    return (
        !!d &&
        d.value >= 0 &&
        (d.unit === "" ? d.value <= 10 : d.unit === "%" && d.value <= 1000)
    );
}

function isFilterFunction(token: string): boolean {
    const fn = call(token);
    if (!fn) return false;
    if (fn.name === "blur") return isLength(fn.args);
    if (AMOUNT_FILTERS.has(fn.name)) return isFilterAmount(fn.args);
    if (fn.name === "hue-rotate") {
        const d = dimension(fn.args);
        return (
            !!d &&
            (d.unit === "deg" || (d.unit === "" && d.value === 0)) &&
            Math.abs(d.value) <= 360
        );
    }
    return false;
}

/** drop-shadow(len len len? color?) keeps a colour function inside it. */
function isDropShadow(token: string): boolean {
    const match = /^drop-shadow\((.*)\)$/.exec(token);
    if (!match) return false;
    const parts = splitTop(match[1].trim(), " ");
    if (!parts || parts.length < 2 || parts.length > 4) return false;
    const last = parts[parts.length - 1];
    const colored = !isLength(last, { negative: true }) && isColor(last);
    const lengths = colored ? parts.slice(0, -1) : parts;
    return (
        lengths.length >= 2 &&
        lengths.length <= 3 &&
        lengths.every((token, index) =>
            isLength(token, { negative: index < 2 }),
        )
    );
}

function isFilter(value: string): boolean {
    if (value === "none") return true;
    const tokens = splitTop(value, " ");
    return (
        !!tokens &&
        tokens.length >= 1 &&
        tokens.length <= 10 &&
        tokens.every((token) => isFilterFunction(token) || isDropShadow(token))
    );
}

const POSITION_WORDS = new Set(["left", "center", "right", "top", "bottom"]);
function isPosition(tokens: string[]): boolean {
    return (
        tokens.length >= 1 &&
        tokens.length <= 2 &&
        tokens.every(
            (token) =>
                POSITION_WORDS.has(token) ||
                isLength(token, { percent: true, negative: true }),
        )
    );
}

function isClipPath(value: string): boolean {
    if (value === "none") return true;
    const fn = call(value);
    if (!fn) return false;
    const lp = (token: string) => isLength(token, { percent: true });
    const [shape, at] = fn.args.split(/\s+at\s+/);
    const sizes = shape ? shape.split(/\s+/).filter(Boolean) : [];
    const position = at === undefined ? [] : at.split(/\s+/).filter(Boolean);
    if (at !== undefined && !isPosition(position)) return false;
    if (fn.name === "inset")
        return (
            at === undefined &&
            sizes.length >= 1 &&
            sizes.length <= 4 &&
            sizes.every(lp)
        );
    if (fn.name === "circle") return sizes.length <= 1 && sizes.every(lp);
    if (fn.name === "ellipse")
        return (sizes.length === 0 || sizes.length === 2) && sizes.every(lp);
    return false;
}

const lengths =
    (count: number, options: { percent?: boolean; negative?: boolean } = {}) =>
    (value: string) => {
        const tokens = splitTop(value, " ");
        return (
            !!tokens &&
            tokens.length >= 1 &&
            tokens.length <= count &&
            tokens.every((token) => isLength(token, options))
        );
    };
const oneOf =
    (...words: string[]) =>
    (value: string) =>
        words.includes(value);

/** Every property an image's style may carry, and what its value may be. */
const IMAGE_STYLE_RULES: Record<string, (value: string) => boolean> = {
    "border-radius": lengths(4, { percent: true }),
    padding: lengths(4, { percent: true }),
    margin: lengths(4, { percent: true, negative: true }),
    "border-width": lengths(4),
    "outline-width": lengths(1),
    "outline-offset": lengths(1, { negative: true }),
    width: (value) => {
        const d = dimension(value);
        return !!d && d.unit === "%" && d.value >= 5 && d.value <= 100;
    },
    "aspect-ratio": (value) => {
        if (value === "auto") return true;
        const match = /^(\S+) \/ (\S+)$/.exec(value);
        return (
            !!match &&
            numberIn(match[1], 0.01, 100) &&
            numberIn(match[2], 0.01, 100)
        );
    },
    opacity: (value) => numberIn(value, 0, 1),
    rotate: (value) => {
        const d = dimension(value);
        return (
            !!d &&
            (d.unit === "deg" || (d.unit === "" && d.value === 0)) &&
            d.value >= -180 &&
            d.value <= 180
        );
    },
    scale: (value) => numberIn(value, 0.1, 3),
    "border-color": isColor,
    "outline-color": isColor,
    "background-color": isColor,
    "box-shadow": (value) => {
        if (value === "none") return true;
        const layers = splitTop(value, ",");
        return (
            !!layers &&
            layers.length >= 1 &&
            layers.length <= 3 &&
            layers.every(isShadowLayer)
        );
    },
    filter: isFilter,
    "border-style": oneOf("solid", "dashed", "dotted", "double", "none"),
    "outline-style": oneOf("solid", "dashed", "dotted", "double", "none"),
    "object-fit": oneOf("cover", "contain", "fill"),
    "object-position": (value) => {
        const tokens = splitTop(value, " ");
        return !!tokens && isPosition(tokens);
    },
    "mix-blend-mode": oneOf(
        "normal",
        "multiply",
        "screen",
        "overlay",
        "darken",
        "lighten",
        "difference",
        "luminosity",
    ),
    "clip-path": isClipPath,
};
export const FORMATTED_IMAGE_STYLE_PROPERTIES = Object.keys(IMAGE_STYLE_RULES);

/** One value as stored: lower case, single spaces, `(a, b)` spacing. */
function canonicalValue(value: string): string {
    return value
        .toLowerCase()
        .replace(/\s+/g, " ")
        .replace(/\(\s+/g, "(")
        .replace(/\s+\)/g, ")")
        .replace(/\s*,\s*/g, ", ")
        .replace(/\s*\/\s*/g, " / ")
        .trim();
}

/**
 * An image's kitchen-sink overrides as the one canonical inline style
 * (Al, 2026-10-23: "all of these styles scope to inline html"), or null.
 * Each `prop: value` declaration must name a listed property with a value
 * its rule accepts; any slip refuses the whole string, never repairs it.
 * The canonical form is lower case, `prop: value; prop: value`, each
 * property once, in the order written. An empty string is no overrides.
 */
export function parseImageStyle(style: string): string | null {
    if (typeof style !== "string") return null;
    if (style.length > FORMATTED_IMAGE_STYLE_MAX_BYTES * 4) return null;
    if (STYLE_REFUSED.test(style)) return null;
    const seen = new Set<string>();
    const declarations: string[] = [];
    for (const raw of style.split(";")) {
        if (!raw.trim()) continue;
        const colon = raw.indexOf(":");
        if (colon < 0) return null;
        const property = raw.slice(0, colon).trim().toLowerCase();
        const value = canonicalValue(raw.slice(colon + 1));
        // Own properties only: `constructor`, `__proto__` and the like are
        // not styles, and must refuse, never throw.
        const rule = Object.prototype.hasOwnProperty.call(
            IMAGE_STYLE_RULES,
            property,
        )
            ? IMAGE_STYLE_RULES[property]
            : undefined;
        if (!rule || !value || seen.has(property) || !rule(value)) return null;
        seen.add(property);
        declarations.push(`${property}: ${value}`);
    }
    const canonical = declarations.join("; ");
    return byteLength(canonical) <= FORMATTED_IMAGE_STYLE_MAX_BYTES
        ? canonical
        : null;
}

/** UTF-8 bytes without Buffer or TextEncoder (both runtimes, old targets). */
function byteLength(text: string): number {
    let bytes = 0;
    for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);
        bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : 3;
    }
    return bytes;
}

/** An image's attributes with defaults dropped and the style canonical, or
 * null when any of them is not one the model names. */
export function canonicalImageAttrs(
    value: unknown,
): FormattedImageAttrs | null {
    if (!isObject(value)) return null;
    if (!keysWithin(value, ["src", "alt", "width", "align", "look", "style"]))
        return null;
    const { src, alt, width, align, look, style } = value;
    if (typeof src !== "string" || !isFormattedImageSrc(src)) return null;
    const attrs: FormattedImageAttrs = { src };
    if (alt !== undefined && alt !== null) {
        if (typeof alt !== "string" || alt.length > 500) return null;
        if (alt) attrs.alt = alt;
    }
    if (width !== undefined && width !== null) {
        if (typeof width !== "number" || !Number.isFinite(width)) return null;
        const rounded = Math.round(width * 1000) / 1000;
        if (rounded < 0.05 || rounded > 1) return null;
        if (rounded !== FORMATTED_IMAGE_DEFAULTS.width) attrs.width = rounded;
    }
    if (align !== undefined && align !== null) {
        if (!FORMATTED_IMAGE_ALIGNS.includes(align as FormattedImageAlign))
            return null;
        if (align !== FORMATTED_IMAGE_DEFAULTS.align)
            attrs.align = align as FormattedImageAlign;
    }
    if (look !== undefined && look !== null) {
        if (!FORMATTED_IMAGE_LOOKS.includes(look as FormattedImageLook))
            return null;
        if (look !== FORMATTED_IMAGE_DEFAULTS.look)
            attrs.look = look as FormattedImageLook;
    }
    if (style !== undefined && style !== null) {
        if (typeof style !== "string") return null;
        const canonical = parseImageStyle(style);
        if (canonical === null) return null;
        if (canonical) attrs.style = canonical;
    }
    return attrs;
}

type Json = unknown;
const isObject = (value: Json): value is Record<string, Json> =>
    !!value && typeof value === "object" && !Array.isArray(value);
const keysWithin = (value: Record<string, Json>, allowed: string[]) =>
    Object.keys(value).every((key) => allowed.includes(key));

class Refused extends Error {}
const refuse = (): never => {
    throw new Refused();
};

interface Budget {
    nodes: number;
}

function parseMarks(value: Json): FormattedMark[] | undefined {
    if (value === undefined) return undefined;
    if (!Array.isArray(value) || value.length > 4) return refuse();
    const seen = new Set<string>();
    const marks = value.map((mark): FormattedMark => {
        if (!isObject(mark) || typeof mark.type !== "string") return refuse();
        if (seen.has(mark.type)) return refuse();
        seen.add(mark.type);
        if (["bold", "italic", "code"].includes(mark.type)) {
            if (!keysWithin(mark, ["type"])) return refuse();
            return { type: mark.type as "bold" | "italic" | "code" };
        }
        if (mark.type !== "link" || !keysWithin(mark, ["type", "attrs"]))
            return refuse();
        const attrs = mark.attrs;
        if (
            !isObject(attrs) ||
            !keysWithin(attrs, ["href"]) ||
            typeof attrs.href !== "string" ||
            !isFormattedHref(attrs.href)
        )
            return refuse();
        return { type: "link", attrs: { href: attrs.href } };
    });
    return marks.length ? marks : undefined;
}

function parseInline(
    value: Json,
    budget: Budget,
): FormattedInline[] | undefined {
    if (value === undefined) return undefined;
    if (!Array.isArray(value)) return refuse();
    const inline = value.map((node): FormattedInline => {
        if (++budget.nodes > MAX_NODES || !isObject(node)) return refuse();
        if (node.type === "hardBreak") {
            if (!keysWithin(node, ["type"])) return refuse();
            return { type: "hardBreak" };
        }
        if (node.type === "image") {
            if (!keysWithin(node, ["type", "attrs"])) return refuse();
            const attrs = canonicalImageAttrs(node.attrs);
            return attrs ? { type: "image", attrs } : refuse();
        }
        if (
            node.type !== "text" ||
            !keysWithin(node, ["type", "text", "marks"]) ||
            typeof node.text !== "string" ||
            !node.text
        )
            return refuse();
        const marks = parseMarks(node.marks);
        return marks
            ? { type: "text", text: node.text, marks }
            : { type: "text", text: node.text };
    });
    return inline.length ? inline : undefined;
}

function parseBlocks(
    value: Json,
    budget: Budget,
    depth: number,
    allowEmpty = false,
): FormattedBlock[] {
    if (depth > MAX_DEPTH || !Array.isArray(value)) return refuse();
    if (!allowEmpty && !value.length) return refuse();
    return value.map((node) => parseBlock(node, budget, depth));
}

function parseItems<T extends "listItem" | "taskItem">(
    value: Json,
    type: T,
    budget: Budget,
    depth: number,
): (T extends "listItem" ? FormattedListItem : FormattedTaskItem)[] {
    if (!Array.isArray(value) || !value.length) return refuse();
    return value.map((item) => {
        if (++budget.nodes > MAX_NODES || !isObject(item) || item.type !== type)
            return refuse();
        const content = parseBlocks(item.content, budget, depth + 1);
        if (type === "listItem") {
            if (!keysWithin(item, ["type", "content"])) return refuse();
            return { type, content } as never;
        }
        if (
            !keysWithin(item, ["type", "attrs", "content"]) ||
            !isObject(item.attrs) ||
            !keysWithin(item.attrs, ["checked"]) ||
            typeof item.attrs.checked !== "boolean"
        )
            return refuse();
        return {
            type,
            attrs: { checked: item.attrs.checked },
            content,
        } as never;
    });
}

function parseBlock(node: Json, budget: Budget, depth: number): FormattedBlock {
    if (++budget.nodes > MAX_NODES || !isObject(node)) return refuse();
    switch (node.type) {
        case "paragraph": {
            if (!keysWithin(node, ["type", "content"])) return refuse();
            const content = parseInline(node.content, budget);
            return content
                ? { type: "paragraph", content }
                : { type: "paragraph" };
        }
        case "heading": {
            const level = isObject(node.attrs) ? node.attrs.level : undefined;
            if (
                !keysWithin(node, ["type", "attrs", "content"]) ||
                !isObject(node.attrs) ||
                !keysWithin(node.attrs, ["level"]) ||
                ![1, 2, 3, 4].includes(level as number)
            )
                return refuse();
            const content = parseInline(node.content, budget);
            return {
                type: "heading",
                attrs: { level: level as FormattedHeadingLevel },
                ...(content ? { content } : {}),
            };
        }
        case "codeBlock": {
            if (!keysWithin(node, ["type", "content"])) return refuse();
            const content = parseInline(node.content, budget);
            if (content?.some((item) => item.type !== "text" || item.marks))
                return refuse();
            return content
                ? {
                      type: "codeBlock",
                      content: content as { type: "text"; text: string }[],
                  }
                : { type: "codeBlock" };
        }
        case "horizontalRule":
            if (!keysWithin(node, ["type"])) return refuse();
            return { type: "horizontalRule" };
        case "blockquote":
        case "callout":
            if (!keysWithin(node, ["type", "content"])) return refuse();
            return {
                type: node.type,
                content: parseBlocks(node.content, budget, depth + 1),
            };
        case "details": {
            const parts = node.content;
            if (
                !keysWithin(node, ["type", "content"]) ||
                !Array.isArray(parts) ||
                parts.length !== 2 ||
                !isObject(parts[0]) ||
                !isObject(parts[1]) ||
                parts[0].type !== "detailsSummary" ||
                parts[1].type !== "detailsContent" ||
                !keysWithin(parts[0], ["type", "content"]) ||
                !keysWithin(parts[1], ["type", "content"])
            )
                return refuse();
            budget.nodes += 2;
            const summary = parseInline(parts[0].content, budget);
            return {
                type: "details",
                content: [
                    summary
                        ? { type: "detailsSummary", content: summary }
                        : { type: "detailsSummary" },
                    {
                        type: "detailsContent",
                        content: parseBlocks(
                            parts[1].content,
                            budget,
                            depth + 1,
                        ),
                    },
                ],
            };
        }
        case "bulletList":
            if (!keysWithin(node, ["type", "content"])) return refuse();
            return {
                type: "bulletList",
                content: parseItems(node.content, "listItem", budget, depth),
            };
        case "orderedList": {
            const start = isObject(node.attrs) ? node.attrs.start : undefined;
            if (
                !keysWithin(node, ["type", "attrs", "content"]) ||
                !isObject(node.attrs) ||
                !keysWithin(node.attrs, ["start"]) ||
                !Number.isInteger(start) ||
                (start as number) < 0 ||
                (start as number) > 1_000_000
            )
                return refuse();
            return {
                type: "orderedList",
                attrs: { start: start as number },
                content: parseItems(node.content, "listItem", budget, depth),
            };
        }
        case "taskList":
            if (!keysWithin(node, ["type", "content"])) return refuse();
            return {
                type: "taskList",
                content: parseItems(node.content, "taskItem", budget, depth),
            };
        default:
            return refuse();
    }
}

/** The document exactly as stored, or null when any part of it is not one
 * this model names (an unknown node or mark, an extra attribute, a link to
 * anything but the web, or more nesting than a message needs). */
export function parseFormattedDoc(value: unknown): FormattedDoc | null {
    try {
        if (
            !isObject(value) ||
            value.type !== "doc" ||
            !keysWithin(value, ["type", "content"])
        )
            return null;
        return {
            type: "doc",
            content: parseBlocks(value.content, { nodes: 0 }, 0),
        };
    } catch (error) {
        if (error instanceof Refused) return null;
        throw error;
    }
}

const prefixLines = (text: string, first: string, rest = first) =>
    text
        .split("\n")
        .map((line, index) => (index ? rest : first) + line)
        .join("\n");

function inlineText(content: FormattedInline[] | undefined): string {
    return (content || [])
        .map((node) => {
            if (node.type === "hardBreak") return "\n";
            if (node.type === "image") return imageText(node);
            let text = node.text;
            const marks = node.marks || [];
            const has = (type: FormattedMark["type"]) =>
                marks.some((mark) => mark.type === type);
            if (has("code")) text = `\`${text}\``;
            if (has("italic")) text = `_${text}_`;
            if (has("bold")) text = `**${text}**`;
            const link = marks.find((mark) => mark.type === "link");
            if (link?.type === "link")
                text =
                    node.text === link.attrs.href
                        ? link.attrs.href
                        : `[${text}](${link.attrs.href})`;
            return text;
        })
        .join("");
}

/** An image in words: `![alt]`, `![]` without alt. */
const imageText = (node: FormattedImage) => `![${node.attrs.alt || ""}]`;

function blocksText(blocks: FormattedBlock[]): string {
    return blocks.map(blockText).join("\n");
}

function blockText(block: FormattedBlock): string {
    switch (block.type) {
        case "paragraph":
            return inlineText(block.content);
        case "heading":
            return `${"#".repeat(block.attrs.level)} ${inlineText(block.content)}`;
        case "codeBlock":
            return `\`\`\`\n${inlineText(block.content)}\n\`\`\``;
        case "horizontalRule":
            return "---";
        case "blockquote":
            return prefixLines(blocksText(block.content), "> ");
        case "callout":
            return `> [!NOTE]\n${prefixLines(blocksText(block.content), "> ")}`;
        case "details":
            return `▸ ${inlineText(block.content[0].content)}\n${prefixLines(
                blocksText(block.content[1].content),
                "  ",
            )}`;
        case "bulletList":
            return block.content
                .map((item) =>
                    prefixLines(blocksText(item.content), "- ", "  "),
                )
                .join("\n");
        case "orderedList":
            return block.content
                .map((item, index) => {
                    const marker = `${block.attrs.start + index}. `;
                    return prefixLines(
                        blocksText(item.content),
                        marker,
                        " ".repeat(marker.length),
                    );
                })
                .join("\n");
        case "taskList":
            return block.content
                .map((item) =>
                    prefixLines(
                        blocksText(item.content),
                        item.attrs.checked ? "- [x] " : "- [ ] ",
                        "  ",
                    ),
                )
                .join("\n");
    }
}

/** The message's words in Markdown style, one line per paragraph: what
 * search, previews, mail and agents read. A document that is only plain
 * paragraphs gives exactly the text a plain field would have held. */
export function formattedText(doc: FormattedDoc): string {
    return blocksText(doc.content);
}

function inlineWords(content: FormattedInline[] | undefined): string {
    return (content || [])
        .map((node) =>
            node.type === "hardBreak"
                ? "\n"
                : node.type === "image"
                  ? imageText(node)
                  : node.text,
        )
        .join("");
}

/** This package targets a library without Array.prototype.flatMap. */
const flat = <T>(groups: T[][]): T[] => ([] as T[]).concat(...groups);

function itemWords(content: FormattedBlock[], marker: string): string[] {
    return blocksWords(content).map((line, i) =>
        i ? line : `${marker} ${line}`,
    );
}

function blocksWords(blocks: FormattedBlock[]): string[] {
    return flat(blocks.map(blockWords));
}

function blockWords(block: FormattedBlock): string[] {
    switch (block.type) {
        case "paragraph":
        case "heading":
        case "codeBlock":
            return [inlineWords(block.content)];
        case "horizontalRule":
            return [];
        case "blockquote":
        case "callout":
            return blocksWords(block.content);
        case "details":
            return [
                `▸ ${inlineWords(block.content[0].content)}`,
                ...blocksWords(block.content[1].content),
            ];
        case "bulletList":
            return flat(
                block.content.map((item) => itemWords(item.content, "•")),
            );
        case "orderedList":
            return flat(
                block.content.map((item, index) =>
                    itemWords(item.content, `${block.attrs.start + index}.`),
                ),
            );
        case "taskList":
            return flat(
                block.content.map((item) =>
                    itemWords(item.content, item.attrs.checked ? "☑" : "☐"),
                ),
            );
    }
}

/** The message's words without Markdown markers, for a one- or two-line
 * preview: list items keep a •, number or box; nothing else is marked. */
export function formattedWords(doc: FormattedDoc): string {
    return blocksWords(doc.content).join("\n");
}

/** True when the document holds nothing a plain field could not: only
 * paragraphs of unmarked text, without images or soft breaks. Such a message is stored as text
 * alone. */
export function formattedIsPlain(doc: FormattedDoc): boolean {
    return doc.content.every(
        (block) =>
            block.type === "paragraph" &&
            (block.content || []).every(
                (node) => node.type === "text" && !node.marks,
            ),
    );
}

/** Plain text as a document: one paragraph per line. */
export function formattedFromText(text: string): FormattedDoc {
    return {
        type: "doc",
        content: text.split("\n").map((line) =>
            line
                ? {
                      type: "paragraph",
                      content: [{ type: "text", text: line }],
                  }
                : { type: "paragraph" },
        ),
    };
}

export const sameFormattedDoc = (left: FormattedDoc, right: FormattedDoc) =>
    JSON.stringify(left) === JSON.stringify(right);
