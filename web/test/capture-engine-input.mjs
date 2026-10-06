// Saves the engine input of one "split an edge" re-layout, for the native replay:
//   node test/capture-engine-input.mjs <out dir> [sizes, default 600,1000]
//   cd ../engine && LF_TIME=1 cargo run --release --example replay -- <out dir>/split-600.bin
// Diagrams come from test/gen.mjs, as perf.mjs makes them. The input is copied out of the engine's
// own memory just before it runs (the f64 wire buffer, little-endian), so nothing here re-encodes it.
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const out = resolve(process.argv[2] || '.');
const sizes = (process.argv[3] || '600,1000').split(',').map(Number);
const root = resolve(new URL('..', import.meta.url).pathname);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript' };
const server = createServer(async (req, res) => {
  try {
    const p = join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    const body = await readFile(p);
    res.writeHead(200, { 'content-type': types[extname(p)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
await page.goto(`http://127.0.0.1:${server.address().port}/test/perf-page.html`);
await page.waitForFunction(() => window.perfReady && document.getElementById('flow'));
for (const n of sizes) {
  const buf = await page.evaluate(async (n) => {
    const { generate } = await import('/test/gen.mjs');
    const f = document.getElementById('flow');
    f.setDoc(generate(n, { family: 'flow', seed: n, orientation: 'auto' }));
    f.flush();
    await new Promise((r) => setTimeout(r, 500));
    // The exports object is frozen: put a copy in its place whose begin/run note the input.
    const ex = f.eng.ex;
    let at = null;
    let input = null;
    f.eng.ex = {
      ...ex,
      lf_begin: (len) => ((at = { ptr: ex.lf_begin(len) >>> 0, len }), at.ptr),
      lf_run: () => ((input = Array.from(new Float64Array(ex.memory.buffer, at.ptr, at.len))), ex.lf_run()),
    };
    const j = new Set(f.doc.junctions.map((x) => x.id));
    const plain = f.doc.edges.filter((e) => !j.has(e.from) && !j.has(e.to));
    f.select([plain[Math.floor(plain.length / 2)].id]);
    f.flush();
    f.engineCache.clear();
    f.splitEdge(f.selection[0]);
    f.flush();
    f.eng.ex = ex;
    f.finishEdit(false);
    return input;
  }, n);
  const file = join(out, `split-${n}.bin`);
  await writeFile(file, Buffer.from(new Float64Array(buf).buffer));
  console.log(`${n} nodes → ${file} (${buf.length} values)`);
}
await browser.close();
server.close();
