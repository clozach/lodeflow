// Builds dist/lode-flow.js (ESM, wasm inlined), dist/lode-flow.iife.js (classic <script>), dist/react.js.
import * as esbuild from 'esbuild';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const watch = process.argv.includes('--watch');
const common = { bundle: true, target: 'es2020', legalComments: 'none', logLevel: 'info' };
const builds = [
  { ...common, entryPoints: ['src/index.ts'], format: 'esm', outfile: 'dist/lode-flow.js', minify: true, sourcemap: watch },
  { ...common, entryPoints: ['src/index.ts'], format: 'iife', globalName: 'LodeFlow', outfile: 'dist/lode-flow.iife.js', minify: true },
  {
    ...common,
    entryPoints: ['src/react.tsx'],
    format: 'esm',
    outfile: 'dist/react.js',
    minify: true,
    external: ['react', './index'],
    plugins: [{
      name: 'rewrite-index',
      setup(b) {
        b.onResolve({ filter: /^\.\/index$/ }, () => ({ path: './lode-flow.js', external: true }));
      },
    }],
  },
];

if (watch) {
  // Dev loop: rebuild on save, serve src/, and reload open pages (examples/standalone.html?live).
  const [main, ...rest] = builds;
  const ctx = await esbuild.context(main);
  await ctx.watch();
  for (const b of rest) await (await esbuild.context(b)).watch();
  const { port } = await ctx.serve({ servedir: '..', port: Number(process.env.PORT || 5207), host: '0.0.0.0' });
  console.log(`dev: http://t.local:${port}/examples/standalone.html?live (reloads on every rebuild)`);
} else {
  for (const b of builds) await esbuild.build(b);
  // The local TypeScript, run by this Node (a stray global npx can point at another Node).
  execFileSync(process.execPath, [createRequire(import.meta.url).resolve('typescript/bin/tsc'), '-p', 'tsconfig.json'], { stdio: 'inherit' });
}
