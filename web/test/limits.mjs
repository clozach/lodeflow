// Browser checks for the optional whole-document item budget and built-in Blueprint.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const bundle = await readFile(new URL('../dist/lode-flow.iife.js', import.meta.url), 'utf8');
const nodes = (n) => Array.from({ length: n }, (_, i) => ({ id: `n${i}`, text: `Item ${i}` }));
const doc = (n, rest = {}) => ({ nodes: nodes(n), edges: [], groups: [], junctions: [], settings: { orientation: 'lr', untangle: false }, ...rest });
const seed = doc(2);
const fixture = (key = '', data = seed) => `<!doctype html><meta charset="utf-8"><style>body {margin:0} lode-flow {height:600px}</style>
<lode-flow theme="blueprint" max-items="100" ${key ? `storage-key="${key}"` : ''}><script type="application/json">${JSON.stringify(data)}</script></lode-flow>
<script>${bundle.replace(/<\/script/gi, '<\\/script')}</script>`;
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://local');
  res.setHeader('content-type', url.pathname === '/oversized.json' ? 'application/json' : 'text/html');
  res.end(url.pathname === '/oversized.json' ? JSON.stringify(doc(101)) : fixture(url.searchParams.get('key'), url.searchParams.has('oversized') ? doc(101) : seed));
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 700 }, colorScheme: 'dark' });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const E = (fn, arg) => page.evaluate(fn, arg);
const state = () => E(() => {
  const f = document.querySelector('lode-flow');
  return { state: f.getState(), items: f.itemCount, max: f.maxItems, editor: !!f.shadowRoot.querySelector('textarea.ed') };
});
const reset = async (data) => {
  await E((data) => {
    const f = document.querySelector('lode-flow');
    f.setDoc(data); f.select([]); f.tun.animation = 0;
    f.events = [];
    if (!f.limitListener) { f.addEventListener('lode-limit', (e) => f.events.push(e.detail)); f.limitListener = true; }
  }, data);
  await page.waitForTimeout(100);
};
const pick = async (ids) => { await E((ids) => { const f = document.querySelector('lode-flow'); f.select(ids); f.focus({ preventScroll: true }); }, ids); };
const unchanged = async (before, message) => assert.deepEqual(await state(), before, message);
let checks = 0;
const check = async (name, fn) => { await fn(); checks++; console.log(`✓ ${name}`); };

