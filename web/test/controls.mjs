// Diagram toolbar, touch hints and explicitly destructive reset: real browser regressions.
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
