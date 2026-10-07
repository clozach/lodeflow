// Bare graphs and host actions, exercised in three browser engines.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { chromium, firefox, webkit } from 'playwright';

const bundle = await readFile(process.env.LF_BUNDLE || resolve('dist/lode-flow.iife.js'));
const server = createServer((req, res) => {
  res.writeHead(200, { 'content-type': req.url === '/bundle.js' ? 'text/javascript' : 'text/html' });
  res.end(req.url === '/bundle.js' ? bundle : '<script src="/bundle.js"></script>');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}`;
const doc = {
  nodes: [{ id: 'a', text: 'First measurement' }, { id: 'b', text: 'Fresh record reuse' }, { id: 'c', text: 'One authorized page' }],
  edges: [{ id: 'ab', from: 'a', to: 'b', label: 'Δ−917 ms' }, { id: 'bc', from: 'b', to: 'c', label: 'Fewer requests' }],
  groups: [], settings: { orientation: 'lr', compactness: 'compact' },
};
const results = [];
try {
  for (const [name, engine] of Object.entries({ chromium, firefox, webkit })) {
    if (process.env.BROWSERS && !process.env.BROWSERS.split(',').includes(name)) continue;
    const browser = await engine.launch();
    const page = await browser.newPage({ viewport: { width: 1100, height: 950 } });
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));
    try {
      await page.goto(url);
      await page.evaluate((doc) => {
        document.body.innerHTML = `<style>body{margin:25px;font-family:system-ui;background:#ecf1ed}lode-flow{height:250px;margin:20px 0}</style>
          <div id="host"><lode-flow id="graph" presentation="graph" node-activation="event" readonly storage-key="map"></lode-flow></div>
          <lode-flow id="passive" presentation="graph"></lode-flow><lode-flow id="editor"></lode-flow>`;
        for (const f of document.querySelectorAll('lode-flow')) f.doc = doc;
        window.events = [];
        document.getElementById('host').addEventListener('lode-activate', (e) => window.events.push({ ...e.detail, bubbles: e.bubbles, composed: e.composed }));
      }, doc);
      await page.waitForFunction(() => [...document.querySelectorAll('lode-flow')].every((f) => f.layoutInfo));
      await page.waitForTimeout(350);
      const graph = page.locator('#graph');
      const nodes = graph.locator('.node[data-id]');
      const style = await graph.evaluate((f) => {
        const v = f.shadowRoot.querySelector('.vp');
        return { bg: getComputedStyle(v).backgroundColor, image: getComputedStyle(v).backgroundImage, tab: v.tabIndex, role: v.getAttribute('role'), chrome: [...f.shadowRoot.querySelectorAll('.ui,.ring,.chev,.nudge,.marquee')].every((n) => getComputedStyle(n).display === 'none') };
      });
      assert.deepEqual(style, { bg: 'rgba(0, 0, 0, 0)', image: 'none', tab: -1, role: 'group', chrome: true });
      assert.equal(await graph.getByRole('button', { name: 'First measurement' }).count(), 1);
      await nodes.nth(0).click();
      await nodes.nth(0).focus();
      await page.keyboard.press('Enter');
      await page.keyboard.press('Space');
      const events = await page.evaluate(() => window.events);
      assert.deepEqual(events.map((e) => [e.id, e.trigger, e.bubbles, e.composed]), [['a', 'pointer', true, true], ['a', 'keyboard', true, true], ['a', 'keyboard', true, true]]);
      assert.equal(events[0].node.text, 'First measurement');
      await page.keyboard.press('ArrowRight');
      assert.equal(await graph.evaluate((f) => f.shadowRoot.activeElement.dataset.id), 'b');
      await page.keyboard.press('End');
      assert.equal(await graph.evaluate((f) => f.shadowRoot.activeElement.dataset.id), 'c');
      await page.keyboard.press('Home');
      assert.equal(await graph.evaluate((f) => f.shadowRoot.activeElement.dataset.id), 'a');
      assert.notEqual(await nodes.nth(0).evaluate((n) => getComputedStyle(n).outlineStyle), 'none');
      await graph.evaluate((f) => f.select(['b']));
      await page.waitForFunction(() => document.getElementById('graph').shadowRoot.querySelector('[data-id="b"]').getAttribute('aria-pressed') === 'true');
      assert.equal(await nodes.nth(1).getAttribute('aria-pressed'), 'true');
      const before = await graph.evaluate((f) => JSON.stringify(f.getState()));
      await graph.locator('.vp').focus();
      for (const key of ['n', 'Enter', 'Delete', 'g', 'c', 't', 'u', '=', '-', '?', 'Control+z', 'Control+Shift+z']) await page.keyboard.press(key);
      await graph.locator('.carrier').first().click();
      const box = await graph.boundingBox();
      await page.mouse.move(box.x + 20, box.y + 20);
      await page.mouse.down();
      await page.mouse.move(box.x + 90, box.y + 55);
      await page.mouse.up();
      await page.mouse.dblclick(box.x + 20, box.y + 20);
      await page.mouse.click(box.x + 20, box.y + 20, { button: 'right' });
      await graph.evaluate((f) => f.shadowRoot.querySelector('.vp').dispatchEvent(new WheelEvent('wheel', { deltaY: -300, ctrlKey: true, bubbles: true, cancelable: true })));
      await graph.evaluate((f) => { f.undo(); f.redo(); f.rewind(); f.fastForward(); f.showSelection(); });
      assert.equal(await graph.evaluate((f) => JSON.stringify(f.getState())), before, 'graph gestures and undo APIs leave content, view and history intact');
      assert.equal(await graph.locator('textarea').count(), 0);
      assert.equal(await page.evaluate(() => localStorage.getItem('lodeflow:map')), null, 'host highlights do not save editor state');
      assert.equal(await page.locator('#passive').getByRole('button').count(), 0);
      const passiveBefore = await page.locator('#passive').evaluate((f) => JSON.stringify(f.getState()));
      await page.locator('#passive .node').first().dblclick();
      assert.equal(await page.locator('#passive').evaluate((f) => JSON.stringify(f.getState())), passiveBefore);
      const editor = page.locator('#editor');
      await editor.locator('.node').first().click();
      await editor.locator('.node').first().click();
      assert.equal(await editor.locator('textarea').count(), 1, 'default editor still edits the selected node');
      await page.keyboard.press('Escape');
      await editor.evaluate((f) => { f.setAttribute('node-activation', 'event'); window.editorActions = []; f.addEventListener('lode-activate', (e) => window.editorActions.push(e.detail)); });
      await editor.locator('.node').nth(1).click();
      await editor.locator('.vp').focus();
      await page.keyboard.press('Enter');
      assert.deepEqual(await page.evaluate(() => window.editorActions.map((e) => [e.id, e.trigger])), [['b', 'pointer'], ['a', 'keyboard']]);
      assert.equal(await editor.locator('textarea').count(), 0);
      await editor.evaluate((f) => { f.setAttribute('presentation', 'graph'); f.removeAttribute('node-activation'); });
      await page.waitForTimeout(100);
      assert.equal(await editor.getByRole('button').count(), 0, 'changing modes removes action semantics and controls');
      await editor.evaluate((f) => f.removeAttribute('presentation'));
      await page.waitForTimeout(100);
      await editor.locator('.node').first().click();
      assert.equal(await editor.locator('textarea').count(), 1, 'returning to editor restores editing');
      assert.deepEqual(errors, []);
      results.push({ browser: name, ok: true });
      console.log(`✓ ${name}: bare graph, passive gestures, activation, keyboard focus, mode changes and editor preservation`);
    } finally {
      await browser.close();
    }
  }
  console.log(JSON.stringify(results));
} finally {
  server.close();
}
