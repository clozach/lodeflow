/* field-core.js — the vault's canonical numeric property field ("the
 * propsheet field"). ONE implementation of the control every live property
 * editor in the vault needs; consumers vendor or import it, never hand-roll a
 * second one (vault AGENTS.md § component seams reify by DRY refactoring).
 *
 * CANONICAL SOURCE: pixel-reveal/src/component/field-core.js
 * A vendored COPY must carry a header naming that path (copies, never
 * symlinks — vault AGENTS.md § Obsidian plugin installs must be copies).
 *
 * Lineage: allisinbloom.art BloomTuner.svelte → tuner.js → propsheet.js
 * numberField() → NumberField.svelte (Al's Safari fix) → this extraction.
 *
 * THE CONTRACT (Al, 2026-08-21/24; spec prose in projects/pixel-reveal/AGENTS.md
 * § Propsheet › Fields):
 *   - Label ABOVE the control. The control is one bordered box: [icon][value+unit].
 *   - Drag the icon horizontally to scrub: right = up, one `step` per pixel.
 *     A plain capture-drag ONLY. ⚠️ NEVER Pointer Lock — Safari answers
 *     requestPointerLock() with a mandatory "Your mouse pointer is hidden"
 *     banner, unstyleable browser chrome that pushes the whole page down.
 *   - Click or Tab into the number to type. Enter or blur submits: every
 *     non-numeric character is stripped, the result clamped to [min,max] and
 *     re-rendered with the unit inline ("500 banana" → "500ms").
 *   - ↑/↓ nudge by `step`; ⇧ multiplies by 10 (⇧-drag too).
 *   - Escape reverts an unsubmitted edit; Escape DURING a drag cancels it.
 *   - Icons come from the ONE shared registry (icons.js) by concept name.
 *   - Labels are never truncated — they wrap (vault AGENTS.md § User-visible
 *     strings are never truncated). Enforced here with two inline styles so a
 *     consumer that forgets the CSS still obeys the rule. The VALUE obeys the
 *     same rule through `title` (the full painted string is always on the
 *     element) plus a content-sized `size` attribute, because an <input> clips
 *     by horizontal scroll — the one mechanism that rule bans outright.
 *
 * PREVIEW / COMMIT — the load-bearing split:
 *   onPreview(v)  every value change, including every pixel of a drag. Cheap
 *                 live redraw; this is also where a consumer with no setter
 *                 writes the live state (see § Ownership below).
 *   onCommit(v)   ONCE, when the interaction ends: mouseup / touchend / Enter
 *                 / blur / an arrow-key nudge. Expensive, durable work goes
 *                 here — the host app persists each committed value into a
 *                 GIT-TRACKED json that obsidian-git auto-commits, so a commit
 *                 per mousemove pixel would be dozens of vault writes a second
 *                 and a polluted history. allisinbloom's bloom shader needs the
 *                 per-pixel preview to redraw live. Both are served, neither
 *                 pays the other's cost.
 *   A commit fires only when the value actually CHANGED across the
 *   interaction — a click on the icon with no movement, or a blur with the
 *   text untouched, writes nothing. That guard is diffed against the LIVE
 *   value (every write path re-reads get() first), never against a stale
 *   repaint cache; when the live value is unknown (an async get() still in
 *   flight, or a get() that threw) the guard is skipped, because an explicit
 *   user action must never be optimised away.
 *
 * ERRORS — onPreview/onCommit may throw or return a rejecting promise:
 *   both are invoked through a wrapper. A sync throw and an async rejection
 *   are routed to spec.onError(err, { attempted, previous, phase }); nothing
 *   ever escapes as an unhandled rejection into the host renderer. A failed
 *   COMMIT additionally restores the previous value on screen (unless the user
 *   has since started typing or is mid-drag), so the field never keeps showing
 *   a number the consumer refused. A failed PREVIEW is reported only — during
 *   a drag there are sixty of them a second and unwinding each would fight the
 *   pointer.
 *
 * ESCAPE POLICY (satisfies both hosts):
 *   - pending edit + Escape  → revert, consume the key (preventDefault +
 *                              stopPropagation). The field ate it.
 *   - mid-drag + Escape      → cancel the scrub (restores the start value and
 *                              fires one preview so a get()-shape consumer can
 *                              unwind), consume the key. No commit.
 *   - no pending edit + Escape → do NOTHING and let it propagate, so the
 *                              host's Escape ladder gets it (jit-panel:
 *                              expanded tier → palette → closed, one level per
 *                              press). Ask hasPendingEdit() to reason about it
 *                              from a window-capture listener, which by
 *                              definition runs before this field's own.
 *   - Tab always propagates (host focus-cycle contract).
 *   - Every other bare/⇧ key is stopped — typing "5" must not fire the host's
 *     "5" shortcut — but any chord bearing ⌘/⌃/⌥ passes through untouched:
 *     those belong to the host app (⌘C, ⌘L, ⌥←; see the the slideshow host key
 *     bridge, 2026-08-24).
 *   handleKeydown() is idempotent per event object, so a host may route a key
 *   in for first refusal AND let the same event reach the input without the
 *   action firing twice.
 *
 * OWNERSHIP of the value. Two shapes, pick one:
 *   spec.get()      the consumer owns the number (propsheet/pulse shape). It
 *                   may return a Promise; the last known value is cached and
 *                   painted immediately, then repainted when the promise
 *                   resolves. Never blocks. onPreview is where you write the
 *                   new value back into your own state.
 *   spec.value      the field owns the number (React/ref shape). setValue()
 *                   and update({value}) drive it from outside.
 *   The spec object is SHALLOW-COPIED at construction, so two fields built
 *   from one long-lived registry entry never alias each other. Read/patch the
 *   copy through `field.spec` / `field.update()`; mutating the object you
 *   passed in has no effect (callbacks and get() still close over your state,
 *   which is the part that should stay shared).
 *
 * LOADING — no build step, no npm deps, no imports, ES5 syntax:
 *   (a) browser IIFE/global:  <script src="field-core.js"> then
 *                             window.PropsheetField.createNumberField(...)
 *   (b) Obsidian CommonJS:    eval this source in a CommonJS wrapper and read
 *                             module.exports. (Obsidian's require resolves
 *                             "obsidian" and bare ids ONLY — this file
 *                             require()s nothing, on purpose.)
 *   (c) ESM / Vite / TS:      import from the SIBLING field-core.mjs, never
 *                             from this file. `import PropsheetField from
 *                             "./field-core.js"` works only where node
 *                             resolves this file as CommonJS — inside a
 *                             package declaring "type": "module" (Vite,
 *                             SvelteKit, generative-canvas, stonks) it is a
 *                             hard SyntaxError at load. field-core.mjs
 *                             side-effect-imports this file and re-exports the
 *                             API as both a default and named exports;
 *                             field-core.d.ts types it for TypeScript.
 *   (d) React:                create once, keep the handle on a ref, call
 *                             update()/render() from an effect, destroy() on
 *                             unmount. Mount `el` into a container ref.
 *                             update() no longer clobbers an unsubmitted edit
 *                             (pass {force:true} for the old behaviour), so an
 *                             effect that re-runs on unrelated prop churn is
 *                             safe.
 *
 * CSS: this file ships one small CONTRACT stylesheet (PropsheetField.CSS) and
 * injects it once per document, because three of its rules are correctness,
 * not taste: the knob needs a size to be a grabbable drag target at all, the
 * focused control needs a ≥2px indicator (vault AGENTS.md § Keyboard focus
 * order — and propsheet's own skin sets outline:0), and long labels must wrap.
 * Every rule is written at zero or minimal specificity (`:where(...)`) and
 * keyed off data-psf-* attributes, so ANY consumer skin overrides it. It also
 * emits the propsheet class names (field / lbl / ctl / knob, + is-dragging) so
 * an existing propsheet skin styles it the rest of the way; override the class
 * names with spec.classes, and pass spec.injectCSS:false to suppress the
 * stylesheet entirely.
 *
 * KNOWN LOSSAGE, documented rather than papered over:
 *   - spec.format without a matching spec.parse is one-way. submit() no longer
 *     re-parses the field's own rendering (it returns early when nothing was
 *     typed), so a display like "3 of 9" is safe to sit there — but if the
 *     user edits it, parseTyped sees the digits your format added. Supply the
 *     inverse `parse` whenever `format` emits digits the value did not.
 *   - Exponent notation does not survive parsing ("1e3" → 13), because a unit
 *     is far likelier than an exponent in this control. formatValue never
 *     EMITS exponent notation, even past 1e21.
 */
