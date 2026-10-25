// Vendors theditor's framework-free core into web/src/theditor/vendor/ by copy.
//   node scripts/sync-theditor.mjs            copy every canonical file (header added, imports rewritten)
//   node scripts/sync-theditor.mjs --check    report drift; exit 1 on any unexplained difference
//   --from <checkout>   a checkout of the swamikk CourseLit fork (https://github.com/clozach/swamikk) to copy
//                       from; default: $THEDITOR_SOURCE. Unset: --check verifies the portable checksum
//                       receipt written by the last canonical sync; copying still needs a checkout.
// A copy may run ahead of its canonical file (AHEAD below) while the canonical repository has not yet
// landed a change lodeflow needs. --check accepts it only while the canonical file is still exactly the
// one it went ahead of; the moment that file changes (or appears), the check fails so someone reconciles.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const vendor = resolve(here, '../web/src/theditor/vendor');
const args = process.argv.slice(2);
const check = args.includes('--check');
const fromAt = args.indexOf('--from');
const given = fromAt >= 0 ? args[fromAt + 1] ?? '' : process.env.THEDITOR_SOURCE || '';
const FILES = [
  { local: 'formatted-message.ts', canonical: 'packages/common-models/src/formatted-message.ts' },
  { local: 'extensions.ts', canonical: 'apps/web/components/feedback/formatting/extensions.ts' },
  { local: 'doc.ts', canonical: 'apps/web/components/feedback/formatting/doc.ts' },
  { local: 'image-css.ts', canonical: 'apps/web/components/feedback/formatting/image-css.ts' },
  // The design roles the magnets measure by (MAGNET_GAP, CONTROL_SIZE_TOUCH): theditor's chrome core reads them.
  { local: 'design-measurements.ts', canonical: 'packages/common-models/src/design-measurements.ts' },
  // The pointer's grace on its way from a picture's magnet to its open lozenge (the image magnets read it).
  { local: 'hover-grace/policy.ts', canonical: 'apps/web/lib/hover-grace/policy.ts' },
  { local: 'hover-grace/controller.ts', canonical: 'apps/web/lib/hover-grace/controller.ts' },
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

const receipt = resolve(here, 'theditor-model-vendor.json');
const snapshot = () => ({
  version: 1,
  source: 'https://github.com/clozach/swamikk',
  files: Object.fromEntries(FILES.map(file => [file.local, {canonical: file.canonical, sha256: sha(readFileSync(resolve(vendor, file.local)))}])),
});
function checkReceipt() {
  const recorded = JSON.parse(readFileSync(receipt, 'utf8'));
  if (JSON.stringify(recorded) !== JSON.stringify(snapshot())) {
    throw new Error('sync-theditor: model copies differ from the canonical sync receipt; re-sync with --from <checkout>');
  }
  console.log(`✓ model receipt: ${FILES.length} files match the canonical sync`);
}
if (!given) {
  if (fromAt < 0 && check) { checkReceipt(); process.exit(0); }
  throw new Error('sync-theditor: pass --from <checkout> or set THEDITOR_SOURCE to copy canonical files');
}
const source = resolve(given);

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
  mkdirSync(dirname(to), {recursive:true});
  writeFileSync(to, want);
  console.log(`→ ${file.local}: copied from ${file.canonical}${ahead ? ' (it was ahead of canonical: remove it from AHEAD once the change is confirmed there)' : ''}`);
}
if (!failed) {
  if (check) checkReceipt();
  else writeFileSync(receipt, JSON.stringify(snapshot(), null, 2) + '\n');
}
process.exit(failed ? 1 : 0);
