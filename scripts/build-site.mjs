// Build the portable GitHub Pages artifact after building web/dist.
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(process.argv[2] || `${root}/site/dist`);
await readFile(`${root}/web/dist/lode-flow.js`); // A missing library build is an actionable error.
await mkdir(`${output}/assets`, { recursive: true });
for (const name of ['index.html', 'styles.css', 'app.mjs', 'tutorial.mjs', 'favicon.svg', 'logo.svg']) {
  await cp(`${root}/site/${name}`, `${output}/${name}`);
}
await cp(`${root}/web/dist/lode-flow.js`, `${output}/assets/lode-flow.js`);
await writeFile(`${output}/.nojekyll`, '');
console.log(`GitHub Pages tutorial: ${output}`);
