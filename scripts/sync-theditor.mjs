// Vendors theditor's framework-free core into web/src/theditor/vendor/ by copy.
//   node scripts/sync-theditor.mjs            copy every canonical file (header added, imports rewritten)
//   node scripts/sync-theditor.mjs --check    report drift; exit 1 on any unexplained difference
//   --from <checkout>   a checkout of the swamikk CourseLit fork (https://github.com/clozach/swamikk) to copy
//                       from; default: $THEDITOR_SOURCE. Unset: the copies are the source (--check passes
//                       with a note; copying needs a checkout).
// A copy may run ahead of its canonical file (AHEAD below) while the canonical repository has not yet
// landed a change lodeflow needs. --check accepts it only while the canonical file is still exactly the
// one it went ahead of; the moment that file changes (or appears), the check fails so someone reconciles.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const vendor = resolve(here, '../web/src/theditor/vendor');
const args = process.argv.slice(2);
const check = args.includes('--check');
const fromAt = args.indexOf('--from');
const given = fromAt >= 0 ? args[fromAt + 1] ?? '' : process.env.THEDITOR_SOURCE || '';
if (!given) {
  if (fromAt < 0 && check) {
    console.log('sync-theditor: THEDITOR_SOURCE is unset: the vendored copies are the source; nothing to compare.');
    process.exit(0);
  }
  console.error('sync-theditor: no canonical checkout to copy from (pass --from <checkout> or set THEDITOR_SOURCE)');
  process.exit(1);
}
const source = resolve(given);

const FILES = [
  { local: 'formatted-message.ts', canonical: 'packages/common-models/src/formatted-message.ts' },
  { local: 'extensions.ts', canonical: 'apps/web/components/feedback/formatting/extensions.ts' },
  { local: 'doc.ts', canonical: 'apps/web/components/feedback/formatting/doc.ts' },
  { local: 'image-css.ts', canonical: 'apps/web/components/feedback/formatting/image-css.ts' },
];
/**
 * Copies that run ahead of canonical, by local file name: { canonical: <SHA-256 of the canonical file
 * when the copy went ahead, or null if it did not exist yet>, why: '<what the copy adds>' }. Empty while
 * every copy matches its canonical file.
 */
const AHEAD = {};
/** The vendored files import the package as a local stand-in (common-models.ts, lodeflow's own). */
const REWRITE = [[/(from\s+["'])@courselit\/common-models(["'])/g, '$1./common-models$2']];
/** UI never comes along: a canonical file importing these is not framework-free any more. */
const FORBIDDEN = /from\s+["'](@config\/|react\b|react-dom|@tiptap\/react|next\/|\.\.\/)/;

const sha = (text) => createHash('sha256').update(text).digest('hex');
const header = (canonical) => `// Vendored copy; do not edit here. Canonical: the swamikk CourseLit fork, https://github.com/clozach/swamikk, ${canonical}\n// Refresh with \`node scripts/sync-theditor.mjs\`; \`--check\` reports drift.\n`;
const expected = (file, text) => header(file.canonical) + REWRITE.reduce((t, [from, to]) => t.replace(from, to), text);

if (!existsSync(source)) {
  console.error(`sync-theditor: canonical checkout not found at ${source} (pass --from <checkout> or set THEDITOR_SOURCE)`);
  process.exit(1);
}
let failed = false;
for (const file of FILES) {
  const from = resolve(source, file.canonical);
  const to = resolve(vendor, file.local);
  const ahead = AHEAD[file.local];
  const canonical = existsSync(from) ? readFileSync(from, 'utf8') : null;
  const local = existsSync(to) ? readFileSync(to, 'utf8') : null;
  if (canonical !== null && FORBIDDEN.test(canonical)) {
    console.error(`✗ ${file.local}: canonical ${file.canonical} now imports UI or a sibling module; stop and decide before vendoring it`);
    failed = true;
    continue;
  }
  const want = canonical === null ? null : expected(file, canonical);
  if (check) {
    if (local === null) {
      console.error(`✗ ${file.local}: missing from the vendored copies`);
      failed = true;
    } else if (want !== null && local === want) {
      console.log(`✓ ${file.local}: matches canonical${ahead ? ' (listed in AHEAD: remove it there)' : ''}`);
    } else if (ahead && (canonical === null ? ahead.canonical === null : ahead.canonical === sha(canonical))) {
      console.log(`↑ ${file.local}: ahead of canonical${canonical === null ? ` (canonical ${file.canonical} does not exist yet)` : ''}: ${ahead.why}`);
    } else if (ahead) {
      console.error(`✗ ${file.local}: ahead of canonical, and canonical ${file.canonical} ${canonical === null ? 'disappeared' : 'changed since'}: reconcile, then sync and remove it from AHEAD`);
      failed = true;
    } else if (canonical === null) {
      console.error(`✗ ${file.local}: canonical ${file.canonical} is missing`);
      failed = true;
    } else {
      console.error(`✗ ${file.local}: differs from canonical ${file.canonical} (run without --check to copy it)`);
      failed = true;
    }
    continue;
  }
  if (want === null) {
    console.error(`✗ ${file.local}: canonical ${file.canonical} is missing; the vendored copy is left as it is`);
    failed = true;
    continue;
  }
  if (local === want) {
    console.log(`✓ ${file.local}: already current`);
    continue;
  }
  writeFileSync(to, want);
  console.log(`→ ${file.local}: copied from ${file.canonical}${ahead ? ' (it was ahead of canonical: remove it from AHEAD once the change is confirmed there)' : ''}`);
}
process.exit(failed ? 1 : 0);
