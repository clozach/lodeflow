// Camera-math properties, in Node, no browser: edge pan's speed curve and its stop at the diagram.
//   node test/geometry.mjs
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const entry = fileURLToPath(new URL('../src/geometry.ts', import.meta.url));
const out = await build({ entryPoints: [entry], bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'error' });
const { edgePanVelocity: v, edgePanStop: stop, snapRotation } = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));

const W = 1000, H = 600, B = 48, MAX = 900;
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} vs ${b}`);
let checks = 0;
const check = (fn) => { fn(); checks++; };

// The speed curve.
check(() => assert.deepEqual(v({ x: 500, y: 300 }, W, H, B, MAX), { x: 0, y: 0 }, 'the middle does not pan'));
check(() => near(v({ x: W - B, y: 300 }, W, H, B, MAX).x, 0, 'the band’s inner line is still'));
check(() => near(v({ x: W, y: 300 }, W, H, B, MAX).x, MAX, 'the edge is top speed'));
check(() => near(v({ x: W + 300, y: 300 }, W, H, B, MAX).x, MAX, 'past the edge (a captured pointer) stays at top speed'));
check(() => near(v({ x: W - B / 2, y: 300 }, W, H, B, MAX).x, MAX / 4, 'half way in is a quarter of top speed (eases in)'));
check(() => near(v({ x: 0, y: 300 }, W, H, B, MAX).x, -MAX, 'the left edge pans the other way'));
check(() => near(v({ x: 500, y: 0 }, W, H, B, MAX).y, -MAX, 'the top edge pans up'));
check(() => near(v({ x: 500, y: H }, W, H, B, MAX).y, MAX, 'the bottom edge pans down'));
check(() => {
  const c = v({ x: W, y: H }, W, H, B, MAX);
  near(c.x, MAX, 'a corner pans across');
  near(c.y, MAX, 'and down');
});
check(() => assert.deepEqual(v({ x: W, y: H }, W, H, 0, MAX), { x: 0, y: 0 }, 'no band, no pan'));
check(() => {
  let last = -1;
  for (let x = W - B; x <= W + 20; x += 0.5) {
    const s = v({ x, y: 300 }, W, H, B, MAX).x;
    assert.ok(s >= last, `speed never falls as the pointer nears the edge (x=${x})`);
    last = s;
  }
});

// The stop at the diagram: margin 16.
const M = 16;
const box = (x, y, w, h) => ({ x, y, w, h });
check(() => assert.deepEqual(stop({ x: 600, y: 0 }, box(-500, 0, 3000, 400), W, H, M), { x: 600, y: 0 }, 'plenty of diagram beyond: full speed'));
check(() => near(stop({ x: 600, y: 0 }, box(0, 0, W - M + 20, 400), W, H, M).x, 120, '20 px left: slowed to 6 × 20 px/s'));
check(() => near(stop({ x: 600, y: 0 }, box(0, 0, W - M + 0.4, 400), W, H, M).x, 0, 'within half a pixel: stopped'));
check(() => near(stop({ x: 600, y: 0 }, box(100, 100, 400, 300), W, H, M).x, 0, 'a diagram already in view does not pan'));
check(() => near(stop({ x: -600, y: 0 }, box(-200, 0, 3000, 400), W, H, M).x, -600, 'leftward: diagram beyond the left edge, full speed'));
check(() => near(stop({ x: -600, y: 0 }, box(M - 10, 0, 3000, 400), W, H, M).x, -60, 'leftward: 10 px left, slowed'));
check(() => near(stop({ x: 0, y: 600 }, box(0, 0, 400, H - M + 50), W, H, M).y, 300, 'downward: limited the same way'));
check(() => near(stop({ x: 0, y: -600 }, box(0, M + 5, 400, 300), W, H, M).y, 0, 'upward: top already in view'));
check(() => assert.deepEqual(stop({ x: 0, y: 0 }, box(-900, -900, 3000, 3000), W, H, M), { x: 0, y: 0 }, 'no speed stays none'));

for (const turn of [-720, -360, 0, 360, 720]) for (const offset of [-3, -2.9, 0, 2.9, 3]) check(() => assert.equal(snapRotation((turn + offset) * Math.PI / 180), 0, 'upright boundary'));
for (const angle of [-180, -3.001, 3.001, 90, 356.999, 363.001]) check(() => near(snapRotation(angle * Math.PI / 180), angle * Math.PI / 180, 'outside snap zone'));

for (const turn of [-720, -360, 0, 360, 720]) for (let target = 0; target < 360; target += 45) {
  const expected = target === 0 ? 0 : (turn + target) * Math.PI / 180;
  for (const offset of [-3, -2.9, 0, 2.9, 3]) check(() => near(snapRotation((turn + target + offset) * Math.PI / 180), expected, 'common angle boundary'));
  for (const offset of [-3.001, 3.001, 22.5]) check(() => { const a = (turn + target + offset) * Math.PI / 180; near(snapRotation(a), a, 'between common angle bands'); });
}

console.log(`✓ geometry: ${checks} edge-pan and rotation checks`);