try {
  await page.goto(base);
  await page.waitForFunction(() => document.querySelector('lode-flow')?.layoutInfo);

  await check('99 → 100 succeeds; 101st free node leaves no editor or undo entry', async () => {
    await reset(doc(99)); await pick([]); await page.keyboard.press('n');
    await page.waitForSelector('textarea.ed');
    await page.locator('textarea.ed').fill('The hundredth item'); await page.keyboard.press('Enter');
    assert.equal((await state()).items, 100);
    await pick([]); const before = await state(); await page.keyboard.press('n');
    await unchanged(before, 'rejected free add leaves the complete state unchanged');
    const events = await E(() => document.querySelector('lode-flow').events);
    assert.equal(events.at(-1).attemptedCount, 101);
    assert.match(events.at(-1).message, /100 items/);
    assert.match(await page.locator('.nudge').textContent(), /100 items/);
  });

  await check('at 100, host select+focus allows text editing, delete and undo/redo', async () => {
    await pick(['n0']); await page.keyboard.press('Enter'); await page.waitForSelector('textarea.ed');
    await page.locator('textarea.ed').fill('Edited at the limit'); await page.keyboard.press('Enter');
    assert.equal(await E(() => document.querySelector('lode-flow').doc.nodes[0].text), 'Edited at the limit');
    assert.equal((await state()).items, 100);
    await page.keyboard.press('Delete'); assert.equal((await state()).items, 99);
    await E(() => document.querySelector('lode-flow').undo()); assert.equal((await state()).items, 100);
    await E(() => document.querySelector('lode-flow').redo()); assert.equal((await state()).items, 99);
  });

  await check('linked node additions are atomic at 99 and fit at 98', async () => {
    await reset(doc(99)); await pick(['n0']); const before = await state(); await page.keyboard.press('n');
    await unchanged(before, 'node plus edge does not partially add its node');
    await reset(doc(98)); await pick(['n0']); await page.keyboard.press('n'); await page.waitForSelector('textarea.ed');
    await page.locator('textarea.ed').fill('One node and one edge'); await page.keyboard.press('Enter');
    assert.equal((await state()).items, 100);
    assert.equal(await E(() => document.querySelector('lode-flow').doc.edges.length), 1);
  });

  await check('multi-link, picked-node add, split and merge reject the whole transaction', async () => {
    const linked = doc(98, { edges: [{ id: 'e', from: 'n0', to: 'n1' }] });
    for (const operation of ['addLinkedTo', 'splitEdge', 'addCause', 'performLink', 'performLinks']) {
      await reset(linked); await pick(['n0']); const before = await state();
      await E((operation) => {
        const f = document.querySelector('lode-flow');
        if (operation === 'addLinkedTo') f.addLinkedTo(['n1', 'n2'], 'after');
        if (operation === 'splitEdge') f.splitEdge('e');
        if (operation === 'addCause') f.addCause('e');
        if (operation === 'performLink') f.performLink('n2', { type: 'edge', id: 'e' }, 'drag');
        if (operation === 'performLinks') f.performLinks('n0', [
          { from: 'n0', to: { type: 'node', id: 'n2' } }, { from: 'n0', to: { type: 'node', id: 'n3' } },
        ], [{ text: 'Item 2' }, { text: 'Item 3' }], false);
      }, operation);
      await unchanged(before, `${operation} leaves content, selection, editor and history untouched`);
      assert.equal(await E(() => document.querySelector('lode-flow').events.length), 1);
    }
  });

  await check('groups and junctions each consume one item; grouping respects the boundary', async () => {
    await reset(doc(99)); await pick(['n0', 'n1']); await page.keyboard.press('g'); await page.waitForSelector('textarea.ed');
    await page.locator('textarea.ed').fill('A group is one item'); await page.keyboard.press('Enter');
    assert.equal((await state()).items, 100);
    await pick(['n2', 'n3']); const before = await state(); await page.keyboard.press('g'); await unchanged(before, 'second group rejected');
    const merged = doc(95, {
      groups: [{ id: 'g', text: 'One group' }], junctions: [{ id: 'j' }],
      edges: [{ id: 'a', from: 'n0', to: 'j' }, { id: 'b', from: 'n1', to: 'j' }, { id: 'trunk', from: 'j', to: 'n2' }],
    });
    await reset(merged); assert.equal((await state()).items, 100);
    await pick([]); const allTypes = await state(); await page.keyboard.press('n'); await unchanged(allTypes, 'junction and group included in cap');
  });

  await check('setDoc and setState reject oversized content/history before replacing the current state', async () => {
    await reset(doc(4)); await pick(['n1']);
    const before = await state();
    const reject = await E((oversized) => {
      const f = document.querySelector('lode-flow');
      const failures = [];
      for (const fn of [() => f.setDoc(oversized), () => f.setDoc(oversized, { resetHistory: false }), () => f.setState({ doc: oversized, view: { sel: [] } })]) {
        try { fn(); } catch (err) { failures.push(err.name); }
      }
      return failures;
    }, doc(101));
    assert.deepEqual(reject, ['RangeError', 'RangeError', 'RangeError']); await unchanged(before, 'public loads reject atomically');
    const rejectHistory = await E(({ valid, oversized }) => {
      const f = document.querySelector('lode-flow');
      const view = { cam: { x: 0, y: 0, z: 1, r: 0 }, sel: [], follow: true };
      const failures = [];
      for (const history of [
        { v: 2, index: 0, docs: [valid, oversized], entries: [{ kind: 'add', before: { doc: 0, view }, after: { doc: 1, view } }] },
        { v: 1, index: 1, entries: [{ kind: 'delete', before: { doc: oversized, view }, after: { doc: valid, view } }] },
      ]) {
        try { f.setState({ doc: valid, history }); } catch (err) { failures.push(err.name); }
      }
      return failures;
    }, { valid: doc(4), oversized: doc(101) });
    assert.deepEqual(rejectHistory, ['RangeError', 'RangeError']); await unchanged(before, 'both history formats reject atomically');
  });

  await check('inline and src loads cannot exceed the cap', async () => {
    await page.goto(`${base}/?oversized`); await page.waitForTimeout(200);
    assert.equal((await state()).items, 0);
    await page.goto(base); await page.waitForFunction(() => document.querySelector('lode-flow')?.layoutInfo);
    const before = await state(); await E(() => document.querySelector('lode-flow').setAttribute('src', '/oversized.json'));
    await page.waitForTimeout(150); await unchanged(before, 'src rejects without replacing the existing diagram');
  });

  await check('oversized saved content or undo history stays in localStorage until explicit reset', async () => {
    await page.goto(`${base}/?key=limit-test`); await page.waitForFunction(() => document.querySelector('lode-flow')?.layoutInfo);
    const original = await E((oversized) => {
      const view = { cam: { x: 0, y: 0, z: 1, r: 0 }, sel: [], follow: true };
      const saved = JSON.stringify({ rev: 123, doc: oversized, view });
      localStorage.setItem('lodeflow:limit-test', saved);
      return saved;
    }, doc(101));
    await page.reload(); await page.waitForTimeout(200);
    assert.equal((await state()).items, 0);
    assert.match(await page.locator('.empty').textContent(), /saved data is unchanged/i);
    await pick([]); await page.keyboard.press('n'); await page.waitForSelector('textarea.ed');
    await page.locator('textarea.ed').fill('Unsaved'); await page.keyboard.press('Enter'); await page.waitForTimeout(350);
    assert.equal(await E(() => localStorage.getItem('lodeflow:limit-test')), original);
    await E((valid) => {
      const f = document.querySelector('lode-flow'); f.setDoc(valid); f.select(['n0']);
    }, doc(3));
    await page.waitForTimeout(350);
    assert.equal(await E(() => JSON.parse(localStorage.getItem('lodeflow:limit-test')).doc.nodes.length), 3);
    const historySave = await E(({ valid, oversized }) => {
      const view = { cam: { x: 0, y: 0, z: 1, r: 0 }, sel: [], follow: true };
      const saved = JSON.stringify({ rev: 456, doc: valid, view });
      const history = JSON.stringify({ rev: 456, history: { v: 2, index: 0, docs: [valid, oversized], entries: [{ kind: 'add', before: { doc: 0, view }, after: { doc: 1, view } }] } });
      localStorage.setItem('lodeflow:limit-test', saved); localStorage.setItem('lodeflow:limit-test:history', history);
      return { saved, history };
    }, { valid: doc(3), oversized: doc(101) });
    await page.reload(); await page.waitForTimeout(200); await pick([]); await page.waitForTimeout(350);
    assert.equal((await state()).items, 0);
    assert.deepEqual(await E(() => ({ saved: localStorage.getItem('lodeflow:limit-test'), history: localStorage.getItem('lodeflow:limit-test:history') })), historySave);
  });

  await check('uncapped default accepts 101+; a later lower cap preserves content and blocks growth/history bypass', async () => {
    await page.goto(base); await page.waitForFunction(() => document.querySelector('lode-flow')?.layoutInfo);
    await E(() => document.querySelector('lode-flow').removeAttribute('max-items')); await reset(doc(101));
    assert.equal((await state()).max, null);
    await pick([]); await page.keyboard.press('n'); await page.waitForSelector('textarea.ed');
    await page.locator('textarea.ed').fill('Uncapped item 102'); await page.keyboard.press('Enter');
    assert.equal((await state()).items, 102);
    await E(() => document.querySelector('lode-flow').setAttribute('max-items', '100'));
    await pick([]); const before = await state(); await page.keyboard.press('n'); await unchanged(before, 'lower cap preserves existing content');
    await pick(['n0']); await page.keyboard.press('Enter'); await page.locator('textarea.ed').fill('Still editable'); await page.keyboard.press('Enter');
    assert.equal((await state()).items, 102); await page.keyboard.press('Delete'); assert.equal((await state()).items, 101);
    await page.waitForTimeout(200); // let the successful deletion's follow-camera refit finish
    const deleted = await state(); await E(() => document.querySelector('lode-flow').undo()); await unchanged(deleted, 'undo cannot grow an oversized document');
    await E(() => document.querySelector('lode-flow').rewind()); await unchanged(deleted, 'express rewind cannot bypass cap');
  });

  await check('Blueprint stays blue under OS dark mode; yellow selection/root ring and cyan focus', async () => {
    await reset(seed); await pick(['n0']); await page.waitForTimeout(150);
    const css = (sel) => E((sel) => {
      const f = document.querySelector('lode-flow'); const s = getComputedStyle(f.shadowRoot.querySelector(sel));
      return { background: s.backgroundColor, image: s.backgroundImage, radius: s.borderRadius, shadow: s.boxShadow, border: s.borderTopColor, font: s.fontFamily };
    }, sel);
    const node = await css('.node[data-id="n0"]'); assert.equal(node.background, 'rgb(11, 52, 84)'); assert.equal(node.radius, '2px');
    assert.equal(node.border, 'rgb(255, 228, 92)'); assert.match(node.font, /monospace/);
    assert.match((await css('.vp')).image, /repeating-linear-gradient/);
    assert.match((await css('.ring')).shadow, /138, 222, 255.*1px/);
    await pick([]); await page.waitForTimeout(30);
    assert.match((await css('.ring')).shadow, /255, 228, 92.*2px/);
    await E(() => document.querySelector('lode-flow').style.setProperty('--lf-focus-ring-empty-color', '#ffffff'));
    assert.match((await css('.ring')).shadow, /255, 255, 255.*2px/);
    await E(() => document.querySelector('lode-flow').setAttribute('theme', 'light'));
    assert.equal((await css('.node')).background, 'rgb(255, 255, 255)');
    assert.equal((await css('.vp')).image, 'none');
  });
  assert.deepEqual(errors, [], 'no unhandled browser errors');
  console.log(`\n${checks}/${checks} item-limit and Blueprint browser scenarios pass`);
} finally {
  await browser.close(); await new Promise((resolve) => server.close(resolve));
}
