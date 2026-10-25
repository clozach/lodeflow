// Vendored copy; do not edit here. Canonical: theditor (projects/theditor/src/vanilla/host-css.ts).
// Refresh with `node projects/theditor/src/scripts/vendor-sync.mjs`; `--check` reports drift.
/**
 * What the shared stylesheets (css/*.css) take from the page they live in:
 * the fork's site provides these through its design system; a vanilla host
 * gets them here. Sizes come from the design roles (design-measurements.ts),
 * so a magnet measures the same in both. Colour roles are overridable by the
 * host (`--theditor-*`), with light defaults and `.dark` ones.
 */
import { CONTROL_SIZE_FORMAT, CONTROL_SIZE_TOUCH, MAGNET_GAP, MAGNET_STACK_GAP } from "../../common-models";

export const HOST_CSS = /* css */ `
.kk-theditor {
    --kk-control-format-size: ${CONTROL_SIZE_FORMAT}px;
    --kk-control-touch-size: ${CONTROL_SIZE_TOUCH}px;
    --kk-magnet-gap: ${MAGNET_GAP}px;
    --kk-magnet-stack-gap: ${MAGNET_STACK_GAP}px;
    --kk-format-button-size: var(--kk-control-format-size);
    --kk-editor-radius: 9px;
    --kk-layer-message-tools: 40;
    --kk-composer-accent: var(--theditor-accent, #91462f);
    --popover: var(--theditor-popover, 0 0% 100%);
    --popover-foreground: var(--theditor-popover-foreground, 222.2 84% 4.9%);
    --border: var(--theditor-border, 214.3 31.8% 91.4%);
    --muted-foreground: var(--theditor-muted-foreground, 215.4 16.3% 46.9%);
    position: fixed;
    inset: 0 auto auto 0;
    width: 0;
    height: 0;
    z-index: var(--kk-layer-message-tools);
    font: 500 13px/1.25 var(--theditor-font, system-ui, -apple-system, "Segoe UI", sans-serif);
    color: hsl(var(--popover-foreground));
}
.kk-theditor.dark {
    --popover: var(--theditor-popover, 222.2 84% 4.9%);
    --popover-foreground: var(--theditor-popover-foreground, 210 40% 98%);
    --border: var(--theditor-border, 217.2 32.6% 17.5%);
    --muted-foreground: var(--theditor-muted-foreground, 215 20.2% 65.1%);
}
.kk-theditor *, .kk-theditor *::before, .kk-theditor *::after { box-sizing: border-box; }
.kk-theditor button { font: inherit; color: inherit; margin: 0; cursor: pointer; }
.kk-theditor button:disabled { cursor: default; }
/* The writing-tools dock: a fixed layer, revealed just in time (a selection,
   the pointer, or the keyboard in it); hidden, it stays in keyboard order. */
.kk-theditor .kk-message-tools-dock {
    position: fixed;
    display: flex;
    align-items: flex-end;
    gap: var(--kk-magnet-stack-gap) var(--kk-magnet-gap);
    pointer-events: none;
    transition: opacity 120ms ease-out;
}
.kk-theditor .kk-message-tools-dock[data-revealed="false"] { opacity: 0; }
.kk-theditor .kk-message-tools-dock[data-revealed="true"] > * { pointer-events: auto; }
.kk-theditor .kk-message-tools-dock[data-revealed="false"] > * { pointer-events: none; }
@media (pointer: coarse) {
    .kk-theditor .kk-message-tools-dock { --kk-format-button-size: var(--kk-control-touch-size); }
}
@media (prefers-reduced-motion: reduce) {
    .kk-theditor .kk-message-tools-dock { transition: none; }
}
.kk-theditor .kk-fm-magnet { display: inline-flex; align-items: center; justify-content: center; }
.kk-theditor .kk-fm-image-tools[hidden] { display: none; }
/* The link step covers the row. */
.kk-theditor .kk-fm-link-bar {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    gap: var(--kk-magnet-gap);
    padding: 0 4px;
    border: 1px solid hsl(var(--border));
    border-radius: calc(var(--kk-format-button-size) / 2);
    background: hsl(var(--popover));
    box-shadow: 0 2px 5px #39271c22;
}
.kk-theditor .kk-fm-link-bar input {
    flex: 1;
    min-width: 0;
    height: 28px;
    padding: 0 10px;
    border: 1px solid hsl(var(--border));
    border-radius: 14px;
    background: transparent;
    color: inherit;
    font: inherit;
}
.kk-theditor .kk-fm-link-bar input:focus-visible { outline: 2px solid var(--kk-composer-accent); outline-offset: 1px; }
.kk-theditor .kk-fm-link-bar button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: none;
    width: 28px;
    height: 28px;
    padding: 0;
    border: 1px solid hsl(var(--border));
    border-radius: 50%;
    background: hsl(var(--popover));
}
.kk-theditor .kk-fm-link-problem {
    position: absolute;
    left: 0;
    top: calc(100% + var(--kk-magnet-stack-gap));
    margin: 0;
    padding: 4px 8px;
    border-radius: 6px;
    background: hsl(var(--popover));
    color: #b42318;
    font-size: 12px;
    white-space: nowrap;
}
.kk-theditor.dark .kk-fm-link-problem { color: #fda29b; }
.kk-theditor .kk-fm-link-problem[hidden] { display: none; }
/* A chord a magnet carries (the fork's shortcut.css): hidden, so a magnet is
   only as wide as its face, until ⌘ is held on its own. */
.kk-theditor .kk-key {
    display: inline-block;
    padding: 1px 6px;
    border-radius: 6px;
    background: color-mix(in srgb, currentColor 10%, hsl(var(--popover)));
    font: inherit;
    font-size: 12px;
    font-weight: 500;
    line-height: 18px;
    white-space: nowrap;
    pointer-events: none;
}
.kk-theditor:not([data-kk-keys="shown"]) .kk-key { display: none !important; }
`;
