// Build the portable GitHub Pages artifact after building web/dist.
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(process.argv[2] || `${root}/site/dist`);
// A missing library build is an actionable error.
for (const name of ['lode-flow.js', 'theditor.js']) await readFile(`${root}/web/dist/${name}`);
await mkdir(`${output}/assets`, { recursive: true });
for (const name of ['index.html', 'styles.css', 'app.mjs', 'tutorial.mjs', 'persistence.mjs', 'favicon.svg', 'logo.svg', 'logo-dark.svg']) {
  await cp(`${root}/site/${name}`, `${output}/${name}`);
}
// The core, then theditor (formatted text in nodes), which imports the core as ./lode-flow.js beside it.
for (const name of ['lode-flow.js', 'theditor.js']) await cp(`${root}/web/dist/${name}`, `${output}/assets/${name}`);
await writeFile(`${output}/.nojekyll`, '');
console.log(`GitHub Pages tutorial: ${output}`);
