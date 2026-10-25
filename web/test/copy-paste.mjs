// Copy/paste between diagrams, read-only sources and loose edges, in real browsers.
//   node test/copy-paste.mjs          (BROWSERS=chromium,webkit picks engines)
// Keys go through the browser's own copy and paste commands (⌘C / ⌘V, Ctrl elsewhere), so the clipboard
// events take the same route as a person's ⌘C; Playwright keeps that clipboard inside the browser.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { chromium, firefox, webkit } from 'playwright';

const bundle = await readFile(process.env.LF_BUNDLE || new URL('../dist/lode-flow.iife.js', import.meta.url));
const page = `<!doctype html><style>body{margin:0;display:grid;grid-template-columns:1fr 1fr;height:100vh}lode-flow{height:100vh}</style>
<script src="/bundle.js"></script><lode-flow id="a" readonly></lode-flow><lode-flow id="b"></lode-flow>`;
const server = createServer((req, res) => {
  res.setHeader('content-type', req.url === '/bundle.js' ? 'text/javascript' : 'text/html');
  res.end(req.url === '/bundle.js' ? bundle : page);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}`;
const source = {
  groups: [{ id: 'g', text: 'Pair' }],
  nodes: [{ id: 'x', text: 'Free' }, { id: 'y', text: 'Claimed', group: 'g' }, { id: 'z', text: 'Working', group: 'g' }],
  edges: [{ id: 'xy', from: 'x', to: 'y', label: 'binds' }, { id: 'yz', from: 'y', to: 'z' }],
  settings: { orientation: 'tb' },
};
// ⌘ on macOS, Ctrl elsewhere: the key the browser's own copy and paste commands answer to.
const META = 'ControlOrMeta';
const results = [];
const flow = (p, id, fn, arg) => p.locator(`#${id}`).evaluate(fn, arg);
const settle = (p) => p.waitForTimeout(250);
const doc = (p, id) => flow(p, id, (f) => f.doc);
const pick = async (p, id, ids) => { await flow(p, id, (f, s) => { f.select(s); f.focus(); }, ids); await settle(p); };

async function check(engine, name, label, fn) {
  const browser = await engine.launch(), context = await browser.newContext({ viewport: { width: 1400, height: 800 }, reducedMotion: 'reduce' }), p = await context.newPage(), errors = [];
  p.setDefaultTimeout(5e3);
  p.on('pageerror', (e) => errors.push(e.message));
  try {
    await p.goto(url);
    await p.waitForFunction(() => document.querySelector('#a')?.layoutInfo && document.querySelector('#b')?.layoutInfo);
    await p.evaluate((d) => { for (const f of document.querySelectorAll('lode-flow')) f.tun.animation = 0; document.querySelector('#a').setDoc(d); document.querySelector('#b').setDoc({ nodes: [], edges: [], settings: { orientation: 'tb' } }); }, source);
    await settle(p);
    await fn(p);
    assert.deepEqual(errors, []);
    results.push(true);
    console.log(`✓ ${name}: ${label}`);
  } catch (e) {
    results.push(false);
    console.error(`✗ ${name}: ${label}\n${e.stack}`);
  } finally {
    await browser.close();
  }
}

for (const [name, engine] of [['chromium', chromium], ['webkit', webkit], ['firefox', firefox]]) {
  if (process.env.BROWSERS && !process.env.BROWSERS.split(',').includes(name)) continue;

  await check(engine, name, '⌘C in a read-only diagram, ⌘V in another: pieces, links and the group arrive selected', async (p) => {
    const before = JSON.stringify(await doc(p, 'a'));
    await pick(p, 'a', ['g']);
    await p.keyboard.press(`${META}+c`);
    await pick(p, 'b', []);
    await p.keyboard.press(`${META}+v`);
    await settle(p);
    const b = await doc(p, 'b');
    assert.deepEqual(b.nodes.map((n) => n.text), ['Claimed', 'Working']);
    assert.equal(b.groups.length, 1);
    assert.equal(b.edges.length, 1);
    assert.ok(!b.nodes.some((n) => ['y', 'z'].includes(n.id)), 'fresh ids');
    assert.deepEqual(await flow(p, 'b', (f) => f.selection), [b.groups[0].id]);
    assert.equal(JSON.stringify(await doc(p, 'a')), before, 'source untouched');
  });

  await check(engine, name, 'a read-only diagram copies on ⌘X, and refuses ⌘V', async (p) => {
    const before = JSON.stringify(await doc(p, 'a'));
    await pick(p, 'a', ['x']);
    await p.keyboard.press(`${META}+x`);
    await settle(p);
    assert.equal(JSON.stringify(await doc(p, 'a')), before, 'nothing removed');
    await p.keyboard.press(`${META}+v`);
    await settle(p);
    assert.equal(JSON.stringify(await doc(p, 'a')), before, 'nothing pasted');
    await pick(p, 'b', []);
    await p.keyboard.press(`${META}+v`);
    await settle(p);
    assert.deepEqual((await doc(p, 'b')).nodes.map((n) => n.text), ['Free'], 'the cut still copied');
  });

  await check(engine, name, 'a copied edge without its ends arrives loose, keeping its label', async (p) => {
    await pick(p, 'a', ['xy']);
    await p.keyboard.press(`${META}+c`);
    await pick(p, 'b', []);
    await p.keyboard.press(`${META}+v`);
    await settle(p);
    const b = await doc(p, 'b');
    assert.equal(b.loose.length, 1);
    assert.equal(b.loose[0].label, 'binds');
    assert.ok(!b.loose[0].from && !b.loose[0].to);
  });

  await check(engine, name, 'Copy and Paste buttons work without the keyboard', async (p) => {
    await pick(p, 'a', ['x']);
    await p.locator('#a').evaluate((f) => f.shadowRoot.querySelector('.node-magnet [data-act="copy"]').click());
    await settle(p);
    await pick(p, 'b', []);
    await p.locator('#b').evaluate((f) => f.shadowRoot.querySelector('.puck [data-act="paste"]').click());
    await settle(p);
    assert.deepEqual((await doc(p, 'b')).nodes.map((n) => n.text), ['Free']);
  });

  await check(engine, name, 'cut and paste in one diagram, each one undo step', async (p) => {
    await pick(p, 'a', ['g']);
    await p.keyboard.press(`${META}+c`);
    await pick(p, 'b', []);
    await p.keyboard.press(`${META}+v`);
    await settle(p);
    const pasted = await flow(p, 'b', (f) => f.selection);
    await p.keyboard.press(`${META}+x`);
    await settle(p);
    assert.equal((await doc(p, 'b')).nodes.length, 0, 'cut removed the group and its nodes');
    await p.keyboard.press(`${META}+v`);
    await settle(p);
    assert.equal((await doc(p, 'b')).nodes.length, 2, 'pasted back');
    await p.keyboard.press(`${META}+z`);
    await settle(p);
    assert.equal((await doc(p, 'b')).nodes.length, 0, 'undo takes back the paste');
    await p.keyboard.press(`${META}+z`);
    await settle(p);
    assert.equal((await doc(p, 'b')).nodes.length, 2, 'undo takes back the cut');
    assert.notDeepEqual(await flow(p, 'b', (f) => f.selection), [], pasted.join());
  });

  await check(engine, name, 'text boxes keep the browser’s own copy and paste', async (p) => {
    await flow(p, 'b', (f) => f.setDoc({ nodes: [{ id: 'n', text: 'hello' }], edges: [], settings: { orientation: 'tb' } }));
    await pick(p, 'b', ['n']);
    await p.keyboard.press('Enter');
    await settle(p);
    await p.keyboard.press(`${META}+a`);
    await p.keyboard.press(`${META}+c`);
    await p.keyboard.press('ArrowRight');
    await p.keyboard.press(`${META}+v`);
    await p.keyboard.press('ControlOrMeta+Shift+Enter');
    await settle(p);
    const b = await doc(p, 'b');
    assert.deepEqual(b.nodes.map((n) => n.text), ['hellohello']);
  });

  await check(engine, name, 'A adds a free loose edge, ‘relates to’ ready to retype, three label-heights long top to bottom', async (p) => {
    await pick(p, 'b', []);
    await p.keyboard.press('a');
    await settle(p);
    assert.equal(await flow(p, 'b', (f) => f.shadowRoot.activeElement?.value), 'relates to');
    await p.keyboard.press('ControlOrMeta+Shift+Enter');
    await settle(p);
    const b = await doc(p, 'b');
    assert.deepEqual(b.loose.map((l) => l.label), ['relates to']);
    const m = await flow(p, 'b', (f, id) => {
      const path = f.shadowRoot.querySelector('path.edge').getAttribute('d').match(/-?[\d.]+/g).map(Number);
      const label = f.shadowRoot.querySelector(`.carrier[data-eid="${id}"]`);
      return { dx: Math.abs(path.at(-2) - path[0]), dy: Math.abs(path.at(-1) - path[1]), h: label.offsetHeight, arrow: !!f.shadowRoot.querySelector('path.arrow').getAttribute('d') };
    }, b.loose[0].id);
    assert.ok(m.dx < 1, `vertical (dx ${m.dx})`);
    assert.ok(Math.abs(m.dy - 3 * m.h) < 2, `length ${m.dy} is three label-heights (${m.h})`);
    assert.ok(m.arrow, 'drawn with an arrowhead');
  });

  await check(engine, name, 'left to right, a free loose edge runs its label plus a label-height each side', async (p) => {
    await flow(p, 'b', (f) => f.setDoc({ nodes: [], edges: [], loose: [{ id: 'l', label: 'relates to' }], settings: { orientation: 'lr' } }));
    await settle(p);
    const m = await flow(p, 'b', (f) => {
      const path = f.shadowRoot.querySelector('path.edge').getAttribute('d').match(/-?[\d.]+/g).map(Number);
      const label = f.shadowRoot.querySelector('.carrier[data-eid="l"]');
      return { dx: Math.abs(path.at(-2) - path[0]), dy: Math.abs(path.at(-1) - path[1]), w: label.offsetWidth, h: label.offsetHeight };
    });
    assert.ok(m.dy < 1, `horizontal (dy ${m.dy})`);
    assert.ok(Math.abs(m.dx - (m.w + 2 * m.h)) < 2, `length ${m.dx} = ${m.w} + 2 × ${m.h}`);
  });

  await check(engine, name, 'A on a node hangs a loose edge from it; E attaches its head and it becomes an ordinary edge', async (p) => {
    await flow(p, 'b', (f) => f.setDoc({ nodes: [{ id: 'p', text: 'Cause' }, { id: 'q', text: 'Effect' }], edges: [], settings: { orientation: 'tb' } }));
    await pick(p, 'b', ['p']);
    await p.keyboard.press('a');
    await settle(p);
    await p.keyboard.press('ControlOrMeta+Shift+Enter');
    await settle(p);
    const [l] = (await doc(p, 'b')).loose;
    assert.equal(l.from, 'p');
    await pick(p, 'b', [l.id]);
    await p.keyboard.press('e');
    await settle(p);
    await p.keyboard.press('Enter');
    await settle(p);
    const b = await doc(p, 'b');
    assert.equal(b.loose, undefined);
    assert.deepEqual(b.edges.map((e) => [e.id, e.from, e.to, e.label]), [[l.id, 'p', 'q', 'relates to']]);
  });

  await check(engine, name, 'dragging a loose edge onto a node, then a node onto it, attaches both ends', async (p) => {
    await flow(p, 'b', (f) => f.setDoc({ nodes: [{ id: 'p', text: 'Cause' }, { id: 'q', text: 'Effect' }], edges: [], loose: [{ id: 'l', label: 'relates to' }], settings: { orientation: 'lr' } }));
    await settle(p);
    const at = (sel) => p.locator('#b').evaluate((f, s) => { const r = f.shadowRoot.querySelector(s).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, sel);
    const drag = async (from, to) => {
      const a = await at(from), b = await at(to);
      await p.mouse.move(a.x, a.y); await p.mouse.down();
      for (let i = 1; i <= 8; i++) await p.mouse.move(a.x + ((b.x - a.x) * i) / 8, a.y + ((b.y - a.y) * i) / 8);
      await p.mouse.up(); await settle(p);
    };
    await drag('.carrier[data-eid="l"]', '.node[data-id="q"]');
    assert.equal((await doc(p, 'b')).loose[0].to, 'q', 'the head goes to the node it was dropped on');
    await drag('.node[data-id="p"]', '.carrier[data-eid="l"]');
    const b = await doc(p, 'b');
    assert.deepEqual(b.edges.map((e) => [e.id, e.from, e.to]), [['l', 'p', 'q']]);
  });

  await check(engine, name, 'cutting a group’s only node and pasting it back never doubles the group', async (p) => {
    await flow(p, 'b', (f) => f.setDoc({ groups: [{ id: 's', text: 'Solo' }], nodes: [{ id: 'z', text: 'Alone', group: 's' }, { id: 'o', text: 'Other' }], edges: [], settings: { orientation: 'tb' } }));
    await pick(p, 'b', ['z']);
    await p.keyboard.press(`${META}+x`);
    await settle(p);
    assert.deepEqual((await doc(p, 'b')).groups, [], 'the group that came with the copy goes with the cut');
    await pick(p, 'b', []);
    await p.keyboard.press(`${META}+v`);
    await settle(p);
    const b = await doc(p, 'b');
    assert.deepEqual(b.groups.map((g) => g.text), ['Solo']);
    assert.deepEqual(b.nodes.map((n) => n.text).sort(), ['Alone', 'Other']);
  });

  await check(engine, name, '⌘A takes folded groups whole, and pasting into a folded group opens it', async (p) => {
    await flow(p, 'b', (f) => f.setDoc({ groups: [{ id: 'f', text: 'Folded', collapsed: true }], nodes: [{ id: 'x', text: 'Outside' }, { id: 'i', text: 'Inside', group: 'f' }], edges: [{ id: 'xi', from: 'x', to: 'i' }], settings: { orientation: 'tb' } }));
    await pick(p, 'b', []);
    await p.keyboard.press(`${META}+a`);
    await settle(p);
    assert.deepEqual((await flow(p, 'b', (f) => f.selection)).sort(), ['f', 'x']);
    await p.keyboard.press(`${META}+c`);
    await pick(p, 'b', ['f']);
    await p.keyboard.press(`${META}+v`);
    await settle(p);
    const b = await doc(p, 'b');
    assert.equal(b.groups.find((g) => g.id === 'f').collapsed, false, 'the folded group opened for the paste');
    assert.equal(b.nodes.filter((n) => n.text === 'Outside').length, 2);
    assert.equal(b.groups.length, 2, 'the copied folded group came too');
    const sel = await flow(p, 'b', (f) => f.selection);
    assert.ok(sel.length > 0 && (await flow(p, 'b', (f, s) => s.every((id) => f.shadowRoot.querySelector(`[data-id="${id}"], [data-gid="${id}"]`)), sel)), 'what was pasted is drawn');
  });

  await check(engine, name, '⌘A selects free loose edges too, so copying everything takes them', async (p) => {
    await flow(p, 'b', (f) => f.setDoc({ nodes: [{ id: 'p', text: 'Cause' }], edges: [], loose: [{ id: 'l', label: 'relates to' }, { id: 'h', from: 'p' }], settings: { orientation: 'tb' } }));
    await pick(p, 'b', []);
    await p.keyboard.press(`${META}+a`);
    await settle(p);
    assert.deepEqual((await flow(p, 'b', (f) => f.selection)).sort(), ['l', 'p']);
  });

  const hanging = { nodes: [{ id: 'p', text: 'Cause' }, { id: 'q', text: 'Next' }], edges: [{ id: 'pq', from: 'p', to: 'q' }], loose: [{ id: 'h', from: 'p', label: 'hang' }, { id: 'l', label: 'free' }], settings: { orientation: 'tb' } };
  const acts = (p) => flow(p, 'b', (f) => [...f.shadowRoot.querySelectorAll('.node-magnet [data-act], .node-magnet .count-chip')].map((b) => b.dataset.act || b.textContent));

  await check(engine, name, '⇧⌫ on a loose edge removes its label and keeps the edge', async (p) => {
    await flow(p, 'b', (f, d) => f.setDoc(d), hanging);
    await pick(p, 'b', ['h']);
    await p.keyboard.press('Shift+Backspace');
    await settle(p);
    const b = await doc(p, 'b');
    assert.deepEqual(b.loose.map((l) => [l.id, l.label ?? '']), [['h', ''], ['l', 'free']]);
  });

  await check(engine, name, 'a node plus a loose edge shows the several-items toolbar', async (p) => {
    await flow(p, 'b', (f, d) => f.setDoc(d), hanging);
    await pick(p, 'b', ['p', 'l']);
    const a = await acts(p);
    assert.ok(a.includes('2 selected'), a.join(','));
    assert.ok(!a.includes('edit') && !a.includes('loose-out'), a.join(','));
  });

  await check(engine, name, 'S from a node reaches its hanging loose edge; arrows reach a free one', async (p) => {
    await flow(p, 'b', (f, d) => f.setDoc(d), hanging);
    await pick(p, 'b', ['p']);
    const seen = new Set();
    for (let i = 0; i < 2; i++) { await p.keyboard.press('s'); await settle(p); seen.add((await flow(p, 'b', (f) => f.selection))[0]); }
    assert.deepEqual([...seen].sort(), ['h', 'pq']);
    const visited = new Set();
    await pick(p, 'b', []);
    for (const k of ['ArrowDown', 'ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowUp', 'ArrowLeft']) {
      await p.keyboard.press(k);
      await settle(p);
      for (const id of await flow(p, 'b', (f) => f.selection)) visited.add(id);
    }
    assert.ok(visited.has('l'), [...visited].join(','));
  });

  await check(engine, name, 'pasting 51 lines of text names the limit', async (p) => {
    await p.evaluate(() => { const t = document.createElement('textarea'); t.id = 't'; t.value = Array.from({ length: 51 }, (_, i) => `line ${i}`).join('\n'); document.body.append(t); });
    await p.locator('#t').focus();
    await p.keyboard.press(`${META}+a`);
    await p.keyboard.press(`${META}+c`);
    await pick(p, 'b', []);
    await p.keyboard.press(`${META}+v`);
    await settle(p);
    assert.equal((await doc(p, 'b')).nodes.length, 0);
    const said = await flow(p, 'b', (f) => f.shadowRoot.textContent);
    assert.match(said, /51 lines/);
  });
}

server.close();
const ok = results.filter(Boolean).length;
console.log(`${ok}/${results.length} copy/paste and loose-edge browser checks pass`);
if (ok !== results.length) process.exit(1);
