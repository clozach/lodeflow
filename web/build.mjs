// Builds dist/lode-flow.js (ESM, wasm inlined), dist/lode-flow.iife.js (classic <script>), dist/react.js,
// and the optional theditor entry dist/theditor.js / dist/theditor.iife.js (formatted text in nodes;
// Tiptap bundled there only; it reaches the core through ../index, never a second copy of it).
import * as esbuild from 'esbuild';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const watch = process.argv.includes('--watch');
const common = { bundle: true, target: 'es2020', legalComments: 'none', logLevel: 'info' };
/** The theditor entry reaches the core only through ../index (one registry, one element class). */
const coreOnlyThroughIndex = {
  name: 'core-only-through-index',
  setup(b) {
    b.onResolve({ filter: /^\.\.\// }, (args) => {
      if (args.path !== '../index' && args.importer.includes('/src/theditor/') && !args.importer.includes('/src/theditor/vendor/')) {
        return { errors: [{ text: `theditor entry imports ${args.path}: use ../index (the core) instead` }] };
      }
    });
  },
};
/** ESM: the core is its own module beside it. */
const coreExternal = {
  name: 'core-external',
  setup(b) {
    b.onResolve({ filter: /^\.\.\/index$/ }, () => ({ path: './lode-flow.js', external: true }));
  },
};
/** IIFE: the core is the LodeFlow global that lode-flow.iife.js defines. */
const coreGlobal = {
  name: 'core-global',
  setup(b) {
    b.onResolve({ filter: /^\.\.\/index$/ }, () => ({ path: 'lodeflow-core', namespace: 'lodeflow-global' }));
    b.onLoad({ filter: /.*/, namespace: 'lodeflow-global' }, () => ({
      contents: "if (!globalThis.LodeFlow) throw new Error('lodeflow: load lode-flow.iife.js before theditor.iife.js'); module.exports = globalThis.LodeFlow;",
      loader: 'js',
    }));
  },
};

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
  { ...common, entryPoints: ['src/theditor/index.ts'], format: 'esm', outfile: 'dist/theditor.js', minify: true, plugins: [coreOnlyThroughIndex, coreExternal] },
  { ...common, entryPoints: ['src/theditor/index.ts'], format: 'iife', globalName: 'Theditor', outfile: 'dist/theditor.iife.js', minify: true, plugins: [coreOnlyThroughIndex, coreGlobal] },
];

if (watch) {
  // Dev loop: rebuild on save, serve src/, and reload open pages (examples/standalone.html?live).
  const [main, ...rest] = builds;
  const ctx = await esbuild.context(main);
  await ctx.watch();
  for (const b of rest) await (await esbuild.context(b)).watch();
  const { port } = await ctx.serve({ servedir: '..', port: Number(process.env.PORT || 5207), host: '0.0.0.0' });
  console.log(`dev: http://localhost:${port}/examples/standalone.html?live (reloads on every rebuild)`);
} else {
  for (const b of builds) await esbuild.build(b);
  // The local TypeScript, run by this Node (a stray global npx can point at another Node).
  execFileSync(process.execPath, [createRequire(import.meta.url).resolve('typescript/bin/tsc'), '-p', 'tsconfig.json'], { stdio: 'inherit' });
}
