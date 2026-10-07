// Exercise the actual Pages artifact at a repository prefix in three browser engines.
// Run after `node scripts/build-site.mjs`: cd web && node test/tutorial.mjs
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, firefox, webkit } from 'playwright';
import { appearanceKey, countItems, seed, storageKey } from '../../site/tutorial.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../site/dist');
const key = `lodeflow:${storageKey}`;
const types = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const server = createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(new URL(req.url, 'http://local').pathname);
    if (!path.startsWith('/lodeflow/')) throw new Error('Wrong repository prefix');
    const file = resolve(root, path.slice('/lodeflow/'.length) || 'index.html');
    if (!file.startsWith(`${root}/`)) throw new Error('Outside site');
    const bytes = await readFile(file);
    res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream' });
    res.end(bytes);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const url = `http://127.0.0.1:${server.address().port}/lodeflow/`;
const docOf = (page) => page.evaluate(() => document.querySelector('lode-flow').doc);
const ready = async (page, empty = false) => {
  await page.waitForFunction((empty) => (empty || document.querySelector('lode-flow')?.layoutInfo) && document.body.dataset.ready === 'true', empty);
  await page.waitForTimeout(300);
};
const select = (page, id) => page.locator('lode-flow').evaluate((flow, id) => {
  flow.select([id]); flow.showSelection(); flow.focus();
}, id);
const undo = async (page, redo = false) => {
  await page.locator('lode-flow').evaluate((flow) => flow.focus());
  const modifier = await page.evaluate(() => /Mac/.test(navigator.platform) ? 'Meta' : 'Control');
  await page.keyboard.press(`${modifier}+${redo ? 'Shift+' : ''}z`);
};
const edit = async (page, text) => {
  await page.keyboard.press('Enter');
  await page.locator('textarea.ed').fill(text);
  await page.keyboard.press('Enter');
};
const waitSaved = (page, text) => page.waitForFunction(({ key, text }) => localStorage.getItem(key)?.includes(text), { key, text });
let failures = 0;

async function scenario(browser, name, action, options = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: 'light', ...options });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await action(page, context);
    assert.deepEqual(errors, [], 'no uncaught browser errors');
    console.log(`✓ ${name}`);
  } catch (error) {
    failures++;
    console.error(`✗ ${name}\n  ${error.stack}`);
  } finally { await context.close(); }
}

