// Public CSS rendering controls in real Chromium; no consumer model is involved.
// node test/theme.mjs [--capture <dir>] [--bundle <iife>] [--baseline]
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { chromium } from 'playwright';

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i < 0 ? null : process.argv[i + 1];
};
const captures = arg('--capture') && resolve(arg('--capture'));
const baseline = process.argv.includes('--baseline');
const bundle = await readFile(resolve(arg('--bundle') || 'dist/lode-flow.iife.js'), 'utf8');
const doc = {
  settings: { orientation: 'lr', incremental: false },
  groups: [{ id: 'g', text: 'A shared group' }],
  nodes: [
    { id: 'a', text: 'A long first label wraps to remain readable', group: 'g' },
    { id: 'b', text: 'A second item', group: 'g' },
    { id: 'c', text: 'A third item' },
  ],
  edges: [
    { id: 'ab', from: 'a', to: 'b', text: 'A link label' },
    { id: 'bc', from: 'b', to: 'c' },
    { id: 'ca', from: 'c', to: 'a' },
  ],
};
const html = `<!doctype html><meta charset="utf-8"><title>lodeflow rendering controls</title>
<style>
body { margin: 0; padding: 20px; font: 14px system-ui; background: #eee; color: #222; }
header { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
h1 { font-size: 17px; margin: 0 auto 0 0; }
button { font: inherit; padding: 5px 10px; }
lode-flow { height: 560px; border-radius: 12px; }
lode-flow.custom {
  --lf-bg: #f7f6ef; --lf-fg: #21392c; --lf-muted: #52695b;
  --lf-canvas-background: repeating-linear-gradient(0deg, #61756818 0 1px, transparent 1px 24px),
    repeating-linear-gradient(90deg, #61756818 0 1px, transparent 1px 24px), #f7f6ef;
  --lf-node-bg: #f0ffe9; --lf-node-border: #386e45; --lf-node-shadow: none;
  --lf-node-radius: 2px; --lf-node-border-width: 2px;
  --lf-font: monospace; --lf-font-size: 16px;
  --lf-accent: #783875; --lf-accent-soft: #78387518;
  --lf-edge: #386e45; --lf-edge-back: #875321;
  --lf-edge-width: 3px; --lf-edge-hover-width: 4px;
  --lf-edge-hot-width: 5px; --lf-edge-selected-width: 6px;
  --lf-selection-width: 3px;
}
</style>
<header><h1>Rendering controls</h1><button id="theme">Change appearance</button>
<button id="node">Select item</button><button id="edge">Select line</button></header>
<lode-flow theme="light"></lode-flow>
<script>${bundle.replace(/<\/script/gi, '<\\/script')}</script>
<script>
const flow = document.querySelector('lode-flow');
flow.doc = ${JSON.stringify(doc)};
document.querySelector('#theme').onclick = () => flow.classList.toggle('custom');
document.querySelector('#node').onclick = () => flow.select(['a']);
document.querySelector('#edge').onclick = () => flow.select(['ab']);
</script>`;

if (captures) {
  await mkdir(captures, { recursive: true });
  await writeFile(join(captures, baseline ? 'before.html' : 'fixture.html'), html);
}
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1024, height: 660 }, deviceScaleFactor: 2, colorScheme: 'light' });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const settle = async () => {
  await page.waitForFunction(() => document.querySelector('lode-flow')?.layoutInfo);
  await page.waitForTimeout(800);
  await page.mouse.move(1000, 10);
};
const css = (selector, properties, pseudo = null) => page.evaluate(({ selector, properties, pseudo }) => {
  const el = document.querySelector('lode-flow').shadowRoot.querySelector(selector);
  const s = getComputedStyle(el, pseudo);
  return Object.fromEntries(properties.map((p) => [p, s[p]]));
}, { selector, properties, pseudo });
const shot = async (name) => {
  const png = await page.screenshot();
  if (captures) {
    await writeFile(join(captures, `${name}.${baseline ? 'before' : 'after'}.png`), png);
    if (!baseline && name.startsWith('default')) {
      assert.ok(png.equals(await readFile(join(captures, `${name}.before.png`))), `${name} unchanged pixel for pixel`);
    }
  }
};
const select = async (ids) => {
  await page.evaluate((ids) => document.querySelector('lode-flow').select(ids), ids);
  await settle();
};
const nodePoint = async () => page.locator('.node[data-id="a"]').boundingBox();

