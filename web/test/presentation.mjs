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
      const actionsRendered = (disabled) => page.waitForFunction((disabled) => {
        const nodes = [...document.getElementById('graph').shadowRoot.querySelectorAll('.node[data-id]')];
        return nodes.length === 3 && nodes.every((node) => node.disabled === disabled.includes(node.dataset.id));
      }, disabled, { timeout: 5000 });
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
      await graph.evaluate((f) => { f.undo(); f.redo(); f.rewind(); f.fastForward(); });
      assert.equal(await graph.evaluate((f) => JSON.stringify(f.getState())), before, 'graph gestures and undo APIs leave content, view and history intact');
      assert.equal(await graph.locator('textarea').count(), 0);
      assert.equal(await page.evaluate(() => localStorage.getItem('lodeflow:map')), null, 'host highlights do not save editor state');

      // Availability is host metadata, including IDs supplied before a node exists.
      const availabilityBefore = await graph.evaluate((f) => JSON.stringify(f.getState()));
      await graph.evaluate((f) => { window.actionLayouts = 0; f.addEventListener('lode-layout', () => window.actionLayouts++); const ids = ['a', 'c', 'future']; f.disabledNodeIds = ids; ids.push('b'); });
      await actionsRendered(['a', 'c']);
      assert.deepEqual(await graph.evaluate((f) => f.disabledNodeIds), ['a', 'c', 'future']);
      assert.deepEqual(await nodes.evaluateAll((ns) => ns.map((n) => [n.disabled, n.tabIndex])), [[true, -1], [false, 0], [true, -1]]);
      assert.equal(await graph.evaluate((f) => JSON.stringify(f.getState())), availabilityBefore, 'availability does not alter content, camera or history');
      assert.equal(await page.evaluate(() => window.actionLayouts), 0, 'availability does not request layout');
      await graph.evaluate((f) => { const copy = f.disabledNodeIds; copy.length = 0; f.disabledNodeIds = ['future', 'c', 'a']; }); await page.waitForTimeout(50);
      assert.equal(await page.evaluate(() => window.actionLayouts), 0, 'same membership is a no-op');
      const eventCount = await page.evaluate(() => window.events.length);
      await nodes.nth(0).evaluate((n) => { n.click(); n.dispatchEvent(new MouseEvent('click', { bubbles: true })); n.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
      assert.equal(await page.evaluate(() => window.events.length), eventCount, 'disabled pointer and keyboard activation cannot bypass the host gate');
      await nodes.nth(1).focus();
      for (const key of ['ArrowLeft', 'ArrowRight', 'Home', 'End']) { await page.keyboard.press(key); assert.equal(await graph.evaluate((f) => f.shadowRoot.activeElement.dataset.id), 'b'); }
      await graph.evaluate((f) => { const marker = document.createElement('button'); marker.id = 'before-graph'; marker.textContent = 'Before graph'; f.before(marker); marker.focus(); });
      await page.keyboard.press('Tab'); assert.equal(await graph.evaluate((f) => f.shadowRoot.activeElement.dataset.id), 'b', 'Tab skips disabled steps');
      await graph.evaluate((f) => { f.disabledNodeIds = []; document.getElementById('before-graph').remove(); });
      await actionsRendered([]);
      assert.equal(await nodes.nth(0).isEnabled(), true);

      // Already-visible selection requires neither camera movement nor page scrolling.
      await graph.evaluate((f) => { f.select(['b']); window.visibleState = JSON.stringify(f.getState()); window.visibleScroll = [scrollX, scrollY]; f.showSelection(); });
      await page.waitForTimeout(450);
      assert.equal(await graph.evaluate((f) => JSON.stringify(f.getState())), await page.evaluate(() => window.visibleState));
      assert.deepEqual(await page.evaluate(() => [scrollX, scrollY]), await page.evaluate(() => window.visibleScroll));
      await graph.evaluate((f) => { const state = f.getState(); f.setState({ ...state, view: { cam: { x: -1200, y: -900, z: 1, r: 0 }, follow: false, sel: ['c'] } }); window.revealBefore = f.getState(); f.showSelection(); });
      await page.waitForFunction(() => {
        const f = document.getElementById('graph'), frame = f.getBoundingClientRect(), node = f.shadowRoot.querySelector('[data-id="c"]').getBoundingClientRect();
        return node.left >= frame.left + 15 && node.right <= frame.right - 15 && node.top >= frame.top + 15 && node.bottom <= frame.bottom - 15;
      }, null, { timeout: 2000 });
      const revealed = await graph.evaluate((f) => {
        const frame = f.getBoundingClientRect(), node = f.shadowRoot.querySelector('[data-id="c"]').getBoundingClientRect();
        const vp = f.shadowRoot.querySelector('.vp');
        return { inside: node.left >= frame.left + 15 && node.right <= frame.right - 15 && node.top >= frame.top + 15 && node.bottom <= frame.bottom - 15, state: f.getState(), frame: frame.toJSON(), node: node.toJSON(), vpScroll: [vp.scrollLeft, vp.scrollTop] };
      });
      assert.equal(revealed.inside, true, `offscreen graph selection pans into view (${JSON.stringify(revealed)})`);
      const revealBefore = await page.evaluate(() => window.revealBefore);
      assert.deepEqual(revealed.state.doc, revealBefore.doc); assert.deepEqual(revealed.state.history, revealBefore.history);
      assert.equal(revealed.state.view.cam.z, revealBefore.view.cam.z);
      assert.equal(await page.evaluate(() => localStorage.getItem('lodeflow:map')), null);

      // Wide graph in a page scroller: a newly added instruction can fit the graph but be clipped by its parent.
      await graph.evaluate((f) => {
        const wrapper = document.createElement('div'); wrapper.id = 'guide-scroll'; wrapper.style.cssText = 'width:420px;overflow:auto';
        f.before(wrapper); wrapper.append(f); f.style.width = '2000px';
        const nodes = Array.from({ length: 10 }, (_, i) => ({ id: `step${i}`, text: `Instruction ${i}` }));
        f.setDoc({ nodes, edges: nodes.slice(1).map((n, i) => ({ id: `edge${i}`, from: nodes[i].id, to: n.id })), groups: [], settings: { orientation: 'lr' } });
        f.select(['step9']); window.nestedScrollBefore = scrollY; f.showSelection();
      });
      await page.waitForTimeout(550);
      const nestedReveal = await graph.evaluate((f) => { const wrapper = f.parentElement, frame = wrapper.getBoundingClientRect(), node = f.shadowRoot.querySelector('[data-id="step9"]').getBoundingClientRect(); return { scroll: wrapper.scrollLeft, inside: node.left >= frame.left && node.right <= frame.right, page: scrollY }; });
      assert.equal(nestedReveal.inside, true, `selected instruction is revealed in parent scroller (${JSON.stringify(nestedReveal)})`);
      assert.ok(nestedReveal.scroll > 0); assert.equal(nestedReveal.page, await page.evaluate(() => window.nestedScrollBefore), 'horizontal guide reveal leaves page scroll unchanged');
      await graph.evaluate((f) => {
        f.parentElement.scrollLeft = 0;
        const nodes = Array.from({ length: 10 }, (_, i) => ({ id: `edge-step${i}`, text: `Edge instruction ${i}` }));
        f.setDoc({ nodes, edges: nodes.slice(1).map((n, i) => ({ id: `new-edge${i}`, from: nodes[i].id, to: n.id })), groups: [], settings: { orientation: 'lr' } });
        f.select(['new-edge8']); f.showSelection();
      });
      await page.waitForTimeout(550);
      const newEdgeReveal = await graph.evaluate((f) => { const frame = f.parentElement.getBoundingClientRect(), path = f.shadowRoot.querySelectorAll('.edge')[8].getBoundingClientRect(); return { inside: path.left >= frame.left && path.right <= frame.right, scroll: f.parentElement.scrollLeft }; });
      assert.equal(newEdgeReveal.inside, true, `new selected edge also reveals after pending layout (${JSON.stringify(newEdgeReveal)})`);
      await graph.evaluate((f) => { const wrapper = f.parentElement; wrapper.before(f); wrapper.remove(); f.style.width = ''; });

      // New groups use the same fade and fold animation in a bare host graph.
      await graph.evaluate((f, doc) => { f.setDoc(doc); f.setAttribute('group-activation', 'event'); window.groupEvents = []; f.addEventListener('lode-group-activate', (e) => window.groupEvents.push(e.detail)); }, doc);
      await page.waitForTimeout(450);
      await graph.evaluate((f) => {
        window.groupOpacity = [];
        const sample = () => { const box = f.shadowRoot.querySelector('.gbox[data-gid="level"]'); if (box) window.groupOpacity.push(Number(box.style.opacity)); if (window.groupOpacity.length < 30) requestAnimationFrame(sample); };
        requestAnimationFrame(sample);
        f.setDoc({ ...f.doc, nodes: f.doc.nodes.map((n) => ['a', 'b'].includes(n.id) ? { ...n, group: 'level' } : n), groups: [{ id: 'level', text: 'Completed level' }] });
      });
      await page.waitForTimeout(550);
      const opacities = await page.evaluate(() => window.groupOpacity);
      assert.ok(opacities.some((o) => o > 0 && o < .95), `expanded group fades into existence (${opacities})`);
      assert.equal(opacities.at(-1), 1);
      await graph.evaluate((f) => f.setDoc({ ...f.doc, groups: f.doc.groups.map((g) => ({ ...g, collapsed: true })) }));
      await page.waitForTimeout(450);
      const level = graph.getByRole('button', { name: 'Completed level', exact: true });
      assert.equal(await level.count(), 1, 'only the visible group proxy is a native button');
      assert.equal(await graph.locator('button button').count(), 0, 'group actions never nest native buttons');
      const collapsedBefore = await graph.evaluate((f) => JSON.stringify(f.getState()));
      await level.click(); await level.focus(); await page.keyboard.press('Space');
      assert.deepEqual(await page.evaluate(() => window.groupEvents.map((e) => [e.id, e.group.collapsed, e.trigger])), [['level', true, 'pointer'], ['level', true, 'keyboard']]);
      assert.equal(await graph.evaluate((f) => JSON.stringify(f.getState())), collapsedBefore, 'group activation leaves folding to the host');
      await graph.locator('[data-id="c"]').focus(); await page.keyboard.press('ArrowRight');
      assert.equal(await graph.evaluate((f) => f.shadowRoot.activeElement.dataset.gid), 'level', 'arrow navigation includes the visible group and skips its hidden nodes');
      await graph.evaluate((f) => { f.addEventListener('lode-group-activate', () => f.setDoc({ ...f.doc, groups: f.doc.groups.map((g) => ({ ...g, collapsed: !g.collapsed })) }), { once: true }); });
      await page.keyboard.press('Enter'); await page.waitForTimeout(450);
      assert.equal(await graph.locator('[data-id="a"]').isVisible(), true, 'completed group reopens for replay');
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await graph.evaluate((f, doc) => f.setDoc(doc), doc); await page.waitForTimeout(50);
      await graph.evaluate((f) => f.setDoc({ ...f.doc, nodes: f.doc.nodes.map((n) => ({ ...n, group: 'snap' })), groups: [{ id: 'snap', text: 'Reduced motion' }] }));
      await page.waitForTimeout(50);
      assert.equal(await graph.locator('.gbox[data-gid="snap"]').evaluate((n) => Number(n.style.opacity)), 1, 'reduced motion snaps the new group');
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      assert.equal(await page.locator('#passive').getByRole('button').count(), 0);
      const passiveBefore = await page.locator('#passive').evaluate((f) => JSON.stringify(f.getState()));
      await page.locator('#passive .node').first().dblclick();
      assert.equal(await page.locator('#passive').evaluate((f) => JSON.stringify(f.getState())), passiveBefore);
      const editor = page.locator('#editor');
      await editor.evaluate((f) => { f.disabledNodeIds = ['a']; });
      await editor.locator('.node').first().click();
      await editor.locator('.node').first().click();
      assert.equal(await editor.locator('textarea').count(), 1, 'default editor still edits the selected node');
      await page.keyboard.press('Escape');
      await editor.evaluate((f) => { f.disabledNodeIds = []; });
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