(function () {
  "use strict";

  var VERSION = "1.1.0";
  var MAX_DECIMALS = 12;
  var SEQ = 0;

  // ---------------------------------------------------------------- utils

  function isNum(v) { return typeof v === "number" && isFinite(v); }
  function isFn(v) { return typeof v === "function"; }
  function isThenable(v) { return !!v && isFn(v.then); }
  function noop() {}
  function has(obj, k) { return !!obj && Object.prototype.hasOwnProperty.call(obj, k); }

  /* `window` FIRST, then self, then globalThis. Deliberate: the vault's
     loaders evaluate this file in a CommonJS wrapper with an INJECTED fake
     `window` (jit-panel's eval shim, the capture rig, the test harnesses).
     Reaching for the ambient globalThis first would publish PropsheetField on
     the real global and leave the caller's shim empty. */
  function getGlobal() {
    if (typeof window !== "undefined") return window;
    if (typeof self !== "undefined") return self;
    if (typeof globalThis !== "undefined") return globalThis;
    return null;
  }

  /* Shallow own-key copy. Used for the spec (so registry entries never alias)
     and for the class-name merge. */
  function assign(target, source) {
    if (!source) return target;
    for (var k in source) if (has(source, k)) target[k] = source[k];
    return target;
  }

  function warnOnce(seen, message) {
    if (seen[message]) return;
    seen[message] = true;
    var g = getGlobal();
    if (g && g.console && isFn(g.console.warn)) g.console.warn(message);
  }
  var WARNED = {};

  // ------------------------------------------------------- pure helpers
  // Every helper takes a plain spec-shaped object; all fields optional:
  //   { min, max, step, decimals, integer, unit, format, parse }

  /* stepFor(spec)                → the base step (integer mode defaults to 1)
     stepFor(spec, {shiftKey:true}) → base × 10 (the ⇧ nudge, and ⇧-drag)
     `mods` accepts a real KeyboardEvent/MouseEvent or {shift:true}. */
  function stepFor(spec, mods) {
    var s = spec || {};
    var base = (isNum(s.step) && s.step > 0) ? s.step : 1;
    var shift = !!(mods && (mods.shiftKey || mods.shift));
    return shift ? base * 10 : base;
  }

  /* Decimals implied by a step: 0.01 → 2, 0.25 → 2, 1 → 0, 10 → 0, 1e-7 → 7.
     Derived from the decimal text of the step, not log10, so 0.25 is right. */
  function decimalsForStep(step) {
    var s = Math.abs(Number(step));
    if (!isFinite(s) || s === 0) return 0;
    var text = String(s);
    var e = text.indexOf("e");
    if (e < 0) e = text.indexOf("E");
    var frac, dot;
    if (e >= 0) {
      var mant = text.slice(0, e);
      var exp = parseInt(text.slice(e + 1), 10) || 0;
      dot = mant.indexOf(".");
      frac = dot < 0 ? 0 : mant.length - dot - 1;
      return Math.max(0, Math.min(MAX_DECIMALS, frac - exp));
    }
    dot = text.indexOf(".");
    return dot < 0 ? 0 : Math.min(MAX_DECIMALS, text.length - dot - 1);
  }

  /* decimalsFor(spec) → explicit spec.decimals, else 0 in integer mode,
     else derived from the step. */
  function decimalsFor(spec) {
    var s = spec || {};
    if (isNum(s.decimals)) return Math.max(0, Math.min(MAX_DECIMALS, Math.round(s.decimals)));
    if (s.integer) return 0;
    return decimalsForStep(stepFor(s));
  }

  /* clampTo(value, spec) → value rounded to the spec's decimals and clamped
     into [min,max]. Rounds first, then clamps, so a bound always wins.
     Rounding is half-AWAY-from-zero, so ±1.5 → ±2 and a `position` field with
     negative coordinates is symmetric about the origin (Math.round alone is
     half-up: -1.5 → -1). Negative zero is normalised to 0, so getValue() and
     onCommit never hand a consumer a -0 that survives Object.is or a
     serializer. Non-finite input returns the clamped zero (a sane in-range
     placeholder). */
  function clampTo(value, spec) {
    var s = spec || {};
    var v = Number(value);
    if (!isFinite(v)) v = 0;
    var f = Math.pow(10, decimalsFor(s));
    var sign = v < 0 ? -1 : 1;
    v = sign * Math.round(Math.abs(v) * f) / f;
    if (isNum(s.max)) v = Math.min(s.max, v);
    if (isNum(s.min)) v = Math.max(s.min, v);
    if (v === 0) v = 0;                       // kill -0
    return v;
  }

  /* Positional integer text, never exponent notation. String(1e21) is
     "1e+21", and parseTyped would read that back as 121 — so the display must
     stay positional however large the number gets. */
  function integerText(value) {
    var r = Math.round(value);
    var text = String(r);
    if (text.indexOf("e") < 0 && text.indexOf("E") < 0) return text;
    if (isFn(r.toLocaleString)) {
      try {
        var loc = r.toLocaleString("en-US", { useGrouping: false, maximumFractionDigits: 0 });
        if (loc && loc.indexOf("e") < 0 && loc.indexOf("E") < 0) return loc;
      } catch (err) { /* Intl unavailable — fall through */ }
    }
    return text;
  }

  /* formatValue(value, spec) → the display string, unit inline, no space:
     500 + "ms" → "500ms"; 0.5 with step .01 → "0.5×" (trailing zeros dropped).
     A non-finite value formats as "" so an async field can paint an honest
     blank instead of "NaN". spec.format(v, spec) overrides wholesale. */
  function formatValue(value, spec) {
    var s = spec || {};
    if (isFn(s.format)) return String(s.format(value, s));
    if (!isNum(value)) return "";
    var d = decimalsFor(s);
    var text;
    if (d) {
      text = value.toFixed(d).replace(/\.?0+$/, "");
      if (text.indexOf("e") >= 0 || text.indexOf("E") >= 0) text = integerText(value);
    } else {
      text = integerText(value);
    }
    if (text === "-0") text = "0";
    return text + (s.unit == null ? "" : String(s.unit));
  }

  /* parseTyped(text) → the number a human meant, or null.
     Strips every non-numeric character (units, spaces, stray letters) and any
     minus that is not leading: "500 banana" → 500, "-12 px" → -12, "" → null.
     PURE: it does NOT clamp — callers pass the result through clampTo.
     Caveat worth knowing: exponent notation does not survive ("1e3" → 13),
     because a unit is far likelier than an exponent in this control.
     spec.parse(text, spec) overrides wholesale. */
  function parseTyped(text, spec) {
    if (spec && isFn(spec.parse)) {
      var custom = spec.parse(text, spec);
      return isNum(custom) ? custom : null;
    }
    var cleaned = String(text == null ? "" : text)
      .replace(/[^0-9.\-]/g, "")
      .replace(/(?!^)-/g, "");
    var n = parseFloat(cleaned);
    return isFinite(n) ? n : null;
  }

  // ---------------------------------------------------- keyboard policy

  /* classifyKey(event, opts) → { action, preventDefault, stopPropagation, … }
     Pure: reads only key + modifier flags, touches nothing. opts.pending says
     whether an unsubmitted edit exists; opts.dragging whether a scrub is live.
     Actions:
       "submit"  Enter — parse, clamp, preview + commit
       "revert"  Escape with a pending edit — restore the rendered text
       "cancel"  Escape mid-drag — abandon the scrub, restore the start value
       "nudge"   ↑/↓ — { direction: ±1, step } preview + commit
       "pass"    the host's key: Tab, Escape with nothing pending and no drag,
                 and every ⌘/⌃/⌥ chord. Never consumed, never stopped.
       "type"    an ordinary editing key. Not prevented (the input needs its
                 default) but stopped, so page shortcuts do not fire while
                 typing. */
  function classifyKey(ev, opts) {
    var e = ev || {};
    var o = opts || {};
    var pending = !!o.pending;
    var dragging = !!o.dragging;
    var key = e.key;
    var foreign = !!(e.metaKey || e.ctrlKey || e.altKey);
    var pass = { action: "pass", preventDefault: false, stopPropagation: false };

    if (foreign || key === "Tab") return pass;
    if (key === "Enter") return { action: "submit", preventDefault: true, stopPropagation: true };
    if (key === "Escape" || key === "Esc") {
      if (dragging) return { action: "cancel", preventDefault: true, stopPropagation: true };
      if (!pending) return pass;                     // the host's Escape ladder
      return { action: "revert", preventDefault: true, stopPropagation: true };
    }
    if (key === "ArrowUp" || key === "ArrowDown") {
      return {
        action: "nudge",
        direction: key === "ArrowUp" ? 1 : -1,
        shift: !!e.shiftKey,
        preventDefault: true,
        stopPropagation: true
      };
    }
    return { action: "type", preventDefault: false, stopPropagation: true };
  }

  // ------------------------------------------------------------ scrubber

  /* createScrubber(spec, handlers) — the drag math, DOM-free and testable.
       handlers.start()   → the value the drag begins from
       handlers.preview(v) → every changed pixel
       handlers.commit(v)  → once, at end(), and only if the value moved
     Accumulates deltas against the START value (never against the clamped
     current one), so dragging past a bound and back does not go sticky. */
  function createScrubber(spec, handlers) {
    var h = handlers || {};
    var active = false, startVal = 0, acc = 0, lastX = 0, current = 0;

    function fire(name, v) { if (isFn(h[name])) h[name](v); }

    return {
      isActive: function () { return active; },
      value: function () { return current; },
      startValue: function () { return clampTo(startVal, spec); },
      begin: function (x) {
        var from = isFn(h.start) ? h.start() : 0;
        startVal = isNum(from) ? from : 0;
        acc = 0;
        lastX = Number(x) || 0;
        current = clampTo(startVal, spec);
        active = true;
        return current;
      },
      move: function (x, mods) {
        if (!active) return current;
        var px = Number(x) || 0;
        acc += (px - lastX) * stepFor(spec, mods);
        lastX = px;
        var next = clampTo(startVal + acc, spec);
        if (next !== current) { current = next; fire("preview", next); }
        return current;
      },
      end: function () {
        if (!active) return current;
        active = false;
        if (current !== clampTo(startVal, spec)) fire("commit", current);
        return current;
      },
      cancel: function () {
        if (!active) return current;
        active = false;
        var restored = clampTo(startVal, spec);
        if (restored !== current) { current = restored; fire("preview", restored); }
        current = restored;
        return current;
      }
    };
  }

  // --------------------------------------------------------------- icons

  /* The ⇔ scrub glyph, inlined. iconMarkup's LAST resort, so a field whose
     registry is missing, shadowed by another plugin, or simply doesn't carry
     the concept still renders a visible, grabbable drag affordance instead of
     a zero-area empty span. */
  var FALLBACK_ICON =
    '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" ' +
    'stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M1.5 8h13M4.5 5l-3 3 3 3M11.5 5l3 3-3 3"/></svg>';

  /* Concept name → SVG markup from the ONE shared registry (icons.js).
     spec.icons overrides; otherwise the global Icons map is used; a missing
     concept falls back to `ratio`, then to the built-in ⇔ (never throws, never
     renders nothing). A miss is warned once per concept name, because the
     silent version surfaced as "the duration field is wearing the ratio glyph"
     — invisible without a pixel diff. */
  function iconMarkup(name, registry) {
    var g = getGlobal();
    var reg = registry || (g && g.Icons) || null;
    if (reg && typeof reg[name] === "string") return reg[name];
    if (name != null && name !== "") {
      warnOnce(WARNED, "PropsheetField: unknown icon concept \"" + name + "\" — falling back");
    }
    if (reg && typeof reg.ratio === "string") return reg.ratio;
    return FALLBACK_ICON;
  }

  // ----------------------------------------------------------------- CSS

  /* The contract stylesheet. Layout rules sit inside :where() so they carry
     ZERO specificity and any consumer skin beats them; the focus indicator is
     left at its natural (0,1,0) so it survives propsheet's `outline:0`. */
  var CSS = [
    ":where([data-psf-field]){display:flex;flex-direction:column;gap:4px;min-width:0;}",
    ":where([data-psf-label]){white-space:normal;overflow-wrap:anywhere;}",
    ":where([data-psf-control]){display:inline-flex;align-items:center;min-width:0;width:max-content;max-width:100%;}",
    ":where([data-psf-input]){flex:0 1 auto;width:auto;}",
    ":where([data-psf-knob]){display:inline-grid;place-items:center;flex:0 0 auto;",
    "width:22px;min-width:22px;min-height:18px;align-self:stretch;",
    "cursor:ew-resize;touch-action:none;user-select:none;-webkit-user-select:none;}",
    ":where([data-psf-input]){min-width:0;}",
    "[data-psf-control]:focus-within{outline:2px solid currentColor;outline-offset:1px;}",
    "[data-psf-input]:focus-visible{outline:2px solid currentColor;outline-offset:1px;}"
  ].join("");

  var cssSeen = (typeof WeakSet !== "undefined") ? new WeakSet() : null;

  /* Inject the contract stylesheet into a document, once. Returns true if it
     wrote a <style>. Safe on a document with no head/body (the test fake), on
     a repeat call, and on a non-DOM object. */
  function injectCSS(doc) {
    if (!doc || !isFn(doc.createElement)) return false;
    var host = doc.head || doc.documentElement || doc.body;
    if (!host || !isFn(host.appendChild)) return false;
    if (cssSeen) {
      if (cssSeen.has(doc)) return false;
      cssSeen.add(doc);
    } else {
      if (doc.__psfCSSInjected) return false;
      doc.__psfCSSInjected = true;
    }
    var style = doc.createElement("style");
    if (isFn(style.setAttribute)) style.setAttribute("data-psf-css", "");
    style.textContent = CSS;
    host.appendChild(style);
    return true;
  }

  // ----------------------------------------------------------- the field

  var DEFAULT_CLASSES = {
    field: "field",
    label: "lbl",
    control: "ctl",
    knob: "knob",
    input: "",
    dragging: "is-dragging"
  };

  /* createNumberField(spec) → { el, nodes, render, focus, destroy, getValue,
                                 setValue, update, hasPendingEdit,
                                 handleKeydown, isDragging, submit, revert,
                                 isDestroyed, spec }
     spec (shallow-copied; see § Ownership):
       label     string, shown above the control, never truncated
       unit      string appended inline to the value ("ms", "px/s", "×")
       icon      concept name from icons.js ("duration", "count", …)
       min, max  bounds (omit for unbounded)
       step      value per drag pixel and per ↑/↓ (default 1)
       decimals  optional; derived from step when omitted
       integer   true → whole numbers only (decimals 0, step defaults to 1)
       get()     number | Promise<number>  — consumer owns the value
       value     number                    — field owns the value
       onPreview(v)  every change, drag pixels included
       onCommit(v)   once per interaction, only when the value moved
       onError(err, {attempted, previous, phase})  a callback threw or rejected
       document  a Document to build in (defaults to the ambient one)
       icons     an icon registry override
       classes   class-name overrides
       injectCSS false → do not write the contract stylesheet into `document`
       title     knob tooltip override
       ariaLabel input aria-label override
       format(v, spec) / parse(text, spec)  display / entry overrides */
  function createNumberField(spec) {
    var s = assign({}, spec || {});          // never alias a registry entry
    var g = getGlobal();
    var doc = s.document || (typeof document !== "undefined" ? document : (g && g.document));
    if (!doc || !isFn(doc.createElement)) {
      throw new Error("createNumberField: no document available (pass spec.document)");
    }
    if (s.injectCSS !== false) injectCSS(doc);

    var cls = assign(assign({}, DEFAULT_CLASSES), s.classes);

    var destroyed = false;
    var asyncToken = 0;
    var lastPainted = "";
    var uid = "psf-" + (++SEQ);
    var cached = clampTo(isNum(s.value) ? s.value : (isNum(s.initial) ? s.initial : 0), s);
    /* Is `cached` the live value? False while an async get() is in flight or
       after a get() threw — in which case the changed-guard is skipped rather
       than diffed against a number we do not actually know. */
    var cacheFresh = true;

    // ---- DOM
    function make(tag, className, text) {
      var n = doc.createElement(tag);
      if (className) n.className = className;
      if (text != null) n.textContent = text;
      return n;
    }
    function attr(node, k, v) { if (isFn(node.setAttribute)) node.setAttribute(k, String(v)); }
    function add(parent, child) {
      if (isFn(parent.appendChild)) parent.appendChild(child);
      else if (isFn(parent.append)) parent.append(child);
    }

    var el = make("div", cls.field);
    attr(el, "data-psf-field", "");

    /* A real <label for> so clicking the (much larger) label focuses the
       input — the standard affordance, and a motor-accessibility win against a
       ~100px number box. */
    var labelEl = make("label", cls.label, s.label == null ? "" : String(s.label));
    attr(labelEl, "data-psf-label", "");
    attr(labelEl, "for", uid);
    // Vault rule: user-visible strings are never truncated — labels wrap.
    if (labelEl.style) {
      labelEl.style.whiteSpace = "normal";
      labelEl.style.overflowWrap = "anywhere";
    }

    var ctl = make("div", cls.control);
    attr(ctl, "data-psf-control", "");

    var knob = make("span", cls.knob);
    knob.innerHTML = iconMarkup(s.icon, s.icons);
    attr(knob, "data-psf-knob", "");
    /* aria-hidden, not role="presentation": the knob is a pure pointer
       affordance whose entire capability is duplicated by ↑/↓ on the input, so
       it should be pruned from the accessibility tree outright. role
       ="presentation" strips the implicit semantics but leaves the element and
       its title exposed — instructions for an interaction AT users cannot
       perform. The keyboard equivalent is advertised on the input instead
       (aria-keyshortcuts). */
    attr(knob, "aria-hidden", "true");
    attr(knob, "title", s.title == null ? ("drag to adjust " + (s.label || "value")) : String(s.title));
    if (knob.style) {
      knob.style.cursor = "ew-resize";
      knob.style.userSelect = "none";
      knob.style.webkitUserSelect = "none";
      knob.style.touchAction = "none";        // required, or the browser scrolls instead of scrubbing
    }

    var input = make("input", cls.input);
    attr(input, "type", "text");
    attr(input, "id", uid);
    attr(input, "data-psf-input", "");
    attr(input, "inputmode", "decimal");
    attr(input, "spellcheck", "false");
    attr(input, "autocomplete", "off");
    /* Spinbutton semantics: without these a screen reader is never told the
       field has bounds, never hears the clamp that rewrote 99999 to 10000, and
       hears nothing at all when ↑/↓ mutate input.value programmatically. */
    attr(input, "role", "spinbutton");
    attr(input, "aria-keyshortcuts", "ArrowUp ArrowDown Shift+ArrowUp Shift+ArrowDown");
    input.id = uid;
    input.type = "text";

    add(ctl, knob);
    add(ctl, input);
    add(el, labelEl);
    add(el, ctl);

    function ariaLabel() {
      if (s.ariaLabel != null) return String(s.ariaLabel);
      var base = s.label == null ? "value" : String(s.label);
      return s.unit ? base + " (" + s.unit + ")" : base;
    }
    function syncLabelAria() { attr(input, "aria-label", ariaLabel()); }
    function syncBoundsAria() {
      if (!isFn(input.setAttribute)) return;
      if (isNum(s.min)) input.setAttribute("aria-valuemin", String(s.min));
      else if (isFn(input.removeAttribute)) input.removeAttribute("aria-valuemin");
      if (isNum(s.max)) input.setAttribute("aria-valuemax", String(s.max));
      else if (isFn(input.removeAttribute)) input.removeAttribute("aria-valuemax");
    }
    syncLabelAria();
    syncBoundsAria();

    // ---- value plumbing
    function pull() {
      var v;
      if (isFn(s.get)) {
        try { v = s.get(); }
        catch (err) { cacheFresh = false; return cached; }
      } else {
        v = s.value;
      }
      if (isThenable(v)) {
        var token = ++asyncToken;
        cacheFresh = false;                            // we do not know it yet
        v.then(function (resolved) {
          if (destroyed || token !== asyncToken) return;
          if (!isNum(resolved)) return;
          cached = clampTo(resolved, s);               // a bound always wins
          cacheFresh = true;
          if (!hasPendingEdit()) paint(true);          // never clobber a live edit
        }, noop);
        return cached;                                 // never blocks
      }
      if (isNum(v)) { cached = clampTo(v, s); cacheFresh = true; }
      return cached;
    }

    function paint(force) {
      if (destroyed) return lastPainted;
      if (!force && hasPendingEdit()) return lastPainted;
      lastPainted = formatValue(cached, s);
      input.value = lastPainted;
      if (isFn(input.setAttribute)) {
        if (isNum(cached)) input.setAttribute("aria-valuenow", String(cached));
        else if (isFn(input.removeAttribute)) input.removeAttribute("aria-valuenow");
        // aria-valuetext is what makes a screen reader say "510 milliseconds"
        // rather than "510" on each nudge, and makes a clamped submit audible.
        input.setAttribute("aria-valuetext", lastPainted);
        /* Never-truncate, value edition: an <input> clips by horizontal
           scroll with no scrollbar and no tell. `size` keeps the box wide
           enough for its own content wherever the skin lets it, and `title`
           is the rule's own named last resort — the full string is always
           reachable. */
        input.setAttribute("title", lastPainted);
        input.setAttribute("size", String(Math.max(4, lastPainted.length)));
      }
      return lastPainted;
    }

    function hasPendingEdit() {
      return String(input.value) !== lastPainted;
    }

    /* An explicit write is authoritative, so it invalidates any async pull
       already in flight: otherwise the promise created a microtask ago
       resolves with the PRE-write value and repaints it over the number the
       user just committed, leaving screen and truth permanently divergent. */
    function store(v) {
      cached = v;
      cacheFresh = true;
      asyncToken++;
      if (!isFn(s.get)) s.value = v;
      paint(true);
    }

    function report(err, attempted, previous, phase) {
      if (isFn(s.onError)) {
        try { s.onError(err, { attempted: attempted, previous: previous, phase: phase }); }
        catch (e2) { /* a throwing error handler is the host's problem, not ours */ }
      } else {
        warnOnce(WARNED, "PropsheetField: on" + (phase === "commit" ? "Commit" : "Preview") +
          " failed and no spec.onError was supplied");
        var gg = getGlobal();
        if (gg && gg.console && isFn(gg.console.error)) gg.console.error(err);
      }
      /* A rejected COMMIT means the consumer refused the number; the field
         must not keep displaying it. A rejected PREVIEW is reported only —
         there are sixty a second under a drag and unwinding each would fight
         the pointer. */
      if (phase !== "commit") return;
      if (destroyed || scrubber.isActive() || hasPendingEdit()) return;
      if (!isNum(previous)) return;
      cached = previous;
      cacheFresh = false;
      paint(true);
    }

    /* Invoke a consumer callback so nothing escapes: a sync throw is caught, a
       returned promise gets a rejection handler (and only then — a non-thenable
       return costs no microtask, which matters at 60 previews a second). */
    function invoke(fn, v, previous, phase) {
      if (!isFn(fn)) return;
      var out;
      try { out = fn(v); }
      catch (err) { report(err, v, previous, phase); return; }
      if (isThenable(out)) {
        out.then(null, function (err) { report(err, v, previous, phase); });
      }
    }

    function previewValue(v, previous) { invoke(s.onPreview, v, previous, "preview"); }
    function commitValue(v, previous) { invoke(s.onCommit, v, previous, "commit"); }

    /* One discrete interaction (typing, an arrow nudge, setValue): preview
       then commit, each at most once, and only when the value actually moved.
       The live value is re-read FIRST — diffing against the last repaint would
       drop a user's explicit Enter (the number they asked for is the one on
       screen) and, in the async shape, write staleCache±step over the truth.
       The repaint happens either way, so "500 banana" still normalizes to
       "500ms" on a no-op submit without waking either callback. */
    function applyDiscrete(raw, opts) {
      var o = opts || {};
      pull();
      var previous = cached;
      var next = clampTo(raw, s);
      var changed = o.force === true || !cacheFresh || next !== previous;
      store(next);
      if (changed) {
        if (o.preview !== false) previewValue(next, previous);
        if (o.commit !== false) commitValue(next, previous);
      }
      return next;
    }

    /* The value an interaction should START from: what the user has typed, if
       anything parseable is on screen, else the live value. Typing 3000 then
       pressing ↑ must give 3010, the way every native numeric control behaves
       — silently discarding the typed text from two other affordances while
       Escape treats it as first-class state was an internal inconsistency. */
    function currentValue() {
      if (hasPendingEdit()) {
        var typed = parseTyped(input.value, s);
        if (typed !== null) return clampTo(typed, s);
      }
      return pull();
    }

    /* submit() is a no-op when the text on screen is byte-for-byte what the
       field painted. Without that guard, a plain focus→blur re-parses the
       field's OWN rendering — and a unit containing a digit ("px/s2") or a
       spec.format emitting one ("3 of 9") reads back as a different number,
       then commits it. The user never touched the value; they tabbed through. */
    function submit() {
      if (destroyed) return cached;
      if (!hasPendingEdit()) return cached;
      var typed = parseTyped(input.value, s);
      if (typed === null) { paint(true); return cached; }
      return applyDiscrete(typed);
    }

    function revert() {
      if (destroyed) return cached;
      return paint(true);
    }

    function nudge(direction, shift) {
      return applyDiscrete(currentValue() + direction * stepFor(s, { shift: !!shift }));
    }

    // ---- keyboard
    /* Memoised on event identity: the header advertises handleKeydown as a
       host-integration seam ("give the focused field first refusal"), and a
       host that MIRRORS rather than consumes — the the slideshow host key
       bridge does exactly that — would otherwise turn one physical ArrowUp
       into two nudges and two durable writes. */
    var lastEvent = null;
    var lastVerdict = null;
    function handleKeydown(ev) {
      if (destroyed) return classifyKey(ev, {});
      if (ev && ev === lastEvent) return lastVerdict;
      var verdict = classifyKey(ev, { pending: hasPendingEdit(), dragging: scrubber.isActive() });
      if (ev) { lastEvent = ev; lastVerdict = verdict; }
      if (verdict.preventDefault && ev && isFn(ev.preventDefault)) ev.preventDefault();
      if (verdict.stopPropagation && ev && isFn(ev.stopPropagation)) ev.stopPropagation();
      if (verdict.action === "submit") { submit(); select(); }
      else if (verdict.action === "revert") { revert(); select(); }
      else if (verdict.action === "cancel") { endDrag(true); }
      else if (verdict.action === "nudge") { nudge(verdict.direction, verdict.shift); select(); }
      return verdict;
    }

    function select() { if (!destroyed && isFn(input.select)) input.select(); }

    // ---- scrub (plain capture-drag; never Pointer Lock — see the header)
    var scrubber = createScrubber(s, {
      start: currentValue,
      preview: function (v) { var previous = cached; store(v); previewValue(v, previous); },
      commit: function (v) { commitValue(v, scrubber.startValue()); }
    });

    function setDragging(on) {
      if (!knob.classList || !cls.dragging) return;
      if (on) knob.classList.add(cls.dragging); else knob.classList.remove(cls.dragging);
    }

    /* Every exit from a drag goes through here, so there is exactly one place
       that detaches listeners and clears the dragging class. */
    function endDrag(cancelled) {
      if (!scrubber.isActive()) { detachDrag(); setDragging(false); return; }
      detachDrag();
      if (cancelled) scrubber.cancel(); else scrubber.end();
      setDragging(false);
    }

    function onMouseMove(e) {
      /* The release we never saw. A mouseup delivered to browser chrome, a
         devtools panel, another window, or swallowed by a context menu never
         reaches the document — and without this the field stays armed, the
         number chasing a button-less pointer across the page until a stray
         mouseup commits wherever it landed. */
      if (e && e.buttons === 0) { endDrag(false); return; }
      scrubber.move(e.clientX, e);
    }
    function onMouseUp() { endDrag(false); }
    function onWindowBlur() { endDrag(false); }

    function docKeydown(e) {
      if (!scrubber.isActive()) return;
      var k = e && e.key;
      if (k !== "Escape" && k !== "Esc") return;
      if (isFn(e.preventDefault)) e.preventDefault();
      if (isFn(e.stopImmediatePropagation)) e.stopImmediatePropagation();
      else if (isFn(e.stopPropagation)) e.stopPropagation();
      endDrag(true);
    }

    function view() {
      var w = doc.defaultView;
      return (w && isFn(w.addEventListener)) ? w : null;
    }

    var mouseAttached = false;
    function attachDrag(withMouse) {
      if (isFn(doc.addEventListener)) doc.addEventListener("keydown", docKeydown, true);
      if (!withMouse || !isFn(doc.addEventListener)) return;
      mouseAttached = true;
      doc.addEventListener("mousemove", onMouseMove);
      doc.addEventListener("mouseup", onMouseUp);
      doc.addEventListener("contextmenu", onMouseUp);
      var w = view();
      if (w) w.addEventListener("blur", onWindowBlur);
    }
    function detachDrag() {
      if (isFn(doc.removeEventListener)) doc.removeEventListener("keydown", docKeydown, true);
      if (!mouseAttached || !isFn(doc.removeEventListener)) return;
      mouseAttached = false;
      doc.removeEventListener("mousemove", onMouseMove);
      doc.removeEventListener("mouseup", onMouseUp);
      doc.removeEventListener("contextmenu", onMouseUp);
      var w = view();
      if (w && isFn(w.removeEventListener)) w.removeEventListener("blur", onWindowBlur);
    }

    function onMouseDown(e) {
      // Primary button only. A right-click that begins a scrub then opens the
      // native context menu is a reproducible stuck drag; middle-click fights
      // autoscroll on Windows/Linux Chrome.
      if (e && e.button != null && e.button !== 0) return;
      if (e && isFn(e.preventDefault)) e.preventDefault();
      scrubber.begin(e ? e.clientX : 0);
      setDragging(true);
      attachDrag(true);
    }

    function touchPoint(e) {
      if (!e) return null;
      if (e.touches && e.touches.length) return e.touches[0];
      if (e.changedTouches && e.changedTouches.length) return e.changedTouches[0];
      return null;
    }
    function onTouchStart(e) {
      var t = touchPoint(e);
      if (!t) return;
      scrubber.begin(t.clientX);
      setDragging(true);
      attachDrag(false);
    }
    function onTouchMove(e) {
      if (!scrubber.isActive()) return;
      var t = touchPoint(e);
      if (!t) return;
      if (e && isFn(e.preventDefault)) e.preventDefault();   // the page must not scroll under a scrub
      scrubber.move(t.clientX, e);
    }
    function onTouchEnd() { endDrag(false); }
    /* touchcancel means the SYSTEM took the gesture away (an incoming call, a
       system edge gesture, too many touch points). Committing whatever pixel
       the finger last reached is the opposite of what that means. */
    function onTouchCancel() { endDrag(true); }

    function onFocus() { select(); }
    function onBlur() { submit(); }

    if (isFn(knob.addEventListener)) {
      knob.addEventListener("mousedown", onMouseDown);
      knob.addEventListener("touchstart", onTouchStart, { passive: true });
      knob.addEventListener("touchmove", onTouchMove, { passive: false });
      knob.addEventListener("touchend", onTouchEnd);
      knob.addEventListener("touchcancel", onTouchCancel);
    }
    if (isFn(input.addEventListener)) {
      input.addEventListener("focus", onFocus);
      input.addEventListener("keydown", handleKeydown);
      input.addEventListener("blur", onBlur);
    }

    pull();
    paint(true);

    return {
      el: el,
      nodes: { field: el, label: labelEl, control: ctl, knob: knob, input: input },
      spec: s,

      /* Re-read the value from get()/value and repaint. Skips the repaint
         while an unsubmitted edit is on screen, so a host re-render cannot
         eat what the user is typing. */
      render: function () {
        if (destroyed) return lastPainted;
        pull();
        return paint(false);
      },

      focus: function () {
        if (destroyed) return input;
        if (isFn(input.focus)) input.focus();
        select();
        return input;
      },

      getValue: function () { return cached; },

      /* Programmatic set. Fires onPreview by default; pass {commit:true} to
         persist as well, {preview:false} to stay silent, {force:true} to fire
         both even when the value did not move. */
      setValue: function (v, opts) {
        if (destroyed) return cached;
        var o = opts || {};
        return applyDiscrete(v, {
          preview: o.preview !== false,
          commit: o.commit === true,
          force: o.force === true
        });
      },

      /* Patch the spec in place (label, unit, min/max/step, value, callbacks)
         — the React/ref update path. NON-DESTRUCTIVE by default: a repaint is
         skipped while an unsubmitted edit is on screen, because in React any
         parent state change re-runs the effect that calls this, and in Svelte
         any mutation of the bound object re-runs the $effect — neither has
         anything to do with this field, and both would otherwise wipe a
         half-typed number. Pass {force:true} for the old clobbering behaviour.
         Tightened bounds re-clamp the held value, so update({max}) can never
         leave an illegal number on screen or in getValue(). */
      update: function (patch, opts) {
        if (destroyed) return lastPainted;
        var o = opts || {};
        if (patch) {
          for (var k in patch) if (has(patch, k)) s[k] = patch[k];
          // Keyed off key PRESENCE, not value: update({label:null}) clears.
          if (has(patch, "label")) labelEl.textContent = s.label == null ? "" : String(s.label);
          if (has(patch, "label") || has(patch, "unit") || has(patch, "ariaLabel")) syncLabelAria();
          if (has(patch, "min") || has(patch, "max")) syncBoundsAria();
          if (has(patch, "icon") || has(patch, "icons")) knob.innerHTML = iconMarkup(s.icon, s.icons);
          if (has(patch, "title")) {
            attr(knob, "title", s.title == null
              ? ("drag to adjust " + (s.label || "value"))
              : String(s.title));
          }
        }
        pull();
        cached = clampTo(cached, s);
        return paint(o.force === true || !hasPendingEdit());
      },

      hasPendingEdit: hasPendingEdit,
      isDragging: function () { return !destroyed && scrubber.isActive(); },
      isDestroyed: function () { return destroyed; },

      /* Route a key in from a host listener (e.g. a window-capture handler
         that wants to give the focused field first refusal). Returns the
         classification so the host can see what happened. Idempotent per
         event object. */
      handleKeydown: handleKeydown,

      /* Submit / revert on demand — the host's own Escape ladder may want to
         revert a field before collapsing a tier. */
      submit: submit,
      revert: revert,

      /* Unmounting mid-drag FLUSHES the pending commit rather than dropping
         it: every preview pixel has already written through to the consumer's
         live state, so skipping the durable write leaves the UI showing a
         number the git-tracked json does not have — the exact inversion the
         preview/commit split exists to prevent. (To discard instead, call
         handle.revert() after an Escape, or cancel the drag first.) */
      destroy: function () {
        if (destroyed) return;
        if (scrubber.isActive()) endDrag(false);
        destroyed = true;
        asyncToken++;
        detachDrag();
        if (isFn(knob.removeEventListener)) {
          knob.removeEventListener("mousedown", onMouseDown);
          knob.removeEventListener("touchstart", onTouchStart);
          knob.removeEventListener("touchmove", onTouchMove);
          knob.removeEventListener("touchend", onTouchEnd);
          knob.removeEventListener("touchcancel", onTouchCancel);
        }
        if (isFn(input.removeEventListener)) {
          input.removeEventListener("focus", onFocus);
          input.removeEventListener("keydown", handleKeydown);
          input.removeEventListener("blur", onBlur);
        }
        if (isFn(el.remove)) el.remove();
        else if (el.parentNode && isFn(el.parentNode.removeChild)) el.parentNode.removeChild(el);
      }
    };
  }

  // -------------------------------------------------------------- export

  var API = {
    VERSION: VERSION,
    CSS: CSS,
    injectCSS: injectCSS,
    createNumberField: createNumberField,
    createScrubber: createScrubber,
    classifyKey: classifyKey,
    clampTo: clampTo,
    formatValue: formatValue,
    parseTyped: parseTyped,
    stepFor: stepFor,
    decimalsFor: decimalsFor,
    decimalsForStep: decimalsForStep,
    iconMarkup: iconMarkup,
    FALLBACK_ICON: FALLBACK_ICON
  };

  // UMD tail. module.exports for CommonJS (Obsidian's eval-in-wrapper, node);
  // the global ALWAYS, so a bundler that refuses to transform CJS in src/ can
  // side-effect import this file and read globalThis.PropsheetField. ESM
  // consumers import the sibling field-core.mjs, which does exactly that and
  // re-exports named bindings — see header note (c).
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  var G = getGlobal();
  if (G) G.PropsheetField = API;
})();