try {
  await page.setContent(html);
  await settle();
  assert.deepEqual(await css('.node[data-id="a"]', ['borderRadius', 'borderTopWidth', 'fontSize', 'backgroundColor']), {
    borderRadius: '10px', borderTopWidth: '1px', fontSize: '14px', backgroundColor: 'rgb(255, 255, 255)',
  });
  assert.equal((await css('.edge', ['strokeWidth'])).strokeWidth, '1.6px');
  await shot('default-light');
  await select(['a']);
  await shot('selected-default');
  await select([]);
  await page.evaluate(() => document.querySelector('lode-flow').setAttribute('theme', 'dark'));
  assert.equal((await css('.node', ['backgroundColor'])).backgroundColor, 'rgb(34, 36, 42)');
  await shot('default-dark');
  await page.evaluate(() => document.querySelector('lode-flow').setAttribute('theme', 'light'));
  await page.click('#theme');
  await settle();
  await shot('canvas');
  await select(['a']);
  await shot('selection');
  await select(['ab']);
  await shot('line');
  await select(['g']);
  await page.locator('.node-magnet [data-act="collapse"]').click();
  await settle();
  await shot('group');
  await page.locator('.node-magnet [data-act="collapse"]').click();
  await select(['ab']);

  if (!baseline) {
    assert.deepEqual(await css('.node[data-id="a"]', ['borderRadius', 'borderTopWidth', 'fontSize', 'fontFamily', 'backgroundColor']), {
      borderRadius: '2px', borderTopWidth: '2px', fontSize: '16px', fontFamily: 'monospace', backgroundColor: 'rgb(240, 255, 233)',
    });
    assert.match((await css('.vp', ['backgroundImage'])).backgroundImage, /repeating-linear-gradient/);
    assert.equal((await css('.carrier:not(.dot)', ['backgroundImage'])).backgroundImage, 'none', 'label surface stays solid');
    assert.equal((await css('.edge.sel', ['strokeWidth'])).strokeWidth, '6px');
    assert.match((await css('.carrier.sel', ['boxShadow'])).boxShadow, /0px 0px 0px 3px/, 'edge label selection keeps its ring');
    assert.equal((await css('.edge.back', ['strokeWidth'])).strokeWidth, '3px');
    const beforeHover = await css('.edge.back', ['strokeDasharray', 'stroke']);
    assert.equal(beforeHover.strokeDasharray, '6px, 5px', 'loop remains dashed');
    await page.evaluate(() => document.querySelector('lode-flow').shadowRoot.querySelector('.edge.back').classList.add('hover'));
    assert.equal((await css('.edge.back', ['strokeWidth'])).strokeWidth, '4px');
    await page.evaluate(() => document.querySelector('lode-flow').shadowRoot.querySelector('.edge.back').classList.remove('hover'));
    await select(['a']);
    assert.match((await css('.node.sel', ['boxShadow'], '::after')).boxShadow, /0px 0px 0px 3px/);
    assert.equal((await css('.edge.hot', ['strokeWidth'])).strokeWidth, '5px');
    const metrics = await page.evaluate(() => {
      const f = document.querySelector('lode-flow');
      const node = f.shadowRoot.querySelector('.node[data-id="a"]');
      return { size: f.sizes.get('a'), w: node.offsetWidth, h: node.offsetHeight, text: node.querySelector('.t').offsetHeight };
    });
    assert.equal(metrics.size.h, metrics.h, 'runtime font and border changes are remeasured');
    assert.equal(metrics.size.w, metrics.w);
    assert.ok(metrics.text > 30, 'text still wraps');
    await select(['g']);
    await page.locator('.node-magnet [data-act="collapse"]').click();
    await settle();
    assert.match((await css('.proxy.sel', ['boxShadow'], '::after')).boxShadow, /0px 0px 0px 3px/, 'flat collapsed group keeps its selection ring');
    assert.notEqual((await css('.proxy.sel', ['boxShadow'], '::before')).boxShadow, 'none', 'flat collapsed group keeps its stacked-card cue');
    await page.locator('.node-magnet [data-act="collapse"]').click();
    await settle();
    await select(['a']);
    const box = await nodePoint();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForSelector('textarea.ed');
    assert.match((await css('.node.editing', ['boxShadow'], '::after')).boxShadow, /0px 0px 0px 3px/, 'flat editing node keeps its ring');
    assert.equal((await css('textarea.ed', ['fontFamily'])).fontFamily, 'monospace');
    await page.locator('textarea.ed').fill('Edited label stays wrapped and readable');
    await page.keyboard.press('Enter');
    await settle();
    assert.equal(await page.evaluate(() => document.querySelector('lode-flow').doc.nodes.find((n) => n.id === 'a').text), 'Edited label stays wrapped and readable');
    await page.locator('.node-magnet [data-act="nextedge"]').click();
    await settle();
    assert.equal((await page.evaluate(() => document.querySelector('lode-flow').selection))[0], 'ab', 'magnet control still steps to the line');
    await page.keyboard.press('Shift+s');
    assert.ok((await page.evaluate(() => document.querySelector('lode-flow').selection)).length, 'keyboard remains in diagram after button click');
    await page.evaluate(() => document.querySelector('lode-flow').setAttribute('readonly', ''));
    await select(['a']);
    const original = await page.evaluate(() => document.querySelector('lode-flow').doc);
    await page.locator('.node[data-id="a"]').click();
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('textarea.ed').count(), 0, 'read-only remains read-only');
    assert.deepEqual(await page.evaluate(() => document.querySelector('lode-flow').doc), original);
    await page.click('#theme');
    await settle();
    assert.equal((await css('.node', ['borderTopWidth'])).borderTopWidth, '1px', 'removing theme restores default border');
    await page.evaluate(() => document.querySelector('lode-flow').style.setProperty('--lf-node-border-width', '7px'));
    await settle();
    const borderOnly = await page.evaluate(() => {
      const f = document.querySelector('lode-flow');
      return { measured: f.sizes.get('a').h, actual: f.shadowRoot.querySelector('.node[data-id="a"]').offsetHeight };
    });
    assert.equal(borderOnly.measured, borderOnly.actual, 'border-only changes remeasure the full rendered node');
  }
  assert.deepEqual(errors, []);
  console.log(baseline ? '✓ baseline captures and default appearance' : '✓ defaults, public theme, runtime remeasurement, text editing, selection, controls and read-only compatibility');
} finally {
  await browser.close();
}
