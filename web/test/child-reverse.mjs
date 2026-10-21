// Empty-canvas node drops and edge reversal through real pointer/key/control paths.
// BROWSERS=chromium,webkit node test/child-reverse.mjs; LF_BUNDLE selects a regression baseline.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { chromium, firefox, webkit } from 'playwright';

const bundle = await readFile(process.env.LF_BUNDLE || new URL('../dist/lode-flow.iife.js', import.meta.url));
const server = createServer((req, res) => {
  res.setHeader('content-type', req.url === '/bundle.js' ? 'text/javascript' : 'text/html');
  res.end(req.url === '/bundle.js' ? bundle : '<!doctype html><style>body{margin:0}lode-flow{height:100vh}</style><script src="/bundle.js"></script><lode-flow></lode-flow>');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}`;
const seed = { nodes: [{ id: 'a', text: 'First' }, { id: 'b', text: 'Next' }], edges: [{ id: 'ab', from: 'a', to: 'b', label: 'leads to' }], groups: [], junctions: [], settings: { orientation: 'tb' } };
const flow = (p, fn, arg) => p.locator('lode-flow').evaluate(fn, arg);
const state = (p) => flow(p, (f) => f.getState());
const doc = (p) => flow(p, (f) => f.doc);
const settle = (p) => p.waitForTimeout(180);
const pick = async (p, ids) => { await flow(p, (f, s) => { f.select(s); f.focus(); }, ids); await settle(p); };
const reset = async (p, d = seed, ids = []) => {
  await flow(p, (f, { d, ids }) => {
    f.removeAttribute('readonly'); f.removeAttribute('max-items');
    f.setDoc(d); f.select(ids); f.focus();
  }, { d, ids });
  await settle(p);
};
async function dragEmpty(p, id = 'a', { shift = false, distance = 170 } = {}) {
  const r = await p.locator(`.node[data-id="${id}"]`).boundingBox();
  // Horizontal from a top-to-bottom graph avoids its existing edge and endpoint.
  const start = { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  if (shift) await p.keyboard.down('Shift');
  await p.mouse.move(start.x, start.y);
  await p.mouse.down();
  await p.mouse.move(start.x + distance, start.y, { steps: 12 });
  await p.mouse.up();
  if (shift) await p.keyboard.up('Shift');
  await settle(p);
}
async function typeChild(p, text = 'New child') {
  await p.locator('textarea.ed').fill(text);
  await p.keyboard.press('Enter');
  await settle(p);
}
function reversedEdges(before, after) {
  assert.equal(after.edges.length, before.edges.length);
  for (const e of before.edges) {
    const actual = after.edges.find((n) => n.id === e.id);
    assert.deepEqual(actual, { ...e, from: e.to, to: e.from });
  }
}
const results = [];
async function check(name, fn) {
  if (process.env.ONLY && !name.includes(process.env.ONLY)) return;
  try { await fn(); results.push(true); console.log(`✓ ${name}`); }
  catch (e) { results.push(false); console.error(`✗ ${name}\n${e.stack}`); }
}

try {
  for (const [name, engine] of Object.entries({ chromium, firefox, webkit })) {
    if (process.env.BROWSERS && !process.env.BROWSERS.split(',').includes(name)) continue;
    const browser = await engine.launch(), context = await browser.newContext({ viewport: { width: 1100, height: 780 }, reducedMotion: 'reduce' });
    const p = await context.newPage(), errors = [];
    p.setDefaultTimeout(4000);
    p.on('pageerror', (e) => errors.push(e.message));
    try {
      await p.goto(url);
      await p.waitForFunction(() => document.querySelector('lode-flow')?.layoutInfo);
      await flow(p, (f) => { f.tun.animation = 0; });

      await check(`${name}: dropping a node on empty canvas starts a connected editable child`, async () => {
        await reset(p);
        await dragEmpty(p);
        assert.equal(await p.locator('textarea.ed').count(), 1);
        assert.equal(await flow(p, (f) => f.shadowRoot.activeElement === f.shadowRoot.querySelector('textarea.ed')), true);
        assert.equal(await p.locator('.nudge:visible').count(), 0);
        await typeChild(p);
        const d = await doc(p), child = d.nodes.find((n) => n.text === 'New child');
        assert.ok(child);
        assert.ok(d.edges.some((e) => e.from === 'a' && e.to === child.id));
        assert.deepEqual(await flow(p, (f) => f.selection), [child.id]);
        assert.equal(d.loose?.length || 0, 0);
      });

      await check(`${name}: drop child uses N's parent group and is one content undo/redo step`, async () => {
        const grouped = { ...seed, groups: [{ id: 'g', text: 'Group' }], nodes: seed.nodes.map((n) => ({ ...n, group: 'g' })) };
        await reset(p, grouped);
        const original = await doc(p);
        await dragEmpty(p);
        await typeChild(p, 'Grouped child');
        const added = await doc(p), child = added.nodes.find((n) => n.text === 'Grouped child');
        assert.equal(child.group, 'g');
        await p.keyboard.press('ControlOrMeta+z'); await settle(p);
        assert.deepEqual(await doc(p), original);
        await p.keyboard.press('ControlOrMeta+Shift+z'); await settle(p);
        assert.deepEqual(await doc(p), added);
      });

      await check(`${name}: leaving the dropped child empty discards the draft and connection`, async () => {
        await reset(p);
        const original = await doc(p);
        await dragEmpty(p);
        await p.keyboard.press('Escape'); await settle(p);
        assert.deepEqual(await doc(p), original);
        assert.equal(await p.locator('textarea.ed').count(), 0);
      });

      await check(`${name}: short movement is a click; Shift drag still selects; read-only drag still pans`, async () => {
        await reset(p);
        const original = await doc(p);
        await dragEmpty(p, 'a', { distance: 5 });
        assert.deepEqual(await doc(p), original);
        assert.equal(await p.locator('textarea.ed').count(), 0);
        await dragEmpty(p, 'a', { shift: true });
        assert.deepEqual(await doc(p), original);
        assert.equal(await p.locator('textarea.ed').count(), 0);
        await flow(p, (f) => f.setAttribute('readonly', ''));
        await dragEmpty(p);
        assert.deepEqual(await doc(p), original);
        assert.equal(await p.locator('textarea.ed').count(), 0);
      });

      await check(`${name}: the item cap rejects a dropped child without a partial node or edge`, async () => {
        await reset(p);
        const original = await doc(p);
        await flow(p, (f) => f.setAttribute('max-items', '4'));
        await dragEmpty(p);
        assert.deepEqual(await doc(p), original);
        assert.equal(await p.locator('textarea.ed').count(), 0);
      });

      await check(`${name}: Escape, pointer cancellation and off-frame drops do not add a child`, async () => {
        for (const finish of ['escape', 'cancel', 'outside']) {
          await reset(p);
          const original = await doc(p), r = await p.locator('.node[data-id="a"]').boundingBox();
          const x = r.x + r.width / 2, y = r.y + r.height / 2;
          await p.mouse.move(x, y); await p.mouse.down();
          await p.mouse.move(finish === 'outside' ? 1120 : x + 170, y, { steps: 12 });
          if (finish === 'escape') await p.keyboard.press('Escape');
          if (finish === 'cancel') await flow(p, (f) => f.shadowRoot.querySelector('.vp').dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1, bubbles: true })));
          await p.mouse.up(); await settle(p);
          assert.deepEqual(await doc(p), original, finish);
          assert.equal(await p.locator('textarea.ed').count(), 0, finish);
        }
      });

      await check(`${name}: Reverse magnet swaps an edge's ends and keeps its identity, label and selection`, async () => {
        await reset(p, seed, ['ab']);
        const original = await doc(p);
        const button = p.locator('[data-act="reverse"]');
        assert.match(await button.textContent(), /Reverse/);
        assert.match(await button.getAttribute('aria-label'), /⇧R/);
        await button.click(); await settle(p);
        reversedEdges(original, await doc(p));
        assert.deepEqual(await flow(p, (f) => f.selection), ['ab']);
        await p.keyboard.press('ControlOrMeta+z'); await settle(p);
        assert.deepEqual(await doc(p), original);
        await p.keyboard.press('ControlOrMeta+Shift+z'); await settle(p);
        reversedEdges(original, await doc(p));
      });

      await check(`${name}: Shift+R reverses, R retains Upright, typing R edits words`, async () => {
        await reset(p, seed, ['ab']);
        const original = await doc(p);
        await p.keyboard.press('r'); await settle(p);
        assert.deepEqual(await doc(p), original);
        await p.keyboard.press('Shift+r'); await settle(p);
        reversedEdges(original, await doc(p));
        await p.keyboard.press('Enter');
        await p.locator('textarea.ed').fill('R is a letter');
        await p.keyboard.press('Shift+r');
        await p.keyboard.press('Enter'); await settle(p);
        const d = await doc(p);
        assert.equal(d.edges[0].from, 'b');
        assert.equal(d.edges[0].to, 'a');
        assert.match(d.edges[0].label, /R/);
      });

      await check(`${name}: hanging and free loose edges reverse and round-trip with saved history`, async () => {
        for (const loose of [[{ id: 'loose', from: 'a', label: 'maybe' }], [{ id: 'loose', to: 'a', label: 'maybe' }], [{ id: 'loose', label: 'maybe' }]]) {
          await reset(p, { ...seed, loose }, ['loose']);
          const original = await doc(p);
          const ends = () => flow(p, (f) => { const path = f.edgeEls.get('loose').path, a = path.getPointAtLength(0), b = path.getPointAtLength(path.getTotalLength()); return { a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y } }; });
          const oldEnds = await ends();
          await p.keyboard.press('Shift+r'); await settle(p);
          const changed = await doc(p), l = changed.loose[0], before = original.loose[0];
          assert.equal(l.from, before.to);
          assert.equal(l.to, before.from);
          assert.equal(l.id, before.id); assert.equal(l.label, before.label);
          if (!before.from && !before.to) {
            assert.notDeepEqual(l, before, 'free arrow changes direction');
            const newEnds = await ends();
            assert.ok(Math.hypot(oldEnds.a.x - newEnds.b.x, oldEnds.a.y - newEnds.b.y) < 0.5, 'drawn tail moves to the former head');
            assert.ok(Math.hypot(oldEnds.b.x - newEnds.a.x, oldEnds.b.y - newEnds.a.y) < 0.5, 'drawn head moves to the former tail');
          }
          const saved = await state(p);
          await p.reload();
          await p.waitForFunction(() => document.querySelector('lode-flow')?.layoutInfo);
          await flow(p, (f, s) => { f.tun.animation = 0; f.setState(s); f.focus(); }, saved);
          await p.keyboard.press('ControlOrMeta+z'); await settle(p);
          assert.deepEqual(await doc(p), original);
          await p.keyboard.press('ControlOrMeta+Shift+z'); await settle(p);
          assert.deepEqual(await doc(p), changed);
        }
      });

      await check(`${name}: a shared trunk reverses the connection; a branch reverses only that link`, async () => {
        for (const kind of ['fork', 'merge']) for (const selected of ['trunk', 'branch1']) {
          const edges = kind === 'fork' ? [{ id: 'trunk', from: 'a', to: 'j', label: 'choice' }, { id: 'branch1', from: 'j', to: 'b' }, { id: 'branch2', from: 'j', to: 'c' }] : [{ id: 'trunk', from: 'j', to: 'a', label: 'choice' }, { id: 'branch1', from: 'b', to: 'j' }, { id: 'branch2', from: 'c', to: 'j' }];
          await reset(p, { ...seed, nodes: [...seed.nodes, { id: 'c', text: 'Other' }], edges, junctions: [{ id: 'j', kind }] }, [selected]);
          const original = await doc(p);
          await p.locator('[data-act="reverse"]').click(); await settle(p);
          const d = await doc(p);
          if (selected === 'trunk') {
            reversedEdges(original, d);
            assert.equal(d.junctions[0].kind, kind === 'fork' ? 'merge' : 'fork');
          } else {
            assert.equal(d.junctions.length, 0, 'remaining one-branch connection becomes ordinary');
            const reversed = d.edges.find((e) => e.id === 'branch1');
            assert.equal(reversed.from, kind === 'fork' ? 'b' : 'a');
            assert.equal(reversed.to, kind === 'fork' ? 'a' : 'b');
            assert.equal(reversed.label, 'choice');
            const remaining = d.edges.find((e) => e.id === 'trunk');
            assert.equal(remaining.from, kind === 'fork' ? 'a' : 'c');
            assert.equal(remaining.to, kind === 'fork' ? 'c' : 'a');
          }
          assert.deepEqual(await flow(p, (f) => f.selection), [selected]);
          await p.keyboard.press('ControlOrMeta+z'); await settle(p);
          assert.deepEqual(await doc(p), original);
        }
      });

      await check(`${name}: reversing into an existing direction is refused atomically`, async () => {
        await reset(p, { ...seed, edges: [...seed.edges, { id: 'ba', from: 'b', to: 'a', label: 'already' }] }, ['ab']);
        const original = await doc(p);
        await p.keyboard.press('Shift+r'); await settle(p);
        assert.deepEqual(await doc(p), original);
        assert.match(await p.locator('.nudge:visible').textContent(), /Already linked/);
      });

      await check(`${name}: read-only selection has no Reverse and ignores Shift+R`, async () => {
        await reset(p, seed, ['ab']);
        await flow(p, (f) => f.setAttribute('readonly', '')); await settle(p);
        const original = await doc(p);
        assert.equal(await p.locator('[data-act="reverse"]').count(), 0);
        await p.keyboard.press('Shift+r'); await settle(p);
        assert.deepEqual(await doc(p), original);
      });

      await check(`${name}: selected free arrowheads stay clear of their controls in either direction`, async () => {
        for (const orientation of ['tb', 'lr']) for (const reversed of [false, true]) {
          await reset(p, { ...seed, nodes: [], edges: [], loose: [{ id: 'loose', label: 'relates to', ...(reversed ? { reversed: true } : {}) }], settings: { orientation } }, ['loose']);
          const overlap = await flow(p, (f) => {
            const path = f.edgeEls.get('loose').path, m = path.getScreenCTM();
            const boxes = ['.node-magnet', '.puck'].map((s) => f.shadowRoot.querySelector(s).getBoundingClientRect());
            return [0, 0.12, 0.88, 1].map((t) => { const q = path.getPointAtLength(path.getTotalLength() * t), x = m.a * q.x + m.c * q.y + m.e, y = m.b * q.x + m.d * q.y + m.f; return boxes.some((r) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom); });
          });
          assert.deepEqual(overlap, [false, false, false, false], `${orientation}, reversed=${reversed}`);
        }
      });

      await check(`${name}: ordinary and hanging arrowheads stay clear of edge controls`, async () => {
        const failures = [];
        for (const orientation of ['tb', 'lr']) for (const type of ['ordinary', 'head-free', 'tail-free']) for (const reverse of [false, true]) {
          const fixture = type === 'ordinary' ? { ...seed, settings: { orientation } } : { ...seed, edges: [], loose: [{ id: 'ab', label: 'relates to', [type === 'head-free' ? 'from' : 'to']: 'a' }], settings: { orientation } };
          await reset(p, fixture, ['ab']);
          if (reverse) { await p.keyboard.press('Shift+r'); await settle(p); }
          const blocked = await flow(p, (f) => {
            const path = f.edgeEls.get('ab').path, m = path.getScreenCTM(), q = path.getPointAtLength(path.getTotalLength());
            const x = m.a * q.x + m.c * q.y + m.e, y = m.b * q.x + m.d * q.y + m.f;
            return ['.node-magnet', '.puck'].some((s) => { const r = f.shadowRoot.querySelector(s).getBoundingClientRect(); return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom; });
          });
          if (blocked) failures.push(`${orientation}, ${type}, reversed=${reverse}`);
        }
        assert.deepEqual(failures, [], 'arrowheads covered by a control');
      });

      await check(`${name}: Shift keeps edge controls and their neighboring controls in place`, async () => {
        await reset(p, seed, ['ab']);
        const geometry = () => flow(p, (f) => [...f.shadowRoot.querySelectorAll('.node-magnet button')].map((b) => ({ act: b.dataset.act, x: b.getBoundingClientRect().x, y: b.getBoundingClientRect().y, w: b.getBoundingClientRect().width, h: b.getBoundingClientRect().height })));
        const before = await geometry();
        await p.keyboard.down('Shift'); await settle(p);
        assert.deepEqual(await geometry(), before);
        await p.keyboard.up('Shift');
        assert.deepEqual(await geometry(), before);
        await p.keyboard.press('?'); await settle(p);
        assert.match(await p.locator('.help').textContent(), /⇧R/);
        assert.match(await p.locator('.help').textContent(), /Reverse/);
        await p.keyboard.press('Escape');
      });
      assert.deepEqual(errors, [], `${name}: page errors`);
    } finally { await browser.close(); }
  }
} finally { server.close(); }
console.log(`${results.filter(Boolean).length}/${results.length} child/reverse checks passed`);
if (results.some((r) => !r)) process.exitCode = 1;
