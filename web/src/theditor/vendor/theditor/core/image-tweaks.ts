// Vendored copy; do not edit here. Canonical: theditor (projects/theditor/src/core/image-tweaks.ts).
// Refresh with `node projects/theditor/src/scripts/vendor-sync.mjs`; `--check` reports drift.
/**
 * The kitchen-sink editor's registry (Al, 2026-10-23): every image style a
 * person can tweak, found by name, by synonym or by a near miss, each row
 * showing its effective value (the override, else what the look draws) and
 * writing one canonical override into the image's `style` (or, for width,
 * its `width`). Pure data and functions: the React column reads this.
 */
import {
    FORMATTED_IMAGE_DEFAULTS,
    parseImageStyle,
    type FormattedImageAttrs,
    type FormattedImageLook,
} from "../../common-models";
import { matchTerm, tokenize } from "./search-text";
import { IMAGE_GAP, IMAGE_LOOK_BASE } from "../../image-css";

/** An image's attributes with every default filled in. */
export type FullImageAttrs = Required<FormattedImageAttrs>;

export function fullImageAttrs(attrs: FormattedImageAttrs): FullImageAttrs {
    return { ...FORMATTED_IMAGE_DEFAULTS, ...attrs } as FullImageAttrs;
}

/** What a row reads from: the image, and what its element really paints
 * (for values no look names, such as the frame's colour). */
export interface TweakContext {
    attrs: FullImageAttrs;
    computed?: { borderColor?: string; aspect?: number };
}

/** A canonical style as an ordered property map, and back. */
export function styleMap(style: string): Map<string, string> {
    const map = new Map<string, string>();
    for (const declaration of (parseImageStyle(style) ?? "").split("; ")) {
        const colon = declaration.indexOf(": ");
        if (colon > 0)
            map.set(declaration.slice(0, colon), declaration.slice(colon + 2));
    }
    return map;
}

function styleText(map: Map<string, string>): string | null {
    return parseImageStyle(
        Array.from(map, ([property, value]) => `${property}: ${value}`).join(
            "; ",
        ),
    );
}

/** A copy of the style with properties set (a value) or removed (null). */
export function withStyle(
    attrs: FullImageAttrs,
    changes: Record<string, string | null>,
): Partial<FormattedImageAttrs> {
    const map = styleMap(attrs.style);
    for (const [property, value] of Object.entries(changes)) {
        if (value === null) map.delete(property);
        else map.set(property, value);
    }
    const style = styleText(map);
    return style === null ? {} : { style };
}

const round = (value: number, places: number) =>
    Math.round(value * 10 ** places) / 10 ** places;
const px = (value: string | undefined) => {
    const match = value && /^(-?[\d.]+)px$/.exec(value.split(" ")[0]);
    return match ? parseFloat(match[1]) : null;
};
const unitless = (value: string | undefined, unit = "") => {
    const match = value && new RegExp(`^(-?[\\d.]+)${unit}$`).exec(value);
    return match ? parseFloat(match[1]) : null;
};

/* ---- Filters: one `filter`, its functions in a fixed order ---- */

const FILTERS = [
    { fn: "blur", unit: "px", neutral: 0 },
    { fn: "brightness", unit: "%", neutral: 100 },
    { fn: "contrast", unit: "%", neutral: 100 },
    { fn: "saturate", unit: "%", neutral: 100 },
    { fn: "grayscale", unit: "%", neutral: 0 },
    { fn: "sepia", unit: "%", neutral: 0 },
    { fn: "hue-rotate", unit: "deg", neutral: 0 },
] as const;
type FilterFn = (typeof FILTERS)[number]["fn"];

function filterParts(attrs: FullImageAttrs) {
    const known = new Map<string, number>();
    const other: string[] = [];
    const value = styleMap(attrs.style).get("filter");
    for (const part of value && value !== "none"
        ? value.match(/[a-z-]+\([^()]*(?:\([^()]*\)[^()]*)*\)/g) || []
        : []) {
        const match = /^([a-z-]+)\(([-\d.]+)(px|%|deg)?\)$/.exec(part);
        const spec = match && FILTERS.find((item) => item.fn === match[1]);
        if (spec && match) {
            // Amounts written as fractions (0.5) read as percentages.
            const amount = parseFloat(match[2]);
            known.set(
                spec.fn,
                spec.unit === "%" && !match[3] ? amount * 100 : amount,
            );
        } else other.push(part);
    }
    return { known, other };
}

