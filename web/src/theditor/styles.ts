// Formatted text in nodes: the content's own look (shared by the drawn node and its editor), the
// editor's surface and ProseMirror's base rules (inside the shadow root, where the page's head
// stylesheet cannot reach).
import { FORMATTED_IMAGE_DEFAULTS } from './vendor/formatted-message';

/** A picture at the default width: its wrapper's inline style starts with the default (image-css.ts). */
const DEFAULT_WIDTH = `--kk-fm-image-width: ${FORMATTED_IMAGE_DEFAULTS.width}`;
const defaultWidth = `:is([style="${DEFAULT_WIDTH}"], [style^="${DEFAULT_WIDTH};"])`;

export const THEDITOR_CSS = /* css */ `
.t.fm, .fm-ed {
  --lf-fm-rule: color-mix(in srgb, currentColor 22%, transparent);
  --lf-fm-tint: color-mix(in srgb, currentColor 7%, transparent);
  --kk-composer-accent: var(--lf-accent);
}
/* The image stylesheet's dark rules hang off a .dark page class; a diagram's own dark theme gets the same
   (the printed-photo paper stays light, shadows deepen). */
:host([theme="dark"]) { --kk-fm-image-paper: #f3ede2; }
:host([theme="dark"]) .kk-fm-image[data-look="inset"] { box-shadow: inset 0 1px 4px rgb(0 0 0 / .5), inset 0 0 0 1px rgb(255 255 255 / .08); }
:host([theme="dark"]) .kk-fm-image:is([data-look="floating"], [data-look="physical"]) { box-shadow: 0 2px 6px rgb(0 0 0 / .5), 0 10px 24px rgb(0 0 0 / .4); }
@media (prefers-color-scheme: dark) {
  :host(:not([theme="light"]):not([theme="blueprint"])) { --kk-fm-image-paper: #f3ede2; }
  :host(:not([theme="light"]):not([theme="blueprint"])) .kk-fm-image[data-look="inset"] { box-shadow: inset 0 1px 4px rgb(0 0 0 / .5), inset 0 0 0 1px rgb(255 255 255 / .08); }
  :host(:not([theme="light"]):not([theme="blueprint"])) .kk-fm-image:is([data-look="floating"], [data-look="physical"]) { box-shadow: 0 2px 6px rgb(0 0 0 / .5), 0 10px 24px rgb(0 0 0 / .4); }
}
:is(.t.fm, .fm-ed .ProseMirror) > :first-child { margin-top: 0; }
:is(.t.fm, .fm-ed .ProseMirror) > :last-child { margin-bottom: 0; }
/* Thumb layout, for a page to set on <lode-flow> (custom properties reach into the shadow root):
   --lf-thumb-cols pictures per row (default 3: a third of the row, as image-css.ts's .333 leaves rounding slack) and
   --lf-thumb-min a floor on a thumb's width (default 0px; a floor wider than a row's share wraps it).
   A picture whose width was set (the fork's style magnets) keeps it. */
:is(.t.fm, .fm-ed) .kk-fm-image${defaultWidth} {
  width: max(var(--lf-thumb-min, 0px), calc(99.9% / var(--lf-thumb-cols, 3) - var(--kk-fm-image-gap)));
}
/* Block margins only: a line holding images lends its trailing gap back (image-css.ts). */
:is(.t.fm, .fm-ed) p { margin-block: 0; }
:is(.t.fm, .fm-ed) :is(h1, h2, h3, h4) { margin-block: .45em .15em; font-weight: 650; line-height: 1.25; }
:is(.t.fm, .fm-ed) h1 { font-size: 1.3em; }
:is(.t.fm, .fm-ed) h2 { font-size: 1.16em; }
:is(.t.fm, .fm-ed) h3 { font-size: 1.06em; }
:is(.t.fm, .fm-ed) h4 { font-size: 1em; }
:is(.t.fm, .fm-ed) :is(ul, ol) { margin: .15em 0; padding-left: 1.3em; }
:is(.t.fm, .fm-ed) ul { list-style: disc; }
:is(.t.fm, .fm-ed) ol { list-style: decimal; }
:is(.t.fm, .fm-ed) ul[data-type="taskList"] { list-style: none; padding-left: .1em; }
:is(.t.fm, .fm-ed) ul[data-type="taskList"] > li { display: flex; align-items: flex-start; gap: .4em; }
:is(.t.fm, .fm-ed) ul[data-type="taskList"] > li > label { flex: none; display: inline-flex; align-items: center; height: 1.38em; user-select: none; }
:is(.t.fm, .fm-ed) ul[data-type="taskList"] > li > div { flex: 1; min-width: 0; }
:is(.t.fm, .fm-ed) ul[data-type="taskList"] > li[data-checked="true"] > div { color: color-mix(in srgb, currentColor 60%, transparent); }
:is(.t.fm, .fm-ed) ul[data-type="taskList"] input[type="checkbox"] { width: 1em; height: 1em; margin: 0; accent-color: var(--lf-accent); }
:is(.t.fm, .fm-ed) blockquote { margin: .2em 0; padding-left: .7em; border-left: 3px solid var(--lf-fm-rule); color: color-mix(in srgb, currentColor 80%, transparent); }
:is(.t.fm, .fm-ed) .kk-fm-callout { margin: .3em 0; padding: .45em .65em; border-radius: 7px; border-left: 3px solid var(--lf-accent); background: color-mix(in srgb, var(--lf-accent) 9%, transparent); }
:is(.t.fm, .fm-ed) .kk-fm-details { margin: .2em 0; }
:is(.t.fm, .fm-ed) .kk-fm-summary { position: relative; padding-left: 1.1em; font-weight: 600; }
:is(.t.fm, .fm-ed) .kk-fm-summary::before { content: "▸"; position: absolute; left: .1em; font-weight: 400; color: color-mix(in srgb, currentColor 60%, transparent); }
/* ▾ while open (a drawn node always shows a toggle's contents); ⌘↵ in the editor closes it to ▸. */
:is(.t.fm, .fm-ed) .kk-fm-details:not([data-open="false"]) > .kk-fm-summary::before { content: "▾"; }
:is(.t.fm, .fm-ed) .kk-fm-details-content { margin-top: .1em; padding-left: 1.1em; }
:is(.t.fm, .fm-ed) code { padding: .08em .28em; border-radius: 4px; background: var(--lf-fm-tint); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .88em; }
:is(.t.fm, .fm-ed) pre { margin: .3em 0; padding: .45em .6em; border-radius: 7px; background: var(--lf-fm-tint); white-space: pre-wrap; overflow-wrap: anywhere; }
:is(.t.fm, .fm-ed) pre code { padding: 0; background: none; font-size: .86em; }
:is(.t.fm, .fm-ed) hr { margin: .5em 0; border: 0; border-top: 1px solid var(--lf-fm-rule); }
:is(.t.fm, .fm-ed) strong { font-weight: 650; }
.fm-ed a { color: var(--lf-accent); text-decoration: underline; text-underline-offset: .12em; }
.fm-ed { position: relative; cursor: text; user-select: text; -webkit-user-select: text; }
.fm-ed .ProseMirror { outline: none; min-height: 1.38em; }
.fm-ed.fm-empty::before { content: attr(data-ph); position: absolute; left: 0; top: 0; color: var(--lf-muted); font-style: italic; pointer-events: none; }
.ProseMirror { position: relative; word-wrap: break-word; white-space: pre-wrap; white-space: break-spaces; font-variant-ligatures: none; font-feature-settings: "liga" 0; }
.ProseMirror [contenteditable="false"] { white-space: normal; }
.ProseMirror [contenteditable="false"] [contenteditable="true"] { white-space: pre-wrap; }
.ProseMirror pre { white-space: pre-wrap; }
img.ProseMirror-separator { display: inline !important; border: none !important; margin: 0 !important; width: 0 !important; height: 0 !important; }
.ProseMirror-gapcursor { display: none; pointer-events: none; position: absolute; margin: 0 !important; }
.ProseMirror-gapcursor::after { content: ""; display: block; position: absolute; top: -2px; width: 20px; border-top: 1px solid currentColor; animation: lf-pm-blink 1.1s steps(2, start) infinite; }
@keyframes lf-pm-blink { to { visibility: hidden; } }
.ProseMirror-focused .ProseMirror-gapcursor { display: block; }
.ProseMirror-hideselection *::selection { background: transparent; }
.ProseMirror-hideselection { caret-color: transparent; }
.ProseMirror-selectednode { outline: 2px solid var(--lf-accent); }
li.ProseMirror-selectednode { outline: none; }
@media (prefers-reduced-motion: reduce) { .ProseMirror-gapcursor::after { animation: none; } }
`;

/** theditor's magnets in a diagram: the shared stylesheets' colour roles from the diagram's theme. */
export const MAGNETS_CSS = /* css */ `
.kk-theditor { --theditor-accent: var(--lf-accent); --theditor-font: var(--lf-ui-font); }
.kk-theditor.dark { --theditor-popover: 225 10% 15%; --theditor-popover-foreground: 40 20% 90%; --theditor-border: 225 9% 26%; --theditor-muted-foreground: 38 8% 60%; }
:host([theme="blueprint"]) .kk-theditor { --theditor-popover: 206 77% 14%; --theditor-popover-foreground: 200 100% 97%; --theditor-border: 201 33% 56%; --theditor-muted-foreground: 203 47% 77%; }
`;
