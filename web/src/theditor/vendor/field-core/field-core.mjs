/* field-core.mjs — the ESM face of the vault's canonical propsheet field.
 *
 * CANONICAL SOURCE: pixel-reveal/src/component/field-core.js
 * (this file is a two-line adapter over that one; a vendored copy of the pair
 * must carry a header naming that path — copies, never symlinks.)
 *
 * WHY THIS FILE EXISTS. field-core.js is a UMD IIFE with no import/export
 * statements, so it is valid in BOTH module systems — but `import X from
 * "./field-core.js"` only produces a binding where node resolves that file as
 * CommonJS, i.e. in a directory with no `"type": "module"` above it. Inside a
 * Vite/SvelteKit/TS package that declares `"type": "module"` (generative-canvas
 * and stonks both do) the same import is a hard SyntaxError at load:
 * "does not provide an export named 'default'".
 *
 * So ESM/Vite/TS consumers import THIS file instead. It side-effect-imports
 * the core — which works under either resolution — and re-exports the API as
 * a default plus real named bindings, so `verbatimModuleSyntax` and
 * tree-shaking both behave. field-core.d.ts types it.
 *
 *   import PropsheetField, { createNumberField } from "./field-core.mjs";
 */
import "./field-core.js";

const API = /** @type {any} */ (globalThis).PropsheetField;

if (!API) {
  throw new Error(
    "field-core.mjs: field-core.js did not install globalThis.PropsheetField — " +
    "check that the sibling file loaded."
  );
}

export const {
  VERSION,
  CSS,
  injectCSS,
  createNumberField,
  createScrubber,
  classifyKey,
  clampTo,
  formatValue,
  parseTyped,
  stepFor,
  decimalsFor,
  decimalsForStep,
  iconMarkup,
  FALLBACK_ICON
} = API;

export default API;