function withFilter(
    attrs: FullImageAttrs,
    fn: FilterFn,
    amount: number | null,
) {
    const { known, other } = filterParts(attrs);
    if (amount === null) known.delete(fn);
    else known.set(fn, amount);
    const parts = FILTERS.filter(
        (spec) => known.has(spec.fn) && known.get(spec.fn) !== spec.neutral,
    ).map((spec) => `${spec.fn}(${known.get(spec.fn)}${spec.unit})`);
    const value = [...parts, ...other].join(" ");
    return withStyle(attrs, { filter: value || null });
}

/* ---- Shadow: the first outer layer, `0 y blur rgb(0 0 0 / a)` ---- */

function shadowOf(attrs: FullImageAttrs): [number, number, number] {
    const value = styleMap(attrs.style).get("box-shadow");
    const match =
        value &&
        /^0 (-?[\d.]+)(?:px)? ([\d.]+)(?:px)? rgb\(0 0 0 \/ ([\d.]+)\)$/.exec(
            value,
        );
    if (match)
        return [
            parseFloat(match[1]),
            parseFloat(match[2]),
            parseFloat(match[3]),
        ];
    const base = IMAGE_LOOK_BASE[attrs.look as FormattedImageLook].shadow;
    return [base[0], base[1], base[2]];
}

function withShadow(attrs: FullImageAttrs, part: 0 | 1 | 2, value: number) {
    const shadow = shadowOf(attrs);
    shadow[part] = value;
    return withStyle(attrs, {
        "box-shadow": `0 ${round(shadow[0], 1)}px ${round(shadow[1], 1)}px rgb(0 0 0 / ${round(shadow[2], 2)})`,
    });
}

/* ---- The registry ---- */

export type TweakControl =
    | {
          kind: "number";
          key: string;
          label: string;
          unit: string;
          min: number;
          max: number;
          step: number;
          icon: "distance" | "ratio" | "scale" | "drag";
          get: (ctx: TweakContext) => number;
          set: (
              ctx: TweakContext,
              value: number,
          ) => Partial<FormattedImageAttrs>;
      }
    | {
          kind: "choice";
          key: string;
          label: string;
          options: readonly string[];
          get: (ctx: TweakContext) => string;
          set: (
              ctx: TweakContext,
              value: string,
          ) => Partial<FormattedImageAttrs>;
      }
    | {
          kind: "color";
          key: string;
          label: string;
          get: (ctx: TweakContext) => string;
          set: (
              ctx: TweakContext,
              value: string,
          ) => Partial<FormattedImageAttrs>;
      }
    | {
          /** Words, written when Enter is pressed or the field is left. */
          kind: "text";
          key: string;
          label: string;
          /** The tooltip: what the words are for. */
          hint: string;
          placeholder: string;
          maxLength: number;
          get: (ctx: TweakContext) => string;
          set: (
              ctx: TweakContext,
              value: string,
          ) => Partial<FormattedImageAttrs>;
      };

export interface TweakRow {
    id: string;
    name: string;
    synonyms: readonly string[];
    /** Style properties this row writes; ↺ removes them all. `width` and
     * `alt` here mean the image's own attributes, not styles. */
    properties: readonly string[];
    controls: readonly TweakControl[];
}

const look = (ctx: TweakContext) =>
    IMAGE_LOOK_BASE[ctx.attrs.look as FormattedImageLook];
const style = (ctx: TweakContext, property: string) =>
    styleMap(ctx.attrs.style).get(property);

function lengthRow(
    id: string,
    name: string,
    property: string,
    synonyms: string[],
    max: number,
    base: (ctx: TweakContext) => number,
    extra?: (ctx: TweakContext, value: number) => Record<string, string | null>,
): TweakRow {
    return {
        id,
        name,
        synonyms,
        properties: [property],
        controls: [
            {
                kind: "number",
                key: property,
                label: name,
                unit: "px",
                min: 0,
                max,
                step: 1,
                icon: "distance",
                get: (ctx) => px(style(ctx, property)) ?? base(ctx),
                set: (ctx, value) =>
                    withStyle(ctx.attrs, {
                        [property]: `${round(value, 1)}px`,
                        ...extra?.(ctx, value),
                    }),
            },
        ],
    };
}

