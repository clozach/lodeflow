// Re-layout timings for diagrams of increasing size, in real Chromium.
//   node test/perf.mjs [--family flow|plain|dense|deep|wide] [--sizes 10,25,50,...] [--reps 3]
//                      [--orientation auto|lr|tb|in-out] [--ops reorient,addNode,...] [--stop ms] [--out file.json]
// Prints a table (median busy milliseconds per operation) and any problems found after an operation.
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const family = arg('family', 'flow');
const sizes = arg('sizes', '10,25,50,100,150,200,300,400,600,800,1000').split(',').map(Number);
const reps = Number(arg('reps', '3'));
const out = arg('out', null);
const orientation = arg('orientation', 'auto');
const ops = arg('ops', null);
const stop = Number(arg('stop', 'Infinity'));

const root = resolve(new URL('..', import.meta.url).pathname);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  try {
    const p = join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    const body = await readFile(p);
    res.writeHead(200, { 'content-type': types[extname(p)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`http://127.0.0.1:${server.address().port}/test/perf-page.html`);
await page.waitForFunction(() => window.perfReady && document.getElementById('flow'));
await page.exposeFunction('report', (row) => {
  const cells = Object.entries(row.ops).map(([k, r]) => `${k} ${r.total.toFixed(1)}`).join(' · ');
  console.log(`n=${row.n} e=${row.edges} load ${row.load.toFixed(1)} · ${cells}${row.problems.length ? ' · PROBLEMS: ' + row.problems.join('; ') : ''}`);
});
const rows = await page.evaluate(
  async ({ family, sizes, reps, orientation, ops, stop }) => {
    const f = document.getElementById('flow');
    return window.perf.runSuite(f, {
      sizes, family, reps, orientation,
      ops: ops ? ops.split(',') : undefined,
      generate: window.perf.generate,
      stopAboveMs: stop,
      onResult: (r) => window.report(r),
    });
  },
  { family, sizes, reps, orientation, ops, stop },
);
if (errors.length) console.log('PAGE ERRORS:', errors.slice(0, 5));
if (out) await writeFile(out, JSON.stringify({ family, orientation, reps, rows, errors }, null, 2));
await browser.close();
server.close();
