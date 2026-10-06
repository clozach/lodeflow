// Captures before/after pairs (2×) of the demo page for the project's reveal deck.
//   RUN_DIR=… [SCENES=id,id] node test/capture-deck.mjs <demo.html> <previous build's demo.html>
// Each side runs in a fresh page with the same viewport, scale and sample data, and shoots the
// diagram's frame only. A side is a function that leaves the page in the state to shoot (the
// mouse may still be held down). Scenes whose "before" needs the previous code use the second demo.
// Scenes are per change: these are ⇧-reversing Link and Select edge's (2026-10-02); earlier changes'
// scenes (links, untangle, size limits, edge controls, reverse link) are in this file's git history.
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const RUN = resolve(process.env.RUN_DIR || 'run');
const demo = 'file://' + resolve(process.argv[2]);
const oldDemo = process.argv[3] ? 'file://' + resolve(process.argv[3]) : null;
await mkdir(join(RUN, 'captures'), { recursive: true });
const browser = await chromium.launch();
const scenes = [];

const settle = (page, ms = 900) => page.waitForTimeout(ms);
const box = (page, sel) =>
  page.evaluate((sel) => {
    const n = document.getElementById('flow').shadowRoot.querySelector(sel);
    const r = n.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, sel);
const edgeMid = (page, from, to) =>
  page.evaluate(([from, to]) => {
    const f = document.getElementById('flow');
    const i = f.doc.edges.findIndex((e) => e.from === from && e.to === to);
    const path = [...f.shadowRoot.querySelectorAll('path.edge')][i];
    const p = path.getPointAtLength(path.getTotalLength() / 2);
    const m = path.getScreenCTM();
    return { x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f };
  }, [from, to]);
const click = async (page, sel) => {
  const b = await box(page, sel);
  await page.mouse.click(b.x, b.y);
  await settle(page, 400);
};
async function drag(page, a, b, release = true) {
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(a.x + (b.x - a.x) * 0.3, a.y + (b.y - a.y) * 0.3, { steps: 6 });
  await page.mouse.move(b.x, b.y, { steps: 10 });
  await settle(page, 300);
  if (release) await page.mouse.up();
}
const away = (page) => page.mouse.move(2, 2);

async function open(url, opts) {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 780 }, deviceScaleFactor: 2, ...opts });
  const page = await ctx.newPage();
  await page.goto(url);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => document.getElementById('flow')?.layoutInfo);
  await settle(page, 700);
  return { ctx, page };
}

const only = process.env.SCENES ? new Set(process.env.SCENES.split(',')) : null;
async function scene(id, title, before, after, { opts, beforeUrl } = {}) {
  if (only && !only.has(id)) return;
  const shots = {};
  for (const [side, fn, url] of [['before', before, beforeUrl ?? demo], ['after', after, demo]]) {
    const { ctx, page } = await open(url, opts);
    if (fn) await fn(page);
    await settle(page);
    const path = `captures/${id}.${side}.png`;
    await page.locator('#frame').screenshot({ path: join(RUN, path) });
    shots[side] = path;
    await ctx.close();
  }
  scenes.push({ id, title, ...shots });
  console.log('captured', id);
}

const trust = '.node[data-id="trust"]';
const trustSelected = async (page) => {
  await click(page, trust);
  await away(page);
};
const keys = (...ks) => async (page) => {
  await trustSelected(page);
  for (const k of ks) {
    await page.keyboard.press(k);
    await settle(page, 400);
  }
};

const edgeSelected = async (page) => {
  const m = await edgeMid(page, 'slip', 'trust');
  await page.mouse.click(m.x, m.y);
  await settle(page, 400);
  await away(page);
};
// The key rows sit below the help dialog's fold: scroll them into view on both sides.
const helpKeys = async (page) => {
  await keys('?')(page);
  await page.evaluate(() => {
    const h = [...document.getElementById('flow').shadowRoot.querySelectorAll('h4')].find((x) => x.textContent === 'Keys');
    h?.scrollIntoView({ block: 'start' });
  });
};
const shiftHeld = async (page) => {
  await trustSelected(page);
  await page.keyboard.down('Shift');
  await settle(page, 300);
};

await scene('link-and-select-edge', 'A node’s controls: Link E ⇧E and Select edge S ⇧S', trustSelected, trustSelected, { beforeUrl: oldDemo });
await scene('shift-turns-them-around', 'Holding ⇧ turns them around in place', trustSelected, shiftHeld);
await scene('edge-controls-select-edge', 'An edge’s controls: Select edge S ⇧S', edgeSelected, edgeSelected, { beforeUrl: oldDemo });
await scene('help-lists-the-keys', 'Help: E / ⇧E and S / ⇧S', helpKeys, helpKeys, { beforeUrl: oldDemo });

await writeFile(join(RUN, 'captures', 'manifest.json'), JSON.stringify({ scale: 2, scenes }, null, 2));
await browser.close();
console.log('manifest →', join(RUN, 'captures', 'manifest.json'));