function filterRow(
    id: string,
    name: string,
    fn: FilterFn,
    synonyms: string[],
    range: [number, number],
    step = 1,
): TweakRow {
    const spec = FILTERS.find((item) => item.fn === fn)!;
    return {
        id,
        name,
        synonyms,
        properties: [`filter:${fn}`],
        controls: [
            {
                kind: "number",
                key: fn,
                label: name,
                unit: spec.unit,
                min: range[0],
                max: range[1],
                step,
                icon:
                    spec.unit === "deg"
                        ? "drag"
                        : spec.unit === "px"
                          ? "distance"
                          : "ratio",
                get: (ctx) =>
                    filterParts(ctx.attrs).known.get(fn) ?? spec.neutral,
                set: (ctx, value) => withFilter(ctx.attrs, fn, value),
            },
        ],
    };
}

function choiceRow(
    id: string,
    name: string,
    property: string,
    synonyms: string[],
    options: readonly string[],
    base: (ctx: TweakContext) => string,
): TweakRow {
    return {
        id,
        name,
        synonyms,
        properties: [property],
        controls: [
            {
                kind: "choice",
                key: property,
                label: name,
                options,
                get: (ctx) => style(ctx, property) ?? base(ctx),
                set: (ctx, value) =>
                    withStyle(ctx.attrs, {
                        [property]: value === base(ctx) ? null : value,
                    }),
            },
        ],
    };
}

/** The frame needs a line style to show: a width alone draws nothing. */
const frameLine = (ctx: TweakContext): Record<string, string | null> =>
    style(ctx, "border-style") || ctx.attrs.look === "physical"
        ? {}
        : { "border-style": "solid" };

