/* field-core.d.mts — declarations for the ESM face (field-core.mjs).
 *
 * CANONICAL SOURCE: pixel-reveal/src/component/field-core.js
 *
 * TypeScript resolves the declarations for an import of "./field-core.mjs"
 * from "./field-core.d.mts" specifically — a sibling field-core.d.ts is NOT
 * consulted for a .mjs specifier, which is why this file exists rather than
 * one .d.ts serving both. The real declarations live in field-core.d.ts (the
 * face for the CommonJS/global entry); this re-exports them so both import
 * specifiers are typed from one source.
 */
export * from "./field-core.js";
export { default } from "./field-core.js";
