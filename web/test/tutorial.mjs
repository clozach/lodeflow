// Test the built Pages artifact under a repository prefix, without a separate server.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, firefox, webkit } from 'playwright';
import { appearanceKey, countItems, progressKey, seed, steps, storageKey } from '../../site/tutorial.mjs';
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
    res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream' }); res.end(bytes);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const url = `http://127.0.0.1:${server.address().port}/lodeflow/`;
const docOf = (page, id = 'flow') => page.locator(`#${id}`).evaluate((flow) => flow.doc);
const ready = async (page) => { await page.waitForFunction(() => document.body.dataset.ready === 'true'); await page.locator('#flow .puck button').first().waitFor({ state: 'visible' }); };
const current = (page, id) => page.waitForFunction((id) => document.body.dataset.step === id, id);
const select = (page, ids) => page.locator('#flow').evaluate((flow, ids) => { flow.select(Array.isArray(ids) ? ids : [ids]); flow.showSelection(); flow.focus(); }, ids);
const enterText = async (page, text) => { await page.locator('textarea.ed').fill(text); await page.keyboard.press('Enter'); };
const edit = async (page, text) => { await page.keyboard.press('Enter'); await enterText(page, text); };
const start = async (page) => { await page.locator('#flow').evaluate((flow) => flow.focus()); await page.keyboard.press('n'); await enterText(page, 'An idea'); await current(page, 'rename'); };
const help = async (page, touch = false) => { if (!await page.locator('#appearance').isVisible()) await page.locator('#flow [data-act="help"]')[touch ? 'tap' : 'click'](); await page.locator('#appearance').waitFor({ state: 'visible' }); };
const clickStep = async (page, index, touch = false) => { await current(page, steps[index].id); await page.locator(`#guide .node[data-id="${steps[index].id}"]`)[touch ? 'tap' : 'click'](); await current(page, steps[index + 1]?.id || 'complete'); };
const waitProgress = (page, reached) => page.waitForFunction(({ key, progressKey, reached }) => { const saved = JSON.parse(localStorage.getItem(key) || 'null'), progress = JSON.parse(localStorage.getItem(progressKey) || 'null'); return saved && progress?.rev === saved.rev && progress.reached === reached; }, { key, progressKey, reached });
let failures = 0;
async function scenario(browser, name, action, options = {}) {
  if (process.env.ONLY && !name.includes(process.env.ONLY)) return;
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: 'light', ...options });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try { await action(page, context); assert.deepEqual(errors, [], 'no uncaught browser errors'); console.log(`✓ ${name}`); }
  catch (error) { failures++; console.error(`✗ ${name}\n  ${error.stack}`); }
  finally { await context.close(); }
}
try {
  const selected = process.env.BROWSERS?.toLowerCase().split(',');
  for (const [name, engine] of Object.entries({ Chromium: chromium, Firefox: firefox, WebKit: webkit }).filter(([name]) => !selected || selected.includes(name.toLowerCase()))) {
    const browser = await engine.launch();
    try {
      await scenario(browser, `${name}: two blank charts, centered kickoff, Help-only host controls and version isolation`, async (page) => {
        await page.addInitScript(() => localStorage.setItem('lodeflow:public-tutorial-v1', 'Previous demo data'));
        await page.goto(url); await ready(page);
        assert.equal(countItems(await docOf(page)), 0); assert.equal(countItems(await docOf(page, 'guide')), 0);
        assert.equal(await page.locator('#flow').getAttribute('empty-hint'), '');
        assert.deepEqual(await page.locator('#flow .kickstarter').evaluate((hint) => [...hint.children].map((line) => line.textContent)), ['Double-click anywhere', 'to add the first node', 'or']);
        assert.equal(await page.locator('#appearance').isVisible(), false);
        assert.equal(await page.locator('#flow .puck button:visible').count(), 2, 'fresh canvas has only Add and Help');
        const blank = await page.locator('#flow .vp').boundingBox();
        const add = await page.locator('#flow [data-act="addnode"]').boundingBox();
        assert.ok(Math.abs(add.y + add.height / 2 - (blank.y + blank.height / 2)) < 50, 'kickoff controls sit in the middle');
        await page.waitForTimeout(200); await page.keyboard.press('n'); await enterText(page, 'An idea'); await current(page, 'rename');
        await help(page); assert.equal(await page.locator('#appearance').inputValue(), 'light');
        assert.match(await page.locator('#item-count').textContent(), /1 \/ 100/);
        assert.equal(await page.evaluate(() => localStorage.getItem('lodeflow:public-tutorial-v1')), 'Previous demo data');
        assert.equal(await page.locator('aside, footer, .toolbar, .intro').count(), 0);
      });

      await scenario(browser, `${name}: native first level observes edits, linked/free creation and real linking`, async (page) => {
        await page.goto(url); await ready(page); await start(page);
        await page.waitForFunction(() => {
          const frame = document.querySelector('.guide-frame').getBoundingClientRect();
          const nodes = [...document.querySelector('#guide').shadowRoot.querySelectorAll('.node[data-id]')];
          return nodes.length === 4 && nodes.every((node) => { const bounds = node.getBoundingClientRect(); return bounds.top >= frame.top && bounds.bottom <= frame.bottom; });
        });
        const future = page.locator('#guide .node[data-id="linked"]');
        assert.equal(await future.isDisabled(), true);
        assert.equal((await docOf(page, 'guide')).nodes.length, 4);
        const first = (await docOf(page)).nodes[0].id;
        await select(page, first); await edit(page, 'My first idea'); await current(page, 'linked');
        await select(page, first); await page.keyboard.press('n'); await enterText(page, 'A next step'); await current(page, 'free');
        await page.keyboard.press('Escape'); await page.keyboard.press('n'); await enterText(page, 'A different idea'); await current(page, 'link');
        const free = (await docOf(page)).nodes.find((node) => node.text === 'A different idea').id;
        await select(page, free); await page.keyboard.press('e'); await page.locator('#flow .lk-filter').fill('My first idea'); await page.keyboard.press('Enter'); await page.keyboard.press('Escape');
        await current(page, 'label');
        assert.equal((await docOf(page)).groups.length, 0, 'completed instruction level does not group practice work');
        await page.waitForFunction(() => document.querySelector('#guide').doc.groups.find((group) => group.id === 'level-0')?.collapsed === true);
        assert.equal((await docOf(page, 'guide')).nodes.length, 8);
        await waitProgress(page, 4); await page.reload(); await ready(page); await current(page, 'label');
        await select(page, (await docOf(page)).edges[0].id); await edit(page, 'leads to'); await current(page, 'insert');
        await page.keyboard.press('n'); await enterText(page, 'One smaller step'); await current(page, 'group');
        const pair = (await docOf(page)).nodes.slice(0, 2).map((node) => node.id);
        await select(page, pair); await page.keyboard.press('g'); await enterText(page, 'Ideas together'); await current(page, 'collapse');
        const group = (await docOf(page)).groups[0].id;
        await select(page, group); await page.keyboard.press('c'); await current(page, 'expand');
        await page.keyboard.press('c'); await current(page, 'dive');
        await page.keyboard.press('j'); await current(page, 'undo');
        const modifier = await page.evaluate(() => /Mac/.test(navigator.platform) ? 'Meta' : 'Control');
        await page.keyboard.press(`${modifier}+z`); await current(page, 'redo');
        await page.keyboard.press(`${modifier}+Shift+z`); await current(page, 'complete');
      });

      await scenario(browser, `${name}: gated examples, level fade/fold, completed replay and saved final accomplishments`, async (page) => {
        await page.goto(url); await ready(page); await start(page);
        const requests = []; page.on('request', (request) => requests.push(request.url()));
        for (let index = 0; index < steps.length; index++) {
          await clickStep(page, index);
          if (index === 3 || index === 7 || index === 11) {
            const level = Math.floor(index / 4);
            assert.equal((await docOf(page, 'guide')).groups.find((group) => group.id === `level-${level}`).collapsed, false, 'completed group is shown before folding');
            await page.waitForFunction((id) => document.querySelector('#guide').doc.groups.find((group) => group.id === id)?.collapsed === true, `level-${level}`);
          }
        }
        assert.deepEqual(requests, [], 'practice and tutorial actions make no network requests');
        assert.equal(countItems(await docOf(page)), 8, 'examples create only their intended items');
        await waitProgress(page, 12); await page.reload(); await ready(page); await current(page, 'complete');
        await help(page); await page.locator('#hard-reset').click();
        await page.emulateMedia({ reducedMotion: 'reduce' }); await start(page);
        for (let index = 0; index < steps.length; index++) await clickStep(page, index);
        await page.waitForFunction(() => document.querySelector('#guide').doc.groups.length === 3 && document.querySelector('#guide').doc.groups.every((group) => group.collapsed));
        await waitProgress(page, 12);
        await page.locator('#guide .proxy[data-gid="level-2"]').click();
        await page.locator('#guide .node[data-id="expand"]').click();
        await page.waitForTimeout(750);
        assert.equal((await docOf(page, 'guide')).groups.find((group) => group.id === 'level-2').collapsed, false, 'replay does not refold a finished level');
        await waitProgress(page, 12); await page.reload(); await ready(page); await current(page, 'complete');
      });

      await scenario(browser, `${name}: Restore undo/redo recovers progress after reload; Hard Reset erases only this version`, async (page) => {
        await page.goto(url); await ready(page); await start(page);
        for (let index = 0; index < 4; index++) await clickStep(page, index);
        await page.waitForFunction(() => document.querySelector('#guide').doc.groups[0]?.collapsed === true);
        await waitProgress(page, 4);
        const before = await docOf(page);
        await help(page); await page.locator('#appearance').selectOption('blueprint'); await page.locator('#reset').click(); await current(page, 'blank');
        await waitProgress(page, -1); await page.reload(); await ready(page);
        await page.locator('#flow').evaluate((flow) => flow.undo()); await current(page, 'label'); assert.deepEqual(await docOf(page), before);
        await page.locator('#flow').evaluate((flow) => flow.redo()); await current(page, 'blank');
        await page.locator('#flow').evaluate((flow) => flow.undo()); await current(page, 'label');
        const unrelated = { 'another-app:notes': 'Private notes', 'lodeflow:another-diagram:history': 'Other history', 'lodeflow:public-tutorial-v1': 'Old version data' };
        await page.evaluate((unrelated) => { for (const [key, value] of Object.entries(unrelated)) localStorage.setItem(key, value); }, unrelated);
        await select(page, before.nodes[0].id); await page.keyboard.press('Enter'); await page.locator('textarea.ed').fill('A draft to discard');
        await help(page);
        assert.equal(await page.locator('#hard-reset').getAttribute('title'), 'All data storage is local-only. Clicking this button resets the tutorial and deletes all your edits. ⚠️ Cannot be undone.');
        await page.evaluate(() => { window.removedKeys = []; const remove = Storage.prototype.removeItem; Storage.prototype.removeItem = function(key) { window.removedKeys.push(key); return remove.call(this, key); }; });
        await page.locator('#hard-reset').click(); await current(page, 'blank');
        assert.equal(countItems(await docOf(page)), 0); assert.equal(countItems(await docOf(page, 'guide')), 0);
        assert.equal(await page.locator('textarea.ed').count(), 0);
        assert.equal(await page.locator('#flow').evaluate((flow) => flow.canUndo || flow.canRedo), false);
        const saved = await page.evaluate(({ key, progressKey, appearanceKey, unrelated }) => ({ removed: window.removedKeys, state: JSON.parse(localStorage.getItem(key)), appearance: localStorage.getItem(appearanceKey), history: localStorage.getItem(`${key}:history`), progress: JSON.parse(localStorage.getItem(progressKey)), unrelated: Object.fromEntries(Object.keys(unrelated).map((key) => [key, localStorage.getItem(key)])) }), { key, progressKey, appearanceKey, unrelated });
        assert.deepEqual(saved.removed, [key, `${key}:history`, progressKey, appearanceKey]);
        assert.equal(saved.appearance, null); assert.equal(saved.history, null); assert.equal(saved.progress.reached, -1); assert.equal(saved.state.history.entries.length, 0); assert.deepEqual(saved.unrelated, unrelated);
        await page.reload(); await ready(page); await current(page, 'blank');
        await page.locator('#flow').evaluate((flow) => flow.undo()); assert.equal(countItems(await docOf(page)), 0);
        await start(page); await select(page, (await docOf(page)).nodes[0].id); await edit(page, 'Retained saved edit');
        await page.waitForFunction((key) => localStorage.getItem(key)?.includes('Retained saved edit'), key);
        await page.evaluate(() => { Storage.prototype.removeItem = () => { throw new DOMException('Blocked', 'SecurityError'); }; });
        await help(page); await page.locator('#hard-reset').click(); assert.equal(countItems(await docOf(page)), 0); assert.match(await page.locator('#save-status').textContent(), /Session only/);
      });

      await scenario(browser, `${name}: capacity rejects atomically; oversized saved history stays protected`, async (page) => {
        await page.goto(url); await ready(page);
        await page.locator('#flow').evaluate((flow) => { flow.setDoc({ nodes: Array.from({ length: 98 }, (_, i) => ({ id: `n${i}`, text: `Idea ${i}` })), edges: [{ id: 'e', from: 'n0', to: 'n1' }], groups: [{ id: 'g', text: 'Group' }] }); flow.focus(); });
        await page.keyboard.press('n'); assert.equal(await page.locator('textarea.ed').count(), 0); assert.equal(countItems(await docOf(page)), 100);
        await select(page, 'n0'); await edit(page, 'Editable at capacity'); assert.equal((await docOf(page)).nodes[0].text, 'Editable at capacity');
        const rejected = await page.locator('#flow').evaluate((flow) => { try { flow.setDoc({ ...flow.doc, nodes: [...flow.doc.nodes, { id: 'overflow', text: 'Overflow' }] }); return false; } catch (error) { return error instanceof RangeError; } }); assert.equal(rejected, true);
        const oversized = { nodes: Array.from({ length: 101 }, (_, i) => ({ id: `n${i}`, text: `Idea ${i}` })), edges: [], groups: [], junctions: [] };
        await page.waitForFunction((key) => localStorage.getItem(key)?.includes('Editable at capacity'), key);
        for (const historyOnly of [false, true]) {
          const saved = { rev: 1, doc: historyOnly ? seed : oversized };
          const history = { rev: 1, history: { v: 2, index: 0, docs: [seed, oversized], entries: [{ kind: 'load', label: 'Load', before: { doc: 0, view: {} }, after: { doc: 1, view: {} } }] } };
          await page.evaluate(({ key, saved, history, historyOnly }) => { localStorage.setItem(key, JSON.stringify(saved)); if (historyOnly) localStorage.setItem(`${key}:history`, JSON.stringify(history)); else localStorage.removeItem(`${key}:history`); }, { key, saved, history, historyOnly });
          await page.reload(); await ready(page); assert.match(await page.locator('#save-status').textContent(), /protected/); assert.deepEqual(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), key), saved);
          await help(page); await page.locator('#reset').click(); assert.equal(countItems(await docOf(page)), 0); await waitProgress(page, -1);
        }
      });

      await scenario(browser, `${name}: corrupt, blocked and full storage remain usable`, async (page) => {
        await page.addInitScript(({ key }) => localStorage.setItem(key, '{ broken json'), { key });
        await page.goto(url); await ready(page); assert.equal(countItems(await docOf(page)), 0); assert.match(await page.locator('#notice').textContent(), /could not be read/); await start(page);
        await select(page, (await docOf(page)).nodes[0].id); await page.keyboard.press('Enter'); await page.locator('textarea.ed').fill('Pending draft');
        await help(page); await page.locator('#hard-reset').scrollIntoViewIfNeeded();
        await page.evaluate(() => { localStorage.setItem('lodeflow:another-diagram:history', 'Untouched history'); Storage.prototype.setItem = () => { throw new DOMException('Full', 'QuotaExceededError'); }; });
        await page.locator('#hard-reset').click(); assert.equal(countItems(await docOf(page)), 0); assert.match(await page.locator('#save-status').textContent(), /Session only/);
        assert.equal(await page.evaluate(() => localStorage.getItem('lodeflow:another-diagram:history')), 'Untouched history');
        await page.evaluate(() => { Storage.prototype.getItem = () => { throw new DOMException('Blocked', 'SecurityError'); }; });
        await start(page); await select(page, (await docOf(page)).nodes[0].id); await edit(page, 'Still editable'); assert.equal((await docOf(page)).nodes[0].text, 'Still editable');
        await page.addInitScript(() => Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Blocked getter', 'SecurityError'); } }));
        await page.reload(); await ready(page); await start(page);
        assert.match(await page.locator('#save-status').textContent(), /Session only/);
      });

      await scenario(browser, `${name}: cross-tab import preserves an active draft and imports bound accomplishments`, async (page, context) => {
        await page.goto(url); await ready(page); await start(page); await waitProgress(page, 0);
        const other = await context.newPage(); await other.goto(url); await ready(other);
        await select(page, (await docOf(page)).nodes[0].id); await page.keyboard.press('Enter'); await page.locator('textarea.ed').fill('Unfinished draft');
        for (let index = 0; index < 4; index++) await clickStep(other, index);
        await waitProgress(other, 4); await page.locator('#tab-notice').waitFor({ state: 'visible' });
        assert.equal(await page.locator('textarea.ed').inputValue(), 'Unfinished draft');
        await page.locator('#load-saved').click(); await current(page, 'label');
        assert.equal(countItems(await docOf(page)), 5);
        assert.equal((await docOf(page)).nodes[0].text, 'My first idea', 'explicit loading displays the chosen saved words');
        assert.equal(await page.locator('textarea.ed').count(), 0, 'explicit loading ends the old draft');
        await page.locator('#flow').evaluate((flow) => flow.undo()); await current(page, 'linked');
        assert.equal((await docOf(page)).nodes[0].text, 'Unfinished draft');
      });

      await scenario(browser, `${name}: phone instructions, native touch linking, menus and Blueprint`, async (page) => {
        await page.goto(url); await ready(page);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        await page.locator('#flow [data-act="addnode"]').tap(); await page.locator('textarea.ed').fill('An idea');
        await page.locator('#flow .vp').tap({ position: { x: 15, y: 15 } }); await current(page, 'rename');
        for (let index = 0; index < 3; index++) await clickStep(page, index, true);
        const doc = await docOf(page), free = doc.nodes.find((node) => node.text === 'A different idea').id;
        await select(page, free); await page.waitForTimeout(420); await page.locator('#flow .node-magnet [data-act="link"]').tap();
        await page.locator('#flow .lk-list li').filter({ hasText: 'My first idea' }).first().tap(); await page.locator('#flow [data-act="close-linker"]').tap(); await current(page, 'label');
        const instructions = (await docOf(page, 'guide')).nodes.map((node) => node.text).join('\n'); assert.doesNotMatch(instructions, /press |Shift|Ctrl|⌘|Enter/);
        await help(page, true); await page.locator('#appearance').selectOption('blueprint');
        const contrast = await page.locator('#reset').evaluate((button) => {
          const style = getComputedStyle(button);
          const light = (value) => { const rgb = value.match(/[\d.]+/g).slice(0, 3).map((part) => { const n = Number(part) / 255; return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4; }); return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722; };
          const values = [light(style.color), light(style.backgroundColor)].sort((a, b) => a - b); return (values[1] + 0.05) / (values[0] + 0.05);
        });
        assert.ok(contrast >= 4.5, 'Blueprint Help controls have readable contrast');
        assert.match(await page.locator('#flow').evaluate((flow) => getComputedStyle(flow.shadowRoot.querySelector('.vp')).backgroundImage), /gradient/);
        const hints = await page.locator('#flow').evaluate((flow) => [...flow.shadowRoot.querySelectorAll('kbd')].filter((node) => node.getClientRects().length && getComputedStyle(node).display !== 'none').length); assert.equal(hints, 0);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      }, { viewport: { width: 390, height: 844 }, hasTouch: true });
    } finally { await browser.close(); }
  }
} finally { server.close(); }
if (failures) process.exitCode = 1;