function hex(color: string | undefined): string {
    if (!color) return "#000000";
    if (/^#[0-9a-f]{6}$/i.test(color)) return color.toLowerCase();
    if (/^#[0-9a-f]{3}$/i.test(color))
        return `#${color
            .slice(1)
            .split("")
            .map((c) => c + c)
            .join("")}`.toLowerCase();
    const rgb = /rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)/.exec(color);
    if (!rgb) return "#000000";
    return `#${rgb
        .slice(1, 4)
        .map((n) => Number(n).toString(16).padStart(2, "0"))
        .join("")}`;
}

export const TWEAK_ROWS: readonly TweakRow[] = [
    lengthRow(
        "corners",
        "corners",
        "border-radius",
        ["rounded", "radius", "round"],
        48,
        (ctx) => look(ctx).radius,
    ),
    lengthRow(
        "padding",
        "padding",
        "padding",
        ["inner space", "inset"],
        24,
        (ctx) => look(ctx).padding,
    ),
    lengthRow(
        "margin",
        "margin",
        "margin",
        ["outer space", "gap", "spacing"],
        32,
        () => IMAGE_GAP,
    ),
    lengthRow(
        "frame",
        "frame",
        "border-width",
        ["border", "outline", "stroke"],
        8,
        (ctx) => look(ctx).frame,
        frameLine,
    ),
    {
        id: "frame-color",
        name: "frame color",
        synonyms: ["border color", "stroke color", "colour"],
        properties: ["border-color"],
        controls: [
            {
                kind: "color",
                key: "border-color",
                label: "frame color",
                get: (ctx) =>
                    hex(
                        style(ctx, "border-color") ?? ctx.computed?.borderColor,
                    ),
                set: (ctx, value) =>
                    withStyle(ctx.attrs, {
                        "border-color": value.toLowerCase(),
                        ...((px(style(ctx, "border-width")) ?? look(ctx).frame)
                            ? {}
                            : { "border-width": "1px" }),
                        ...frameLine(ctx),
                    }),
            },
        ],
    },
    choiceRow(
        "frame-style",
        "frame style",
        "border-style",
        ["dashed", "dotted", "border style", "double"],
        ["solid", "dashed", "dotted", "double", "none"],
        (ctx) => (ctx.attrs.look === "physical" ? "solid" : "none"),
    ),
    {
        id: "shadow",
        name: "shadow",
        synonyms: ["drop shadow", "lift", "elevation"],
        properties: ["box-shadow"],
        controls: (
            [
                ["offset-y", "lift", 0, 24, 1, "px"],
                ["blur", "softness", 0, 48, 1, "px"],
                ["alpha", "strength", 0, 1, 0.01, ""],
            ] as const
        ).map(
            ([key, label, min, max, step, unit], part): TweakControl => ({
                kind: "number",
                key: `shadow-${key}`,
                label: `shadow ${label}`,
                unit,
                min,
                max,
                step,
                icon: unit ? "distance" : "ratio",
                get: (ctx) => shadowOf(ctx.attrs)[part],
                set: (ctx, value) =>
                    withShadow(ctx.attrs, part as 0 | 1 | 2, value),
            }),
        ),
    },
    {
        id: "opacity",
        name: "opacity",
        synonyms: ["transparency", "fade"],
        properties: ["opacity"],
        controls: [
            {
                kind: "number",
                key: "opacity",
                label: "opacity",
                unit: "",
                min: 0,
                max: 1,
                step: 0.01,
                icon: "ratio",
                get: (ctx) => unitless(style(ctx, "opacity")) ?? 1,
                set: (ctx, value) =>
                    withStyle(ctx.attrs, {
                        opacity: value >= 1 ? null : String(round(value, 2)),
                    }),
            },
        ],
    },
    filterRow("blur", "blur", "blur", ["soften"], [0, 12]),
    filterRow(
        "brightness",
        "brightness",
        "brightness",
        ["light", "exposure"],
        [0, 200],
    ),
    filterRow("contrast", "contrast", "contrast", [], [0, 200]),
    filterRow(
        "saturation",
        "saturation",
        "saturate",
        ["vivid", "colorful"],
        [0, 200],
    ),
    filterRow(
        "grayscale",
        "grayscale",
        "grayscale",
        ["greyscale", "black and white", "mono"],
        [0, 100],
    ),
    filterRow("sepia", "sepia", "sepia", ["vintage", "old"], [0, 100]),
    filterRow(
        "hue",
        "hue",
        "hue-rotate",
        ["tint", "colour shift"],
        [-180, 180],
    ),
    {
        id: "tilt",
        name: "tilt",
        synonyms: ["rotate", "angle"],
        properties: ["rotate"],
        controls: [
            {
                kind: "number",
                key: "rotate",
                label: "tilt",
                unit: "deg",
                min: -45,
                max: 45,
                step: 1,
                icon: "drag",
                get: (ctx) => unitless(style(ctx, "rotate"), "deg") ?? 0,
                set: (ctx, value) =>
                    withStyle(ctx.attrs, {
                        rotate: value ? `${round(value, 1)}deg` : null,
                    }),
            },
        ],
    },
    {
        id: "zoom",
        name: "zoom",
        synonyms: ["size up", "enlarge", "scale"],
        properties: ["scale"],
        controls: [
            {
                kind: "number",
                key: "scale",
                label: "zoom",
                unit: "×",
                min: 0.5,
                max: 2,
                step: 0.01,
                icon: "scale",
                get: (ctx) => unitless(style(ctx, "scale")) ?? 1,
                set: (ctx, value) =>
                    withStyle(ctx.attrs, {
                        scale: value === 1 ? null : String(round(value, 2)),
                    }),
            },
        ],
    },
    {
        id: "width",
        name: "width",
        synonyms: ["size", "columns", "wide"],
        properties: ["width"],
        controls: [
            {
                kind: "number",
                key: "width",
                label: "width",
                unit: "%",
                min: 10,
                max: 100,
                step: 0.1,
                icon: "ratio",
                get: (ctx) => round(ctx.attrs.width * 100, 1),
                set: (_ctx, value) => ({ width: round(value / 100, 3) }),
            },
        ],
    },
    {
        id: "crop",
        name: "crop",
        synonyms: ["fit", "fill", "square", "aspect ratio"],
        properties: ["object-fit", "aspect-ratio"],
        controls: [
            {
                kind: "choice",
                key: "object-fit",
                label: "crop fit",
                options: ["none", "cover", "contain", "fill"],
                get: (ctx) => style(ctx, "object-fit") ?? "none",
                set: (ctx, value) =>
                    withStyle(ctx.attrs, {
                        "object-fit": value === "none" ? null : value,
                        // Fit means nothing until the frame has a shape.
                        ...(value !== "none" && !style(ctx, "aspect-ratio")
                            ? { "aspect-ratio": "1 / 1" }
                            : {}),
                    }),
            },
            {
                kind: "number",
                key: "aspect-ratio",
                label: "crop shape",
                unit: ":1",
                min: 0.5,
                max: 2,
                step: 0.01,
                icon: "ratio",
                get: (ctx) => {
                    const value = style(ctx, "aspect-ratio");
                    const match = value && /^([\d.]+) \/ ([\d.]+)$/.exec(value);
                    return match
                        ? round(parseFloat(match[1]) / parseFloat(match[2]), 2)
                        : round(ctx.computed?.aspect ?? 1, 2);
                },
                set: (ctx, value) =>
                    withStyle(ctx.attrs, {
                        "aspect-ratio": `${round(value, 2)} / 1`,
                        ...(style(ctx, "object-fit")
                            ? {}
                            : { "object-fit": "cover" }),
                    }),
            },
        ],
    },
    choiceRow(
        "blend",
        "blend",
        "mix-blend-mode",
        ["multiply", "screen", "overlay", "blend mode"],
        [
            "normal",
            "multiply",
            "screen",
            "overlay",
            "darken",
            "lighten",
            "difference",
            "luminosity",
        ],
        () => "normal",
    ),
    {
        id: "shape",
        name: "shape",
        synonyms: ["circle", "round mask", "mask", "clip"],
        properties: ["clip-path"],
        controls: [
            {
                kind: "choice",
                key: "clip-shape",
                label: "shape",
                options: ["none", "circle", "inset"],
                get: (ctx) =>
                    /^(circle|inset)\(/.exec(
                        style(ctx, "clip-path") || "",
                    )?.[1] ?? "none",
                set: (ctx, value) =>
                    withStyle(ctx.attrs, {
                        "clip-path":
                            value === "circle"
                                ? "circle(50%)"
                                : value === "inset"
                                  ? "inset(8%)"
                                  : null,
                    }),
            },
            {
                kind: "number",
                key: "clip-amount",
                label: "shape amount",
                unit: "%",
                min: 0,
                max: 50,
                step: 1,
                icon: "ratio",
                get: (ctx) => {
                    const match = /^(?:circle|inset)\(([\d.]+)%\)$/.exec(
                        style(ctx, "clip-path") || "",
                    );
                    return match ? parseFloat(match[1]) : 50;
                },
                set: (ctx, value) => {
                    const shape = /^inset\(/.test(style(ctx, "clip-path") || "")
                        ? "inset"
                        : "circle";
                    return withStyle(ctx.attrs, {
                        "clip-path": `${shape}(${round(value, 1)}%)`,
                    });
                },
            },
        ],
    },
];

/** Whether the image holds an override this row would reset. */
export function rowOverridden(row: TweakRow, attrs: FullImageAttrs): boolean {
    const map = styleMap(attrs.style);
    const filters = filterParts(attrs).known;
    return row.properties.some((property) =>
        property === "width"
            ? attrs.width !== FORMATTED_IMAGE_DEFAULTS.width
            : property === "alt"
              ? attrs.alt !== FORMATTED_IMAGE_DEFAULTS.alt
              : property.startsWith("filter:")
                ? filters.has(property.slice(7))
                : map.has(property),
    );
}

/** The patch ↺ applies: the row's overrides removed. */
export function resetRow(
    row: TweakRow,
    attrs: FullImageAttrs,
): Partial<FormattedImageAttrs> {
    if (row.properties.includes("width"))
        return { width: FORMATTED_IMAGE_DEFAULTS.width };
    if (row.properties.includes("alt"))
        return { alt: FORMATTED_IMAGE_DEFAULTS.alt };
    const filter = row.properties.find((property) =>
        property.startsWith("filter:"),
    );
    if (filter) return withFilter(attrs, filter.slice(7) as FilterFn, null);
    return withStyle(
        attrs,
        Object.fromEntries(row.properties.map((property) => [property, null])),
    );
}

/** Rows whose name, synonyms or property match every typed word: exact,
 * prefix, inside a word, or (from four letters) one slip away; best first,
 * the registry's order breaking ties. A row's own name counts most, then its
 * synonyms, then the CSS property it writes. An empty query lists every row. */
export function searchTweaks(
    query: string,
    rows: readonly TweakRow[] = TWEAK_ROWS,
): TweakRow[] {
    const words = tokenize(query).map((token) => token.term);
    if (!words.length) return [...rows];
    const terms = (texts: readonly string[], weight: number) =>
        tokenize(texts.join(" ")).map((token) => ({
            term: token.term,
            weight,
        }));
    const scored: { row: TweakRow; score: number; order: number }[] = [];
    rows.forEach((row, order) => {
        const known = [
            ...terms([row.name], 1.5),
            ...terms(row.synonyms, 1),
            ...terms(
                row.properties.map((property) =>
                    property.replace("filter:", ""),
                ),
                0.6,
            ),
        ];
        let score = 0;
        for (const word of words) {
            const rule = {
                term: word,
                prefix: true,
                substring: word.length >= 3,
                typos: word.length >= 4 ? 1 : 0,
            };
            const best = Math.max(
                0,
                ...known.map(
                    ({ term, weight }) =>
                        (matchTerm(rule, term)?.factor ?? 0) * weight,
                ),
            );
            if (!best) return;
            score += best;
        }
        scored.push({ row, score, order });
    });
    return scored
        .sort((a, b) => b.score - a.score || a.order - b.order)
        .map((item) => item.row);
}
