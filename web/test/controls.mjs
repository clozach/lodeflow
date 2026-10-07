// Diagram toolbar, loaded Undo baseline, touch hints and destructive reset: browser regressions.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { chromium, firefox, webkit } from 'playwright';

const bundle = await readFile(process.env.LF_BUNDLE || resolve('dist/lode-flow.iife.js'));
const server = createServer((req, res) => {
  res.writeHead(200, { 'content-type': req.url === '/bundle.js' ? 'text/javascript' : 'text/html' });
  res.end(req.url === '/bundle.js' ? bundle : '<style>body{margin:0}lode-flow{height:100vh}</style><script src="/bundle.js"></script>');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}`;
const seed = { nodes: [{ id: 'a', text: 'First', group: 'g' }, { id: 'b', text: 'Next' }], groups: [{ id: 'g', text: 'Group' }], edges: [{ id: 'ab', from: 'a', to: 'b', label: 'leads to' }], settings: { orientation: 'lr' } };
const groupSeed = { ...seed, nodes: [seed.nodes[0], { ...seed.nodes[1], group: 'g2' }], groups: [...seed.groups, { id: 'g2', text: 'Closed group', collapsed: true }] };
const empty = { nodes: [], edges: [], groups: [] };
const results = [];
const settled = (page) => page.waitForTimeout(160);
const flow = (page, fn, arg) => page.locator('lode-flow').evaluate(fn, arg);
const waitUndo = (page, visible) => page.waitForFunction((visible) => !!document.querySelector('lode-flow').shadowRoot.querySelector('.puck [data-act="undo"]') === visible, visible);
async function historyFixture(page) {
  await reset(page);
  return flow(page, (f) => { f.select(['a']); f.select(['b']); return f.getState(); });
}
async function reset(page, doc = seed, sel = []) {
  await flow(page, (f, { doc, sel }) => { f.closeHelp(); f.closePanel(); f.closeLinker(); f.setDoc(doc, { discardPendingSave: true }); f.select(sel); f.focus(); }, { doc, sel });
  await settled(page);
}
const toolbar = (page) => flow(page, (f) => {
  const box = (n) => { const r = n.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; };
  const p = f.shadowRoot.querySelector('.puck');
  const buttons = [...p.querySelectorAll('button')];
  return { frame: box(f), puck: box(p), buttons: buttons.map((b) => ({ act: b.dataset.act, text: b.textContent, disabled: b.disabled, ...box(b) })), emptyHidden: f.shadowRoot.querySelector('.empty').hidden, emptyText: f.shadowRoot.querySelector('.empty').textContent, wayback: !!f.shadowRoot.querySelector('.wayback') };
});
function assertBookends(t) {
  assert.equal(t.buttons[0].act, 'addnode');
  assert.equal(t.buttons.at(-1).act, 'help');
  assert.equal(t.buttons.at(-1).text, '?');
  assert.ok(t.buttons.slice(0, -1).every((b) => b.x + b.w <= t.buttons.at(-1).x + 1), 'Help is the right bookend, including wrapped controls');
}
function assertCentered(t) {
  assert.ok(Math.abs(t.puck.x + t.puck.w / 2 - (t.frame.x + t.frame.w / 2)) < 2, 'empty toolbar horizontally centered');
  assert.ok(Math.abs(t.puck.y + t.puck.h / 2 - (t.frame.y + t.frame.h / 2)) < 2, 'empty toolbar vertically centered');
}
const visibleHints = (page) => flow(page, (f) => [...f.shadowRoot.querySelectorAll('kbd,.keys,.key-hint')].filter((n) => n.getBoundingClientRect().width && n.getBoundingClientRect().height && getComputedStyle(n).display !== 'none' && !n.closest('[hidden]')).map((n) => n.textContent));
async function assertGroupCaptions(page, touch) {
  const captions = await flow(page, (f) => f.doc.groups.flatMap((g) => [...f.shadowRoot.querySelectorAll(`[data-chev="${g.id}"]`)].map((b) => ({ collapsed: !!g.collapsed, title: b.title, aria: b.getAttribute('aria-label') }))));
  assert.equal(captions.length, 4, 'both chevrons of expanded and collapsed groups are covered');
  for (const c of captions) {
    const expected = `${c.collapsed ? 'Expand' : 'Collapse'} group${touch ? '' : ' (C)'}`;
    assert.equal(c.title, expected); assert.equal(c.aria, expected);
  }
}
async function scrollNudge(page) {
  await page.evaluate(() => { const input = document.createElement('input'); input.id = 'outside'; document.body.append(input); input.focus(); });
  const r = await page.locator('lode-flow').boundingBox();
  await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2);
  await page.mouse.wheel(0, 100); await settled(page);
  const text = await page.locator('.nudge:visible').textContent();
  await page.locator('#outside').evaluate((n) => n.remove());
  return text;
}

async function check(name, fn) {
  try { await fn(); results.push({ name, ok: true }); console.log(`✓ ${name}`); }
  catch (error) { results.push({ name, ok: false }); console.error(`✗ ${name}\n${error.stack}`); }
}
try {
  for (const [name, engine] of Object.entries({ chromium, firefox, webkit })) {
    if (process.env.BROWSERS && !process.env.BROWSERS.split(',').includes(name)) continue;
    const browser = await engine.launch();
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));
    try {
      await page.goto(url);
      await page.evaluate(() => { const f = document.createElement('lode-flow'); document.body.append(f); f.tun.animation = 0; });
      await page.waitForFunction(() => document.querySelector('lode-flow')?.layoutInfo);
      await check(`${name}: fresh empty, groups-only and seeded toolbar`, async () => {
        for (const doc of [empty, { ...empty, groups: [{ id: 'empty-group', text: 'Empty group' }] }]) {
          await reset(page, doc);
          const t = await toolbar(page); assertBookends(t); assertCentered(t);
          assert.equal(t.emptyHidden, true); assert.equal(t.emptyText, ''); assert.equal(t.wayback, false);
          assert.deepEqual(t.buttons.map((b) => b.act), ['addnode', 'help']);
          assert.equal(t.buttons[0].text.includes('⇧'), false, 'Shift+N is omitted until nodes exist');
        }
        await reset(page);
        const t = await toolbar(page); assertBookends(t);
        assert.deepEqual(t.buttons.map((b) => b.act), ['addnode', 'panel', 'help']);
        const icon = await flow(page, (f) => { const r = f.shadowRoot.querySelector('.puck [data-act="addnode"] rect'); return ['x', 'y', 'width', 'height'].map((k) => Number(r.getAttribute(k))); });
        assert.deepEqual(icon, [1, 4.5, 14, 7]);
        await page.locator('.puck [data-act="help"]').click(); await settled(page);
        assert.ok(await page.locator('.help tr').count() >= 30, 'full desktop legend');
        assert.match(await page.locator('.help').textContent(), /N \/ ⇧N/);
      });

      await check(`${name}: edge-positioned drafts remain reachable without panning`, async () => {
        for (const at of [{x: 640, y: 10}, {x: 10, y: 400}, {x: 1270, y: 790}]) {
          await reset(page, empty);
          await page.mouse.dblclick(at.x, at.y);
          await settled(page);
          const geometry = await flow(page, (f) => {
            const ta = f.shadowRoot.querySelector('textarea'), r = ta.getBoundingClientRect(), vp = f.shadowRoot.querySelector('.vp').getBoundingClientRect(), p = f.shadowRoot.querySelector('.puck').getBoundingClientRect();
            return {top: r.top, left: r.left, right: r.right, bottom: r.bottom, vp: vp.toJSON(), overlap: r.left < p.right && r.right > p.left && r.top < p.bottom && r.bottom > p.top, focused: f.shadowRoot.activeElement === ta};
          });
          assert.ok(geometry.top >= geometry.vp.top + 7 && geometry.left >= geometry.vp.left + 7 && geometry.right <= geometry.vp.right - 7 && geometry.bottom <= geometry.vp.bottom - 7, 'draft fits inside canvas');
          assert.equal(geometry.overlap, false, 'toolbar does not cover active draft');
          assert.equal(geometry.focused, true, 'draft retains typing focus');
          await page.keyboard.type('Reachable idea'); await page.keyboard.press('Enter');
          assert.equal((await flow(page, f => f.doc.nodes))[0].text, 'Reachable idea');
          const saved = await flow(page, f => f.getState());
          assert.equal(saved.history.entries.length, 1, 'automatic reveal adds no Pan steps');
          assert.deepEqual(saved.history.entries[0].after.view.cam, saved.view.cam, 'creation owns its revealed camera');
          await flow(page, f => f.undo()); assert.equal(await flow(page, f => f.doc.nodes.length), 0);
          await flow(page, f => f.redo()); assert.equal(await flow(page, f => f.doc.nodes.length), 1);
        }
      });

      await check(`${name}: host resize keeps the focused draft clear of the toolbar`, async () => {
        await page.emulateMedia({reducedMotion: 'reduce'});
        await reset(page, empty);
        await flow(page, f => { f.style.height = '600px'; f.style.marginTop = '180px'; });
        await settled(page);
        await page.mouse.dblclick(640, 192);
        await page.locator('textarea').waitFor({state: 'visible'});
        await flow(page, f => { f.style.height = '400px'; f.style.marginTop = '380px'; });
        await settled(page);
        const geometry = await flow(page, f => {
          const ta = f.shadowRoot.querySelector('textarea'), r = ta.closest('.node').getBoundingClientRect(), vp = f.shadowRoot.querySelector('.vp').getBoundingClientRect(), p = f.shadowRoot.querySelector('.puck').getBoundingClientRect();
          return {r: r.toJSON(), vp: vp.toJSON(), overlap: r.left < p.right && r.right > p.left && r.top < p.bottom && r.bottom > p.top, focused: f.shadowRoot.activeElement === ta, hit: ta.closest('.node').contains(f.shadowRoot.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2))};
        });
        assert.ok(geometry.r.top >= geometry.vp.top + 7 && geometry.r.bottom <= geometry.vp.bottom - 7, 'resized canvas contains the whole draft');
        assert.equal(geometry.overlap, false); assert.equal(geometry.focused, true); assert.equal(geometry.hit, true);
        await page.keyboard.type('Visible after resizing'); await page.keyboard.press('Enter');
        assert.equal((await flow(page, f => f.doc.nodes))[0].text, 'Visible after resizing');
        await flow(page, f => { f.style.height = '100vh'; f.style.marginTop = '0'; });
        await page.emulateMedia({reducedMotion: 'no-preference'});
      });

      await check(`${name}: creation and editing entry paths reveal offscreen text`, async () => {
        await page.emulateMedia({reducedMotion: 'reduce'});
        const cases = [
          {sel: ['a'], key: 'n'}, {sel: ['a'], key: 'Shift+n'},
          {sel: ['g'], key: 'n'}, {sel: ['ab'], key: 'n'}, {sel: ['ab'], key: 'Shift+n'},
          {sel: ['a', 'b'], key: 'g'},
          {sel: ['a'], key: 'Enter'}, {sel: ['g'], key: 'Enter'}, {sel: ['ab'], key: 'Enter'},
          {sel: ['a', 'b'], linked: true},
        ];
        const failures = [];
        for (const c of cases) {
          await reset(page, seed, c.sel);
          await flow(page, f => f.panScreen(0, -900));
          await settled(page);
          if (c.linked) await flow(page, f => f.addLinkedTo(['a', 'b'], 'after'));
          else await page.keyboard.press(c.key);
          try { await page.waitForFunction(() => {
            const f = document.querySelector('lode-flow'), ta = f.shadowRoot.querySelector('textarea');
            if (!ta) return false;
            const r = ta.getBoundingClientRect(), vp = f.shadowRoot.querySelector('.vp').getBoundingClientRect(), p = f.shadowRoot.querySelector('.puck').getBoundingClientRect();
            return r.top >= vp.top + 7 && r.bottom <= vp.bottom - 7 && r.left >= vp.left + 7 && r.right <= vp.right - 7 && !(r.left < p.right && r.right > p.left && r.top < p.bottom && r.bottom > p.top) && f.shadowRoot.activeElement === ta;
          }, null, {timeout: 3000});
            await page.keyboard.type(' Reachable'); await page.keyboard.press('Enter');
            assert.equal(await page.locator('textarea').count(), 0);
          } catch { failures.push(`${c.sel.join(',')}:${c.key || 'addLinkedTo'}`); }
        }
        await page.emulateMedia({reducedMotion: 'no-preference'});
        assert.deepEqual(failures, [], 'each creation/editing path reveals its active text');
      });

      await check(`${name}: editor respects clipping by a parent scroller`, async () => {
        await page.emulateMedia({reducedMotion: 'reduce'});
        await reset(page, seed, ['a']);
        await flow(page, f => {
          const parent = document.createElement('div'); parent.id = 'editor-scroller'; parent.style.cssText = 'height:220px;overflow:auto;margin-top:80px';
          f.before(parent); parent.append(f); f.style.height = '700px'; parent.scrollTop = 160;
          f.panScreen(0, -900); f.focus({preventScroll: true});
        });
        await page.keyboard.press('Enter'); await settled(page);
        const geometry = await flow(page, f => {
          const ta = f.shadowRoot.querySelector('textarea'), r = ta.closest('.node').getBoundingClientRect(), parent = f.parentElement.getBoundingClientRect();
          return {r: r.toJSON(), parent: parent.toJSON(), focused: f.shadowRoot.activeElement === ta};
        });
        assert.ok(geometry.r.top >= geometry.parent.top + 7 && geometry.r.bottom <= geometry.parent.bottom - 7, 'editor lies within parent visible region');
        assert.equal(geometry.focused, true);
        await page.keyboard.type(' in view'); await page.keyboard.press('Enter');
        await flow(page, f => { const parent = f.parentElement; parent.before(f); parent.remove(); f.style.height = '100vh'; });
        await page.emulateMedia({reducedMotion: 'no-preference'});
      });

      await check(`${name}: Layout Help and lists fit the visible window and parent clip`, async () => {
        await page.emulateMedia({reducedMotion: 'reduce'});
        try {
        for (const parentClip of [false, true]) {
          await page.setViewportSize({width: 393, height: 560});
          await reset(page);
          await flow(page, (f, parentClip) => {
            f.style.height = '700px'; f.style.marginTop = '240px';
            if (parentClip) {
              const p = document.createElement('div'); p.id = 'popup-scroller'; p.style.cssText = 'height:220px;overflow:auto;margin-top:120px';
              f.style.marginTop = '0'; f.before(p); p.append(f); p.scrollTop = 180;
            }
          }, parentClip);
          for (const kind of ['panel', 'help', 'linker', 'adder']) {
            await page.mouse.move(1, 1); // Leave the previous pane before its API-driven replacement.
            await flow(page, (f, kind) => {
              f.closePanel(); f.closeHelp(); f.closeLinker();
              if (kind === 'panel') f.openPanel('puck');
              else if (kind === 'help') f.openHelp();
              else if (kind === 'adder') f.openAdder(true);
              else f.openLinker('a', true, 'out');
            }, kind);
            const selector = kind === 'adder' ? '.linker' : `.${kind}`;
            const pane = page.locator(selector);
            const fits = async () => page.waitForFunction((selector) => {
              const f = document.querySelector('lode-flow'), el = f.shadowRoot.querySelector(selector), r = el.getBoundingClientRect(), p = document.querySelector('#popup-scroller')?.getBoundingClientRect();
              const vp = f.shadowRoot.querySelector('.vp').getBoundingClientRect();
              const availableHeight = Math.min(vp.bottom, innerHeight, p?.bottom ?? innerHeight) - Math.max(vp.top, 0, p?.top ?? 0) - 16;
              return Math.abs(parseFloat(el.style.maxHeight) - Math.max(0, availableHeight)) < 0.5 && r.top >= Math.max(0, p?.top ?? 0) + 7 && r.bottom <= Math.min(innerHeight, p?.bottom ?? innerHeight) - 7 && r.left >= 7 && r.right <= innerWidth - 7;
            }, selector, {timeout: 3000});
            await fits();
            if (kind === 'panel') { await pane.locator('[data-act="exhaustive"]').click(); await fits(); }
            await page.setViewportSize({width: 360, height: 430}); await fits();
            if (parentClip) {
              await page.locator('#popup-scroller').evaluate(p => p.style.height = '180px'); await fits();
              await page.locator('#popup-scroller').evaluate(p => p.style.height = '220px'); await fits();
            }
            const r = await pane.boundingBox(), point = {x: r.x + r.width / 2, y: r.y + r.height / 2};
            await page.mouse.move(point.x, point.y);
            assert.equal(await pane.evaluate((el, point) => el.contains(el.getRootNode().elementFromPoint(point.x, point.y)), point), true, `${kind} receives the wheel at its visible center`);
            if (kind === 'help') assert.ok(await pane.evaluate(el => el.scrollHeight > el.clientHeight), 'bounded Help has content to scroll');
            await page.mouse.wheel(0, 5000);
            if (kind === 'help') {
              await page.waitForFunction(() => document.querySelector('lode-flow').shadowRoot.querySelector('.help').scrollTop > 0, null, {timeout: 5000});
            } else await settled(page);
            for (const control of await pane.locator('button:visible,input:visible').all()) {
              if (await control.isDisabled()) continue;
              await control.scrollIntoViewIfNeeded(); await fits();
              assert.equal(await control.evaluate(b => {const r = b.getBoundingClientRect(); return b.contains(b.getRootNode().elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));}), true, `${kind} control reachable after resizing and scrolling`);
            }
          }
          await flow(page, f => { f.closePanel(); f.closeHelp(); f.closeLinker(); const p = f.parentElement; if (p.id === 'popup-scroller') {p.before(f);p.remove();} f.style.height = '100vh'; f.style.marginTop = '0'; });
        }
        } finally {
          await flow(page, f => { f.closePanel(); f.closeHelp(); f.closeLinker(); const p = f.parentElement; if (p.id === 'popup-scroller') {p.before(f);p.remove();} f.style.height = '100vh'; f.style.marginTop = '0'; });
        await page.setViewportSize({width: 1280, height: 800});
        await page.emulateMedia({reducedMotion: 'no-preference'});
        }
      });

      await check(`${name}: opt-in first-node hint fades and returns on empty`, async () => {
        await reset(page, empty);
        assert.equal(await page.locator('.kickstarter').isVisible(), false, 'default empty canvas has no prompt');
        await flow(page, (f) => f.setAttribute('empty-hint', ''));
        await page.waitForFunction(() => {
          const f = document.querySelector('lode-flow'), root = f.shadowRoot, hint = root.querySelector('.kickstarter'), puck = root.querySelector('.puck');
          const frame = f.getBoundingClientRect(), p = puck.getBoundingClientRect(), h = hint.getBoundingClientRect();
          return !hint.hidden && getComputedStyle(hint).visibility !== 'hidden' && Math.abs(p.x + p.width / 2 - (frame.x + frame.width / 2)) < 2 && Math.abs(p.y + p.height / 2 - (frame.y + frame.height / 2)) < 2 && h.bottom < p.y;
        }, null, { timeout: 5000 });
        const hint = await page.locator('.kickstarter').evaluate((n) => ({ lines: [...n.children].map((c) => c.textContent), rect: n.getBoundingClientRect().toJSON(), opacity: getComputedStyle(n).opacity }));
        assert.deepEqual(hint.lines, ['Double-click anywhere', 'to add the first node', 'or']);
        const t = await toolbar(page); assertCentered(t);
        assert.ok(hint.rect.bottom < t.puck.y, 'three intact text lines sit above the centered palette');
        assert.ok(Math.abs(hint.rect.x + hint.rect.width / 2 - (t.frame.x + t.frame.w / 2)) < 2);
        await page.locator('.puck [data-act="addnode"]').click();
        const fade = await page.waitForFunction(() => { const o = Number(getComputedStyle(document.querySelector('lode-flow').shadowRoot.querySelector('.kickstarter')).opacity); return o > 0 && o < 1 ? o : false; }, null, { polling: 16, timeout: 5000 });
        const during = await fade.jsonValue();
        assert.ok(during > 0 && during < 1, 'first-node prompt fades rather than vanishing');
        await page.locator('textarea').fill('A first node'); await page.keyboard.press('Escape');
        await page.locator('.kickstarter').waitFor({ state: 'hidden', timeout: 5000 });
        assert.equal(await page.locator('.kickstarter').isVisible(), false);
        assert.match((await toolbar(page)).buttons[0].text, /⇧N/);
        await reset(page, empty); await page.locator('.kickstarter').waitFor({ state: 'visible', timeout: 5000 });
        assert.equal(await page.locator('.kickstarter').isVisible(), true);
        await flow(page, (f) => f.setAttribute('readonly', '')); await settled(page);
        assert.equal(await page.locator('.kickstarter').isVisible(), false, 'read-only cannot promise adding');
        await flow(page, (f) => { f.removeAttribute('readonly'); f.setAttribute('presentation', 'graph'); }); await settled(page);
        assert.equal(await page.locator('.kickstarter').isVisible(), false, 'graph presentation remains a bare graph');
        await flow(page, (f) => { f.removeAttribute('presentation'); f.removeAttribute('empty-hint'); });
      });

      await check(`${name}: Help slot retains host controls and their keyboard ownership`, async () => {
        await reset(page);
        await flow(page, (f) => {
          const button = document.createElement('button'); button.slot = 'help'; button.textContent = 'Host style';
          window.hostHelpButton = button; window.hostHelpClicks = 0;
          button.addEventListener('click', () => window.hostHelpClicks++); f.append(button);
        });
        assert.equal(await page.getByRole('button', { name: 'Host style' }).isVisible(), false);
        for (let i = 0; i < 2; i++) {
          await page.locator('.puck [data-act="help"]').click(); await settled(page);
          assert.equal(await page.getByRole('button', { name: 'Host style' }).isVisible(), true);
          await page.getByRole('button', { name: 'Host style' }).click();
          assert.equal(await page.locator('.help').isVisible(), true, 'slotted pointer controls are inside Help');
          await page.getByRole('button', { name: 'Host style' }).focus(); await page.keyboard.press('Enter');
          assert.equal(await flow(page, (f) => !!f.shadowRoot.querySelector('textarea')), false, 'host Enter never reaches canvas edit');
          assert.equal(await flow(page, (f) => f.querySelector('[slot="help"]') === window.hostHelpButton), true);
          await page.keyboard.press('Escape'); await settled(page);
          assert.equal(await page.locator('.help').isVisible(), false);
        }
        assert.equal(await page.evaluate(() => window.hostHelpClicks), 4);
        await flow(page, (f) => f.querySelector('[slot="help"]').remove());
        await page.locator('.puck [data-act="help"]').click(); await settled(page);
        assert.equal(await flow(page, (f) => f.shadowRoot.querySelector('slot[name="help"]').hidden), true, 'default footer has no empty footprint');
      });

      await check(`${name}: graph configuration preserves foreign focus and Help closes deliberately`, async () => {
        await reset(page, empty);
        await page.evaluate(() => {
          const practice = document.querySelector('lode-flow'); practice.id = 'focus-practice'; practice.focus();
          const guide = document.createElement('lode-flow'); guide.id = 'focus-guide'; practice.before(guide);
          guide.setAttribute('readonly', ''); guide.setAttribute('presentation', 'graph'); guide.setAttribute('node-activation', 'event'); guide.setAttribute('group-activation', 'event');
        });
        try {
          await settled(page);
          assert.equal(await page.evaluate(() => document.activeElement.id), 'focus-practice', 'graph initialization never steals keys from its editable neighbor');
          await page.keyboard.press('n'); await settled(page);
          assert.equal(await page.locator('#focus-practice textarea').count(), 1);
          assert.equal(await page.locator('#focus-guide textarea').count(), 0);
          await page.locator('#focus-practice textarea').fill('Keyboard reaches practice'); await page.keyboard.press('Escape');
        } finally { await page.locator('#focus-guide').evaluate((n) => n.remove()); }
        await reset(page);
        await page.evaluate(() => { const input = document.createElement('input'); input.id = 'focus-owner'; document.body.append(input); input.focus(); });
        for (const [name, value] of [['presentation', 'graph'], ['node-activation', 'event'], ['group-activation', 'event'], ['readonly', '']]) {
          await flow(page, (f, { name, value }) => f.setAttribute(name, value), { name, value }); await settled(page);
          assert.equal(await page.evaluate(() => document.activeElement.id), 'focus-owner', `${name} update leaves outside focus alone`);
        }
        await flow(page, (f) => { for (const name of ['presentation', 'node-activation', 'group-activation', 'readonly']) f.removeAttribute(name); });
        await page.locator('.puck [data-act="help"]').click(); await settled(page);
        await page.locator('#focus-owner').click(); await settled(page);
        assert.equal(await page.locator('.help').isVisible(), false);
        assert.equal(await page.evaluate(() => document.activeElement.id), 'focus-owner', 'closing Help from an outside pointer does not reclaim focus');
        await page.locator('.puck [data-act="help"]').click(); await settled(page);
        await page.locator('#focus-owner').focus();
        await flow(page, (f) => f.setAttribute('presentation', 'graph')); await settled(page);
        assert.equal(await page.locator('.help').isVisible(), false);
        assert.equal(await page.evaluate(() => document.activeElement.id), 'focus-owner', 'mode change closes even open Help without claiming outside focus');
        await flow(page, (f) => f.removeAttribute('presentation')); await settled(page);
        for (const close of ['button', 'Escape']) {
          await page.locator('.puck [data-act="help"]').click(); await settled(page);
          if (close === 'button') await page.locator('[data-act="close-help"]').click(); else await page.keyboard.press('Escape');
          assert.equal(await flow(page, (f) => f.shadowRoot.activeElement?.classList.contains('vp')), true, 'an explicit Help close returns keys to its diagram');
        }
        await page.locator('#focus-owner').evaluate((n) => n.remove());
      });

      await check(`${name}: click and N/Shift+N agree in every selection`, async () => {
        const outcome = () => flow(page, (f) => {
          const ids = new Map([...f.doc.nodes, ...f.doc.edges, ...f.doc.groups, ...(f.doc.junctions || [])].map((item, i) => [item.id, ['a', 'b', 'g', 'ab'].includes(item.id) ? item.id : `new-${i}`]));
          const doc = structuredClone(f.doc);
          for (const item of [...doc.nodes, ...doc.edges, ...doc.groups, ...(doc.junctions || [])]) for (const key of ['id', 'from', 'to', 'group']) if (item[key]) item[key] = ids.get(item[key]);
          return { doc, sel: f.selection.map((id) => ids.get(id)), editing: !!f.shadowRoot.querySelector('textarea'), list: !f.linkerEl.hidden, label: f.hist.peekUndo()?.label };
        });
        for (const sel of [[], ['a'], ['g'], ['ab'], ['a', 'b']]) for (const shift of [false, true]) {
          await reset(page, seed, sel);
          await page.keyboard.press(shift ? 'Shift+N' : 'n'); await settled(page);
          const keyed = await outcome();
          await reset(page, seed, sel);
          if (shift) await page.keyboard.down('Shift');
          await page.locator('.puck [data-act="addnode"]').click();
          if (shift) await page.keyboard.up('Shift');
          await settled(page);
          assert.deepEqual(await outcome(), keyed, `selection ${sel.join(',') || 'none'}, shift ${shift}`);
          assertBookends(await toolbar(page));
        }
      });

      await check(`${name}: deletion to empty retains genuine Undo`, async () => {
        await reset(page, { nodes: [{ id: 'only', text: 'Keep me' }], edges: [] }, ['only']);
        await page.keyboard.press('Delete'); await settled(page);
        let t = await toolbar(page); assertBookends(t); assertCentered(t);
        assert.deepEqual(t.buttons.map((b) => b.act), ['addnode', 'undo', 'help']);
        assert.equal(t.buttons[1].disabled, false); assert.equal(t.wayback, false);
        await page.locator('.puck [data-act="undo"]').click(); await settled(page);
        assert.equal(await flow(page, (f) => f.doc.nodes[0].text), 'Keep me');
        await page.keyboard.press('Delete'); await settled(page);
        assert.equal(await flow(page, (f) => f.doc.nodes.length), 0, 'keys still reach the diagram after toolbar Undo');
        await reset(page, empty);
        assert.equal(await page.locator('.puck [data-act="undo"]').count(), 0, 'fresh baseline has no disabled Undo');
        await flow(page, (f) => f.setAttribute('readonly', '')); await settled(page);
        t = await toolbar(page); assert.equal(t.emptyHidden, true); assert.equal(t.emptyText, '');
        assert.deepEqual(t.buttons.map((b) => b.act), ['help']);
        await flow(page, (f) => f.removeAttribute('readonly'));
      });

      await check(`${name}: accepted loads hide Undo while history and Redo remain recoverable`, async () => {
        const saved = await historyFixture(page);
        await waitUndo(page, true);
        for (const load of ['state', 'replace', 'same-content', 'same-object']) {
          await flow(page, (f, saved) => { f.setState(saved); f.select(['a']); }, saved);
          await waitUndo(page, true);
          const report = await flow(page, (f, { saved, load }) => {
            const before = f.getState();
            if (load === 'state') f.setState(saved);
            else if (load === 'replace') f.setDoc({ nodes: [], edges: [] }, { resetHistory: false });
            else if (load === 'same-content') f.setDoc(f.doc, { resetHistory: false });
            else f.doc = f.doc;
            return { before, after: f.getState(), canUndo: f.canUndo };
          }, { saved, load });
          await waitUndo(page, false);
          assert.equal(report.canUndo, true, `${load}: hiding the control retains usable history`);
          assert.deepEqual(Object.keys(report.after).sort(), ['doc', 'history', 'view'], 'the display baseline is never persisted');
          if (load === 'state') assert.deepEqual(report.after, saved);
          else if (load === 'same-object') assert.deepEqual(report.after, report.before, 'identical property assignment preserves the existing no-op history behavior');
          else {
            assert.equal(report.after.history.index, report.before.history.index + 1);
            assert.equal(report.after.history.entries.at(-1).kind, 'load');
          }
        }
        const withRedo = await flow(page, (f, saved) => { f.setState(saved); f.undo(); return f.getState(); }, saved);
        await flow(page, (f, state) => f.setState(state), withRedo);
        await waitUndo(page, false);
        await page.waitForFunction(() => !!document.querySelector('lode-flow').shadowRoot.querySelector('.puck [data-act="redo"]'));
        assert.equal(await flow(page, (f) => f.canRedo), true, 'Redo keeps its existing loaded-history visibility');
        await flow(page, (f) => f.setDoc(f.doc, { discardPendingSave: true }));
        await waitUndo(page, false);
        assert.equal(await flow(page, (f) => f.canUndo), false, 'hard replacement still clears history');
      });

      await check(`${name}: first selection, view, edit or history action reveals loaded Undo`, async () => {
        const saved = await historyFixture(page);
        const withRedo = await flow(page, (f, saved) => { f.setState(saved); f.undo(); return f.getState(); }, saved);
        for (const action of ['selection', 'zoom', 'edit', 'keyboard-undo', 'api-undo', 'keyboard-redo', 'api-redo', 'rewind', 'fast-forward']) {
          const state = action.includes('redo') || action === 'fast-forward' ? withRedo : saved;
          await flow(page, (f, state) => { f.setState(state); f.focus(); }, state);
          await waitUndo(page, false);
          if (action === 'selection') await flow(page, (f) => f.select(['a']));
          else if (action === 'zoom') await page.keyboard.press('=');
          else if (action === 'edit') {
            await flow(page, (f) => f.startEdit('a'));
            await page.locator('textarea').fill('First edited');
            await page.keyboard.press('Enter');
          } else if (action === 'keyboard-undo') await page.keyboard.press('ControlOrMeta+z');
          else if (action === 'keyboard-redo') await page.keyboard.press('ControlOrMeta+Shift+z');
          else await flow(page, (f, action) => f[action === 'api-undo' ? 'undo' : action === 'api-redo' ? 'redo' : action === 'fast-forward' ? 'fastForward' : 'rewind'](), action);
          await waitUndo(page, true);
          assert.equal(await flow(page, (f) => f.canUndo), true, action);
          assert.equal(await page.locator('.puck [data-act="undo"]').isEnabled(), true, action);
        }
        await flow(page, (f, saved) => { f.setState(saved); f.select(f.selection); f.focus(); f.openHelp(); f.closeHelp(); }, saved);
        await waitUndo(page, false);
        assert.deepEqual(await flow(page, (f) => f.getState()), saved, 'no-op selection, focus and Help do not reveal Undo or change history');
        await flow(page, (f) => f.setDoc({ nodes: [], edges: [] }, { resetHistory: false }));
        await waitUndo(page, false);
        await flow(page, (f) => f.undo());
        await waitUndo(page, true);
        assert.equal(await flow(page, (f) => f.doc.nodes.length), 2, 'Undo can recover a host Load while its control was hidden');
      });

      await check(`${name}: rejected document or history loads preserve Undo visibility`, async () => {
        const saved = await historyFixture(page);
        const oversized = { ...saved.doc, nodes: Array.from({ length: 5 }, (_, i) => ({ id: `over-${i}`, text: 'Too many' })), edges: [], groups: [], junctions: [] };
        for (const visible of [false, true]) {
          await flow(page, (f, { saved, visible }) => { f.setState(saved); if (visible) f.select(['a']); f.setAttribute('max-items', '4'); }, { saved, visible });
          await waitUndo(page, visible);
          for (const load of ['document', 'state', 'history']) {
            const report = await flow(page, (f, { load, oversized, saved }) => {
              const before = f.getState();
              let rejected = false;
              try {
                if (load === 'document') f.setDoc(oversized, { resetHistory: false });
                else if (load === 'state') f.setState({ ...saved, doc: oversized });
                else f.setState({ ...saved, history: { ...saved.history, docs: [oversized] } });
              } catch (e) { rejected = e instanceof RangeError; }
              return { rejected, before, after: f.getState(), canUndo: f.canUndo };
            }, { load, oversized, saved });
            assert.equal(report.rejected, true, load);
            assert.deepEqual(report.after, report.before, load);
            assert.equal(report.canUndo, true);
            await waitUndo(page, visible);
          }
          await flow(page, (f) => f.removeAttribute('max-items'));
        }
      });

      await check(`${name}: saved reload hides Undo without discarding browser history`, async () => {
        const saved = await historyFixture(page);
        await flow(page, (f) => { f.setAttribute('storage-key', 'undo-reload'); f.saveNow(); });
        const storage = await page.evaluate(() => ({ doc: localStorage.getItem('lodeflow:undo-reload'), history: localStorage.getItem('lodeflow:undo-reload:history') }));
        assert.ok(storage.doc && storage.history);
        await page.reload();
        await page.evaluate(() => { const f = document.createElement('lode-flow'); f.setAttribute('storage-key', 'undo-reload'); document.body.append(f); f.tun.animation = 0; });
        await page.waitForFunction(() => document.querySelector('lode-flow').layoutInfo && document.querySelector('lode-flow').canUndo);
        await waitUndo(page, false);
        assert.deepEqual(await flow(page, (f) => f.getState().history), saved.history);
        assert.deepEqual(await page.evaluate(() => ({ doc: localStorage.getItem('lodeflow:undo-reload'), history: localStorage.getItem('lodeflow:undo-reload:history') })), storage, 'startup does not write a visibility state');
        await flow(page, (f) => { f.removeAttribute('storage-key'); f.focus(); });
        await page.keyboard.press('ControlOrMeta+z');
        await waitUndo(page, true);
        assert.deepEqual(await flow(page, (f) => f.selection), ['a'], 'saved selection history is still usable');
      });

      await check(`${name}: destructive reset drops draft and pending quota save`, async () => {
        for (const newNode of [false, true]) {
          await reset(page);
          const report = await flow(page, (f, newNode) => {
            localStorage.clear();
            localStorage.setItem('lodeflow:other:history', 'unrelated-history');
            localStorage.setItem('lodeflow:other', 'unrelated-document');
            localStorage.setItem('host:appearance', 'blueprint');
            f.setAttribute('storage-key', 'reset-test');
            if (newNode) f.action('addnode'); else { f.startEdit('a'); f.persist(); }
            f.editing.ta.value = 'Draft must disappear';
            window.storageCalls = [];
            const set = Storage.prototype.setItem, remove = Storage.prototype.removeItem;
            Storage.prototype.setItem = function(k, v) { window.storageCalls.push(['set', k]); throw new DOMException('full', 'QuotaExceededError'); };
            Storage.prototype.removeItem = function(k) { window.storageCalls.push(['remove', k]); return remove.call(this, k); };
            window.restoreStorage = () => { Storage.prototype.setItem = set; Storage.prototype.removeItem = remove; };
            const before = f.persistTimer;
            let rejected = false;
            try { f.setDoc({ nodes: [], edges: [] }, { resetHistory: false, discardPendingSave: true }); } catch { rejected = true; }
            const untouched = f.persistTimer === before && !!f.editing && f.editing.ta.value === 'Draft must disappear';
            const count = f.doc.nodes.length + f.doc.edges.length + f.doc.groups.length + f.doc.junctions.length;
            f.setAttribute('max-items', String(count));
            let limitRejected = false;
            try { f.setDoc({ nodes: Array.from({ length: count + 1 }, (_, i) => ({ id: `over-${i}`, text: 'Too many' })), edges: [] }, { discardPendingSave: true }); } catch { limitRejected = true; }
            const limitUntouched = f.persistTimer === before && !!f.editing && f.editing.ta.value === 'Draft must disappear';
            f.setDoc({ nodes: [{ id: 'fresh', text: 'Fresh baseline' }], edges: [] }, { discardPendingSave: true });
            f.removeAttribute('max-items');
            return { rejected, untouched, limitRejected, limitUntouched, timer: f.persistTimer, editing: !!f.editing, undo: f.canUndo, text: f.doc.nodes.map((n) => n.text) };
          }, newNode);
          assert.deepEqual(report, { rejected: true, untouched: true, limitRejected: true, limitUntouched: true, timer: 0, editing: false, undo: false, text: ['Fresh baseline'] });
          await page.waitForTimeout(400);
          const storage = await page.evaluate(() => { const report = { calls: window.storageCalls, history: localStorage.getItem('lodeflow:other:history'), doc: localStorage.getItem('lodeflow:other'), appearance: localStorage.getItem('host:appearance'), own: localStorage.getItem('lodeflow:reset-test') }; window.restoreStorage(); return report; });
          assert.deepEqual(storage, { calls: [], history: 'unrelated-history', doc: 'unrelated-document', appearance: 'blueprint', own: null });
          await flow(page, (f) => f.removeAttribute('storage-key'));
        }
        await reset(page);
        const flushed = await flow(page, (f) => { f.setAttribute('storage-key', 'normal-replace'); f.persist(); f.setDoc({ nodes: [], edges: [] }); return JSON.parse(localStorage.getItem('lodeflow:normal-replace')).doc.nodes.map((n) => n.text); });
        assert.deepEqual(flushed, ['First', 'Next'], 'ordinary setDoc still flushes the prior pending save');
        await flow(page, (f) => f.removeAttribute('storage-key'));
      });

      if (name === 'chromium') await check(`${name}: first touch on a fine-pointer display keeps its target`, async () => {
        await reset(page, empty);
        assert.equal(await page.evaluate(() => matchMedia('(any-pointer: coarse)').matches), false);
        const cdp = await page.context().newCDPSession(page);
        const tap = async (selector) => {
          const r = await page.locator(selector).first().boundingBox();
          const point = { x: r.x + r.width / 2, y: r.y + r.height / 2 };
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
          await settled(page);
        };
        await tap('.puck [data-act="addnode"]');
        assert.equal(await page.locator('textarea').count(), 1, 'first Add tap opens its editor');
        assert.deepEqual(await visibleHints(page), []);
        await reset(page, groupSeed);
        await page.locator('.puck [data-act="help"]').click(); await settled(page);
        assert.match(await page.locator('.help').textContent(), /Gestures and keys/);
        await assertGroupCaptions(page, false);
        await tap('.help tr');
        assert.equal(await page.locator('.help h2 span').textContent(), 'Gestures', 'an open desktop legend switches after actual touch');
        assert.deepEqual(await visibleHints(page), []);
        await assertGroupCaptions(page, true);
        await tap('[data-act="close-help"]');
        assert.equal(await page.locator('.help:not([hidden])').count(), 0, 'Close remains tappable');
        assert.equal(await scrollNudge(page), 'Tap the diagram to scroll it');
        await page.locator('.puck [data-act="help"]').click(); await settled(page);
        await assertGroupCaptions(page, false);
        await flow(page, (f) => f.closeHelp());
        assert.match(await scrollNudge(page), /^Click the diagram to scroll it · (⌘|Ctrl)-scroll zooms$/, 'desktop scroll wording remains');
      });

      if (name === 'chromium') for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
        await check(`${name}: touch hints absent at ${viewport.width}px`, async () => {
          const touch = await browser.newPage({ viewport, hasTouch: true });
          try {
            await touch.goto(url);
            await touch.evaluate(() => { const f = document.createElement('lode-flow'); document.body.append(f); f.tun.animation = 0; });
            await touch.waitForFunction(() => document.querySelector('lode-flow')?.layoutInfo);
            await reset(touch, groupSeed);
            await assertGroupCaptions(touch, true);
            assert.equal(await scrollNudge(touch), 'Tap the diagram to scroll it');
            await touch.locator('.glabel[data-gid="g"] .chev').tap(); await settled(touch);
            assert.equal(await flow(touch, (f) => f.doc.groups.find((g) => g.id === 'g').collapsed), true, 'first chevron tap still folds the group');
            await assertGroupCaptions(touch, true);
            await reset(touch, empty); assertBookends(await toolbar(touch)); assertCentered(await toolbar(touch));
            await flow(touch, (f) => f.setAttribute('empty-hint', '')); await page.waitForTimeout(450);
            assert.equal(await touch.locator('.kickstarter > div').first().textContent(), 'Tap Add node');
            assert.equal(await touch.locator('.kickstarter .or').isVisible(), false, 'touch prompt names its working control without redundant or');
            const beforeTap = await flow(touch, (f) => f.doc.nodes.length);
            await touch.locator('.puck [data-act="addnode"]').tap(); await settled(touch);
            assert.equal(await flow(touch, (f) => f.doc.nodes.length), beforeTap + 1, 'advertised Add tap creates first node');
            await flow(touch, (f) => { f.removeAttribute('empty-hint'); f.finishEdit('discard'); }); await reset(touch, empty);
            await touch.locator('.puck [data-act="help"]').tap(); await settled(touch);
            assert.equal(await touch.locator('.help h2 span').textContent(), 'Gestures');
            assert.equal(await touch.locator('.help tr').count(), 12);
            assert.doesNotMatch(await touch.locator('.help').textContent(), /Double-tap/);
            assert.doesNotMatch(await touch.locator('.help').textContent(), /Esc|Ctrl|⌘|⇧|↵|Press \[|press [A-Z]|keyboard|Keys/);
            assert.deepEqual(await visibleHints(touch), []);
            await touch.locator('[data-act="close-help"]').tap();
            await reset(touch, seed, ['a']);
            assert.deepEqual(await visibleHints(touch), []);
            await touch.locator('.puck [data-act="panel"]').tap(); await settled(touch);
            assert.deepEqual(await visibleHints(touch), []);
            await flow(touch, (f) => f.closePanel());
            await touch.locator('.node-magnet [data-act="link"]').tap(); await settled(touch);
            assert.deepEqual(await visibleHints(touch), []);
            assert.doesNotMatch(await touch.locator('[data-act="close-linker"]').getAttribute('title'), /Esc/);
            await flow(touch, (f) => { f.checkRow(0, true); f.checkRow(1, true); }); await settled(touch);
            assert.deepEqual(await visibleHints(touch), []);
            await touch.locator('[data-act="close-linker"]').tap();
            await reset(touch, seed);
            await touch.locator('.puck [data-act="addnode"]').tap(); await settled(touch);
            assert.equal(await touch.locator('textarea').count(), 1, 'Add responds to the first tap');
          } finally { await touch.close(); }
        });
      }
      assert.deepEqual(errors, [], `${name}: no browser errors`);
    } finally { await page.close(); await browser.close(); }
  }
} finally { server.close(); }
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} control checks pass`);
if (results.some((r) => !r.ok)) process.exitCode = 1;
