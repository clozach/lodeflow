// Shadow-DOM stylesheet. Every colour is a custom property the host page can override.

export const CSS = /* css */ `
:host {
  --lf-bg: #faf8f4;
  --lf-fg: #1f1c18;
  --lf-muted: #6f6a61;
  --lf-node-bg: #ffffff;
  --lf-node-border: #d8d2c6;
  --lf-node-shadow: 0 1px 2px rgba(40, 32, 20, .06), 0 2px 8px rgba(40, 32, 20, .05);
  --lf-accent: #2f62d8;
  --lf-accent-soft: rgba(47, 98, 216, .12);
  --lf-edge: #9a9385;
  --lf-edge-back: #c2410c;
  --lf-group-bg: rgba(47, 98, 216, .045);
  --lf-group-border: rgba(47, 98, 216, .32);
  --lf-group-fg: #3d4f7a;
  --lf-ui-bg: rgba(255, 255, 255, .92);
  --lf-ui-border: rgba(31, 28, 24, .12);
  --lf-ui-hover: rgba(31, 28, 24, .07);
  --lf-ui-shadow: 0 6px 24px rgba(30, 24, 12, .14), 0 1px 3px rgba(30, 24, 12, .1);
  --lf-focus: #2f62d8;
  --lf-font: inherit;
  --lf-ui-font: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --lf-node-width: 176px;
  --lf-node-radius: 10px;
  --lf-node-border-width: 1px;
  --lf-edge-width: 1.6px;
  --lf-edge-hover-width: 2.6px;
  --lf-edge-hot-width: 2.4px;
  --lf-edge-selected-width: 3.2px;
  --lf-selection-width: 2px;
  display: block;
  position: relative;
  height: var(--lf-height, 440px);
  min-height: 160px;
  color: var(--lf-fg);
  font-family: var(--lf-font);
  contain: strict;
}
:host([theme="dark"]) { color-scheme: dark; }
@media (prefers-color-scheme: dark) {
  :host(:not([theme="light"]):not([theme="blueprint"])) {
    --lf-bg: #16171a; --lf-fg: #ebe8e2; --lf-muted: #a19b90;
    --lf-node-bg: #22242a; --lf-node-border: #3b3e46;
    --lf-node-shadow: 0 1px 2px rgba(0,0,0,.4), 0 2px 10px rgba(0,0,0,.25);
    --lf-accent: #7aa2ff; --lf-accent-soft: rgba(122,162,255,.16);
    --lf-edge: #7d8490; --lf-edge-back: #f0915a;
    --lf-group-bg: rgba(122,162,255,.06); --lf-group-border: rgba(122,162,255,.38); --lf-group-fg: #b4c6f5;
    --lf-ui-bg: rgba(34,36,42,.94); --lf-ui-border: rgba(255,255,255,.12); --lf-ui-hover: rgba(255,255,255,.08);
    --lf-ui-shadow: 0 6px 24px rgba(0,0,0,.45), 0 1px 3px rgba(0,0,0,.35);
    --lf-focus: #7aa2ff;
    color-scheme: dark;
  }
}
:host([theme="dark"]) {
  --lf-bg: #16171a; --lf-fg: #ebe8e2; --lf-muted: #a19b90;
  --lf-node-bg: #22242a; --lf-node-border: #3b3e46;
  --lf-node-shadow: 0 1px 2px rgba(0,0,0,.4), 0 2px 10px rgba(0,0,0,.25);
  --lf-accent: #7aa2ff; --lf-accent-soft: rgba(122,162,255,.16);
  --lf-edge: #7d8490; --lf-edge-back: #f0915a;
  --lf-group-bg: rgba(122,162,255,.06); --lf-group-border: rgba(122,162,255,.38); --lf-group-fg: #b4c6f5;
  --lf-ui-bg: rgba(34,36,42,.94); --lf-ui-border: rgba(255,255,255,.12); --lf-ui-hover: rgba(255,255,255,.08);
  --lf-ui-shadow: 0 6px 24px rgba(0,0,0,.45), 0 1px 3px rgba(0,0,0,.35);
  --lf-focus: #7aa2ff;
}
:host([theme="blueprint"]) {
  color-scheme: dark;
  --lf-bg: #0b3454; --lf-fg: #eef9ff; --lf-muted: #a7c9df;
  --lf-canvas-background:
    repeating-linear-gradient(0deg, transparent 0 23px, #b9ddff0a 23px 24px),
    repeating-linear-gradient(90deg, transparent 0 23px, #b9ddff0a 23px 24px),
    repeating-linear-gradient(0deg, transparent 0 119px, #b9ddff10 119px 120px),
    repeating-linear-gradient(90deg, transparent 0 119px, #b9ddff10 119px 120px), #0b3454;
  --lf-font: ui-monospace, "SFMono-Regular", Consolas, monospace;
  --lf-node-bg: #0b3454; --lf-node-border: #c2e4fb; --lf-node-shadow: none;
  --lf-node-radius: 2px; --lf-node-border-width: 1px;
  --lf-edge: #d8efff; --lf-edge-back: #f7c78f;
  --lf-edge-width: 1.2px; --lf-edge-hover-width: 2px; --lf-edge-hot-width: 2px; --lf-edge-selected-width: 3px;
  --lf-accent: #ffe45c; --lf-accent-soft: #ffe45c2e; --lf-focus: #8adeff;
  --lf-group-bg: #8adeff08; --lf-group-border: #87b5d2; --lf-group-fg: #d8efff;
  --lf-ui-bg: #08283ff5; --lf-ui-border: #6b9cb6; --lf-ui-hover: #8adeff20;
  --lf-ui-shadow: 0 4px 20px #041a2966;
}
* { box-sizing: border-box; }
.vp {
  position: absolute; inset: 0; overflow: hidden; background: var(--lf-canvas-background, var(--lf-bg));
  outline: none; cursor: default; touch-action: pan-x pan-y; user-select: none; -webkit-user-select: none;
  border-radius: inherit;
}
/* Whether keys reach the diagram: thin with a selection, thick with none (↵ selects the top level). */
.ring { position: absolute; inset: 0; pointer-events: none; border-radius: inherit; box-shadow: none; }
.ring.on { box-shadow: inset 0 0 0 var(--lf-focus-ring-width, 1px) var(--lf-focus); }
.ring.on.empty { box-shadow: inset 0 0 0 var(--lf-focus-ring-empty-width, 2px) var(--lf-focus-ring-empty-color, var(--lf-accent)); }
.vp.active, .vp.captured { touch-action: none; }
.vp.panning, .vp.panning * { cursor: grabbing !important; }
.world { position: absolute; left: 0; top: 0; transform-origin: 0 0; }
.world.moving { will-change: transform; }
svg.layer { position: absolute; left: 0; top: 0; width: 1px; height: 1px; overflow: visible; }
.gbox { fill: var(--lf-group-bg); stroke: var(--lf-group-border); stroke-width: 1.25; cursor: pointer; }
.gbox:hover { stroke-width: 2; }
.gbox.sel { stroke: var(--lf-accent); stroke-width: 2.5; fill: var(--lf-accent-soft); }
.edge { fill: none; stroke: var(--lf-edge); stroke-width: var(--lf-edge-width); stroke-linecap: round; }
.edge.back { stroke: var(--lf-edge-back); stroke-dasharray: 6 5; }
.edge.hot { stroke: var(--lf-accent); stroke-width: var(--lf-edge-hot-width); }
.edge.back.hot { stroke: var(--lf-edge-back); }
.arrow { fill: var(--lf-edge); }
.arrow.back { fill: var(--lf-edge-back); }
.arrow.hot { fill: var(--lf-accent); }
.edge.hover { stroke-width: var(--lf-edge-hover-width); }
/* Hover darkens a plain edge's own grey, never blue: blue means selected, or touching the selection. */
.edge.hover:not(.hot):not(.back):not(.sel) { stroke: color-mix(in srgb, var(--lf-edge) 60%, var(--lf-fg)); }
.arrow.hover:not(.hot):not(.back):not(.sel) { fill: color-mix(in srgb, var(--lf-edge) 60%, var(--lf-fg)); }
.edge.sel { stroke: var(--lf-accent); stroke-width: var(--lf-edge-selected-width); }
.edge.back.sel { stroke: var(--lf-edge-back); stroke-width: var(--lf-edge-selected-width); }
.arrow.sel { fill: var(--lf-accent); }
.edge.link-ok { stroke: var(--lf-accent); stroke-width: 4; }
.edge.link-no { stroke: #b93a22; stroke-dasharray: 3 4; }
.vp.over-edge { cursor: pointer; }
.vp.linking, .vp.linking * { cursor: crosshair !important; }
.linkline { fill: none; stroke: var(--lf-muted); stroke-width: 2; stroke-dasharray: 6 5; stroke-linecap: round; pointer-events: none; }
.linkline.ok { stroke: var(--lf-accent); stroke-dasharray: none; }
.linkhead { fill: var(--lf-accent); pointer-events: none; }
.nodes { position: absolute; left: 0; top: 0; }
.node {
  position: absolute; left: 0; top: 0; width: var(--lf-node-width);
  padding: 9px 12px; border-radius: var(--lf-node-radius);
  background: var(--lf-node-bg); border: var(--lf-node-border-width) solid var(--lf-node-border); box-shadow: var(--lf-node-shadow);
  font: inherit; font-size: var(--lf-font-size, 14px); line-height: 1.38; color: var(--lf-fg);
  cursor: pointer; transform-origin: 50% 50%;
}
.node:hover { border-color: color-mix(in srgb, var(--lf-accent) 45%, var(--lf-node-border)); }
.node.action:focus-visible { outline: 2px solid var(--lf-focus); outline-offset: 4px; }
.node.action { touch-action: manipulation; text-align: inherit; appearance: none; }
.node.sel { border-color: var(--lf-accent); }
/* Paint rings separately: a consumer's shadow value of "none" is valid on its own,
   but would invalidate a comma-separated shadow list containing the selection ring. */
.node.sel::after, .node.editing::after, .proxy::before {
  content: ""; position: absolute; inset: calc(-1 * var(--lf-node-border-width));
  border-radius: inherit; pointer-events: none;
}
.node.sel::after { box-shadow: 0 0 0 var(--lf-selection-width) var(--lf-accent); }
.node.editing { cursor: text; box-shadow: none; }
.node.editing::after { box-shadow: 0 0 0 var(--lf-selection-width) var(--lf-accent), 0 0 0 6px var(--lf-accent-soft); }
.node.hidden { pointer-events: none; }
.node.link-ok { outline: 2px solid var(--lf-accent); outline-offset: 3px; }
.node.link-no { outline: 2px dashed #b93a22; outline-offset: 3px; }
/* Junction dots and edge labels: laid out like small nodes, so nothing covers them. */
.carrier {
  position: absolute; left: 0; top: 0; width: max-content; max-width: calc(var(--lf-node-width) * .72); min-width: 28px;
  padding: 3px 9px; border-radius: 999px; background: var(--lf-bg); border: 1.5px solid var(--lf-edge);
  font: 500 12.5px/1.3 var(--lf-ui-font); color: var(--lf-fg); text-align: center; cursor: pointer; transform-origin: 50% 50%;
}
.carrier .t { min-height: 1.3em; }
.carrier.dot { width: 12px; min-width: 0; height: 12px; padding: 0; background: var(--lf-edge); border: 2px solid var(--lf-bg); }
.carrier.dot .t { display: none; }
.carrier:hover, .carrier.hover { border-color: color-mix(in srgb, var(--lf-accent) 55%, var(--lf-edge)); }
.carrier.hot { border-color: var(--lf-accent); }
.carrier.back:not(.dot) { border-color: var(--lf-edge-back); border-style: dashed; }
.carrier.dot.hot, .carrier.dot.sel { background: var(--lf-accent); }
.carrier.sel { border-color: var(--lf-accent); box-shadow: 0 0 0 var(--lf-selection-width) var(--lf-accent); }
.carrier.editing { cursor: text; min-width: 96px; border-radius: 10px; box-shadow: 0 0 0 var(--lf-selection-width) var(--lf-accent), 0 0 0 6px var(--lf-accent-soft); }
.carrier textarea.ed { text-align: center; }
.t { white-space: pre-wrap; overflow-wrap: anywhere; min-height: 1.38em; }
.t:empty::before { content: attr(data-ph); color: var(--lf-muted); font-style: italic; }
textarea.ed {
  display: block; width: 100%; margin: 0; padding: 0; border: 0; outline: none; resize: none; overflow: hidden;
  background: transparent; color: inherit; font: inherit; line-height: inherit; white-space: pre-wrap; overflow-wrap: anywhere;
  user-select: text; -webkit-user-select: text;
}
textarea.ed::placeholder { color: var(--lf-muted); font-style: italic; }
.proxy { background: color-mix(in srgb, var(--lf-group-bg) 60%, var(--lf-node-bg)); border-color: var(--lf-group-border); }
.proxy::before { box-shadow: 3px 3px 0 -1px var(--lf-node-bg), 3px 3px 0 0 var(--lf-group-border); }
.proxy.sel { box-shadow: none; }
.proxy.sel::before { box-shadow: 3px 3px 0 -1px var(--lf-node-bg), 3px 3px 0 0 var(--lf-accent); }
.proxy .row { display: flex; align-items: flex-start; gap: 6px; }
.proxy .t { flex: 1; font-weight: 600; color: var(--lf-group-fg); }
.proxy .count { font: 500 11.5px/1.3 var(--lf-ui-font); color: var(--lf-muted); margin-top: 4px; }
.glabel {
  position: absolute; left: 0; top: 0; width: var(--lf-node-width);
  display: flex; align-items: flex-start; gap: 4px; padding: 0; border-radius: 6px;
  font: 600 12.5px/1.35 var(--lf-ui-font); color: var(--lf-group-fg); cursor: pointer;
}
.glabel .gt { flex: 1; white-space: pre-wrap; overflow-wrap: anywhere; min-height: 1.35em; padding-top: 1px; }
.glabel .gt:empty::before { content: attr(data-ph); color: var(--lf-muted); font-style: italic; font-weight: 500; }
.glabel.sel .gt { color: var(--lf-accent); }
.glabel textarea.ed { font: inherit; }
.chev {
  flex: none; width: 20px; height: 20px; display: inline-grid; place-items: center; padding: 0; margin: -1px 0 0 -2px;
  border: 0; border-radius: 5px; background: transparent; color: inherit; cursor: pointer;
}
.chev:hover { background: var(--lf-ui-hover); }
.chev svg { width: 14px; height: 14px; }
.empty {
  position: absolute; inset: 0; display: grid; place-items: center; pointer-events: none;
  font: 500 14px/1.5 var(--lf-ui-font); color: var(--lf-muted); text-align: center; padding: 24px;
}
.empty[hidden] { display: none; }
.ui kbd {
  font: 500 11px/1 ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--lf-muted);
  border: 1px solid var(--lf-ui-border); border-bottom-width: 2px; border-radius: 4px; padding: 2px 4px; background: transparent;
}
/* ---------- magnet controls ---------- */
.ui {
  position: absolute; left: 0; top: 0; z-index: 5;
  font: 500 12.5px/1.25 var(--lf-ui-font); color: var(--lf-fg);
  background: var(--lf-ui-bg); border: 1px solid var(--lf-ui-border); border-radius: 12px; box-shadow: var(--lf-ui-shadow);
  -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px);
  max-width: calc(100% - 16px);
}
.ui[hidden] { display: none; }
.bar { display: flex; flex-wrap: wrap; gap: 2px; padding: 4px; }
.puck .bar { flex-wrap: nowrap; align-items: flex-start; }
.puck-actions { display: flex; flex-wrap: wrap; gap: 2px; min-width: 0; }
.puck .help-toggle { flex: none; margin-left: auto; font-weight: 600; }
.mb {
  display: inline-flex; align-items: center; gap: 6px; min-height: 30px; padding: 5px 9px;
  border: 0; border-radius: 8px; background: transparent; color: inherit; font: inherit; cursor: pointer;
  white-space: normal; overflow-wrap: anywhere; text-align: left;
}
.mb:hover { background: var(--lf-ui-hover); }
.mb:active { transform: translateY(1px); }
.mb:focus-visible, .seg button:focus-visible, .num input:focus-visible, .sw:focus-visible, .disc:focus-visible {
  outline: 2px solid var(--lf-focus); outline-offset: 1px;
}
.mb[hidden] { display: none; }
.mb[disabled] { opacity: .45; cursor: default; }
.mb[disabled]:hover { background: transparent; }
.mb svg { width: 16px; height: 16px; flex: none; }
.mb.danger:hover { background: color-mix(in srgb, #d6452b 14%, transparent); color: #b93a22; }
.mb.primary { background: var(--lf-accent-soft); color: var(--lf-accent); }
.mb.primary:hover { background: color-mix(in srgb, var(--lf-accent) 22%, transparent); }
.mb.on { background: var(--lf-accent-soft); color: var(--lf-accent); }
/* Two-way buttons (Link, Select edge): ⇧ swaps the icon and lights the ⇧ key, in place, so nothing moves. */
.flip .fl { display: inline-grid; }
.flip .fl > svg { grid-area: 1 / 1; }
.flip .fl > svg + svg, .shift .flip .fl > svg:first-child { visibility: hidden; }
.shift .flip .fl > svg + svg { visibility: visible; }
.flip .keys { display: inline-flex; gap: 3px; }
.flip .keys kbd + kbd, .shift .flip .keys kbd:first-child { opacity: .5; }
.shift .flip .keys kbd + kbd { opacity: 1; }
.node-magnet.narrow { max-width: min(300px, calc(100% - 16px)); }
.sep { width: 1px; align-self: stretch; margin: 4px 2px; background: var(--lf-ui-border); }
.count-chip { align-self: center; padding: 0 8px; color: var(--lf-muted); }
.save-problem { align-self: center; margin: 0 4px; padding: 3px 8px; border-radius: 999px; font-weight: 600; color: #b93a22; background: color-mix(in srgb, #d6452b 12%, transparent); }
.pointer { position: absolute; width: 10px; height: 10px; background: var(--lf-ui-bg); border: 1px solid var(--lf-ui-border);
  transform: rotate(45deg); border-right: 0; border-bottom: 0; }
.pointer[hidden] { display: none; }
/* view panel */
.panel { width: 312px; padding: 10px 10px 8px; }
.panel h3 { margin: 0 0 2px; font: 600 11px/1.3 var(--lf-ui-font); letter-spacing: .04em; text-transform: uppercase; color: var(--lf-muted);
  display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.row2 { margin: 8px 0 10px; }
.seg { display: flex; flex-wrap: wrap; gap: 2px; padding: 2px; border-radius: 9px; background: var(--lf-ui-hover); }
.seg button {
  flex: 1 1 auto; min-width: 34px; min-height: 30px; padding: 4px 8px; border: 0; border-radius: 7px; background: transparent;
  color: inherit; font: inherit; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 4px;
}
.seg button:hover { background: var(--lf-ui-bg); }
.seg button[aria-pressed="true"] { background: var(--lf-ui-bg); color: var(--lf-accent); box-shadow: 0 1px 2px rgba(0,0,0,.12); font-weight: 600; }
.seg button svg { width: 16px; height: 16px; }
.hint { font: 400 11.5px/1.35 var(--lf-ui-font); color: var(--lf-muted); margin-top: 4px; }
.sw { display: inline-flex; align-items: center; gap: 8px; text-align: left; border: 0; background: transparent; color: inherit; font: inherit; cursor: pointer; padding: 4px 6px; border-radius: 8px; }
.sw:hover { background: var(--lf-ui-hover); }
.sw .track { width: 30px; height: 18px; border-radius: 9px; background: var(--lf-ui-border); position: relative; transition: background .15s; }
.sw .track::after { content: ""; position: absolute; left: 2px; top: 2px; width: 14px; height: 14px; border-radius: 50%; background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,.3); transition: transform .15s; }
.sw[aria-checked="true"] .track { background: var(--lf-accent); }
.sw[aria-checked="true"] .track::after { transform: translateX(12px); }
.disc { width: 100%; display: flex; justify-content: space-between; align-items: center; margin-top: 6px; padding: 6px 6px; border: 0; border-top: 1px solid var(--lf-ui-border);
  background: transparent; color: var(--lf-muted); font: inherit; cursor: pointer; border-radius: 0 0 6px 6px; }
.disc:hover { background: var(--lf-ui-hover); color: var(--lf-fg); }
.exh[hidden] { display: none; }
.num { display: grid; grid-template-columns: 1fr 86px; align-items: center; gap: 6px; margin: 4px 0; }
.num label { font: 500 12px/1.3 var(--lf-ui-font); }
.num input { width: 100%; padding: 4px 6px; border: 1px solid var(--lf-ui-border); border-radius: 6px; background: transparent; color: inherit; font: 500 12px var(--lf-ui-font); }
/* link list */
.linker { width: 300px; padding: 6px; display: flex; flex-direction: column; gap: 4px; }
.lk-head { display: flex; align-items: flex-start; gap: 6px; padding: 2px 0 0 6px; }
.lk-title { flex: 1; padding-top: 6px; font-weight: 600; overflow-wrap: anywhere; }
.lk-filter { width: 100%; padding: 6px 8px; border: 1px solid var(--lf-ui-border); border-radius: 8px; background: transparent; color: inherit; font: inherit; outline: none; }
.lk-filter:focus-visible { outline: 2px solid var(--lf-focus); outline-offset: 1px; }
.lk-receipt { display: flex; align-items: center; gap: 4px; padding: 2px 2px 2px 8px; border-radius: 8px; background: var(--lf-accent-soft); color: var(--lf-accent); }
.lk-receipt[hidden] { display: none; }
.lk-receipt span { flex: 1; overflow-wrap: anywhere; }
.lk-list { list-style: none; margin: 0; padding: 0; overflow-y: auto; overscroll-behavior: contain; }
.lk-h { padding: 8px 8px 2px; font: 600 11px/1.3 var(--lf-ui-font); letter-spacing: .04em; text-transform: uppercase; color: var(--lf-muted); }
.lk-checked { display: flex; align-items: center; gap: 4px; padding: 2px 2px 2px 8px; border-radius: 8px; background: var(--lf-accent-soft); color: var(--lf-accent); }
.lk-checked[hidden] { display: none; }
.lk-checked > span { flex: 1; }
.lk-item { display: flex; align-items: flex-start; gap: 8px; padding: 6px 8px; border-radius: 8px; cursor: pointer; overflow-wrap: anywhere; }
.lk-tx { flex: 1; min-width: 0; }
.lk-item.act { background: var(--lf-accent-soft); color: var(--lf-accent); }
.lk-item[aria-selected="true"]:not(.act) { background: color-mix(in srgb, var(--lf-accent) 7%, transparent); }
/* A row's checkbox: faint until hovered, active or checked; a click on it checks the row (touch has no ⌘). */
.lk-ck { flex: none; display: grid; place-items: center; width: 14px; height: 14px; margin-top: 2px; border: 1.5px solid currentColor; border-radius: 4px; opacity: .25; }
.lk-item:hover .lk-ck, .lk-item.act .lk-ck { opacity: .6; }
.lk-item[aria-selected="true"] .lk-ck { opacity: 1; background: var(--lf-accent); border-color: var(--lf-accent); }
.lk-item[aria-selected="true"] .lk-ck::after { content: ""; width: 7px; height: 3.5px; margin-top: -2px; border: solid var(--lf-ui-bg); border-width: 0 0 1.8px 1.8px; transform: rotate(-45deg); }
.lk-item.empty .lk-t { font-style: italic; color: var(--lf-muted); }
.lk-item.is-edge .lk-t::before { content: "→ "; color: var(--lf-muted); }
.lk-s { display: block; font-size: 11.5px; color: var(--lf-muted); }
.lk-none { padding: 10px 8px; color: var(--lf-muted); }
.lk-foot { padding: 2px 6px 2px; font-size: 11.5px; color: var(--lf-muted); }
/* way back */
.vp.touch ~ .ui kbd, .vp.touch ~ .ui .keys, .vp.touch ~ .ui .key-hint { display: none; }
@media (any-pointer: coarse) {
  .ui kbd, .ui .keys, .ui .key-hint { display: none; }
}
/* help */
.help { width: min(560px, calc(100% - 24px)); max-height: calc(100% - 24px); overflow: auto; padding: 14px 16px; }
.help h2 { margin: 0 0 8px; font: 600 15px/1.3 var(--lf-ui-font); display: flex; justify-content: space-between; align-items: center; }
.help table { width: 100%; border-collapse: collapse; font: 400 12.5px/1.4 var(--lf-ui-font); }
.help td { padding: 4px 6px; border-top: 1px solid var(--lf-ui-border); vertical-align: top; }
.help td:first-child { white-space: nowrap; color: var(--lf-muted); width: 1%; }
.help h4 { margin: 12px 0 4px; font: 600 11px/1.3 var(--lf-ui-font); text-transform: uppercase; letter-spacing: .04em; color: var(--lf-muted); }
.marquee { position: absolute; border: 1px solid var(--lf-accent); background: var(--lf-accent-soft); pointer-events: none; z-index: 4; }
.marquee[hidden] { display: none; }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.nudge { position: absolute; z-index: 6; padding: 6px 10px; pointer-events: none; font: 500 12px/1.3 var(--lf-ui-font);
  background: var(--lf-ui-bg); border: 1px solid var(--lf-ui-border); border-radius: 8px; box-shadow: var(--lf-ui-shadow); }
.nudge[hidden] { display: none; }
/* A graph embed borrows only the layout and drawing; its host owns actions and scrolling. */
:host([presentation="graph"]) { min-height: 0; }
:host([presentation="graph"]) .vp { background: transparent; touch-action: pan-x pan-y; }
:host([presentation="graph"]) .ui,
:host([presentation="graph"]) .ring,
:host([presentation="graph"]) .chev,
:host([presentation="graph"]) .nudge,
:host([presentation="graph"]) .marquee { display: none !important; }
:host([presentation="graph"]) .node:not(.action),
:host([presentation="graph"]) .gbox,
:host([presentation="graph"]) .carrier { cursor: default; }
:host([presentation="graph"]) .node:not(.action):hover { border-color: var(--lf-node-border); }
:host([presentation="graph"]) .node:not(.action).sel:hover { border-color: var(--lf-accent); }
:host([presentation="graph"]) .gbox:hover { stroke-width: 1.25; }
@media (prefers-reduced-motion: reduce) { .sw .track, .sw .track::after { transition: none; } }
`;
