/* icons.js — the vault's unit/concept glyphs for live controls: one
 * consistent 16×16 monochrome SVG per concept, stroke = currentColor. Used by
 * propsheet.js as the drag affordance inside a numeric field. Add a concept
 * here once; every property editor in the vault renders it the same way.
 *
 *   duration  (ms)    a stopwatch
 *   distance  (px)    a bracketed span
 *   speed     (px/s)  a double chevron
 *   height    (×)     a plain H
 *   scale     (×)     a box with a corner-to-corner arrow
 *   ratio     (:)     a diagonal between two dots
 *   position  (x,y)   crosshairs around a dot
 *   count     (n)     tally marks — a tally of discrete items ("hot list
 *                     length", "slides", "retries"); a plain how-many, not a
 *                     measured quantity
 *   drag              ⇔ — the pointer while scrubbing a value
 */
(function () {
  "use strict";
  var wrap = function (inner) {
    return '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + inner + "</svg>";
  };
  var ICONS = {
    duration: wrap('<circle cx="8" cy="9.5" r="5"/><path d="M8 2.5v2M6.5 2.5h3M8 9.5l2.3-2.3"/>'),
    distance: wrap('<path d="M2 4v8M14 4v8M2 8h12M5 6l-3 2 3 2M11 6l3 2-3 2"/>'),
    speed:    wrap('<path d="M3 4l4.5 4L3 12M8.5 4l4.5 4-4.5 4"/>'),
    height:   wrap('<path d="M4 3v10M12 3v10M4 8h8"/>'),
    scale:    wrap('<path d="M3 13V3h10M13 13V9M13 13H9M13 13L7 7"/>'),
    ratio:    wrap('<path d="M3 13L13 3"/><circle cx="4.5" cy="4.5" r="1.6"/><circle cx="11.5" cy="11.5" r="1.6"/>'),
    position: wrap('<path d="M8 2v3M8 11v3M2 8h3M11 8h3"/><circle cx="8" cy="8" r="1.8"/>'),
    count:    wrap('<path d="M4 4v8M8 4v8M12 4v8M2.5 11L13.5 5"/>'),
    drag:     wrap('<path d="M1.5 8h13M4.5 5l-3 3 3 3M11.5 5l3 3-3 3"/>')
  };

  // UMD tail, matching field-core.js. Three reasons this file cannot just
  // assign `window.Icons`:
  //   1. Under node/vitest/SSR there is no `window`, so a bare assignment
  //      throws at import and takes the whole test run with it.
  //   2. `window.Icons` is a global shared by every Obsidian plugin in the
  //      vault; whichever plugin loads last used to win. Consumers should
  //      take the module export and pass it in explicitly (jit-panel's
  //      mount({ icons }) does), treating the global as a fallback only.
  //   3. A consumer that vendors this file needs a value it can `require`.
  // The global is still written when one exists, so existing readers (propsheet.js)
  // keep working — but it never CLOBBERS a registry another copy already put there.
  if (typeof module !== "undefined" && module.exports) module.exports = ICONS;
  // `window` FIRST, then self, then globalThis. Deliberate: the vault's
  // loaders evaluate this file in a CommonJS wrapper with an INJECTED fake
  // `window` (jit-panel's shim, the rig, the test harnesses). Reaching for the
  // ambient globalThis first would drop the registry on the real global and
  // leave the caller's shim empty — which is exactly the regression this
  // ordering was fixed for on 2026-08-24.
  var g = typeof window !== "undefined" ? window
        : typeof self !== "undefined" ? self
        : typeof globalThis !== "undefined" ? globalThis : null;
  if (g && !g.Icons) g.Icons = ICONS;
})();