try {
  const engines = { Chromium: chromium, Firefox: firefox, WebKit: webkit };
  const selected = process.env.BROWSERS?.toLowerCase().split(',');
  for (const [name, engine] of Object.entries(engines).filter(([name]) => !selected || selected.includes(name.toLowerCase()))) {
    const browser = await engine.launch();
    try {
      await scenario(browser, `${name}: minimal editor, real edits and links, themes, saved undo and restore`, async (page) => {
        await page.goto(url);
        await ready(page);
        assert.equal(countItems(await docOf(page)), 15);
        assert.equal(await page.locator('#appearance').inputValue(), 'light');
        assert.equal(await page.locator('#item-count').textContent(), '15 / 100 items');
        assert.equal(await page.locator('.intro, aside, footer, #mobile-gesture, #step-list, #undo, #redo, #fit').count(), 0, 'host tutorial and duplicate controls are gone');
        const frame = await page.locator('.canvas-frame').boundingBox();
        assert.ok(frame.width > 1200 && frame.height > 600, 'the editor uses the desktop viewport');
        const firstFrame = await page.locator('lode-flow').evaluate((flow) => {
          const frame = flow.getBoundingClientRect();
          return [...flow.shadowRoot.querySelectorAll('.node[data-id]')].map((node) => {
            const r = node.getBoundingClientRect();
            return { id: node.dataset.id, inside: r.left >= frame.left && r.right <= frame.right && r.top >= frame.top && r.bottom <= frame.bottom, textSize: parseFloat(getComputedStyle(node).fontSize) * flow.camera.z };
          });
        });
        assert.ok(firstFrame.every((node) => node.inside && node.textSize >= 11), 'every seed node fits and remains readable');
        const editRequests = [];
        page.on('request', (request) => editRequests.push(request.url()));
        await select(page, 'rename');
        assert.deepEqual(await page.evaluate(() => document.querySelector('lode-flow').selection), ['rename']);
        await edit(page, 'My first idea');
        assert.equal((await docOf(page)).nodes.find((node) => node.id === 'rename').text, 'My first idea');
        await waitSaved(page, 'My first idea');
        assert.deepEqual(editRequests, [], 'diagram edits make no network requests');
        await page.reload();
        await ready(page);
        assert.equal((await docOf(page)).nodes.find((node) => node.id === 'rename').text, 'My first idea');
        await undo(page);
        assert.equal((await docOf(page)).nodes.find((node) => node.id === 'rename').text, 'Rename this idea', 'undo survives reload');
        await undo(page, true);
        await select(page, 'grow');
        await page.keyboard.press('n');
        await page.locator('textarea.ed').fill('A next step');
        await page.keyboard.press('Enter');
        assert.equal(countItems(await docOf(page)), 17, 'a node and its arrow both count');
        await select(page, 'extra');
        await page.keyboard.press('e');
        await page.locator('.lk-filter').fill('A useful outcome');
        await page.keyboard.press('Enter');
        await page.keyboard.press('Escape');
        assert.ok((await docOf(page)).edges.some((edge) => edge.from === 'extra' && edge.to === 'outcome'));
        await select(page, 'practice');
        await page.keyboard.press('c');
        assert.equal((await docOf(page)).groups.find((group) => group.id === 'practice').collapsed, true);
        await page.keyboard.press('c');
        await page.locator('#appearance').selectOption('blueprint');
        const background = await page.locator('lode-flow').evaluate((flow) => getComputedStyle(flow.shadowRoot.querySelector('.vp')).backgroundImage);
        assert.match(background, /gradient/, 'built-in Blueprint grid renders');
        const beforeReset = await docOf(page);
        await page.locator('#reset').click();
        assert.equal(countItems(await docOf(page)), 15);
        await undo(page);
        assert.deepEqual(await docOf(page), beforeReset, 'restoring tutorial is one undoable change');
        await waitSaved(page, 'A next step');
        await page.reload();
        await ready(page);
        assert.equal(await page.locator('#appearance').inputValue(), 'blueprint');
        assert.equal(await page.locator('lode-flow').getAttribute('theme'), 'blueprint');
        await page.locator('#appearance').selectOption('light');
        assert.equal(await page.locator('lode-flow').getAttribute('theme'), 'light');
      });

      await scenario(browser, `${name}: 100 combined items, atomic API rejection, editing at capacity`, async (page) => {
        await page.goto(url);
        await ready(page);
        await page.evaluate(() => {
          const flow = document.querySelector('lode-flow');
          flow.setDoc({ nodes: Array.from({ length: 98 }, (_, i) => ({ id: `n${i}`, text: `Idea ${i}` })), groups: [{ id: 'g', text: 'Group counts too' }], edges: [{ id: 'e', from: 'n0', to: 'n1' }] });
          flow.select([]);
          flow.focus();
        });
        assert.equal(await page.locator('#item-count').textContent(), '100 / 100 items');
        await page.keyboard.press('n');
        assert.equal(await page.locator('textarea.ed').count(), 0, 'cannot add the 101st item');
        assert.equal(countItems(await docOf(page)), 100);
        assert.match(await page.locator('#notice').textContent(), /100/);
        const oversized = await page.evaluate(() => {
          const flow = document.querySelector('lode-flow');
          try { flow.setDoc({ ...flow.doc, nodes: [...flow.doc.nodes, { id: 'overflow', text: 'Overflow' }] }); return false; }
          catch (error) { return error instanceof RangeError; }
        });
        assert.equal(oversized, true);
        assert.equal(countItems(await docOf(page)), 100);
        await page.evaluate(() => { const flow = document.querySelector('lode-flow'); flow.select(['n0']); flow.focus(); });
        await edit(page, 'Editable at the limit');
        assert.equal((await docOf(page)).nodes.find((node) => node.id === 'n0').text, 'Editable at the limit');
      });

      await scenario(browser, `${name}: Hard Reset discards drafts and history, resets appearance, and only clears its own storage`, async (page) => {
        await page.goto(url);
        await ready(page);
        const baseline = await docOf(page);
        const unrelated = { 'another-app:notes': 'Private notes', 'lodeflow:another-diagram': 'Other diagram', 'lodeflow:another-diagram:history': 'Other history' };
        await page.evaluate((unrelated) => { for (const [key, value] of Object.entries(unrelated)) localStorage.setItem(key, value); }, unrelated);
        await select(page, 'rename');
        await edit(page, 'An edit to erase');
        await waitSaved(page, 'An edit to erase');
        await page.locator('#appearance').selectOption('blueprint');
        await page.evaluate(() => {
          window.removedKeys = [];
          const remove = Storage.prototype.removeItem;
          Storage.prototype.removeItem = function (key) { window.removedKeys.push(key); return remove.call(this, key); };
        });
        await select(page, 'rename');
        await page.keyboard.press('Enter');
        await page.locator('textarea.ed').fill('Unfinished draft to erase');
        assert.equal(await page.locator('#hard-reset').getAttribute('title'), 'All data storage is local-only. Clicking this button resets the tutorial and deletes all your edits. ⚠️ Cannot be undone.');
        await page.locator('#hard-reset').click();
        await ready(page);
        assert.deepEqual(await docOf(page), baseline);
        assert.equal(await page.locator('textarea.ed').count(), 0, 'in-progress edit is discarded');
        assert.equal(await page.locator('lode-flow').evaluate((flow) => flow.canUndo || flow.canRedo), false, 'history cannot restore erased edits');
        assert.equal(await page.locator('#appearance').inputValue(), 'light');
        const storage = await page.evaluate(({ key, appearanceKey, unrelated }) => ({
          removed: window.removedKeys,
          appearance: localStorage.getItem(appearanceKey), history: localStorage.getItem(`${key}:history`),
          baseline: JSON.parse(localStorage.getItem(key)),
          unrelated: Object.fromEntries(Object.keys(unrelated).map((key) => [key, localStorage.getItem(key)])),
        }), { key, appearanceKey, unrelated });
        assert.deepEqual(storage.removed, [key, `${key}:history`, appearanceKey]);
        assert.equal(storage.appearance, null);
        assert.equal(storage.history, null);
        assert.deepEqual(storage.unrelated, unrelated);
        assert.deepEqual(storage.baseline.doc, baseline);
        assert.equal(storage.baseline.history.entries.length, 0);
        assert.equal(JSON.stringify(storage.baseline).includes('erase'), false);
        await page.reload();
        await ready(page);
        assert.deepEqual(await docOf(page), baseline);
        await undo(page);
        assert.deepEqual(await docOf(page), baseline, 'reload and Undo cannot bring back erased edits');
        await select(page, 'rename');
        await edit(page, 'An edit retained in blocked storage');
        await waitSaved(page, 'An edit retained in blocked storage');
        await page.evaluate(() => {
          Storage.prototype.removeItem = () => { throw new DOMException('Blocked', 'SecurityError'); };
        });
        await page.locator('#hard-reset').click();
        await ready(page);
        assert.deepEqual(await docOf(page), baseline, 'blocked deletion still resets this session');
        assert.equal(await page.locator('lode-flow').evaluate((flow) => flow.canUndo || flow.canRedo), false);
        assert.match(await page.locator('#save-status').textContent(), /Session only/);
        assert.match(await page.evaluate((key) => localStorage.getItem(key), key), /retained in blocked storage/, 'failed deletion keeps the prior saved value');
      });

      await scenario(browser, `${name}: Hard Reset with full storage leaves unrelated diagram history untouched`, async (page) => {
        await page.addInitScript(() => {
          localStorage.setItem('lodeflow:another-diagram:history', 'Untouched history');
          Storage.prototype.setItem = () => { throw new DOMException('Full', 'QuotaExceededError'); };
        });
        await page.goto(url);
        await ready(page);
        await select(page, 'rename');
        await page.keyboard.press('Enter');
        await page.locator('textarea.ed').fill('Pending draft');
        await page.locator('#hard-reset').click();
        assert.equal(await page.evaluate(() => localStorage.getItem('lodeflow:another-diagram:history')), 'Untouched history');
        assert.equal(countItems(await docOf(page)), 15);
        assert.equal(await page.locator('lode-flow').evaluate((flow) => flow.canUndo), false);
        assert.match(await page.locator('#save-status').textContent(), /Session only/);
        assert.match(await page.locator('#notice').textContent(), /could not be saved/);
      });

      await scenario(browser, `${name}: corrupt storage restores a usable tutorial`, async (page) => {
        await page.addInitScript(({ key }) => localStorage.setItem(key, '{ broken json'), { key });
        await page.goto(url);
        await ready(page);
        assert.equal(countItems(await docOf(page)), 15);
        assert.match(await page.locator('#notice').textContent(), /could not be read/);
        await select(page, 'rename');
        await edit(page, 'Recovered editor');
        assert.equal((await docOf(page)).nodes.find((node) => node.id === 'rename').text, 'Recovered editor');
      });

      await scenario(browser, `${name}: oversized saved document and history stay protected until explicit reset`, async (page) => {
        const oversized = { nodes: Array.from({ length: 101 }, (_, i) => ({ id: `n${i}`, text: `Idea ${i}` })), edges: [], groups: [], junctions: [] };
        await page.goto(url);
        await ready(page);
        for (const historyOnly of [false, true]) {
          const saved = { rev: 1, doc: historyOnly ? seed : oversized };
          const history = { rev: 1, history: { v: 2, index: 0, docs: [seed, oversized], entries: [{ kind: 'load', label: 'Load', before: { doc: 0, view: {} }, after: { doc: 1, view: {} } }] } };
          await page.evaluate(({ key, saved, history, historyOnly }) => {
            localStorage.setItem(key, JSON.stringify(saved));
            if (historyOnly) localStorage.setItem(`${key}:history`, JSON.stringify(history));
            else localStorage.removeItem(`${key}:history`);
          }, { key, saved, history, historyOnly });
          await page.reload();
          await ready(page, true);
          assert.match(await page.locator('#save-status').textContent(), /protected/);
          assert.match(await page.locator('#notice').textContent(), /100-item/);
          assert.deepEqual(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), key), saved, 'saved data is not overwritten');
          await page.locator('#reset').click();
          assert.equal(countItems(await docOf(page)), 15);
          assert.match(await page.locator('#save-status').textContent(), /Local saving/);
          await waitSaved(page, 'Rename this idea');
        }
      });

      await scenario(browser, `${name}: blocked storage stays editable and reports session-only mode`, async (page) => {
        await page.addInitScript(() => {
          Storage.prototype.getItem = () => { throw new DOMException('Blocked', 'SecurityError'); };
          Storage.prototype.setItem = () => { throw new DOMException('Blocked', 'SecurityError'); };
        });
        await page.goto(url);
        await ready(page);
        assert.match(await page.locator('#save-status').textContent(), /Session only/);
        await select(page, 'rename');
        await edit(page, 'Still editable');
        assert.equal((await docOf(page)).nodes.find((node) => node.id === 'rename').text, 'Still editable');
        await undo(page);
        assert.equal((await docOf(page)).nodes.find((node) => node.id === 'rename').text, 'Rename this idea');
        await page.reload();
        await ready(page);
        assert.equal(countItems(await docOf(page)), 15);
      });

      await scenario(browser, `${name}: two tabs show pending saved changes without replacing a draft`, async (page, context) => {
        await page.goto(url);
        await ready(page);
        const other = await context.newPage();
        await other.goto(url);
        await ready(other);
        await select(page, 'rename');
        await page.keyboard.press('Enter');
        await page.locator('textarea.ed').fill('Unfinished draft');
        await select(other, 'rename');
        await edit(other, 'Changed in another tab');
        await waitSaved(other, 'Changed in another tab');
        await page.locator('#tab-notice').waitFor({ state: 'visible' });
        assert.equal(await page.locator('textarea.ed').inputValue(), 'Unfinished draft');
        await page.keyboard.press('Enter');
        await page.locator('#load-saved').click();
        assert.equal((await docOf(page)).nodes.find((node) => node.id === 'rename').text, 'Changed in another tab');
        await undo(page);
        assert.equal((await docOf(page)).nodes.find((node) => node.id === 'rename').text, 'Unfinished draft');
      });

      await scenario(browser, `${name}: phone width and touch controls stay usable without keyboard hints`, async (page) => {
        await page.goto(url);
        await ready(page);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'no horizontal page overflow');
        await select(page, 'extra');
        await page.waitForTimeout(400);
        const selectedVisible = await page.locator('lode-flow').evaluate((flow) => {
          const node = flow.shadowRoot.querySelector('.node[data-id="extra"]').getBoundingClientRect();
          const frame = flow.getBoundingClientRect();
          return node.left >= frame.left && node.right <= frame.right && node.top >= frame.top && node.bottom <= frame.bottom;
        });
        assert.equal(selectedVisible, true, 'Show brings the selected node into the phone viewport');
        await page.locator('.node-magnet [data-act="link"]').tap();
        await page.locator('.lk-list li').filter({ hasText: 'A useful outcome' }).first().tap();
        assert.ok((await docOf(page)).edges.some((edge) => edge.from === 'extra' && edge.to === 'outcome'));
        await page.locator('[data-act="close-linker"]').tap();
        const keyHints = await page.locator('lode-flow').evaluate((flow) => [...flow.shadowRoot.querySelectorAll('kbd')].filter((hint) => hint.getClientRects().length && getComputedStyle(hint).display !== 'none').length);
        assert.equal(keyHints, 0, 'touch hides inline keyboard hints');
        await page.locator('#appearance').selectOption('blueprint');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      }, { viewport: { width: 390, height: 844 }, hasTouch: true });
    } finally { await browser.close(); }
  }
} finally { server.close(); }
if (failures) process.exitCode = 1;
