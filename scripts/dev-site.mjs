// Watch source and serve an automatically refreshed tutorial preview.
// node scripts/dev-site.mjs [port]
import { context } from '../web/node_modules/esbuild/lib/main.js';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { watch } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = `${root}/site/.dev`;
const clients = new Set();
const reload = () => clients.forEach((res) => res.write('data: reload\n\n'));
await mkdir(output, { recursive: true });
async function copyShell() {
  const html = (await readFile(`${root}/site/index.html`, 'utf8'))
    .replace("connect-src 'none'", "connect-src 'self'")
    .replace('</head>', '<script type="module" src="./dev-reload.mjs"></script></head>');
  await writeFile(`${output}/index.html`, html);
  await writeFile(`${output}/favicon.svg`, await readFile(`${root}/site/favicon.svg`));
}
await copyShell();
await writeFile(`${output}/dev-reload.mjs`, "new EventSource('./__live').onmessage = () => location.reload();\n");
const ctx = await context({
  absWorkingDir: root, entryPoints: { app: 'site/app.mjs', styles: 'site/styles.css' },
  bundle: true, format: 'esm', target: 'es2022', outdir: output,
  outExtension: { '.js': '.mjs' },
  plugins: [{ name: 'local-component', setup(build) {
    build.onResolve({ filter: /assets\/lode-flow\.js$/ }, () => ({ path: `${root}/web/src/index.ts` }));
    build.onEnd((result) => { if (!result.errors.length) reload(); });
  } }],
});
await ctx.rebuild();
await ctx.watch();
const mime = { '.html': 'text/html', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const server = createServer(async (req, res) => {
  if (req.url === '/__live') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write(': connected\n\n'); clients.add(res); req.on('close', () => clients.delete(res)); return;
  }
  let pathname;
  try { pathname = decodeURIComponent((req.url || '/').split('?')[0]); }
  catch { res.writeHead(400); res.end('Invalid path'); return; }
  const path = resolve(output, '.' + (pathname === '/' ? '/index.html' : pathname));
  if (!path.startsWith(output + '/')) { res.writeHead(403); res.end(); return; }
  try {
    const bytes = await readFile(path);
    res.writeHead(200, { 'Content-Type': mime[path.slice(path.lastIndexOf('.'))] || 'application/octet-stream', 'Cache-Control': 'no-cache' }); res.end(bytes);
  } catch { res.writeHead(404); res.end('Not found'); }
});
server.listen(Number(process.argv[2] || 5207), '0.0.0.0');
const shell = watch(`${root}/site`, async (_, name) => {
  if (!['index.html', 'favicon.svg'].includes(name)) return;
  await copyShell();
  reload();
});
console.log(`Tutorial preview: http://localhost:${Number(process.argv[2] || 5207)}/ (reloads on save)`);
async function stop() { shell.close(); clients.forEach((res) => res.end()); server.close(); await ctx.dispose(); process.exit(); }
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
