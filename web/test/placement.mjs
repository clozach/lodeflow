// Floating controls stay reachable on narrow frames, before and after a list grows.
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const arg = (name) => { const i = process.argv.indexOf(name); return i < 0 ? null : process.argv[i + 1]; };
const baseline = process.argv.includes('--baseline');
const captures = arg('--capture') && resolve(arg('--capture'));
const textLayerModule = arg('--textlayer');
const bundle = await readFile(resolve(arg('--bundle') || 'dist/lode-flow.iife.js'), 'utf8');
const fixture = {
  settings: { orientation: 'auto', bias: 'start', compactness: 'comfortable', tightGroups: true, untangle: true },
  groups: [{ id: 'ideas', text: 'Ideas you can change' }, { id: 'practice', text: 'Your practice space' }],
  nodes: [
    { id: 'start', text: 'Start with an idea', group: 'ideas' }, { id: 'rename', text: 'Rename this idea', group: 'ideas' },
    { id: 'grow', text: 'Grow from here', group: 'practice' }, { id: 'arrange', text: 'New nodes arrange themselves', group: 'practice' },
    { id: 'extra', text: 'An extra idea' }, { id: 'outcome', text: 'A useful outcome' }, { id: 'learn', text: 'Experiment, then undo' },
  ],
  edges: [
    { id: 'start-rename', from: 'start', to: 'rename', label: 'make it yours' }, { id: 'rename-grow', from: 'rename', to: 'grow', label: 'add a next step' },
    { id: 'grow-arrange', from: 'grow', to: 'arrange' }, { id: 'arrange-outcome', from: 'arrange', to: 'outcome', label: 'leads to' },
    { id: 'start-extra', from: 'start', to: 'extra' }, { id: 'outcome-learn', from: 'outcome', to: 'learn' },
  ], junctions: [],
};
const html = `<!doctype html><meta charset="utf-8"><style>body {margin:16px;font:14px system-ui} lode-flow {height:440px}</style>
<lode-flow theme="light" node-width="190" fit-min="0.62"></lode-flow><script>${bundle.replace(/<\/script/gi, '<\\/script')}</script>
<script>document.querySelector('lode-flow').doc = ${JSON.stringify(fixture)};</script>`;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 520 }, hasTouch: true, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
if (captures) { await mkdir(captures, { recursive: true }); await writeFile(join(captures, `${baseline ? 'before' : 'after'}.html`), html); }
const reset = async (height = 440) => {
  await page.setContent(html);
  await page.evaluate((height) => { const f = document.querySelector('lode-flow'); f.style.height = `${height}px`; f.tun.animation = 0; }, height);
  await page.waitForFunction(() => document.querySelector('lode-flow')?.layoutInfo);
  await page.waitForTimeout(400);
};
const settled = () => page.waitForTimeout(250);
const inspect = () => page.evaluate(() => {
  const f = document.querySelector('lode-flow');
  const rect = (n) => { const r = n.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; };
  const button = f.shadowRoot.querySelector('[data-act="close-linker"]');
  const b = rect(button); const hit = f.shadowRoot.elementFromPoint(b.x + b.w / 2, b.y + b.h / 2);
  return { reachable: button.contains(hit), button: b, hit: hit?.outerHTML.slice(0, 160), list: rect(f.linkerEl), puck: rect(f.puck) };
});
const reports = [];
async function record(name) {
  await settled(); const report = await inspect(); reports.push({ name, ...report });
  if (!baseline) assert.equal(report.reachable, true, `${name}: Close is reachable (${report.hit})`);
  if (captures && name === 'out-after-link') {
    const side = baseline ? 'before' : 'after';
    await page.screenshot({ path: join(captures, `close.${side}.png`) });
    if (textLayerModule) {
      const { extractTextLayer } = await import(pathToFileURL(resolve(textLayerModule)).href);
      await writeFile(join(captures, `close.${side}.text.json`), JSON.stringify(await page.evaluate(extractTextLayer)));
    }
    await writeFile(join(captures, `close.${side}.meta.json`), JSON.stringify({ viewport: { width: 390, height: 520 }, scale: 2, frame: { x: 16, y: 16, width: 358, height: 440 } }));
  }
  console.log(`${report.reachable ? '✓' : '✗'} ${name}: Close ${report.reachable ? 'reachable' : 'covered'}`);
}
try {
  for (const height of [440, 320]) {
    await reset(height);
    await page.evaluate(() => { const f = document.querySelector('lode-flow'); f.select(['extra']); f.vp.focus(); });
    await settled(); await page.locator('.node-magnet [data-act="link"]').tap(); await record(`out-before-link-${height}`);
    await page.locator('.lk-list li').filter({ hasText: 'A useful outcome' }).first().tap();
    await record(height === 440 ? 'out-after-link' : `out-after-link-${height}`);
    if (!baseline) { await page.locator('[data-act="close-linker"]').tap(); assert.equal(await page.locator('.linker:not([hidden])').count(), 0); }
    await reset(height);
    await page.evaluate(() => document.querySelector('lode-flow').openLinker('extra', true, 'in'));
    await record(`reverse-before-link-${height}`);
    await page.locator('.lk-list li').filter({ hasText: 'A useful outcome' }).first().tap(); await record(`reverse-after-link-${height}`);
    await reset(height); await page.evaluate(() => document.querySelector('lode-flow').openAdder(true)); await record(`adder-${height}`);
    await page.evaluate(() => { const f = document.querySelector('lode-flow'); f.checkRow(0, true); f.checkRow(1, true); }); await record(`adder-checked-${height}`);
  }
  // The same bounded candidate search also places node, group and selected-edge controls.
  // Pin each selection near the top-left frame edge, where its old candidates clamp to Layout.
  for (const id of ['extra', 'start-extra', 'ideas']) {
    await reset();
    await page.evaluate((id) => {
      const f = document.querySelector('lode-flow');
      f.select([id]);
      const world = f.geo.nodes.get(id) ?? f.edgeAnchor(id) ?? { x: 0, y: 0 };
      const cam = { x: world.x + f.vw / 2 - 30, y: world.y + f.vh / 2 - 30, z: 1, r: 0 };
      f.commit('Pan', 'pan', { view: { cam, follow: false } }, { animateCam: false });
    }, id);
    await settled();
    const report = await page.evaluate(() => {
      const f = document.querySelector('lode-flow');
      const p = f.puck.getBoundingClientRect(), n = f.nodeMag.getBoundingClientRect();
      const overlap = Math.max(0, Math.min(p.right, n.right) - Math.max(p.left, n.left)) * Math.max(0, Math.min(p.bottom, n.bottom) - Math.max(p.top, n.top));
      const buttons = [...f.nodeMag.querySelectorAll('button')].filter((b) => !b.hidden);
      const reachable = buttons.every((b) => { const r = b.getBoundingClientRect(); return b.contains(f.shadowRoot.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); });
      return { overlap, reachable };
    });
    reports.push({ name: `selection-${id}`, ...report });
    if (!baseline) { assert.equal(report.overlap, 0, `${id} control stays clear of Layout`); assert.equal(report.reachable, true, `${id} buttons reachable`); }
    console.log(`${report.overlap ? '✗' : '✓'} selection-${id}: overlap ${report.overlap}`);
  }
  assert.deepEqual(errors, []);
  if (captures) await writeFile(join(captures, `${baseline ? 'before' : 'after'}.json`), JSON.stringify(reports, null, 2));
  if (baseline) assert.ok(reports.some((r) => !r.reachable), 'previous bundle reproduces a covered Close button');
  else console.log(`\n${reports.length}/${reports.length} list placement checks pass`);
} finally { await browser.close(); }
