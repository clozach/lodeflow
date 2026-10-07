// End-to-end checks in real Chromium. Run: node test/e2e.mjs [--shots <dir>]
// Serves ../ (the src/ folder) on a local port, drives examples/standalone.html.
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { motionCases, verifyMotion } from './group-motion-core.mjs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  ({ chromium } = require(process.env.PLAYWRIGHT_PATH || '/home/claude/.npm-global/lib/node_modules/playwright'));
}

const root = resolve(new URL('..', import.meta.url).pathname, '..');
const shotsArg = process.argv.indexOf('--shots');
const shots = shotsArg > 0 ? resolve(process.argv[shotsArg + 1]) : null;
if (shots) await mkdir(shots, { recursive: true });

const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.map': 'application/json', '.css': 'text/css' };
const server = createServer(async (req, res) => {
  try {
    const p = join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    const body = await readFile(process.env.LF_BUNDLE_FILE && p === join(root, 'web/dist/lode-flow.js') ? process.env.LF_BUNDLE_FILE : p);
    res.writeHead(200, { 'content-type': types[extname(p)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch();
const results = [];
// ONLY=<text> runs matching scenarios; separate several matches with |.
const included = (name) => !process.env.ONLY || process.env.ONLY.split('|').some((text) => name.includes(text));
async function scenario(name, fn, viewport = { width: 1280, height: 800 }, ctxOpts = {}) {
  if (!included(name)) return;
  const page = await browser.newPage({ viewport, ...ctxOpts });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.stack || e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const t0 = Date.now();
  try {
    await page.goto(`${base}/examples/standalone.html`);
    await page.waitForFunction(() => document.querySelector('lode-flow')?.layoutInfo && document.querySelector('lode-flow').doc.nodes.length > 0);
    await page.waitForTimeout(500);
    await fn(page);
    assert.deepEqual(errors, [], 'no page errors');
    results.push({ name, ok: true, ms: Date.now() - t0 });
    console.log(`✓ ${name}`);
  } catch (err) {
    results.push({ name, ok: false, error: String(err && err.message ? err.message : err) });
    console.log(`✗ ${name}\n  ${err && err.stack ? err.stack.split('\n').slice(0, 8).join('\n  ') : err}`);
  } finally {
    await page.close();
  }
}

// ---------- helpers ----------
const E = (page, fn, arg) => page.evaluate(fn, arg);
const el = (page) => E(page, () => {
  const f = document.querySelector('lode-flow');
  return { doc: f.doc, sel: f.selection, cam: f.camera, info: f.layoutInfo, undo: f.canUndo, redo: f.canRedo };
});
const center = (page, sel) =>
  E(page, (sel) => {
    const n = document.querySelector('lode-flow').shadowRoot.querySelector(sel);
    if (!n) return null;
    const r = n.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height };
  }, sel);
const rects = (page) =>
  E(page, () =>
    [...document.querySelector('lode-flow').shadowRoot.querySelectorAll('.node[data-id]')]
      .filter((n) => getComputedStyle(n).visibility !== 'hidden' && Number(n.style.opacity || 1) > 0.5)
      .map((n) => {
        const r = n.getBoundingClientRect();
        return { id: n.dataset.id, x: r.x, y: r.y, w: r.width, h: r.height };
      }),
  );
const settle = (page, ms = 600) => page.waitForTimeout(ms);
const shot = async (page, name) => shots && page.screenshot({ path: join(shots, `${name}.png`) });
const history = (page) => E(page, () => document.querySelector('lode-flow').hist.entries.map((e) => `${e.kind}:${e.label}`));
const edgeId = (doc, from, to) => doc.edges.find((e) => e.from === from && e.to === to)?.id;
/** Screen point halfway along an edge's drawn route. */
const edgeMid = (page, id) =>
  E(page, (id) => {
    const f = document.querySelector('lode-flow');
    const i = [...f.doc.edges].findIndex((e) => e.id === id);
    const path = [...f.shadowRoot.querySelectorAll('path.edge')][i];
    const L = path.getTotalLength();
    const p = path.getPointAtLength(L / 2);
    const m = path.getScreenCTM();
    return { x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f };
  }, id);
/** Drags with the mouse in small steps, as a hand would. */
async function drag(page, a, b, { hold } = {}) {
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(a.x + (b.x - a.x) * 0.3, a.y + (b.y - a.y) * 0.3, { steps: 6 });
  await page.mouse.move(b.x, b.y, { steps: 10 });
  await settle(page, 120);
  if (hold) await hold();
  await page.mouse.up();
}
/** Every visible node and label box on screen, for overlap checks. */
const boxes = (page) =>
  E(page, () =>
    [...document.querySelector('lode-flow').shadowRoot.querySelectorAll('.node[data-id], .carrier:not(.dot)')]
      .filter((n) => getComputedStyle(n).visibility !== 'hidden' && Number(n.style.opacity || 1) > 0.5)
      .map((n) => {
        const r = n.getBoundingClientRect();
        return { id: n.dataset.id || n.dataset.cid, x: r.x, y: r.y, w: r.width, h: r.height };
      }),
  );
function assertNoOverlap(rs) {
  for (let i = 0; i < rs.length; i++)
    for (let j = i + 1; j < rs.length; j++) {
      const a = rs[i], b = rs[j];
      assert.ok(!(a.x < b.x + b.w - 1 && b.x < a.x + a.w - 1 && a.y < b.y + b.h - 1 && b.y < a.y + a.h - 1), `${a.id} overlaps ${b.id}`);
    }
}
/** A point on the bare canvas, by the element's own hit test (no node, group, line or control there). */
const bareSpot = (page, avoid = null) =>
  E(page, (avoid) => {
    const f = document.querySelector('lode-flow');
    const vp = f.shadowRoot.querySelector('.vp').getBoundingClientRect();
    const ui = [...f.shadowRoot.querySelectorAll('.ui:not([hidden])')].map((u) => u.getBoundingClientRect());
    for (let y = vp.bottom - 30; y > vp.top + 30; y -= 23)
      for (let x = vp.left + 30; x < vp.right - 30; x += 29) {
        if (avoid && Math.hypot(x - avoid.x, y - avoid.y) < 60) continue;
        if (ui.some((r) => x >= r.left - 8 && x <= r.right + 8 && y >= r.top - 8 && y <= r.bottom + 8)) continue;
        const t = f.shadowRoot.elementFromPoint(x, y);
        if (f.withEdge(t, f.hit(t), { x: x - vp.left, y: y - vp.top }, false).type === 'empty') return { x, y };
      }
    return null;
  }, avoid);
/** A click with a modifier held (page.mouse.click takes no modifiers). */
async function modClick(page, p, key) {
  await page.keyboard.down(key);
  await page.mouse.click(p.x, p.y);
  await page.keyboard.up(key);
}
const shadowActive = (page) => E(page, () => {
  const a = document.querySelector('lode-flow').shadowRoot.activeElement;
  return a ? a.tagName + (a.className ? '.' + a.className : '') : null;
});

// ---------- scenarios ----------
await scenario('first layout: no overlaps, loop drawn as a back edge, auto picks left-to-right on a wide frame', async (page) => {
  const s = await el(page);
  assert.equal(s.info.orientation, 'lr');
  const rs = await rects(page);
  for (let i = 0; i < rs.length; i++)
    for (let j = i + 1; j < rs.length; j++) {
      const a = rs[i], b = rs[j];
      assert.ok(!(a.x < b.x + b.w - 1 && b.x < a.x + a.w - 1 && a.y < b.y + b.h - 1 && b.y < a.y + a.h - 1), `${a.id} overlaps ${b.id}`);
    }
  const back = await E(page, () => [...document.querySelector('lode-flow').shadowRoot.querySelectorAll('path.edge.back')].length);
  assert.equal(back, 1, 'exactly one back edge closes the loop');
  await shot(page, '01-first-layout');
});

await scenario('auto orientation turns top-to-bottom in a tall, narrow frame', async (page) => {
  const s = await el(page);
  assert.equal(s.info.orientation, 'tb');
  await shot(page, '02-phone');
}, { width: 390, height: 844 });

await scenario('resizing the frame re-orients the flow (and back)', async (page) => {
  await E(page, () => (document.querySelector('.frame').style.cssText = 'width:360px;height:620px'));
  await settle(page, 900);
  assert.equal((await el(page)).info.orientation, 'tb');
  await shot(page, '03-narrow-frame');
  await E(page, () => (document.querySelector('.frame').style.cssText = 'width:1100px;height:520px'));
  await settle(page, 900);
  assert.equal((await el(page)).info.orientation, 'lr');
});

await scenario('click selects; click again edits; Enter saves; ⌘Z/Ctrl+Z restores the old text', async (page) => {
  const b = await center(page, '.node[data-id="cycle"]');
  await page.mouse.click(b.x, b.y);
  await settle(page, 300);
  assert.deepEqual((await el(page)).sel, ['cycle']);
  assert.ok(await center(page, '.node-magnet [data-act="edit"]'), 'selection magnet shows Edit');
  const chords = await E(page, () => [...document.querySelector('lode-flow').shadowRoot.querySelectorAll('.node-magnet .mb:not([hidden])')].map((b) => b.querySelector('kbd')?.textContent));
  assert.ok(chords.every(Boolean), 'every magnet button shows its key');
  await shot(page, '04-selected');
  await page.mouse.click(b.x, b.y);
  await settle(page, 200);
  await page.keyboard.press('End');
  await page.keyboard.type(' while reviews queue up');
  await settle(page, 400);
  await shot(page, '05-editing');
  await page.keyboard.press('Enter');
  await settle(page, 500);
  const t1 = (await el(page)).doc.nodes.find((n) => n.id === 'cycle').text;
  assert.equal(t1, 'Cycle time grows while reviews queue up');
  await page.keyboard.press('Control+z');
  await settle(page, 500);
  assert.equal((await el(page)).doc.nodes.find((n) => n.id === 'cycle').text, 'Cycle time grows');
  await page.keyboard.press('Control+Shift+z');
  await settle(page, 500);
  assert.equal((await el(page)).doc.nodes.find((n) => n.id === 'cycle').text, t1);
});

await scenario('Shift doubles keyboard zoom in and out, including shifted aliases and undo', async (page) => {
  await E(page, () => { const f = document.querySelector('lode-flow'); f.zoomTo(1); f.shadowRoot.querySelector('.vp').focus(); });
  await settle(page, 750);
  const start = (await el(page)).cam;
  for (const [key, expected] of [['=', 1.5], ['-', 1], ['Shift+=', 2], ['Shift+-', 1], ['+', 1.5], ['_', 1]]) {
    await page.keyboard.press(key);
    await settle(page, 750);
    assert.ok(Math.abs((await el(page)).cam.z - expected) < 1e-9, key + ' zoom factor');
  }
  await page.keyboard.press('Shift+=');
  await settle(page);
  await E(page, () => document.querySelector('lode-flow').undo());
  await settle(page);
  assert.ok(Math.abs((await el(page)).cam.z - start.z) < 1e-9, 'undo restores the prior zoom');
  await E(page, () => document.querySelector('lode-flow').redo());
  await settle(page);
  assert.ok(Math.abs((await el(page)).cam.z - 2) < 1e-9, 'redo restores the Shift step');
});

await scenario('pan, zoom, rotate and selection are undoable, one step per gesture', async (page) => {
  const cam0 = (await el(page)).cam;
  await page.mouse.move(640, 600);
  await page.mouse.down();
  await page.mouse.move(760, 540, { steps: 10 });
  await page.mouse.up();
  await settle(page, 200);
  const cam1 = (await el(page)).cam;
  assert.notDeepEqual(cam1, cam0, 'drag pans');
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -200);
  await page.mouse.wheel(0, -200);
  await page.keyboard.up('Control');
  await settle(page, 300);
  const cam2 = (await el(page)).cam;
  assert.ok(cam2.z > cam1.z, 'ctrl-wheel zooms in');
  await page.keyboard.press(']');
  await settle(page, 500);
  const cam3 = (await el(page)).cam;
  assert.ok(Math.abs(cam3.r - Math.PI / 12) < 1e-6, 'rotated 15°');
  await shot(page, '06-rotated');
  const h = await history(page);
  assert.deepEqual(h.map((x) => x.split(':')[0]), ['pan', 'zoom', 'rotate'], 'two wheel ticks coalesce into one zoom');
  await page.keyboard.press('Control+z');
  await settle(page, 500);
  assert.ok(Math.abs((await el(page)).cam.r) < 1e-6, 'undo rotate');
  await page.keyboard.press('Control+z');
  await settle(page, 500);
  assert.ok(Math.abs((await el(page)).cam.z - cam1.z) < 1e-6, 'undo zoom');
  await page.keyboard.press('Control+z');
  await settle(page, 500);
  const back = (await el(page)).cam;
  assert.ok(Math.abs(back.x - cam0.x) < 0.5 && Math.abs(back.y - cam0.y) < 0.5, 'undo pan');
  await page.keyboard.press('Control+y');
  await settle(page, 400);
  assert.ok(Math.abs((await el(page)).cam.x - cam1.x) < 0.5, 'redo pan');
});

await scenario('keyboard only: arrows walk the diagram, N adds after, Ctrl+Enter chains, Delete + toolbar Undo', async (page) => {
  await page.focus('lode-flow');
  await page.keyboard.press('Tab');
  await E(page, () => document.querySelector('lode-flow').shadowRoot.querySelector('.vp').focus());
  await page.keyboard.press('ArrowRight');
  await settle(page, 200);
  let s = await el(page);
  assert.equal(s.sel.length, 1, 'an arrow selects the item nearest the middle first');
  // Walk to the right-most item.
  for (let i = 0; i < 8; i++) await page.keyboard.press('ArrowRight');
  await settle(page, 300);
  s = await el(page);
  const before = s.doc.nodes.length;
  await page.keyboard.press('n');
  await settle(page, 300);
  await page.keyboard.type('First consequence');
  await page.keyboard.press('Control+Enter');
  await settle(page, 300);
  await page.keyboard.type('Second consequence');
  await page.keyboard.press('Enter');
  await settle(page, 600);
  s = await el(page);
  assert.equal(s.doc.nodes.length, before + 2);
  const added = s.doc.nodes.slice(-2).map((n) => n.text);
  assert.deepEqual(added, ['First consequence', 'Second consequence']);
  const h = await history(page);
  assert.ok(h.some((x) => x.startsWith("add:Add node after ‘First consequence’")), 'add + typing is one history step');
  await shot(page, '07-chain');
  await page.keyboard.press('Delete');
  await settle(page, 600);
  assert.equal((await el(page)).doc.nodes.length, before + 1);
  const wb = await center(page, '.puck [data-act="undo"]');
  assert.ok(wb, 'the persistent diagram toolbar offers Undo');
  await shot(page, '08-toolbar-undo');
  await page.mouse.click(wb.x, wb.y);
  await settle(page, 600);
  assert.equal((await el(page)).doc.nodes.length, before + 2, 'toolbar Undo restores it');
});

await scenario('double-click empty canvas adds a node there; Escape on an empty new node leaves no trace', async (page) => {
  const n0 = (await el(page)).doc.nodes.length;
  const h0 = (await history(page)).length;
  await page.mouse.dblclick(600, 590);
  await settle(page, 400);
  assert.equal((await el(page)).doc.nodes.length, n0 + 1);
  await page.keyboard.press('Escape');
  await settle(page, 500);
  assert.equal((await el(page)).doc.nodes.length, n0);
  assert.equal((await history(page)).length, h0, 'abandoned node left nothing in history');
});

await scenario('Leaving Edit mode with Esc or a click on the canvas keeps the words and the selection (new node, node, edge label, group title); a second Esc or click deselects', async (page) => {
  const sr = (fn, arg) => E(page, fn, arg);
  const editorOpen = () => sr(() => !!document.querySelector('lode-flow').shadowRoot.querySelector('textarea.ed'));
  const focusVp = () => sr(() => document.querySelector('lode-flow').shadowRoot.querySelector('.vp').focus());
  const emptyPoint = (avoid) => bareSpot(page, avoid ?? null);
  const clickEmpty = async (avoid) => {
    const p = await emptyPoint(avoid);
    assert.ok(p, 'found a bare spot on the canvas');
    await page.mouse.click(p.x, p.y);
    await settle(page, 500);
    return p;
  };
  // A new node: the typed words stay, the node stays selected, and its Add step carries the words.
  const n0 = (await el(page)).doc.nodes.length;
  const h0 = (await history(page)).length;
  const spot = await emptyPoint();
  await page.mouse.dblclick(spot.x, spot.y);
  await settle(page, 400);
  await page.keyboard.type('Kept as typed');
  await page.keyboard.press('Escape');
  await settle(page, 500);
  let s = await el(page);
  const kept = s.doc.nodes.find((n) => n.text === 'Kept as typed');
  assert.ok(kept, 'Esc keeps the new node with its words');
  assert.equal(s.doc.nodes.length, n0 + 1);
  assert.deepEqual(s.sel, [kept.id], 'Esc leaves the new node selected');
  assert.equal(await editorOpen(), false, 'Edit mode is over');
  assert.equal(await shadowActive(page), 'DIV.vp active', 'focus returns to the diagram');
  let hist = await history(page);
  assert.equal(hist.length, h0 + 1, 'adding, typing and Esc are one step');
  assert.match(hist.at(-1), /^add:Add node .Kept as typed.$/);
  await page.keyboard.press('ControlOrMeta+z');
  await settle(page, 500);
  assert.ok(!(await el(page)).doc.nodes.some((n) => n.id === kept.id), 'one undo takes the new node back');
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await settle(page, 500);
  s = await el(page);
  assert.equal(s.doc.nodes.find((n) => n.id === kept.id)?.text, 'Kept as typed', 'redo brings it back with its words');
  assert.deepEqual(s.sel, [kept.id]);
  await page.keyboard.press('Escape');
  await settle(page, 300);
  assert.deepEqual((await el(page)).sel, [], 'a second Esc deselects all');
  assert.equal((await history(page)).at(-1), 'select:Deselect all');
  // An existing node: the new words stay and it stays selected; one undo brings back the old words.
  const old = s.doc.nodes.find((n) => n.id === 'trust').text;
  await sr(() => document.querySelector('lode-flow').select(['trust']));
  await focusVp();
  await page.keyboard.press('Enter');
  await settle(page, 300);
  assert.equal(await shadowActive(page), 'TEXTAREA.ed');
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('Trust erodes');
  await page.keyboard.press('Escape');
  await settle(page, 500);
  s = await el(page);
  assert.equal(s.doc.nodes.find((n) => n.id === 'trust').text, 'Trust erodes', 'Esc keeps the edit');
  assert.deepEqual(s.sel, ['trust'], 'and the node stays selected');
  hist = await history(page);
  assert.match(hist.at(-1), /^edit:Edit .?Trust erodes.?$/);
  await page.keyboard.press('ControlOrMeta+z');
  await settle(page, 500);
  s = await el(page);
  assert.equal(s.doc.nodes.find((n) => n.id === 'trust').text, old, 'one undo restores the old words');
  assert.deepEqual(s.sel, ['trust']);
  // Esc with nothing typed only leaves Edit mode: no step, still selected.
  const h1 = (await history(page)).length;
  await focusVp();
  await page.keyboard.press('Enter');
  await settle(page, 300);
  await page.keyboard.press('Escape');
  await settle(page, 300);
  s = await el(page);
  assert.equal(s.doc.nodes.find((n) => n.id === 'trust').text, old);
  assert.deepEqual(s.sel, ['trust']);
  assert.equal((await history(page)).length, h1, 'nothing to record');
  // A click on the bare canvas also ends the edit, keeps the words and keeps the selection.
  await page.keyboard.press('Enter');
  await settle(page, 300);
  await page.keyboard.press('End');
  await page.keyboard.type(' fast');
  await clickEmpty();
  s = await el(page);
  assert.equal(await editorOpen(), false, 'a click on the canvas ends the edit');
  assert.equal(s.doc.nodes.find((n) => n.id === 'trust').text, `${old} fast`, 'and keeps the words');
  assert.deepEqual(s.sel, ['trust'], 'and keeps the node selected');
  assert.match((await history(page)).at(-1), /^edit:Edit /, 'no Deselect all step');
  await clickEmpty();
  assert.deepEqual((await el(page)).sel, [], 'the next click on the canvas deselects');
  // An edge label, with Esc and with a click.
  const id = edgeId(s.doc, 'slip', 'trust');
  for (const [how, words] of [['Escape', 'quickly'], ['click', 'quickly, then all at once']]) {
    await sr((id) => document.querySelector('lode-flow').select([id]), id);
    await focusVp();
    await page.keyboard.press('Enter');
    await settle(page, 300);
    assert.equal(await shadowActive(page), 'TEXTAREA.ed', '↵ on one edge edits its label');
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type(words);
    if (how === 'Escape') await page.keyboard.press('Escape');
    else await clickEmpty();
    await settle(page, 400);
    s = await el(page);
    assert.equal(s.doc.edges.find((e) => e.id === id).label, words, `${how} keeps the label`);
    assert.deepEqual(s.sel, [id], `${how} keeps the edge selected`);
    assert.match((await history(page)).at(-1), /^edit:Label /);
  }
  // A new group's title, then renaming it with a click away.
  await sr(() => document.querySelector('lode-flow').select(['slip', 'trust']));
  await focusVp();
  await page.keyboard.press('g');
  await settle(page, 300);
  await page.keyboard.type('Fallout');
  await page.keyboard.press('Escape');
  await settle(page, 600);
  s = await el(page);
  const g = s.doc.groups.find((x) => x.text === 'Fallout');
  assert.ok(g, 'Esc keeps the group title');
  assert.equal(s.doc.nodes.filter((n) => n.group === g.id).length, 2);
  assert.deepEqual(s.sel, [g.id], 'the new group stays selected');
  assert.equal(await editorOpen(), false);
  await focusVp();
  await page.keyboard.press('Enter');
  await settle(page, 300);
  await page.keyboard.press('End');
  await page.keyboard.type(' zone');
  await clickEmpty();
  s = await el(page);
  assert.equal(s.doc.groups.find((x) => x.id === g.id).text, 'Fallout zone', 'a click away keeps the title');
  assert.deepEqual(s.sel, [g.id], 'and the group selected');
  // A new node added by double-click, ended by a click elsewhere on the canvas.
  await clickEmpty();
  const where = await emptyPoint();
  await page.mouse.dblclick(where.x, where.y);
  await settle(page, 400);
  await page.keyboard.type('Clicked away');
  await page.waitForTimeout(450);
  await clickEmpty(where);
  s = await el(page);
  const away = s.doc.nodes.find((n) => n.text === 'Clicked away');
  assert.ok(away, 'the new node keeps its words');
  assert.deepEqual(s.sel, [away.id], 'and stays selected');
});

await scenario('every other way out of Edit mode keeps the words, the selection and the keys: a folded group title, N left empty, a chevron, an empty node’s rim, the Layout pill’s rim', async (page) => {
  const sr = (fn, arg) => E(page, fn, arg);
  const editorOpen = () => sr(() => !!document.querySelector('lode-flow').shadowRoot.querySelector('textarea.ed'));
  const focusOn = (ids) => sr((ids) => { const f = document.querySelector('lode-flow'); f.select(ids); f.shadowRoot.querySelector('.vp').focus(); }, ids);
  const keysWork = async (ids) => {
    // Esc deselects only if the keys still reach the diagram.
    await page.keyboard.press('Escape');
    await settle(page, 300);
    assert.deepEqual((await el(page)).sel, [], 'the keys still reach the diagram (Esc deselects)');
    if (ids) await focusOn(ids);
  };
  // A folded group's title (on its card): Esc, then a click on the canvas.
  await focusOn(['planning']);
  await page.keyboard.press('c');
  await settle(page, 600);
  for (const how of ['Escape', 'click']) {
    await focusOn(['planning']);
    await page.keyboard.press('Enter');
    await settle(page, 300);
    assert.equal(await shadowActive(page), 'TEXTAREA.ed', '↵ on a folded group edits its title');
    await page.keyboard.press('End');
    await page.keyboard.type('!');
    if (how === 'Escape') await page.keyboard.press('Escape');
    else { const p = await bareSpot(page); await page.mouse.click(p.x, p.y); }
    await settle(page, 400);
    assert.equal(await editorOpen(), false);
    assert.deepEqual((await el(page)).sel, ['planning'], `${how} keeps the folded group selected`);
  }
  assert.equal((await el(page)).doc.groups.find((g) => g.id === 'planning').text, 'Planning!!');
  // N with nothing typed, then a click on the canvas: the empty node goes and the selection returns to
  // the node N was pressed on, with no Deselect all step.
  await focusOn(['trust']);
  const n0 = (await el(page)).doc.nodes.length;
  await page.keyboard.press('n');
  await settle(page, 400);
  const p1 = await bareSpot(page);
  await page.mouse.click(p1.x, p1.y);
  await settle(page, 500);
  let s = await el(page);
  assert.equal(s.doc.nodes.length, n0, 'the empty node is gone');
  assert.deepEqual(s.sel, ['trust'], 'the selection is back on the node N was pressed on');
  assert.notEqual((await history(page)).at(-1), 'select:Deselect all');
  // The rim of a new node left empty (outside its text box): the node goes, and no ghost is selected.
  await page.keyboard.press('n');
  await settle(page, 500);
  const fresh = (await el(page)).sel[0];
  const rim = await sr((id) => { const r = document.querySelector('lode-flow').shadowRoot.querySelector(`.node[data-id="${id}"]`).getBoundingClientRect(); return { x: r.left + 2, y: r.top + r.height / 2 }; }, fresh);
  await page.mouse.click(rim.x, rim.y);
  await settle(page, 500);
  s = await el(page);
  assert.ok(!s.doc.nodes.some((n) => n.id === fresh), 'the empty node is gone');
  assert.deepEqual(s.sel, ['trust'], 'no missing id is selected; the selection is back on trust');
  // A group's chevron, not editing: it folds the group and the keys stay in the diagram.
  await focusOn(['trust']);
  let chev = await center(page, '.glabel[data-gid="delivery"] .chev');
  await page.mouse.click(chev.x, chev.y);
  await settle(page, 600);
  assert.equal((await el(page)).doc.groups.find((g) => g.id === 'delivery').collapsed, true);
  await keysWork();
  await sr(() => document.querySelector('lode-flow').setAllGroupsCollapsed(false));
  await settle(page, 600);
  // A group's chevron while editing a node: the press ends the edit and still folds the group.
  await focusOn(['trust']);
  await page.keyboard.press('Enter');
  await settle(page, 300);
  await page.keyboard.type(' x');
  chev = await center(page, '.glabel[data-gid="delivery"] .chev');
  await page.mouse.click(chev.x, chev.y);
  await settle(page, 600);
  s = await el(page);
  assert.equal(s.doc.groups.find((g) => g.id === 'delivery').collapsed, true, 'the chevron folds the group');
  assert.ok(s.doc.nodes.find((n) => n.id === 'trust').text.endsWith(' x'), 'the words are kept');
  await keysWork();
  // The Layout pill's rim (not a button) while editing: the edit ends, the node stays selected, keys still work.
  await focusOn(['trust']);
  await page.keyboard.press('Enter');
  await settle(page, 300);
  await page.keyboard.type('y');
  const pill = await sr(() => { const r = document.querySelector('lode-flow').shadowRoot.querySelector('.puck').getBoundingClientRect(); return { x: r.left + 2, y: r.top + r.height / 2 }; });
  await page.mouse.click(pill.x, pill.y);
  await settle(page, 400);
  s = await el(page);
  assert.equal(await editorOpen(), false);
  assert.ok(s.doc.nodes.find((n) => n.id === 'trust').text.endsWith(' xy'), 'the words are kept');
  assert.deepEqual(s.sel, ['trust']);
  await keysWork();
});

await scenario('touch: a tap on the bare canvas ends Edit mode and keeps the item selected; the next tap deselects', async (page) => {
  await E(page, () => { const f = document.querySelector('lode-flow'); f.select(['trust']); f.shadowRoot.querySelector('.vp').focus(); });
  await page.keyboard.press('Enter');
  await settle(page, 300);
  await page.keyboard.type(' now');
  const p = await bareSpot(page);
  await page.touchscreen.tap(p.x, p.y);
  await settle(page, 500);
  let s = await el(page);
  assert.equal(s.doc.nodes.find((n) => n.id === 'trust').text, 'Customers lose trust now');
  assert.deepEqual(s.sel, ['trust'], 'the tap only ends Edit mode');
  await page.waitForTimeout(450);
  await page.touchscreen.tap(p.x, p.y);
  await settle(page, 500);
  assert.deepEqual((await el(page)).sel, [], 'the next tap deselects');
}, { width: 1280, height: 800 }, { hasTouch: true });

{
  // Switching to another window or tab mid-edit. Only new headless Chromium with focus emulation off
  // models losing window focus (the default headless shell never blurs the page), so this one
  // launches its own browser.
  const name = 'switching to another tab mid-edit keeps Edit mode open: on return the typing carries on, and Esc still works';
  if (included(name)) {
    const t0 = Date.now();
    let real;
    try {
      real = await chromium.launch({ channel: 'chromium' });
      const ctx = await real.newContext({ viewport: { width: 1280, height: 800 } });
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(`${base}/examples/standalone.html`);
      await page.waitForFunction(() => document.querySelector('lode-flow')?.layoutInfo && document.querySelector('lode-flow').doc.nodes.length > 0);
      await settle(page, 500);
      await (await ctx.newCDPSession(page)).send('Emulation.setFocusEmulationEnabled', { enabled: false });
      await page.bringToFront();
      await E(page, () => { const f = document.querySelector('lode-flow'); f.select(['trust']); f.shadowRoot.querySelector('.vp').focus(); });
      await page.keyboard.press('Enter');
      await page.keyboard.press('End');
      await page.keyboard.type(' ZZ');
      const other = await ctx.newPage();
      await other.bringToFront();
      await settle(page, 800);
      assert.equal(await E(page, () => document.hasFocus()), false, 'the page really lost focus');
      assert.equal(await E(page, () => !!document.querySelector('lode-flow').shadowRoot.querySelector('textarea.ed')), true, 'Edit mode stays open while away');
      await page.bringToFront();
      await settle(page, 500);
      await page.keyboard.type('Q');
      await page.keyboard.press('Escape');
      await settle(page, 400);
      const s = await el(page);
      assert.equal(s.doc.nodes.find((n) => n.id === 'trust').text, 'Customers lose trust ZZQ', 'typing carried on after the return');
      assert.deepEqual(s.sel, ['trust'], 'Esc ended the edit and kept the node selected');
      await page.keyboard.press('Escape');
      await settle(page, 300);
      assert.deepEqual((await el(page)).sel, [], 'and the keys still reach the diagram');
      assert.deepEqual(errors, []);
      results.push({ name, ok: true, ms: Date.now() - t0 });
      console.log(`✓ ${name}`);
    } catch (err) {
      results.push({ name, ok: false, error: String(err && err.message ? err.message : err) });
      console.log(`✗ ${name}\n  ${err && err.stack ? err.stack.split('\n').slice(0, 8).join('\n  ') : err}`);
    } finally {
      await real?.close();
    }
  }
}

await scenario('Delete on a selected edge: a click that wobbles still selects, hover stays grey, and pressing a control keeps the keys in the diagram', async (page) => {
  const sr = (fn, arg) => E(page, fn, arg);
  let s = await el(page);
  const id = edgeId(s.doc, 'slip', 'trust');
  // A click that wobbles 6 px (a firm trackpad press) selects the edge instead of panning.
  let m = await edgeMid(page, id);
  await page.mouse.move(m.x, m.y);
  await page.mouse.down();
  await page.mouse.move(m.x + 5, m.y + 3, { steps: 3 });
  await page.mouse.up();
  await settle(page, 300);
  assert.deepEqual((await el(page)).sel, [id], 'a wobbly click selects the edge');
  // Hover is a darker grey, never the selection blue.
  // An edge that does not touch the selected one's ends, so it is plain (not hot).
  const other = s.doc.edges.find((e) => ![e.from, e.to].some((n) => n === 'slip' || n === 'trust'));
  const look = await sr((oid) => {
    const f = document.querySelector('lode-flow');
    const paths = [...f.shadowRoot.querySelectorAll('path.edge')];
    const i = f.doc.edges.findIndex((e) => e.id === oid);
    const p = paths[i];
    p.classList.add('hover');
    const cs = getComputedStyle(p);
    const out = { stroke: cs.stroke, width: cs.strokeWidth, hot: p.classList.contains('hot'), sel: getComputedStyle(paths[f.doc.edges.findIndex((e) => e.id === f.selection[0])]).stroke };
    p.classList.remove('hover');
    return out;
  }, other.id);
  const rgb = (c) => c.match(/[\d.]+/g).slice(0, 3).map(Number);
  const [r, g, b] = rgb(look.stroke);
  assert.ok(!look.hot && Math.max(r, g, b) - Math.min(r, g, b) < 30, `hover is grey, got ${look.stroke}`);
  assert.notEqual(look.stroke, look.sel, 'hover never looks selected');
  assert.equal(look.width, '2.6px');
  await page.keyboard.press('Backspace');
  await settle(page, 400);
  s = await el(page);
  assert.ok(!s.doc.edges.some((e) => e.id === id), '⌫ deletes the selected edge');
  await page.keyboard.press('ControlOrMeta+z');
  await settle(page, 500);
  assert.ok((await el(page)).doc.edges.some((e) => e.id === id), 'undo brings it back');
  // Pressing Select edge on a node's controls keeps keyboard focus on the diagram, so ⌫ still deletes.
  await sr(() => { const f = document.querySelector('lode-flow'); f.select(['trust']); f.shadowRoot.querySelector('.vp').focus(); });
  await settle(page, 400);
  const btn = await center(page, '.node-magnet [data-act="nextedge"]');
  await page.mouse.click(btn.x, btn.y);
  await settle(page, 400);
  s = await el(page);
  assert.equal(s.sel.length, 1);
  const picked = s.sel[0];
  assert.ok(s.doc.edges.some((e) => e.id === picked), 'Select edge selects an edge');
  assert.match(await shadowActive(page), /^DIV\.vp /, 'the press left the keys in the diagram');
  await page.keyboard.press('Backspace');
  await settle(page, 400);
  assert.ok(!(await el(page)).doc.edges.some((e) => e.id === picked), '⌫ after Select edge deletes that edge');
  // The Delete button too: ⌘Z right after it still reaches the diagram.
  await page.keyboard.press('ControlOrMeta+z');
  await settle(page, 500);
  await sr((pid) => document.querySelector('lode-flow').select([pid]), picked);
  await settle(page, 400);
  const del = await center(page, '.node-magnet [data-act="delete"]');
  await page.mouse.click(del.x, del.y);
  await settle(page, 400);
  assert.ok(!(await el(page)).doc.edges.some((e) => e.id === picked), 'the Delete button deletes the edge');
  assert.match(await shadowActive(page), /^DIV\.vp /);
  await page.keyboard.press('ControlOrMeta+z');
  await settle(page, 500);
  assert.ok((await el(page)).doc.edges.some((e) => e.id === picked), '⌘Z after the Delete button undoes it');
});

await scenario('shift-drag box-selects; G groups and names; C collapses to one node; undo expands', async (page) => {
  const a = await center(page, '.node[data-id="slip"]');
  const b = await center(page, '.node[data-id="trust"]');
  await page.keyboard.down('Shift');
  await page.mouse.move(a.x - a.w / 2 - 12, Math.min(a.y, b.y) - 40);
  await page.mouse.down();
  await page.mouse.move(b.x + b.w / 2 + 12, Math.max(a.y, b.y) + 40, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await settle(page, 300);
  const sel = (await el(page)).sel.sort();
  assert.deepEqual(sel, ['slip', 'trust'].sort());
  await page.keyboard.press('g');
  await settle(page, 300);
  await page.keyboard.type('Fallout');
  await page.keyboard.press('Enter');
  await settle(page, 600);
  let s = await el(page);
  const g = s.doc.groups.find((x) => x.text === 'Fallout');
  assert.ok(g, 'group created and named');
  assert.equal(s.doc.nodes.filter((n) => n.group === g.id).length, 2);
  await shot(page, '09-grouped');
  await page.keyboard.press('c');
  await settle(page, 700);
  const hidden = await E(page, () => document.querySelector('lode-flow').shadowRoot.querySelector('.node[data-id="slip"]').style.visibility);
  assert.equal(hidden, 'hidden', 'members hide inside the collapsed group');
  assert.ok(await center(page, `.proxy[data-gid="${g.id}"]`), 'collapsed group drawn as one node');
  await shot(page, '10-collapsed');
  await page.keyboard.press('Control+z');
  await settle(page, 700);
  s = await el(page);
  assert.equal(s.doc.groups.find((x) => x.id === g.id).collapsed, false);
});

await scenario('layout magnet: orientation, bias, density are undoable; panel stays open while applying', async (page) => {
  await page.keyboard.press('Tab');
  await E(page, () => document.querySelector('lode-flow').shadowRoot.querySelector('.vp').focus());
  await page.keyboard.press('/');
  await settle(page, 300);
  const tb = await center(page, '.panel button[data-v="tb"]');
  await page.mouse.click(tb.x, tb.y);
  await settle(page, 700);
  assert.equal((await el(page)).info.orientation, 'tb');
  assert.ok(await center(page, '.panel button[data-v="end"]'), 'panel still open after applying');
  const end = await center(page, '.panel button[data-v="end"]');
  await page.mouse.click(end.x, end.y);
  await settle(page, 700);
  assert.equal((await el(page)).doc.settings.bias, 'end');
  await shot(page, '11-panel-tb-end');
  const radial = await center(page, '.panel button[data-v="in-out"]');
  await page.mouse.click(radial.x, radial.y);
  await settle(page, 800);
  assert.equal((await el(page)).info.orientation, 'in-out');
  await page.keyboard.press('Escape');
  await settle(page, 300);
  await shot(page, '12-radial');
  await page.keyboard.press('Control+z');
  await settle(page, 700);
  assert.equal((await el(page)).info.orientation, 'tb');
  await page.keyboard.press('Control+z');
  await settle(page, 700);
  assert.equal((await el(page)).doc.settings.bias, 'start');
});

await scenario('help lists every gesture; Escape closes it', async (page) => {
  await E(page, () => document.querySelector('lode-flow').shadowRoot.querySelector('.vp').focus());
  await page.keyboard.press('?');
  await settle(page, 300);
  const rows = await E(page, () => document.querySelector('lode-flow').shadowRoot.querySelectorAll('.help tr').length);
  assert.ok(rows >= 20, `help has ${rows} rows`);
  await shot(page, '13-help');
  await page.keyboard.press('Escape');
  await settle(page, 200);
  assert.equal(await E(page, () => document.querySelector('lode-flow').shadowRoot.querySelector('.help').hidden), true);
});

await scenario('content and history survive a reload with storage-key', async (page) => {
  await E(page, () => {
    localStorage.clear();
    const f = document.querySelector('lode-flow');
    f.setAttribute('storage-key', 'e2e');
  });
  const b = await center(page, '.node[data-id="wip"]');
  await page.mouse.click(b.x, b.y);
  await settle(page, 200);
  await page.keyboard.press('Delete');
  await settle(page, 500);
  await page.reload();
  await page.waitForFunction(() => document.querySelector('lode-flow')?.layoutInfo);
  await E(page, () => document.querySelector('lode-flow').setAttribute('storage-key', 'e2e'));
  // The example page does not set storage-key itself, so load explicitly. Since 2026-10-01 the
  // document and its history are saved under two keys, tied by a revision stamp.
  const keys = await E(page, () => Object.keys(localStorage).sort());
  assert.deepEqual(keys, ['lodeflow:e2e', 'lodeflow:e2e:history']);
  // Each distinct document is stored once; entries refer to it (a selection does not change it).
  const saved = await E(page, () => JSON.parse(localStorage.getItem('lodeflow:e2e:history')).history);
  assert.equal(saved.v, 2);
  assert.ok(saved.docs.length < 2 * saved.entries.length, `${saved.docs.length} documents for ${saved.entries.length} entries`);
  await E(page, () => {
    const st = JSON.parse(localStorage.getItem('lodeflow:e2e'));
    const h = JSON.parse(localStorage.getItem('lodeflow:e2e:history'));
    if (h.rev === st.rev) st.history = h.history;
    document.querySelector('lode-flow').setState(st);
  });
  await settle(page, 500);
  let s = await el(page);
  assert.ok(!s.doc.nodes.some((n) => n.id === 'wip'), 'deletion persisted');
  assert.ok(s.undo, 'history persisted');
  await E(page, () => document.querySelector('lode-flow').undo());
  await settle(page, 500);
  s = await el(page);
  assert.ok(s.doc.nodes.some((n) => n.id === 'wip'), 'undo after reload restores');
});

await scenario('readonly: no editing controls, but selection and view still work (and undo)', async (page) => {
  await E(page, () => document.querySelector('lode-flow').setAttribute('readonly', ''));
  await settle(page, 300);
  const b = await center(page, '.node[data-id="slip"]');
  await page.mouse.click(b.x, b.y);
  await settle(page, 300);
  await page.mouse.click(b.x, b.y);
  await settle(page, 300);
  assert.equal(await E(page, () => !!document.querySelector('lode-flow').shadowRoot.querySelector('textarea')), false, 'no editor');
  assert.equal(await center(page, '.node-magnet [data-act="delete"]'), null, 'no delete');
  assert.equal(await center(page, '.node-magnet [data-act="link"]'), null, 'no link');
  assert.ok(await center(page, '.node-magnet [data-act="nextedge"]'), 'stepping through edges only moves the selection, so it is offered');
  await page.keyboard.press('Delete');
  await settle(page, 300);
  assert.ok((await el(page)).doc.nodes.some((n) => n.id === 'slip'));
  await page.keyboard.press('Control+z');
  await settle(page, 300);
  assert.deepEqual((await el(page)).sel, []);
  assert.equal(await center(page, '.puck [data-act="addnode"]'), null, 'no Add node in a read-only toolbar');
});

await scenario('after a click on a control that then redraws or hides, the diagram’s keys still work', async (page) => {
  const doc = () => el(page).then((s) => s.doc);
  // Collapse on the selection's controls, then C expands again.
  const gid = (await doc()).groups[0].id;
  await E(page, (g) => document.querySelector('lode-flow').select([g]), gid);
  await settle(page, 400);
  let b = await center(page, '.node-magnet [data-act="collapse"]');
  await page.mouse.click(b.x, b.y);
  await settle(page, 400);
  assert.equal((await doc()).groups.find((g) => g.id === gid).collapsed, true);
  await page.keyboard.press('c');
  await settle(page, 400);
  assert.equal((await doc()).groups.find((g) => g.id === gid).collapsed, false, 'C after clicking Collapse');
  // Delete on the selection's controls (they go away with the selection), then undo by key.
  const n = await center(page, '.node[data-id="slip"]');
  await page.mouse.click(n.x, n.y);
  await settle(page, 300);
  b = await center(page, '.node-magnet [data-act="delete"]');
  await page.mouse.click(b.x, b.y);
  await settle(page, 500);
  assert.ok(!(await doc()).nodes.some((x) => x.id === 'slip'));
  await page.keyboard.press('Control+z');
  await settle(page, 500);
  assert.ok((await doc()).nodes.some((x) => x.id === 'slip'), 'Ctrl+Z after clicking Delete');
  // Undo on the corner pill (it redraws with the next step's name), then undo again by key.
  await page.keyboard.press('Delete');
  await settle(page, 500);
  await page.keyboard.press('ArrowRight');
  await settle(page, 300);
  b = await center(page, '.puck [data-act="undo"]');
  await page.mouse.click(b.x, b.y);
  await settle(page, 400);
  await page.keyboard.press('Control+z');
  await settle(page, 500);
  assert.ok((await doc()).nodes.some((x) => x.id === 'slip'), 'Ctrl+Z after clicking the pill’s Undo');
  // Undo after deletion on the persistent toolbar, then Delete by key.
  await page.keyboard.press('Delete');
  await settle(page, 500);
  b = await center(page, '.puck [data-act="undo"]');
  await page.mouse.click(b.x, b.y);
  await settle(page, 400);
  await page.keyboard.press('Delete');
  await settle(page, 500);
  assert.ok(!(await doc()).nodes.some((x) => x.id === 'slip'), 'Delete after clicking the toolbar’s Undo');
});

await scenario('wheel over the page does not get trapped until the diagram has focus', async (page) => {
  await E(page, () => document.activeElement && document.activeElement.blur());
  const cam0 = (await el(page)).cam;
  await page.mouse.move(640, 400);
  await page.mouse.wheel(0, 300);
  await settle(page, 300);
  assert.deepEqual((await el(page)).cam, cam0, 'unfocused wheel leaves the diagram alone');
  await page.mouse.click(640, 596);
  await page.mouse.wheel(0, 120);
  await settle(page, 300);
  assert.notDeepEqual((await el(page)).cam, cam0, 'focused wheel pans');
});

// ---------- connecting existing nodes (Al's answers to Q1/Q2, 2026-09-30) ----------

await scenario('mouse drag from a node to a node links them; the new edge is selected; one undo removes it', async (page) => {
  const a = await center(page, '.node[data-id="estimates"]');
  const b = await center(page, '.node[data-id="trust"]');
  const cam0 = (await el(page)).cam;
  await drag(page, a, b, {
    hold: async () => {
      assert.deepEqual((await el(page)).cam, cam0, 'dragging from a node does not pan');
      const mid = await E(page, () => {
        const r = document.querySelector('lode-flow').shadowRoot;
        return { line: r.querySelector('.linkline').getAttribute('d'), ok: r.querySelector('.linkline').classList.contains('ok'), mark: r.querySelector('.node[data-id="trust"]').classList.contains('link-ok') };
      });
      assert.ok(mid.line && mid.ok && mid.mark, 'mid-drag: a solid rubber band ends at the marked target');
      await shot(page, '14-link-drag');
    },
  });
  await settle(page, 700);
  const s = await el(page);
  const id = edgeId(s.doc, 'estimates', 'trust');
  assert.ok(id, 'edge estimates → trust exists');
  assert.deepEqual(s.sel, [id], 'the new edge is selected');
  assert.ok((await history(page)).at(-1).startsWith('link:Link ‘Estimates are guesses’ → ‘Customers lose trust’'));
  assertNoOverlap(await boxes(page));
  assert.equal(await E(page, () => document.querySelector('lode-flow').shadowRoot.querySelector('.linkline').getAttribute('d')), '', 'rubber band gone');
  await page.keyboard.press('Control+z');
  await settle(page, 600);
  assert.equal(edgeId((await el(page)).doc, 'estimates', 'trust'), undefined, 'undo removes the link');
  // Dropping on nothing, or on a node it already links to, changes nothing.
  const n0 = (await history(page)).length;
  await drag(page, a, { x: a.x, y: a.y + 170 });
  const c = await center(page, '.node[data-id="pressure"]');
  await drag(page, a, c);
  await settle(page, 400);
  assert.equal((await history(page)).length, n0, 'no history for a cancelled or refused link');
  assert.match(await E(page, () => document.querySelector('lode-flow').shadowRoot.querySelector('.nudge').textContent), /Already linked/);
});

await scenario('a link held near the frame’s edge eases the view that way: a quick pass does not move it, a still pointer keeps it moving, it stops at the diagram, the far node links, and the pan is its own undo step', async (page) => {
  const f = await E(page, () => {
    const r = document.querySelector('lode-flow').getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  const right = f.x + f.w;
  await E(page, () => document.querySelector('lode-flow').shadowRoot.querySelector('.vp').focus());
  // Keep the fixture's source visible and target offscreen independently of the zoom key step.
  await E(page, () => {
    const flow = document.querySelector('lode-flow');
    flow.setState({ view: { cam: { ...flow.camera, z: flow.camera.z * 1.953125 }, follow: false } });
  });
  await settle(page, 900);
  // System fonts can change the sample's heights. Center the source/target pair
  // vertically so both cards fit and the sideways hold avoids the vertical bands.
  await E(page, () => {
    const flow = document.querySelector('lode-flow');
    const frame = flow.getBoundingClientRect();
    const source = flow.shadowRoot.querySelector('.node[data-id="slip"]').getBoundingClientRect();
    const target = flow.shadowRoot.querySelector('.node[data-id="parallel"]').getBoundingClientRect();
    const pairCenter = (Math.min(source.top, target.top) + Math.max(source.bottom, target.bottom)) / 2;
    flow.setState({ view: { cam: { ...flow.camera, y: flow.camera.y + (pairCenter - frame.y - frame.height / 2) / flow.camera.z }, follow: false } });
  });
  await settle(page, 500);
  const slip = await center(page, '.node[data-id="slip"]');
  let par = await center(page, '.node[data-id="parallel"]');
  assert.ok(slip.x - slip.w / 2 > f.x && slip.x + slip.w / 2 < right, 'the source is in view');
  assert.ok(slip.y - slip.h / 2 > f.y && slip.y + slip.h / 2 < f.y + f.h, 'the source is vertically in view');
  assert.ok(par.y > f.y + 80 && par.y < f.y + f.h - 80, 'the target stays away from vertical edge bands');
  assert.ok(par.x - par.w / 2 > right, 'the target starts out of view, past the right edge');
  const cam0 = (await el(page)).cam;
  const h0 = (await history(page)).length;
  const camNow = async () => (await el(page)).cam;
  const lineEnd = () =>
    E(page, () => {
      const l = document.querySelector('lode-flow').shadowRoot.querySelector('.linkline');
      if (!l.getAttribute('d')) return null;
      const p = l.getPointAtLength(l.getTotalLength());
      const m = l.getScreenCTM();
      return { x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f };
    });

  // Start a link, then cross the edge band in one quick move: the view barely moves.
  await page.mouse.move(slip.x, slip.y);
  await page.mouse.down();
  await page.mouse.move(slip.x + 40, par.y, { steps: 6 });
  const a = await camNow();
  await page.mouse.move(right - 10, par.y);
  await page.mouse.move(right - 200, par.y);
  await settle(page, 150);
  const b = await camNow();
  assert.ok(Math.abs(b.x - a.x) * b.z < 3, `a quick pass through the band moves the view under 3 px (moved ${((b.x - a.x) * b.z).toFixed(2)})`);

  // Hold still in the band: the view keeps moving right, and the loose end stays under the pointer.
  const hold = { x: right - 6, y: par.y };
  await page.mouse.move(hold.x, hold.y, { steps: 4 });
  await settle(page, 350);
  const c1 = await camNow();
  await settle(page, 300);
  const c2 = await camNow();
  assert.ok((c2.x - c1.x) * c2.z > 60, `a still pointer keeps panning (moved ${((c2.x - c1.x) * c2.z).toFixed(1)} px in 300 ms)`);
  assert.ok(Math.abs(c2.y - c1.y) < 1e-6, 'only sideways');
  const end = await lineEnd();
  if (end && !(await E(page, () => document.querySelector('lode-flow').shadowRoot.querySelector('.linkline').classList.contains('ok'))))
    assert.ok(Math.hypot(end.x - hold.x, end.y - hold.y) < 2, 'the rubber band ends under the pointer while the view moves');

  // Keep holding: the pan slows and stops once the diagram's far side is in view, 16 px inside.
  let prev = await camNow();
  for (let i = 0; i < 40; i++) {
    await settle(page, 200);
    const c = await camNow();
    if (Math.abs(c.x - prev.x) * c.z < 0.05) break;
    prev = c;
  }
  await settle(page, 300);
  const stopped = await camNow();
  assert.ok(Math.abs(stopped.x - prev.x) * stopped.z < 0.05, 'the pan stops');
  par = await center(page, '.node[data-id="parallel"]');
  const parRight = par.x + par.w / 2;
  assert.ok(parRight <= right - 15 && parRight > right - 80, `it stops with the diagram’s far side just inside the frame (${(right - parRight).toFixed(1)} px from the edge)`);
  assert.ok((await center(page, '.node[data-id="slip"]')).x < slip.x, 'the source slid left with the view');

  // Move onto the far node: it is marked, the view stays put, and dropping links it.
  await page.mouse.move(par.x, par.y, { steps: 6 });
  await settle(page, 200);
  const c3 = await camNow();
  await settle(page, 250);
  assert.deepEqual(await camNow(), c3, 'off the band, the view is still');
  assert.ok(await E(page, () => document.querySelector('lode-flow').shadowRoot.querySelector('.node[data-id="parallel"]').classList.contains('link-ok')), 'the far node is marked to link');
  await page.mouse.up();
  await settle(page, 700);
  let s = await el(page);
  const id = edgeId(s.doc, 'slip', 'parallel');
  assert.ok(id, 'edge slip → parallel exists');
  assert.deepEqual(s.sel, [id], 'the new edge is selected');
  const h = await history(page);
  assert.equal(h.length, h0 + 2, 'two steps: the pan, then the link');
  assert.equal(h.at(-2), 'pan:Pan');
  assert.ok(h.at(-1).startsWith('link:Link'), h.at(-1));

  // Undo takes the link away and leaves the view; undo again returns the view.
  const camLinked = s.cam;
  await page.keyboard.press('Control+z');
  await settle(page, 700);
  s = await el(page);
  assert.equal(edgeId(s.doc, 'slip', 'parallel'), undefined, 'first undo removes the link');
  // The layout changes back and, as for any undo, the view keeps a neighbourhood still, so the
  // camera shifts a little; the far side the pan reached stays in view.
  const parBack = await center(page, '.node[data-id="parallel"]');
  assert.ok(parBack.x - parBack.w / 2 >= f.x && parBack.x + parBack.w / 2 <= right, 'and leaves the view at the far side the pan reached');
  await page.keyboard.press('Control+z');
  await settle(page, 700);
  s = await el(page);
  assert.ok(Math.abs(s.cam.x - cam0.x) < 0.5 && Math.abs(s.cam.y - cam0.y) < 0.5 && Math.abs(s.cam.z - cam0.z) < 1e-6, 'second undo returns the view');

  // Esc mid-pan cancels the link and keeps the view where it went, as one Pan step.
  const slip2 = await center(page, '.node[data-id="slip"]');
  await page.mouse.move(slip2.x, slip2.y);
  await page.mouse.down();
  await page.mouse.move(slip2.x - 40, slip2.y - 60, { steps: 6 });
  await page.mouse.move(f.x + 4, slip2.y - 60, { steps: 8 });
  await settle(page, 500);
  await page.keyboard.press('Escape');
  const esc = await camNow();
  assert.ok(esc.x < cam0.x - 20 / esc.z, 'the left edge panned left');
  await settle(page, 300);
  assert.ok(Math.abs((await camNow()).x - esc.x) < 1e-6, 'after Esc the view stays where it went');
  await page.mouse.up();
  await settle(page, 300);
  const h2 = await history(page);
  assert.equal(h2.length, h0 + 1, 'Esc records the pan as one step (replacing the undone pan and link)');
  assert.equal(h2.at(-1), 'pan:Pan');
  assert.equal(await E(page, () => document.querySelector('lode-flow').shadowRoot.querySelector('.linkline').getAttribute('d')), '', 'no rubber band after Esc');
  assert.equal((await el(page)).doc.edges.length, s.doc.edges.length, 'no link');
});

await scenario('⌥⌘Z express rewind skips zoom and keeps the view; ⇧⌥⌘Z fast-forwards in that view; the zoom-out moves ahead of the link in the history', async (page) => {
  const a = await center(page, '.node[data-id="estimates"]');
  const b = await center(page, '.node[data-id="trust"]');
  await drag(page, a, b);
  await settle(page, 700);
  let s = await el(page);
  const id = edgeId(s.doc, 'estimates', 'trust');
  assert.ok(id, 'linked by drag');
  const linkLabel = (await history(page)).at(-1);
  assert.ok(linkLabel.startsWith('link:'), linkLabel);
  // Zoom out (one coalesced Zoom step).
  await E(page, () => document.querySelector('lode-flow').shadowRoot.querySelector('.vp').focus());
  const zIn = s.cam.z;
  await page.keyboard.press('-');
  await page.keyboard.press('-');
  await settle(page, 700);
  const out = (await el(page)).cam;
  assert.ok(out.z < zIn, 'zoomed out');
  const h1 = await history(page);
  assert.ok(h1.at(-1).startsWith('zoom:') && h1.at(-2) === linkLabel, 'history: link, then zoom');
  // Express rewind: the link goes, the view stays zoomed out.
  await page.keyboard.press('Control+Alt+KeyZ');
  await settle(page, 700);
  s = await el(page);
  assert.equal(edgeId(s.doc, 'estimates', 'trust'), undefined, 'rewind takes the link away');
  // (The layout changes back and, as for any undo, the view keeps a neighbourhood still, so x/y may shift a little.)
  assert.ok(Math.abs(s.cam.z - out.z) < 1e-9 && Math.abs(s.cam.r - out.r) < 1e-9, 'and leaves the view zoomed out');
  const h2 = await history(page);
  assert.equal(h2.length, h1.length, 'no step added or lost');
  assert.ok(h2.at(-2).startsWith('zoom:') && h2.at(-1) === linkLabel, 'the zoom-out now comes before the link');
  assert.equal(s.redo, true, 'the link is there to redo');
  assert.equal(await E(page, () => document.querySelector('lode-flow').hist.peekRedo()?.label), linkLabel.slice(5), 'next redo is the link');
  // Express fast-forward: the link comes back in the zoomed-out view.
  await page.keyboard.press('Control+Alt+Shift+KeyZ');
  await settle(page, 700);
  s = await el(page);
  assert.ok(edgeId(s.doc, 'estimates', 'trust'), 'fast-forward brings the link back');
  assert.ok(Math.abs(s.cam.z - out.z) < 1e-9, 'in the same zoomed-out view');
  // Plain undo now takes the link, then the zoom.
  await page.keyboard.press('Control+z');
  await settle(page, 700);
  s = await el(page);
  assert.equal(edgeId(s.doc, 'estimates', 'trust'), undefined, '⌘Z takes the link');
  assert.ok(Math.abs(s.cam.z - out.z) < 1e-9, 'without zooming');
  await page.keyboard.press('Control+z');
  await settle(page, 700);
  assert.ok(Math.abs((await el(page)).cam.z - zIn) < 1e-9, 'the next ⌘Z takes the zoom-out');
  // With only camera moves left before the cursor, rewind says so and changes nothing.
  await page.keyboard.press('Control+Shift+z');
  await settle(page, 600);
  const n = (await history(page)).length;
  const cam = (await el(page)).cam;
  await page.keyboard.press('Control+Alt+KeyZ');
  await settle(page, 200);
  assert.match(await E(page, () => document.querySelector('lode-flow').shadowRoot.querySelector('.nudge').textContent), /Nothing to rewind but camera moves/);
  assert.deepEqual((await el(page)).cam, cam, 'nothing moved');
  assert.equal((await history(page)).length, n, 'nothing recorded');
});

await scenario('dropping a link on an edge merges them: one junction, one shared label; undo unmerges', async (page) => {
  let s = await el(page);
  const trunk = edgeId(s.doc, 'cycle', 'slip');
  const a = await center(page, '.node[data-id="estimates"]');
  await drag(page, a, await edgeMid(page, trunk));
  await settle(page, 800);
  s = await el(page);
  assert.equal(s.doc.junctions.length, 1, 'one junction');
  const j = s.doc.junctions[0].id;
  const t = s.doc.edges.find((e) => e.id === trunk);
  assert.deepEqual([t.from, t.to], [j, 'slip'], 'the edge keeps its id as the shared trunk');
  assert.deepEqual(s.doc.edges.filter((e) => e.to === j).map((e) => e.from).sort(), ['cycle', 'estimates']);
  assert.deepEqual(s.sel, [trunk], 'the merge is selected');
  assert.ok(await center(page, '.carrier.dot'), 'a junction dot marks the merge');
  await shot(page, '15-merged');
  // ↵ writes the shared label at the junction.
  await page.keyboard.press('Enter');
  await settle(page, 300);
  assert.equal(await shadowActive(page), 'TEXTAREA.ed');
  await page.keyboard.type('within a quarter');
  await page.keyboard.press('Enter');
  await settle(page, 700);
  s = await el(page);
  assert.equal(s.doc.edges.find((e) => e.id === trunk).label, 'within a quarter');
  assert.equal(await E(page, () => document.querySelector('lode-flow').shadowRoot.querySelector('.carrier.junction').textContent), 'within a quarter');
  assertNoOverlap(await boxes(page));
  await shot(page, '16-merge-labelled');
  // Clicking a branch and editing its label edits the shared one.
  const branch = s.doc.edges.find((e) => e.from === 'estimates' && e.to === j).id;
  const bm = await edgeMid(page, branch);
  await page.mouse.click(bm.x, bm.y);
  await settle(page, 300);
  assert.deepEqual((await el(page)).sel, [branch], 'a branch is selectable on its own');
  await page.keyboard.press('Enter');
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('by next quarter');
  await page.keyboard.press('Enter');
  await settle(page, 500);
  assert.equal((await el(page)).doc.edges.find((e) => e.id === trunk).label, 'by next quarter');
  // Deleting the branch dissolves the merge back into the plain edge, label kept.
  await page.keyboard.press('Delete');
  await settle(page, 700);
  s = await el(page);
  assert.equal(s.doc.junctions.length, 0, 'one cause left: the junction dissolves');
  const back = s.doc.edges.find((e) => e.id === trunk);
  assert.deepEqual([back.from, back.to, back.label], ['cycle', 'slip', 'by next quarter']);
  assert.ok(await center(page, '.puck [data-act="undo"]'), 'toolbar Undo after deleting a branch');
  for (let i = 0; i < 5; i++) await page.keyboard.press('Control+z');
  await settle(page, 800);
  s = await el(page);
  assert.equal(s.doc.junctions.length, 0);
  const orig = s.doc.edges.find((e) => e.id === trunk);
  assert.deepEqual([orig.from, orig.to, orig.label], ['cycle', 'slip', undefined], 'five undos: branch, relabel, selecting the branch, label, merge');
});

await scenario('E opens the link list: nodes, then edges, nearest first; ↓ ↵ link; it stays open with a receipt', async (page) => {
  const w = await center(page, '.node[data-id="wip"]');
  await page.mouse.click(w.x, w.y);
  await settle(page, 300);
  assert.ok(await center(page, '.node-magnet [data-act="link"]'), 'the selection magnet offers Link');
  await page.keyboard.press('e');
  await settle(page, 400);
  assert.equal(await shadowActive(page), 'INPUT.lk-filter', 'the filter has focus');
  const rows = await E(page, () => [...document.querySelector('lode-flow').shadowRoot.querySelectorAll('.lk-list li')].map((li) => li.className.includes('lk-h') ? `# ${li.textContent}` : li.textContent));
  const firstEdge = rows.findIndex((r) => r.startsWith('# Edges'));
  assert.equal(rows[0], '# Nodes');
  assert.ok(firstEdge > 1 && rows.slice(1, firstEdge).every((r) => !r.startsWith('#')), 'nodes first, then edges');
  assert.ok(!rows.includes('More work starts in parallel'), 'already-linked nodes are left out');
  // Nearest first: distances on screen never decrease within a section.
  const d = await E(page, () => {
    const f = document.querySelector('lode-flow');
    const src = f.shadowRoot.querySelector('.node[data-id="wip"]').getBoundingClientRect();
    return f.linker.items.filter((i) => i.kind === 'node').map((i) => {
      const r = f.shadowRoot.querySelector(`.node[data-id="${i.id}"]`).getBoundingClientRect();
      return Math.hypot(r.x + r.width / 2 - src.x - src.width / 2, r.y + r.height / 2 - src.y - src.height / 2);
    });
  });
  assert.ok(d.every((v, i) => i === 0 || v >= d[i - 1] - 0.5), 'nodes sorted nearest to furthest');
  await shot(page, '17-link-list');
  await page.keyboard.type('trust');
  await settle(page, 200);
  await page.keyboard.press('Enter');
  await settle(page, 700);
  let s = await el(page);
  assert.ok(edgeId(s.doc, 'wip', 'trust'), 'linked from the list');
  assert.deepEqual(s.sel, ['wip'], 'the source stays selected');
  const r = await E(page, () => {
    const L = document.querySelector('lode-flow').shadowRoot.querySelector('.linker');
    return { open: !L.hidden, receipt: L.querySelector('.lk-receipt').textContent, filter: L.querySelector('input').value, hasTrust: [...L.querySelectorAll('.lk-item:not(.is-edge)')].some((li) => li.textContent === 'Customers lose trust') };
  });
  assert.ok(r.open, 'the list stays open after linking');
  assert.match(r.receipt, /Linked to ‘Customers lose trust’/);
  assert.equal(r.filter, '');
  assert.ok(!r.hasTrust, 'the new target leaves the list');
  // Down to the first edge, ↵ merges into it.
  const nNodes = await E(page, () => document.querySelector('lode-flow').linker.items.filter((i) => i.kind === 'node').length);
  for (let i = 0; i < nNodes; i++) await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await settle(page, 700);
  s = await el(page);
  assert.equal(s.doc.junctions.length, 1, 'picking an edge merges into it');
  await page.keyboard.press('Escape');
  await settle(page, 200);
  assert.equal(await E(page, () => document.querySelector('lode-flow').shadowRoot.querySelector('.linker').hidden), true, 'Esc closes the list');
  assert.equal(await shadowActive(page), 'DIV.vp active', 'focus returns to the diagram');
});

await scenario('⇧E (or ⇧-click on Link, which ⇧ turns around in place) links nodes or edges into the selection; reopening never doubles a key', async (page) => {
  const t = await center(page, '.node[data-id="trust"]');
  await page.mouse.click(t.x, t.y);
  await settle(page, 300);
  const acts = await E(page, () => [...document.querySelector('lode-flow').shadowRoot.querySelectorAll('.node-magnet .mb:not([hidden])')].map((b) => b.textContent));
  assert.ok(acts.includes('LinkE⇧E') && !acts.some((a) => a.startsWith('Reverse')), `one Link button carries both keys: ${acts}`);
  // Holding ⇧ turns the two-way buttons around in place: same words, nothing on the bar moves.
  const rects = () => E(page, () => [...document.querySelector('lode-flow').shadowRoot.querySelectorAll('.node-magnet, .node-magnet .mb')].map((x) => { const r = x.getBoundingClientRect(); return [x.textContent, Math.round(r.x * 10), Math.round(r.y * 10), Math.round(r.width * 10), Math.round(r.height * 10)].join(' '); }));
  const icon = () => E(page, () => [...document.querySelector('lode-flow').shadowRoot.querySelectorAll('.node-magnet [data-act="link"] .fl svg')].map((x) => getComputedStyle(x).visibility).join(','));
  const at = await rects();
  assert.equal(await icon(), 'visible,hidden');
  await page.keyboard.down('Shift');
  await settle(page, 100);
  assert.deepEqual(await rects(), at, 'holding ⇧ moves nothing and changes no words');
  assert.equal(await icon(), 'hidden,visible', 'holding ⇧ shows the reverse icon');
  await page.keyboard.up('Shift');
  await settle(page, 100);
  assert.equal(await icon(), 'visible,hidden', 'letting go of ⇧ turns it back');
  // ⇧-click on Link opens the reverse list.
  const lb = await center(page, '.node-magnet [data-act="link"]');
  await page.keyboard.down('Shift');
  await page.mouse.click(lb.x, lb.y);
  await page.keyboard.up('Shift');
  await settle(page, 400);
  assert.equal(await E(page, () => document.querySelector('lode-flow').shadowRoot.querySelector('.linker .lk-title').textContent), 'Link … to ‘Customers lose trust’', '⇧-click on Link links into it');
  await page.keyboard.press('Escape');
  await settle(page, 300);
  await page.keyboard.press('Shift+E');
  await settle(page, 400);
  assert.equal(await shadowActive(page), 'INPUT.lk-filter', 'the filter has focus');
  const head = await E(page, () => {
    const f = document.querySelector('lode-flow');
    const L = f.shadowRoot.querySelector('.linker');
    const causes = new Set(f.doc.edges.filter((e) => e.to === 'trust').map((e) => e.from));
    return {
      title: L.querySelector('.lk-title').textContent,
      headers: [...L.querySelectorAll('.lk-h')].map((h) => h.textContent),
      kinds: [...new Set(f.linker.items.map((i) => i.kind))],
      offersACause: f.linker.items.some((i) => causes.has(i.id)),
      offersItself: f.linker.items.some((i) => i.id === 'trust'),
    };
  });
  assert.equal(head.title, 'Link … to ‘Customers lose trust’');
  assert.deepEqual(head.headers, ['Nodes', 'Edges — branch one to this node']);
  assert.deepEqual(head.kinds, ['node', 'edge']);
  assert.ok(!head.offersACause && !head.offersItself, 'nodes that already link into it are left out');
  await shot(page, '17b-reverse-link-list');
  // Closing and reopening the list must not stack its key handling: ↓ moves one row, ↵ links one node.
  await page.keyboard.press('Escape');
  await settle(page, 200);
  assert.deepEqual((await el(page)).sel, ['trust'], 'Esc closes the list and keeps the selection');
  await page.keyboard.press('Shift+E');
  await settle(page, 300);
  await page.keyboard.press('ArrowDown');
  await settle(page, 100);
  assert.equal(await E(page, () => document.querySelector('lode-flow').linker.active), 1, '↓ moves exactly one row on a reopened list');
  const pick = await E(page, () => { const f = document.querySelector('lode-flow'); return f.linker.items[f.linker.active].id; });
  const before = (await el(page)).doc.edges.length;
  await page.keyboard.press('Enter');
  await settle(page, 700);
  let s = await el(page);
  assert.equal(s.doc.edges.length, before + 1, 'one ↵, one new edge');
  assert.ok(edgeId(s.doc, pick, 'trust'), 'the picked node now links into the selected one');
  assert.deepEqual(s.sel, ['trust'], 'the selected node stays selected');
  const receipt = await E(page, () => document.querySelector('lode-flow').shadowRoot.querySelector('.linker .lk-receipt').textContent);
  assert.match(receipt, /^Linked from ‘/);
  assert.ok(!(await E(page, (p) => document.querySelector('lode-flow').linker.items.some((i) => i.id === p), pick)), 'the new cause leaves the list');
  await page.keyboard.press('Control+z');
  await settle(page, 600);
  assert.ok(!edgeId((await el(page)).doc, pick, 'trust'), 'undo from the list takes the link back');
  // E on the same node turns the list around.
  await page.keyboard.press('Escape');
  await settle(page, 200);
  await page.keyboard.press('e');
  await settle(page, 300);
  assert.equal(await E(page, () => document.querySelector('lode-flow').shadowRoot.querySelector('.linker .lk-title').textContent), 'Link ‘Customers lose trust’ to…');
});

await scenario('Add node: contextual N ⇧N on the selection and always on the diagram toolbar; nothing selected adds a free node or picks nodes to link before (↵) or after (⇧↵)', async (page) => {
  const sr = (fn, arg) => E(page, fn, arg);
  const t = await center(page, '.node[data-id="trust"]');
  await page.mouse.click(t.x, t.y);
  await settle(page, 300);
  const acts = await sr(() => [...document.querySelector('lode-flow').shadowRoot.querySelectorAll('.node-magnet .mb:not([hidden])')].map((b) => b.textContent));
  assert.ok(acts.includes('Add nodeN⇧N'), `one Add node button carries both keys: ${acts}`);
  assert.ok(!acts.some((a) => a.startsWith('Add after') || a.startsWith('Add before')), 'no separate Add after / Add before');
  assert.equal(await sr(() => document.querySelector('lode-flow').shadowRoot.querySelectorAll('.node-magnet [data-act="after"] .fl svg').length), 2, 'the same node icon on both sides');
  // A click adds after, a ⇧-click before.
  let s = await el(page);
  const n0 = s.doc.nodes.length;
  await page.mouse.click(...Object.values(await center(page, '.node-magnet [data-act="after"]')).slice(0, 2));
  await settle(page, 400);
  await page.keyboard.type('After trust');
  await page.keyboard.press('Enter');
  await settle(page, 600);
  s = await el(page);
  const after = s.doc.nodes.find((n) => n.text === 'After trust');
  assert.ok(after && edgeId(s.doc, 'trust', after.id), 'a click links the new node after');
  await sr(() => document.querySelector('lode-flow').select(['trust']));
  await settle(page, 300);
  const ab = await center(page, '.node-magnet [data-act="after"]');
  await page.keyboard.down('Shift');
  await page.mouse.click(ab.x, ab.y);
  await page.keyboard.up('Shift');
  await settle(page, 400);
  await page.keyboard.type('Before trust');
  await page.keyboard.press('Enter');
  await settle(page, 600);
  s = await el(page);
  const before = s.doc.nodes.find((n) => n.text === 'Before trust');
  assert.ok(before && edgeId(s.doc, before.id, 'trust'), 'a ⇧-click links the new node before');
  assert.equal(s.doc.nodes.length, n0 + 2);
  // Esc deselects all; Add node moves to the Layout pill.
  await page.keyboard.press('Escape');
  await settle(page, 300);
  assert.deepEqual((await el(page)).sel, [], 'Esc deselects all');
  assert.equal((await history(page)).at(-1), 'select:Deselect all');
  assert.equal(await sr(() => document.querySelector('lode-flow').shadowRoot.querySelector('.node-magnet').hidden), true, 'no selection controls');
  const pill = await center(page, '.puck [data-act="addnode"]');
  assert.ok(pill, 'Add node sits on the Layout pill with nothing selected');
  assert.equal(await sr(() => document.querySelector('lode-flow').shadowRoot.querySelector('.puck [data-act="addnode"]').textContent), 'Add nodeN⇧N');
  await page.mouse.click(pill.x, pill.y);
  await settle(page, 400);
  await page.keyboard.type('Free');
  await page.keyboard.press('Enter');
  await settle(page, 600);
  s = await el(page);
  const free = s.doc.nodes.find((n) => n.text === 'Free');
  assert.ok(free && !s.doc.edges.some((e) => e.from === free.id || e.to === free.id), 'a click on the pill adds an unconnected node');
  // ⇧N with nothing selected opens the node picker, hanging from the pill.
  await page.keyboard.press('Escape');
  await settle(page, 200);
  await page.keyboard.press('Shift+N');
  await settle(page, 400);
  const head = await sr(() => {
    const f = document.querySelector('lode-flow');
    const L = f.shadowRoot.querySelector('.linker');
    const p = f.shadowRoot.querySelector('.puck').getBoundingClientRect();
    const r = L.getBoundingClientRect();
    return { title: L.querySelector('.lk-title').textContent, headers: [...L.querySelectorAll('.lk-h')].map((h) => h.textContent), n: f.linker.items.length, nodes: f.doc.nodes.length, below: r.top >= p.bottom, focus: f.shadowRoot.activeElement?.className };
  });
  assert.equal(head.title, 'Add a node linked to…');
  assert.deepEqual(head.headers, ['Nodes'], 'nodes only');
  assert.equal(head.n, head.nodes, 'every node is offered');
  assert.ok(head.below, 'the list hangs below the Layout pill');
  assert.equal(head.focus, 'lk-filter');
  await shot(page, '17c-add-node-picker');
  // ⌘-click checks a row, ⇧-click checks the run up to another; ↵ links one new node before them all.
  const rowAt = async (i) => center(page, `.linker #lk-${i}`);
  const items = await sr(() => document.querySelector('lode-flow').linker.items.map((x) => x.id));
  const i0 = 1, i1 = 3;
  let r = await rowAt(i0);
  await modClick(page, r, 'ControlOrMeta');
  await settle(page, 150);
  assert.deepEqual(await sr(() => document.querySelector('lode-flow').linker.checked), [`node:${items[i0]}`]);
  assert.equal(await sr(() => document.querySelector('lode-flow').shadowRoot.querySelector('.lk-checked > span').textContent), '1 checked');
  r = await rowAt(i1);
  await modClick(page, r, 'Shift');
  await settle(page, 150);
  const run = items.slice(i0, i1 + 1);
  assert.deepEqual((await sr(() => document.querySelector('lode-flow').linker.checked)).sort(), run.map((x) => `node:${x}`).sort(), '⇧-click checks the run');
  assert.deepEqual(await sr(() => [...document.querySelector('lode-flow').shadowRoot.querySelectorAll('.lk-item[aria-selected="true"]')].map((li) => li.dataset.k)).then((a) => a.sort()), run.map((x) => `node:${x}`).sort(), 'checked rows say so');
  const h0 = (await history(page)).length;
  await page.keyboard.press('Enter');
  await settle(page, 400);
  await page.keyboard.type('Many');
  await page.keyboard.press('Enter');
  await settle(page, 700);
  s = await el(page);
  const many = s.doc.nodes.find((n) => n.text === 'Many');
  assert.ok(many, 'one new node');
  for (const id of run) assert.ok(edgeId(s.doc, many.id, id), `linked before ${id}`);
  assert.equal((await history(page)).length, h0 + 1, 'adding, linking and typing are one undo step');
  assert.equal(await sr(() => !!document.querySelector('lode-flow').linker), false, 'the picker closes once the node is added');
  await page.keyboard.press('ControlOrMeta+z');
  await settle(page, 600);
  s = await el(page);
  assert.ok(!s.doc.nodes.some((n) => n.text === 'Many') && !run.some((id) => s.doc.edges.some((e) => e.to === id && e.from === many.id)), 'one undo takes it all back');
  // ⇧↵ links after.
  await page.keyboard.press('Escape');
  await settle(page, 200);
  await page.keyboard.press('Shift+N');
  await settle(page, 300);
  await page.keyboard.press('ArrowDown');
  const pick = await sr(() => { const f = document.querySelector('lode-flow'); return f.linker.items[f.linker.active].id; });
  await page.keyboard.press('Shift+Enter');
  await settle(page, 400);
  await page.keyboard.type('Follows');
  await page.keyboard.press('Enter');
  await settle(page, 600);
  s = await el(page);
  const follows = s.doc.nodes.find((n) => n.text === 'Follows');
  assert.ok(follows && edgeId(s.doc, pick, follows.id), '⇧↵ links the new node after the picked one');
});

await scenario('link list: ⌘-click checks rows, ⇧↓ and ⌘↵ check from the keys; one pick or the checked bar links them all in one step', async (page) => {
  const sr = (fn, arg) => E(page, fn, arg);
  const t = await center(page, '.node[data-id="trust"]');
  await page.mouse.click(t.x, t.y);
  await settle(page, 300);
  await page.keyboard.press('e');
  await settle(page, 400);
  const items = await sr(() => document.querySelector('lode-flow').linker.items.filter((x) => x.kind === 'node').map((x) => x.id));
  const h0 = (await history(page)).length;
  for (const i of [0, 2]) {
    const r = await center(page, `.linker #lk-${i}`);
    await modClick(page, r, 'ControlOrMeta');
    await settle(page, 120);
  }
  assert.equal(await sr(() => document.querySelector('lode-flow').shadowRoot.querySelector('.lk-checked > span').textContent), '2 checked');
  assert.equal((await history(page)).length, h0, 'checking changes nothing yet');
  const go = await center(page, '.lk-checked [data-act="lk-go"]');
  await page.mouse.click(go.x, go.y);
  await settle(page, 700);
  let s = await el(page);
  assert.ok(edgeId(s.doc, 'trust', items[0]) && edgeId(s.doc, 'trust', items[2]), 'both checked rows linked');
  assert.equal((await history(page)).length, h0 + 1, 'one step');
  assert.match(await sr(() => document.querySelector('lode-flow').shadowRoot.querySelector('.lk-receipt').textContent), /^Linked to ‘.*’ and ‘.*’/);
  assert.deepEqual(await sr(() => document.querySelector('lode-flow').linker.checked), [], 'the checks clear');
  assert.deepEqual(s.sel, ['trust'], 'the list keeps its node selected and stays open');
  await page.keyboard.press('ControlOrMeta+z');
  await settle(page, 600);
  s = await el(page);
  assert.ok(!edgeId(s.doc, 'trust', items[0]) && !edgeId(s.doc, 'trust', items[2]), 'one undo takes both back');
  // Keys: ⌘↵ checks the active row, ⇧↓ checks on the way down, ↵ links them with the active row.
  await sr(() => document.querySelector('lode-flow').shadowRoot.querySelector('.lk-filter').focus());
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ControlOrMeta+Enter');
  await page.keyboard.press('Shift+ArrowDown');
  await settle(page, 150);
  const want = await sr(() => document.querySelector('lode-flow').linker.items.slice(1, 3).map((x) => x.id));
  assert.equal((await sr(() => document.querySelector('lode-flow').linker.checked)).length, 2);
  await page.keyboard.press('Enter');
  await settle(page, 700);
  s = await el(page);
  for (const id of want) assert.ok(edgeId(s.doc, 'trust', id), `keys linked ${id}`);
  await shot(page, '17d-link-list-checked');
});

await scenario('J dives and K surfaces like a tide: Dive opens a collapsed group, Surface closes it again (each its own undo step); ↵ edits one item; L / H link; Esc deselects all', async (page) => {
  const sr = (fn, arg) => E(page, fn, arg);
  await sr(() => {
    const f = document.querySelector('lode-flow');
    f.setDoc({
      nodes: [{ id: 'free', text: 'Free' }, { id: 'o', text: 'In outer', group: 'outer' }, { id: 'a', text: 'In inner', group: 'inner' }, { id: 'b', text: 'Deepest', group: 'deep' }, { id: 'c', text: 'Folded', group: 'shut' }],
      edges: [{ id: 'e1', from: 'free', to: 'o' }, { id: 'e2', from: 'o', to: 'a' }, { id: 'e3', from: 'a', to: 'b' }, { id: 'e4', from: 'b', to: 'c' }],
      groups: [{ id: 'outer', text: 'Outer' }, { id: 'inner', text: 'Inner', parent: 'outer' }, { id: 'deep', text: 'Deep', parent: 'inner' }, { id: 'shut', text: 'Shut', collapsed: true }],
    });
    f.select([]);
    f.shadowRoot.querySelector('.vp').focus();
  });
  await settle(page, 700);
  const sel = async () => (await el(page)).sel;
  const key = async (k) => { await page.keyboard.press(k); await settle(page, 250); return sel(); };
  const shut = async () => (await el(page)).doc.groups.find((g) => g.id === 'shut').collapsed;
  assert.deepEqual(await key('j'), ['free', 'outer', 'shut'], 'nothing selected: J selects the top level');
  assert.deepEqual(await key('j'), ['free', 'o', 'inner', 'c'], 'one level down; the collapsed group opens to reach its node');
  assert.equal(await shut(), false, 'Dive opened ‘Shut’');
  assert.deepEqual((await history(page)).slice(-2), ['collapse:Expand ‘Shut’', 'select:Dive'], 'opening is its own undo step');
  assert.deepEqual(await key('j'), ['free', 'o', 'a', 'deep', 'c']);
  assert.deepEqual(await key('j'), ['free', 'o', 'a', 'b', 'c']);
  const h = (await history(page)).length;
  assert.deepEqual(await key('j'), ['free', 'o', 'a', 'b', 'c'], 'nothing left to dive into');
  assert.equal((await history(page)).length, h, 'and no step recorded');
  assert.deepEqual(await key('k'), ['free', 'o', 'a', 'deep', 'c'], 'the deepest give way to their group');
  assert.deepEqual(await key('k'), ['free', 'o', 'inner', 'c'], 'the level reaches ‘In inner’');
  assert.deepEqual(await key('k'), ['free', 'outer', 'shut'], 'and ‘In outer’ and ‘Folded’');
  assert.equal(await shut(), true, 'surfacing out of the group Dive opened closes it again');
  assert.equal((await el(page)).doc.groups.find((g) => g.id === 'outer').collapsed ?? false, false, 'a group that was already open stays open');
  assert.deepEqual((await history(page)).slice(-2), ['select:Surface', 'collapse:Collapse ‘Shut’'], 'closing is its own undo step, after the selection moved');
  assert.deepEqual(await key('k'), [], 'from the top level, K reaches the diagram itself: nothing selected');
  assert.deepEqual((await history(page)).slice(-1), ['select:Surface'], 'as one Surface step');
  const hr = (await history(page)).length;
  assert.deepEqual(await key('k'), [], 'the diagram itself is as high as it goes');
  assert.equal((await history(page)).length, hr, 'and no step recorded');
  await page.keyboard.press('ControlOrMeta+z');
  await settle(page, 300);
  assert.deepEqual(await sel(), ['free', 'outer', 'shut'], 'one undo goes back down to the top level');
  await page.keyboard.press('ControlOrMeta+z');
  await settle(page, 300);
  assert.equal(await shut(), false, 'the next undo reopens the group');
  assert.deepEqual(await sel(), ['free', 'outer', 'shut'], '…and the selection stays on it');
  await page.keyboard.press('ControlOrMeta+z');
  await settle(page, 300);
  assert.deepEqual(await sel(), ['free', 'o', 'inner', 'c'], 'the next undo steps the selection back');
  assert.deepEqual(await key('Escape'), [], 'Esc deselects all');
  assert.deepEqual(await key('Shift+Enter'), [], '⇧↵ surfaces too: with nothing selected it is already the whole diagram');
  assert.deepEqual(await key('Enter'), ['free', 'outer', 'shut'], 'with nothing selected, ↵ dives to the top level');
  assert.deepEqual(await key('Shift+Enter'), [], '⇧↵ from the top level goes back up to the diagram');
  await key('Enter');
  assert.deepEqual(await key('Enter'), ['free', 'o', 'inner', 'c'], 'with several selected, ↵ dives');
  // One item selected: ↵ edits it, a group included.
  for (const id of ['a', 'inner']) {
    await sr((id) => { const f = document.querySelector('lode-flow'); f.select([id]); f.shadowRoot.querySelector('.vp').focus(); }, id);
    await settle(page, 250);
    await page.keyboard.press('Enter');
    await settle(page, 300);
    assert.equal(await shadowActive(page), 'TEXTAREA.ed', `↵ on ${id} edits it`);
    await page.keyboard.press('Escape');
    await settle(page, 300);
  }
  // A lone group: Rename ↵ and the two-way Dive J K button.
  await sr(() => { const f = document.querySelector('lode-flow'); f.select(['inner']); f.shadowRoot.querySelector('.vp').focus(); });
  await settle(page, 300);
  const acts = await sr(() => [...document.querySelector('lode-flow').shadowRoot.querySelectorAll('.node-magnet .mb:not([hidden])')].map((b) => b.textContent));
  assert.ok(acts.includes('Rename↵') && acts.includes('DiveJK'), `group controls: ${acts}`);
  const dv = await center(page, '.node-magnet [data-act="dive"]');
  await page.mouse.click(dv.x, dv.y);
  await settle(page, 300);
  assert.deepEqual(await sel(), ['a', 'deep'], 'Dive selects what is inside');
  await modClick(page, await center(page, '.node-magnet [data-act="dive"]'), 'Shift');
  await settle(page, 300);
  assert.deepEqual(await sel(), ['inner'], '⇧-click on Dive surfaces');
  // L links onward (E), H links back (⇧E); F shows the selection.
  await sr(() => { const f = document.querySelector('lode-flow'); f.select(['o']); f.shadowRoot.querySelector('.vp').focus(); });
  await settle(page, 300);
  const title = () => sr(() => document.querySelector('lode-flow').shadowRoot.querySelector('.linker .lk-title')?.textContent ?? null);
  await page.keyboard.press('l');
  await settle(page, 300);
  assert.equal(await title(), 'Link ‘In outer’ to…', 'L is E');
  await page.keyboard.press('Escape');
  await settle(page, 200);
  await page.keyboard.press('h');
  await settle(page, 300);
  assert.equal(await title(), 'Link … to ‘In outer’', 'H is ⇧E');
  await page.keyboard.press('Escape');
  await settle(page, 200);
  assert.equal(await sr(() => document.querySelector('lode-flow').shadowRoot.querySelector('.node-magnet [data-act="locate"]').textContent), 'ShowF', 'Show the selection moved to F');
});

await scenario('focus ring: thin blue with a selection, thick with nothing selected, none when keys go elsewhere', async (page) => {
  const ring = () => E(page, () => {
    const st = getComputedStyle(document.querySelector('lode-flow').shadowRoot.querySelector('.ring')).boxShadow;
    const m = st.match(/([\d.]+)px inset/);
    return m ? Number(m[1]) : 0;
  });
  // A field outside the component, and a bare spot of canvas inside it.
  await E(page, () => {
    const i = document.createElement('input');
    i.id = 'outside';
    i.style.cssText = 'position:fixed;left:4px;bottom:4px;z-index:9';
    document.body.append(i);
    document.querySelector('lode-flow').select([]);
    document.activeElement?.blur();
  });
  await settle(page, 300);
  const bare = await E(page, () => {
    const f = document.querySelector('lode-flow');
    const r = f.getBoundingClientRect();
    for (let y = r.top + 30; y < r.bottom - 30; y += 17)
      for (let x = r.left + 30; x < r.right - 30; x += 23)
        if (f.shadowRoot.elementFromPoint(x, y)?.classList.contains('vp')) return { x, y };
    return null;
  });
  assert.ok(bare, 'found bare canvas');
  assert.equal(await ring(), 0, 'nothing focused: no ring');
  await page.click('#outside');
  await settle(page, 150);
  assert.equal(await ring(), 0, 'focus outside: no ring');
  const n0 = (await el(page)).doc.nodes.length;
  await page.keyboard.press('n');
  await settle(page, 300);
  assert.equal((await el(page)).doc.nodes.length, n0, '…and N does nothing to the diagram');
  await page.mouse.click(bare.x, bare.y);
  await settle(page, 300);
  assert.deepEqual((await el(page)).sel, []);
  assert.equal(await ring(), 2, 'a click on the background: thick ring, nothing selected');
  await shot(page, '41a-focus-ring-empty');
  await page.keyboard.press('j');
  await settle(page, 300);
  assert.ok((await el(page)).sel.length > 0, 'J selected the top level');
  assert.equal(await ring(), 1, 'something selected: thin ring');
  await shot(page, '41b-focus-ring-selection');
  await page.keyboard.press('Escape');
  await settle(page, 200);
  assert.equal(await ring(), 2, 'Esc deselects: thick again');
  await page.click('#outside');
  await settle(page, 150);
  assert.equal(await ring(), 0, 'clicking away: no ring');
  await shot(page, '41c-focus-ring-none');
  // A floating control keeps the keys, so it keeps the ring.
  await page.mouse.click(bare.x, bare.y);
  await settle(page, 200);
  await E(page, () => document.querySelector('lode-flow').shadowRoot.querySelector('.puck [data-act="panel"]').focus());
  await settle(page, 150);
  assert.equal(await ring(), 2, 'focus on a control inside: still on');
});

await scenario('edges: click selects, click again labels, S / ⇧S (or Select edge, ⇧-click for back) step through a node’s edges, ⌫ deletes with toolbar Undo', async (page) => {
  let s = await el(page);
  const id = edgeId(s.doc, 'slip', 'trust');
  const m = await edgeMid(page, id);
  await page.mouse.move(m.x, m.y);
  await settle(page, 100);
  assert.equal(await E(page, (i) => {
    const f = document.querySelector('lode-flow');
    const k = f.doc.edges.findIndex((e) => e.id === i);
    return [...f.shadowRoot.querySelectorAll('path.edge')][k].classList.contains('hover');
  }, id), true, 'hovering an edge marks it');
  await page.mouse.click(m.x, m.y);
  await settle(page, 300);
  assert.deepEqual((await el(page)).sel, [id]);
  const acts = await E(page, () => [...document.querySelector('lode-flow').shadowRoot.querySelectorAll('.node-magnet .mb:not([hidden])')].map((b) => b.textContent));
  assert.deepEqual(acts, ['Label↵', 'Insert nodeN', 'Add cause⇧N', 'Add effect', 'LinkE⇧E', 'Select edgeS⇧S', 'Delete⌫']);
  await shot(page, '18-edge-selected');
  await page.mouse.click(m.x, m.y);
  await settle(page, 300);
  await page.keyboard.type('fast');
  await settle(page, 300);
  await shot(page, '19-edge-label-typing');
  await page.keyboard.press('Enter');
  await settle(page, 700);
  assert.equal((await el(page)).doc.edges.find((e) => e.id === id).label, 'fast');
  assertNoOverlap(await boxes(page));
  await shot(page, '20-edge-labelled');
  // S from the node walks its edges in turn; ⇧S walks back.
  const slip = await center(page, '.node[data-id="slip"]');
  await page.mouse.click(slip.x, slip.y);
  await settle(page, 200);
  const seen = [];
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press('s');
    await settle(page, 120);
    seen.push((await el(page)).sel[0]);
  }
  s = await el(page);
  const touching = s.doc.edges.filter((e) => e.from === 'slip' || e.to === 'slip').map((e) => e.id);
  assert.deepEqual(seen.slice(0, 3).sort(), touching.sort(), 'three edges, each once');
  assert.equal(seen[3], seen[0], 'then round again');
  // S goes clockwise on screen from 12 o'clock, as its icon shows: each line leaves the node at a
  // larger clock angle than the one before.
  const clock = await E(page, (ids) => {
    const f = document.querySelector('lode-flow');
    const nb = f.shadowRoot.querySelector('.node[data-id="slip"]').getBoundingClientRect();
    const c = { x: nb.x + nb.width / 2, y: nb.y + nb.height / 2 };
    return ids.map((id) => {
      const path = [...f.shadowRoot.querySelectorAll('path.edge')][f.doc.edges.findIndex((e) => e.id === id)];
      const m = path.getScreenCTM();
      const scr = (q) => ({ x: m.a * q.x + m.c * q.y + m.e, y: m.b * q.x + m.d * q.y + m.f });
      const L = path.getTotalLength();
      const a = scr(path.getPointAtLength(0));
      const z = scr(path.getPointAtLength(L));
      const q = scr(path.getPointAtLength(Math.hypot(a.x - c.x, a.y - c.y) <= Math.hypot(z.x - c.x, z.y - c.y) ? Math.min(L, 30) : Math.max(0, L - 30)));
      return ((Math.atan2(q.y - c.y, q.x - c.x) * 180) / Math.PI + 450) % 360;
    });
  }, seen.slice(0, 3));
  assert.ok(clock[0] < clock[1] && clock[1] < clock[2], `S steps clockwise from 12 o'clock: ${clock.map((d) => Math.round(d)).join('°, ')}°`);
  const back = [];
  for (let i = 0; i < 2; i++) {
    await page.keyboard.press('Shift+S');
    await settle(page, 120);
    back.push((await el(page)).sel[0]);
  }
  assert.deepEqual(back, [seen[2], seen[1]], '⇧S steps back the way S came');
  // The same steps from the selection's controls, starting at the node again.
  await page.mouse.click(slip.x, slip.y);
  await settle(page, 200);
  const nodeActs = await E(page, () => [...document.querySelector('lode-flow').shadowRoot.querySelectorAll('.node-magnet .mb:not([hidden])')].map((b) => b.textContent));
  assert.ok(nodeActs.includes('Select edgeS⇧S'), `a node with edges offers Select edge: ${nodeActs}`);
  const clicked = [];
  for (const back of [false, false, true]) {
    const b = await center(page, '.node-magnet [data-act="nextedge"]');
    if (back) await page.keyboard.down('Shift');
    await page.mouse.click(b.x, b.y);
    if (back) await page.keyboard.up('Shift');
    await settle(page, 200);
    clicked.push((await el(page)).sel[0]);
  }
  assert.deepEqual(clicked, [seen[0], seen[1], seen[0]], 'Select edge and ⇧-click on it step like S and ⇧S');
  await page.keyboard.press('s');
  await settle(page, 150);
  assert.equal((await el(page)).sel[0], seen[1], 'S still works after a click on the controls');
  await page.keyboard.press('Delete');
  await settle(page, 600);
  assert.equal((await el(page)).doc.edges.length, s.doc.edges.length - 1);
  const wb = await center(page, '.puck [data-act="undo"]');
  assert.ok(wb, 'deleting an edge leaves toolbar Undo');
  assert.match(await E(page, () => document.querySelector('lode-flow').shadowRoot.querySelector('.puck [data-act="undo"]').title), /^Undo Delete/);
  await page.mouse.click(wb.x, wb.y);
  await settle(page, 500);
  assert.equal((await el(page)).doc.edges.length, s.doc.edges.length);
});

await scenario('touch: dragging a node pans; Link on the magnet opens the list without the keyboard; tap links', async (page) => {
  const cdp = await page.context().newCDPSession(page);
  const touch = async (type, p) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: p ? [{ x: p.x, y: p.y }] : [] });
  // The first tap gives the diagram the page's touch gestures (before that, a drag scrolls the page).
  await E(page, () => document.querySelector('lode-flow').shadowRoot.querySelector('.vp').focus());
  await settle(page, 300);
  // A node well inside the visible frame (at phone width some sit off-screen).
  const pick = await E(page, () => {
    const f = document.querySelector('lode-flow');
    const vp = f.shadowRoot.querySelector('.vp').getBoundingClientRect();
    const n = [...f.shadowRoot.querySelectorAll('.node[data-id]')].map((x) => ({ id: x.dataset.id, r: x.getBoundingClientRect() }))
      .find(({ r }) => r.x > vp.x + 10 && r.right < vp.right - 10 && r.y > vp.y + 60 && r.bottom < vp.bottom - 100);
    return n && n.id;
  });
  const a = await center(page, `.node[data-id="${pick}"]`);
  const cam0 = (await el(page)).cam;
  await touch('touchStart', a);
  for (let i = 1; i <= 8; i++) await touch('touchMove', { x: a.x + i * 12, y: a.y + i * 6 });
  await touch('touchEnd');
  await settle(page, 300);
  const s0 = await el(page);
  assert.notDeepEqual(s0.cam, cam0, 'a touch drag on a node pans');
  assert.equal(s0.doc.edges.length, 12, 'and links nothing');
  const n = await center(page, `.node[data-id="${pick}"]`);
  await page.touchscreen.tap(n.x, n.y);
  await settle(page, 400);
  const clash = await E(page, () => {
    const r = document.querySelector('lode-flow').shadowRoot;
    const a = r.querySelector('.node-magnet').getBoundingClientRect();
    const b = r.querySelector('.puck').getBoundingClientRect();
    return a.x < b.right && b.x < a.right && a.y < b.bottom && b.y < a.bottom;
  });
  assert.equal(clash, false, 'the Layout pill never covers the selection controls');
  const btn = await center(page, '.node-magnet [data-act="link"]');
  await page.touchscreen.tap(btn.x, btn.y);
  await settle(page, 400);
  assert.equal(await E(page, () => document.querySelector('lode-flow').shadowRoot.querySelector('.linker').hidden), false, 'list open');
  assert.notEqual(await shadowActive(page), 'INPUT.lk-filter', 'the filter is not focused, so no on-screen keyboard');
  await shot(page, '21-touch-list');
  const row = await center(page, '.lk-item');
  await page.touchscreen.tap(row.x, row.y);
  await settle(page, 600);
  assert.equal((await el(page)).doc.edges.length, 13, 'tapping a row links');
}, { width: 390, height: 844 }, { hasTouch: true, isMobile: true });

await scenario('tight groups are on by default; T opens the empty band under End bias, and undo closes it', async (page) => {
  await E(page, () => document.querySelector('lode-flow').shadowRoot.querySelector('.vp').focus());
  assert.equal((await el(page)).doc.settings.tightGroups, true, 'on by default (Q3, 2026-09-30)');
  await page.keyboard.press('b');
  // Untangling can pull a member back by itself (when that removes a crossing): hold it off to see tight groups alone.
  await page.keyboard.press('u');
  await settle(page, 800);
  const x = async (id) => (await center(page, `.node[data-id="${id}"]`)).x;
  assert.ok(Math.abs((await x('estimates')) - (await x('specs'))) < 2, 'tight: estimates sits with its group');
  assertNoOverlap(await boxes(page));
  await page.keyboard.press('t');
  await settle(page, 800);
  assert.equal((await el(page)).doc.settings.tightGroups, false);
  assert.ok((await x('estimates')) > (await x('specs')) + 40, 'strict: estimates drifts late, away from its group');
  await page.keyboard.press('Control+z');
  await settle(page, 800);
  assert.ok(Math.abs((await x('estimates')) - (await x('specs'))) < 2, 'undo');
});

await scenario('untangle: with End bias the sample has no crossing lines; U shows the one it removed', async (page) => {
  await E(page, () => document.querySelector('lode-flow').shadowRoot.querySelector('.vp').focus());
  await page.keyboard.press('b');
  await settle(page, 800);
  let s = await el(page);
  assert.equal(s.doc.settings.untangle, true, 'on by default');
  assert.equal(s.info.crossings, 0, 'no lines cross');
  const tl = async () => [(await center(page, '.node[data-id="trust"]')).x, (await center(page, '.node[data-id="slip"]')).x];
  const [t0, s0] = await tl();
  await page.keyboard.press('u');
  await settle(page, 800);
  s = await el(page);
  assert.equal(s.doc.settings.untangle, false);
  assert.equal(s.info.crossings, 1, 'without untangling one crossing is unavoidable');
  const [t1, s1] = await tl();
  assert.ok(t1 - s1 > t0 - s0 + 40, 'Customers lose trust goes back to the last column');
  await shot(page, '22-untangle-off');
  await page.keyboard.press('Control+z');
  await settle(page, 800);
  assert.equal((await el(page)).info.crossings, 0, 'undo untangles again');
});

for (const entry of ['API', '0', 'magnet']) await scenario(`Fit after pan restores the camera through ${entry}, with Undo and Redo`, async (page) => {
  const initial = (await el(page)).cam;
  await drag(page, { x: 640, y: 600 }, { x: 790, y: 540 });
  await settle(page, 400);
  const panned = (await el(page)).cam;
  assert.ok(Math.abs(panned.x - initial.x) > 50, 'the mouse drag moves the diagram');
  const beforeHistory = (await history(page)).length;
  await E(page, () => {
    const f = document.querySelector('lode-flow');
    f.__fitEngineRuns = 0;
    for (const method of ['layout', 'layoutBoth']) {
      const original = f.eng[method].bind(f.eng);
      f.eng[method] = (...args) => { f.__fitEngineRuns++; return original(...args); };
    }
  });
  if (entry === 'API') await E(page, () => document.querySelector('lode-flow').fit());
  else if (entry === '0') await page.keyboard.press('0');
  else {
    await page.keyboard.press('/');
    const fit = await center(page, '.panel [data-act="fit"]');
    assert.ok(fit, 'the layout magnet offers Fit');
    await page.mouse.click(fit.x, fit.y);
  }
  await settle(page, 600);
  await shot(page, `fit-after-pan-${entry}`);
  const fitted = (await el(page)).cam;
  for (const key of ['x', 'y', 'z', 'r']) assert.ok(Math.abs(fitted[key] - initial[key]) < 0.5, `${entry} restores camera ${key}`);
  assert.equal(await E(page, () => document.querySelector('lode-flow').__fitEngineRuns), 0, 'Fit reuses the existing geometry');
  const entries = await history(page);
  assert.equal(entries.length, beforeHistory + 1, 'Fit adds exactly one view step');
  assert.ok(entries.at(-1).startsWith('fit:'), 'the step is Fit');
  await E(page, () => document.querySelector('lode-flow').undo());
  await settle(page, 500);
  assert.deepEqual((await el(page)).cam, panned, 'one Undo restores the panned camera');
  await E(page, () => document.querySelector('lode-flow').redo());
  await settle(page, 500);
  assert.deepEqual((await el(page)).cam, fitted, 'one Redo restores the fitted camera');
});

await scenario('bulk group collapse includes nested groups, preserves content and selection, and one Undo restores mixed states', async (page) => {
  await E(page, () => {
    const f = document.querySelector('lode-flow');
    f.setDoc({
      nodes: [{ id: 'a', text: 'One', group: 'inner' }, { id: 'b', text: 'Two', group: 'deep' }, { id: 'free', text: 'Outside' }],
      edges: [{ id: 'edge', from: 'a', to: 'free', label: 'A link' }],
      groups: [{ id: 'outer', text: 'Outer', collapsed: false }, { id: 'inner', text: 'Inner', parent: 'outer', collapsed: true }, { id: 'deep', text: 'Deep', parent: 'inner', collapsed: false }],
    });
    f.select(['free', 'inner', 'edge']);
    f.__groupBefore = f.doc;
    f.__groupChanges = [];
    f.addEventListener('lode-change', (e) => f.__groupChanges.push(e.detail.label));
    f.setAllGroupsCollapsed(true);
  });
  await settle(page, 600);
  assert.ok((await el(page)).doc.groups.every((g) => g.collapsed), 'all depths collapse');
  assert.deepEqual((await el(page)).sel, ['free', 'inner', 'edge'], 'the selected ids remain unchanged');
  assert.deepEqual(await E(page, () => {
    const f = document.querySelector('lode-flow');
    return { untouched: ['nodes', 'edges', 'junctions', 'settings'].every((key) => f.doc[key] === f.__groupBefore[key]),
      prior: f.__groupBefore.groups.map((g) => g.collapsed), changes: f.__groupChanges };
  }), { untouched: true, prior: [false, true, false], changes: ['Collapse all groups'] });
  assert.deepEqual((await history(page)).map((x) => x.split(':')[0]), ['select', 'collapse'], 'one content history entry');
  await E(page, () => document.querySelector('lode-flow').undo());
  await settle(page, 500);
  assert.deepEqual((await el(page)).doc.groups.map((g) => g.collapsed), [false, true, false], 'one Undo restores mixed prior states');
  assert.deepEqual((await el(page)).sel, ['free', 'inner', 'edge']);
  await E(page, () => document.querySelector('lode-flow').redo());
  await settle(page, 500);
  assert.ok((await el(page)).doc.groups.every((g) => g.collapsed), 'Redo folds all groups');
  await E(page, () => document.querySelector('lode-flow').setAllGroupsCollapsed(false));
  await settle(page, 500);
  assert.ok((await el(page)).doc.groups.every((g) => !g.collapsed), 'all depths expand');
  await E(page, () => document.querySelector('lode-flow').undo());
  await settle(page, 500);
  assert.ok((await el(page)).doc.groups.every((g) => g.collapsed), 'one Undo restores the collapsed set');
});

await scenario('bulk group collapse is inert for unchanged state, read-only and no groups', async (page) => {
  const check = await E(page, () => {
    const f = document.querySelector('lode-flow');
    const inert = (run) => {
      const doc = f.doc, history = JSON.stringify(f.getState().history), selection = f.selection;
      let changes = 0;
      const changed = () => changes++;
      f.addEventListener('lode-change', changed);
      run();
      f.removeEventListener('lode-change', changed);
      return f.doc === doc && JSON.stringify(f.getState().history) === history && JSON.stringify(f.selection) === JSON.stringify(selection) && changes === 0;
    };
    f.setAllGroupsCollapsed(true);
    const unchanged = inert(() => f.setAllGroupsCollapsed(true));
    f.setAttribute('readonly', '');
    const readonly = inert(() => f.setAllGroupsCollapsed(false, { fit: true }));
    f.removeAttribute('readonly');
    f.setDoc({ nodes: [{ id: 'a', text: 'No groups' }], edges: [], groups: [] });
    const empty = inert(() => { f.setAllGroupsCollapsed(true, { fit: true }); f.setAllGroupsCollapsed(false); });
    return { unchanged, readonly, empty };
  });
  assert.deepEqual(check, { unchanged: true, readonly: true, empty: true });
});

for (const target of ['a', 'g', 'g-proxy', 'g-nested', 'edge']) await scenario(`bulk group collapse preserves a pending ${target} text edit`, async (page) => {
  await E(page, (target) => {
    const f = document.querySelector('lode-flow');
    const groups = [{ id: 'g', text: 'Original', collapsed: target === 'g-proxy', parent: target === 'g-nested' ? 'outer' : null }];
    if (target === 'g-nested') groups.push({ id: 'outer', text: 'Outer', collapsed: false });
    f.setDoc({ nodes: [{ id: 'a', text: 'Original', group: 'g' }, { id: 'b', text: 'Outside' }], edges: [{ id: 'edge', from: 'a', to: 'b', label: 'Original' }], groups });
    f.select([target.startsWith('g') ? 'g' : target]);
  }, target);
  await settle(page, 500);
  await E(page, () => document.querySelector('lode-flow').shadowRoot.querySelector('.vp').focus());
  // F2 edits anything; ↵ on an expanded group dives into it instead.
  await page.keyboard.press('F2');
  await page.locator('lode-flow').locator('textarea.ed').fill('Pending text');
  await E(page, (collapsed) => document.querySelector('lode-flow').setAllGroupsCollapsed(collapsed), target !== 'g-proxy');
  await settle(page, 500);
  const pending = await E(page, (target) => {
    const f = document.querySelector('lode-flow');
    return { text: f.editing?.ta.value, saved: target === 'a' ? f.doc.nodes[0].text : target.startsWith('g') ? f.doc.groups[0].text : f.doc.edges[0].label, kinds: f.hist.entries.map((e) => e.kind) };
  }, target);
  assert.deepEqual(pending, { text: 'Pending text', saved: 'Original', kinds: ['select', 'collapse'] }, 'folding leaves the pending editor intact');
  await E(page, (collapsed) => document.querySelector('lode-flow').setAllGroupsCollapsed(collapsed), target === 'g-proxy');
  await settle(page, 500);
  await E(page, () => document.querySelector('lode-flow').editing.ta.focus());
  await page.keyboard.press('Enter');
  await settle(page, 500);
  const doc = (await el(page)).doc;
  assert.equal(target === 'a' ? doc.nodes[0].text : target.startsWith('g') ? doc.groups[0].text : doc.edges[0].label, 'Pending text', 'the draft can still be saved after restoring the group shape');
});

for (const collapsed of [false, true]) await scenario(`single-group ${collapsed ? 'expand' : 'collapse'} preserves a pending title without a blur history entry`, async (page) => {
    await E(page, (collapsed) => {
      const f = document.querySelector('lode-flow');
      f.setDoc({ nodes: [{ id: 'a', text: 'Member', group: 'g' }], groups: [{ id: 'g', text: 'Original', collapsed }], edges: [] });
      f.select(['g']);
    }, collapsed);
    await settle(page, 500);
    await E(page, () => document.querySelector('lode-flow').shadowRoot.querySelector('.vp').focus());
    await page.keyboard.press('F2');
    await page.locator('lode-flow').locator('textarea.ed').fill('Pending title');
    await E(page, () => document.querySelector('lode-flow').toggleCollapseOf('g'));
    await settle(page, 500);
    assert.deepEqual(await E(page, () => {
      const f = document.querySelector('lode-flow');
      return { draft: f.editing?.ta.value, text: f.doc.groups[0].text, kinds: f.hist.entries.map((e) => e.kind) };
    }), { draft: 'Pending title', text: 'Original', kinds: ['select', 'collapse'] });
    await E(page, () => document.querySelector('lode-flow').editing.ta.focus());
    await page.keyboard.press('Enter');
    await settle(page, 300);
    assert.equal((await el(page)).doc.groups[0].text, 'Pending title');
});

await scenario('bulk group collapse with fit restores mixed flags and the panned camera in one Undo', async (page) => {
  for (const collapsed of [true, false]) {
    await E(page, () => {
      const f = document.querySelector('lode-flow');
      f.setDoc({
        nodes: [{ id: 'a', text: 'One', group: 'inner' }, { id: 'b', text: 'Two' }],
        edges: [{ id: 'edge', from: 'a', to: 'b' }],
        groups: [{ id: 'outer', text: 'Outer', collapsed: false }, { id: 'inner', text: 'Inner', parent: 'outer', collapsed: true }],
      });
      f.select(['b']);
    });
    await settle(page, 500);
    await page.keyboard.down('Space');
    await drag(page, { x: 640, y: 600 }, { x: 930, y: 520 });
    await page.keyboard.up('Space');
    await settle(page, 300);
    const panned = (await el(page)).cam;
    const beforeHistory = (await history(page)).length;
    await E(page, (collapsed) => document.querySelector('lode-flow').setAllGroupsCollapsed(collapsed, { fit: true }), collapsed);
    await settle(page, 600);
    const fitted = (await el(page)).cam;
    assert.ok(Math.abs(fitted.x - panned.x) > 50, 'the group operation visibly returns from the pan');
    assert.deepEqual(fitted, await E(page, () => { const f = document.querySelector('lode-flow'); return f.fitCamera(f.geo); }), 'the changed diagram is fitted');
    assert.ok((await el(page)).doc.groups.every((g) => g.collapsed === collapsed), 'all nested flags change');
    const entries = await history(page);
    assert.equal(entries.length, beforeHistory + 1, 'folding and fitting add one step');
    assert.ok(entries.at(-1).startsWith('collapse:'), 'the combined step is collapse');
    await E(page, () => document.querySelector('lode-flow').undo());
    await settle(page, 600);
    assert.deepEqual((await el(page)).doc.groups.map((g) => g.collapsed), [false, true], 'one Undo restores mixed flags');
    assert.deepEqual((await el(page)).cam, panned, 'one Undo restores the exact panned camera');
    assert.deepEqual((await el(page)).sel, ['b'], 'selection survives the transaction');
    await E(page, () => document.querySelector('lode-flow').redo());
    await settle(page, 600);
    assert.deepEqual((await el(page)).cam, fitted, 'Redo restores the fitted view');
    await page.keyboard.down('Space');
    await drag(page, { x: 640, y: 600 }, { x: 870, y: 520 });
    await page.keyboard.up('Space');
    await settle(page, 300);
    const repanned = (await el(page)).cam;
    const sameGroupsHistory = (await history(page)).length;
    await E(page, (collapsed) => {
      const f = document.querySelector('lode-flow');
      f.__sameGroupsDoc = f.doc;
      f.setAllGroupsCollapsed(collapsed, { fit: true });
    }, collapsed);
    await settle(page, 500);
    assert.deepEqual((await el(page)).cam, fitted, 'explicit fit also works when the flags already match');
    assert.ok(await E(page, () => { const f = document.querySelector('lode-flow'); return f.doc === f.__sameGroupsDoc; }), 'matching flags preserve the document reference');
    assert.equal((await history(page)).length, sameGroupsHistory + 1, 'the explicit view change is one step');
    await E(page, () => document.querySelector('lode-flow').undo());
    await settle(page, 500);
    assert.deepEqual((await el(page)).cam, repanned, 'Undo restores that pan too');
  }
});

await scenario('fit-min lets an embed choose how small fitting may shrink text', async (page) => {
  const z0 = (await el(page)).cam.z;
  assert.ok(Math.abs(z0 - 0.7) < 1e-6, `phone default stops at 70% (got ${z0})`);
  await E(page, () => document.querySelector('lode-flow').setAttribute('fit-min', '45%'));
  await E(page, () => document.querySelector('lode-flow').fit());
  await settle(page, 800);
  const z1 = (await el(page)).cam.z;
  assert.ok(z1 < 0.7 && z1 >= 0.45, `fit-min=45% fits smaller (got ${z1})`);
}, { width: 390, height: 520 });

await scenario('a fixed orientation refits when its frame changes size', async (page) => {
  await E(page, () => {
    const f = document.querySelector('lode-flow');
    f.setAttribute('fit-min', '0.2');
    f.setDoc({ ...f.doc, settings: { ...f.doc.settings, orientation: 'lr' } });
  });
  await settle(page, 700);
  const inside = () => E(page, () => {
    const f = document.querySelector('lode-flow');
    const vp = f.shadowRoot.querySelector('.vp').getBoundingClientRect();
    return [...f.shadowRoot.querySelectorAll('.node[data-id]')].every((n) => {
      const r = n.getBoundingClientRect();
      return r.x >= vp.x - 1 && r.right <= vp.right + 1 && r.y >= vp.y - 1 && r.bottom <= vp.bottom + 1;
    });
  });
  assert.ok(await inside(), 'fits at first');
  for (const size of ['width:620px;height:360px', 'width:1100px;height:300px', 'width:420px;height:640px']) {
    // Resize while a frame is already pending (as during page load), then check the fit.
    await E(page, (css) => {
      const f = document.querySelector('lode-flow');
      f.select([f.selection.length ? 'cycle' : 'slip']);
      document.querySelector('.frame').style.cssText = css;
    }, size);
    await settle(page, 500);
    assert.ok(await inside(), `still fits after resizing to ${size}`);
  }
});

await scenario('split an edge: with an edge selected, N inserts a node in its middle; typing and adding are one undo step', async (page) => {
  let s = await el(page);
  const id = edgeId(s.doc, 'slip', 'trust');
  const m = await edgeMid(page, id);
  await page.mouse.click(m.x, m.y);
  await settle(page, 300);
  assert.ok(await center(page, '.node-magnet [data-act="split"]'), 'the edge magnet offers Insert node');
  await page.keyboard.press('n');
  await settle(page, 300);
  await page.keyboard.type('Churn rises');
  await page.keyboard.press('Enter');
  await settle(page, 700);
  s = await el(page);
  const mid = s.doc.nodes.find((n) => n.text === 'Churn rises');
  assert.ok(mid, 'new node exists');
  assert.ok(s.doc.edges.some((e) => e.id === id && e.from === 'slip' && e.to === mid.id), 'the first half keeps the edge id');
  assert.ok(s.doc.edges.some((e) => e.from === mid.id && e.to === 'trust'), 'the second half reaches the old target');
  assert.ok((await history(page)).at(-1).startsWith('add:Insert node ‘Churn rises’'));
  const t = s.info.timing;
  assert.ok(t && t.totalMs > 0 && t.engineRuns + t.engineReused >= 1 && t.nodes === s.doc.nodes.length, 'layoutInfo.timing reports the last re-layout');
  await page.keyboard.press('Control+z');
  await settle(page, 600);
  s = await el(page);
  assert.ok(!s.doc.nodes.some((n) => n.text === 'Churn rises'), 'one undo removes it');
  assert.ok(s.doc.edges.some((e) => e.id === id && e.to === 'trust'), 'and restores the edge');
});

// ---------- failure modes found by the 2026-10-01 stress hunt ----------

await scenario('one undo of an empty new node removes just that node (not the step before)', async (page) => {
  const b = await center(page, '.node[data-id="trust"]');
  await page.mouse.click(b.x, b.y);
  await settle(page, 300);
  const before = await el(page);
  const h0 = (await history(page)).length;
  await page.keyboard.press('n');
  await settle(page, 300);
  const undo = await center(page, '.puck [data-act="undo"]');
  await page.mouse.click(undo.x, undo.y);
  await settle(page, 500);
  const s = await el(page);
  assert.equal(s.doc.nodes.length, before.doc.nodes.length, 'the empty node is gone');
  assert.equal((await history(page)).length, h0, 'and only it: the selection step before it stays');
  assert.deepEqual(s.sel, ['trust']);
});

await scenario('cancelling an inserted node after scrolling puts the split edge back, label and all', async (page) => {
  let s = await el(page);
  const id = edgeId(s.doc, 'slip', 'trust');
  await E(page, (id) => {
    const f = document.querySelector('lode-flow');
    f.setDoc({ ...f.doc, edges: f.doc.edges.map((e) => (e.id === id ? { ...e, label: 'fast' } : e)) });
  }, id);
  await settle(page, 700);
  const lbl = await center(page, '.carrier:not(.dot)');
  await page.mouse.click(lbl.x, lbl.y);
  await settle(page, 300);
  await page.keyboard.press('n');
  await settle(page, 400);
  await page.mouse.move(640, 500);
  await page.mouse.wheel(0, 120);
  await settle(page, 300);
  await page.keyboard.press('Escape');
  await settle(page, 600);
  s = await el(page);
  const e = s.doc.edges.find((x) => x.id === id);
  assert.ok(e && e.from === 'slip' && e.to === 'trust' && e.label === 'fast', 'the edge is whole again with its label');
  assert.equal(s.doc.nodes.length, 12);
});

await scenario('a merge cannot make a node cause the same effect twice', async (page) => {
  const s = await el(page);
  // estimates → pressure exists; merging estimates into slip → pressure would add a second route.
  const why = await E(page, async (id) => (await import('/web/dist/lode-flow.js')).mergeProblem(document.querySelector('lode-flow').doc, 'estimates', id), edgeId(s.doc, 'slip', 'pressure'));
  assert.equal(why, 'Already linked to its effect');
});

await scenario('storage-key: a full browser store keeps the document, trims the history, and says so when even the document fails', async (page) => {
  await E(page, () => {
    localStorage.clear();
    document.querySelector('lode-flow').setAttribute('storage-key', 'q');
  });
  // A small quota: the document fits, a long history does not.
  await E(page, () => {
    const real = Storage.prototype.setItem;
    window.__quota = 30000;
    Storage.prototype.setItem = function (k, v) {
      if (String(v).length > window.__quota) throw new DOMException('full', 'QuotaExceededError');
      return real.call(this, k, v);
    };
  });
  for (let i = 0; i < 25; i++) {
    await E(page, (i) => {
      const f = document.querySelector('lode-flow');
      f.select([f.doc.nodes[i % f.doc.nodes.length].id]);
      f.addLinked(f.selection[0], 'after');
      f.editing.ta.value = 'Node number ' + i;
      f.finishEdit(true);
    }, i);
  }
  await settle(page, 600);
  let saved = await E(page, () => ({ doc: JSON.parse(localStorage.getItem('lodeflow:q')).doc.nodes.length, live: document.querySelector('lode-flow').doc.nodes.length, chip: !!document.querySelector('lode-flow').shadowRoot.querySelector('.save-problem') }));
  assert.equal(saved.doc, saved.live, 'the document saved in full');
  assert.equal(saved.chip, false, 'no warning while the document saves');
  await E(page, () => (window.__quota = 10));
  await E(page, () => {
    const f = document.querySelector('lode-flow');
    f.addLinked(f.doc.nodes[0].id, 'after');
    f.editing.ta.value = 'One more';
    f.finishEdit(true);
  });
  await settle(page, 700);
  saved = await E(page, () => ({ chip: document.querySelector('lode-flow').shadowRoot.querySelector('.save-problem')?.textContent }));
  assert.equal(saved.chip, 'Not saved', 'the Layout pill says the diagram is not being saved');
});

await scenario('typing that keeps a node’s size does not re-lay out; edits never lay out the same input twice; a click does not rebuild the DOM', async (page) => {
  await E(page, () => {
    const f = document.querySelector('lode-flow');
    window.__runs = { relayout: 0, sync: 0, inputs: [], repeats: 0 };
    const rl = f.relayout.bind(f);
    const sd = f.syncDom.bind(f);
    const ei = f.engineInput.bind(f);
    f.relayout = () => (window.__runs.relayout++, rl());
    f.syncDom = () => (window.__runs.sync++, sd());
    // The same engine input laid out twice in a row is wasted work.
    f.engineInput = (...a) => {
      const inp = ei(...a);
      const key = JSON.stringify(inp) + a[0];
      const r = window.__runs;
      if (r.inputs.includes(key)) r.repeats++;
      r.inputs = [key];
      return inp;
    };
  });
  const b = await center(page, '.node[data-id="cycle"]');
  await page.mouse.click(b.x, b.y);
  await settle(page, 400);
  let r = await E(page, () => ({ ...window.__runs, inputs: 0 }));
  assert.equal(r.sync, 0, 'selecting toggles classes only');
  await page.mouse.click(b.x, b.y);
  await settle(page, 300);
  await E(page, () => (window.__runs.relayout = 0));
  await page.keyboard.press('End');
  await page.keyboard.type('!');
  await settle(page, 400);
  r = await E(page, () => ({ ...window.__runs, inputs: 0 }));
  assert.equal(r.relayout, 0, 'one character that fits on the line: no re-layout');
  await page.keyboard.press('Enter');
  await settle(page, 600);
  const repeats = {};
  for (const k of ['n', 'Escape', 'Delete', 'Control+z']) {
    const r0 = await E(page, () => window.__runs.repeats);
    await page.keyboard.press(k);
    await settle(page, 600);
    repeats[k] = (await E(page, () => window.__runs.repeats)) - r0;
  }
  assert.deepEqual(repeats, { n: 0, Escape: 0, Delete: 0, 'Control+z': 0 }, 'no edit laid out the same input twice');
});

await scenario('link list: the receipt goes once another step follows; it offers no merge it would refuse; read-only closes it', async (page) => {
  const f = () => document.querySelector('lode-flow');
  const b = await center(page, '.node[data-id="estimates"]');
  await page.mouse.click(b.x, b.y);
  await settle(page, 300);
  await page.keyboard.press('e');
  await settle(page, 300);
  await page.keyboard.press('Enter');
  await settle(page, 400);
  const receipt = () => E(page, () => !document.querySelector('lode-flow').shadowRoot.querySelector('.lk-receipt').hidden);
  assert.equal(await receipt(), true, 'receipt after a link');
  const edges = (await el(page)).doc.edges.length;
  await E(page, () => document.querySelector('lode-flow').panScreen(-40, -10));
  await settle(page, 400);
  assert.equal(await receipt(), false, 'a pan pushes a step: the receipt goes');
  assert.equal((await el(page)).doc.edges.length, edges, 'the link stays');
  // A cause already linked to an edge's effect is not offered that edge.
  const offered = await E(page, async () => {
    const fl = document.querySelector('lode-flow');
    fl.closeLinker(false);
    fl.setDoc({ nodes: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }, { id: 'c', text: 'C' }], edges: [{ id: 'ab', from: 'a', to: 'b' }, { id: 'cb', from: 'c', to: 'b' }] });
    await new Promise((r) => setTimeout(r, 500));
    fl.select(['a']);
    fl.openLinker('a', true);
    await new Promise((r) => setTimeout(r, 300));
    return fl.linker.items.map((it) => it.kind + ':' + it.id);
  });
  assert.ok(!offered.includes('edge:cb'), `a → (c → b) would duplicate a → b, so it is not offered (${offered.join(', ')})`);
  await E(page, () => document.querySelector('lode-flow').setAttribute('readonly', ''));
  await settle(page, 400);
  assert.equal(await E(page, () => !!document.querySelector('lode-flow').linker), false, 'read-only closes the list');
  await E(page, () => document.querySelector('lode-flow').removeAttribute('readonly'));
});

await scenario('undo after adding a node and scrolling removes the empty node, and only it', async (page) => {
  const start = await el(page);
  const b = await center(page, '.node[data-id="cycle"]');
  await page.mouse.click(b.x, b.y);
  await settle(page, 300);
  await page.keyboard.press('n');
  await settle(page, 400);
  assert.equal((await el(page)).doc.nodes.length, start.doc.nodes.length + 1, 'a node was added');
  await E(page, () => document.querySelector('lode-flow').panScreen(-60, -20));
  await settle(page, 300);
  await E(page, () => document.querySelector('lode-flow').undo());
  await settle(page, 500);
  let s = await el(page);
  assert.equal(s.doc.nodes.length, start.doc.nodes.length, 'the empty node is gone');
  assert.equal(await E(page, () => document.querySelector('lode-flow').hist.peekUndo()?.kind), 'pan', 'the scroll is still the next step back');
  assert.equal(s.redo, false, 'nothing to redo: the node never existed');
  await E(page, () => document.querySelector('lode-flow').undo());
  await settle(page, 500);
  s = await el(page);
  assert.equal(s.doc.nodes.length, start.doc.nodes.length, 'a second undo takes back the scroll, not an empty node');
  assert.ok(!s.doc.nodes.some((n) => !n.text.trim()), 'no empty node anywhere');
});

await scenario('a full store: the document is saved before any undo history, its own or another diagram’s', async (page) => {
  const r = await E(page, async () => {
    const fl = document.querySelector('lode-flow');
    localStorage.clear();
    // Another diagram's saved history fills the store.
    localStorage.setItem('lodeflow:other', JSON.stringify({ v: 2, rev: 1, doc: { nodes: [] } }));
    const mb = 'x'.repeat(1 << 20);
    let i = 0;
    try {
      for (;;) localStorage.setItem('lodeflow:other:history', mb.repeat(++i));
    } catch {
      /* full to within a megabyte */
    }
    // Top it up with small unrelated keys until nothing more fits.
    for (let size = 1 << 19, k = 0; size >= 16; size >>= 1) {
      try {
        for (;;) localStorage.setItem(`filler-${k++}`, 'y'.repeat(size));
      } catch {
        /* next size down */
      }
    }
    const otherDoc = localStorage.getItem('lodeflow:other');
    fl.setAttribute('storage-key', 'mine');
    fl.select(['wip']);
    fl.deleteSelection();
    fl.saveNow();
    const mine = JSON.parse(localStorage.getItem('lodeflow:mine') || 'null');
    return { saved: !!mine && !mine.doc.nodes.some((n) => n.id === 'wip'), problem: fl.saveProblem, otherDocKept: localStorage.getItem('lodeflow:other') === otherDoc, otherHistory: localStorage.getItem('lodeflow:other:history') !== null };
  });
  assert.equal(r.saved, true, 'this diagram is saved');
  assert.equal(r.problem, null, 'no "Not saved" warning');
  assert.equal(r.otherDocKept, true, 'the other diagram’s document is untouched');
  assert.equal(r.otherHistory, false, 'its saved undo history made the room');
  await E(page, () => localStorage.clear());
});

await scenario('a diagram hidden and shown again (a tab, <details>) refits; a fixed direction keeps a sane camera', async (page) => {
  for (const orientation of ['lr', 'auto']) {
    const r = await E(page, async (orientation) => {
      const f = document.querySelector('lode-flow');
      const wait = (ms) => new Promise((res) => setTimeout(res, ms));
      f.changeSetting('orientation', orientation);
      f.fit();
      await wait(700);
      const before = f.camera;
      const host = f.parentElement;
      const w0 = f.style.width;
      f.style.display = 'none';
      await wait(300);
      // The container changes size while hidden (auto must refit for the new size).
      if (orientation === 'auto') f.style.width = '520px';
      f.style.display = '';
      await wait(900);
      const after = f.camera;
      const vp = f.shadowRoot.querySelector('.vp').getBoundingClientRect();
      const inView = [...f.shadowRoot.querySelectorAll('.node[data-id]')].filter((n) => {
        const b = n.getBoundingClientRect();
        return b.left >= vp.left - 1 && b.right <= vp.right + 1 && b.top >= vp.top - 1 && b.bottom <= vp.bottom + 1;
      }).length;
      f.style.width = w0;
      await wait(600);
      return { before, after, inView, total: f.doc.nodes.length, host: !!host };
    }, orientation);
    if (orientation === 'lr') {
      assert.ok(Math.abs(r.after.x - r.before.x) < 1 && Math.abs(r.after.y - r.before.y) < 1 && Math.abs(r.after.z - r.before.z) < 1e-6, `lr: the camera comes back as it was (${JSON.stringify(r.before)} → ${JSON.stringify(r.after)})`);
    } else {
      assert.ok(r.after.z < r.before.z, `auto: refitted for the narrower frame (z ${r.before.z.toFixed(2)} → ${r.after.z.toFixed(2)})`);
    }
    // At 520 px the fit floor (70 %) keeps text readable, so auto shows the start of the flow.
    if (orientation === 'lr') assert.ok(r.inView >= r.total - 1, `lr: the diagram is in view after showing (${r.inView}/${r.total})`);
    else assert.ok(r.inView >= 3, `auto: nodes in view after showing (${r.inView}/${r.total})`);
  }
});

await scenario('changing storage-key right after an edit saves that edit under the old key', async (page) => {
  const r = await E(page, async () => {
    localStorage.clear();
    const f = document.querySelector('lode-flow');
    f.setAttribute('storage-key', 'a');
    f.select(['wip']);
    f.deleteSelection();
    // Within the 250 ms save delay, the host switches to another diagram (as the React wrapper does).
    f.setAttribute('storage-key', 'b');
    f.setDoc({ nodes: [{ id: 'x', text: 'Another diagram' }], edges: [] });
    await new Promise((res) => setTimeout(res, 600));
    const a = JSON.parse(localStorage.getItem('lodeflow:a') || 'null');
    const b = JSON.parse(localStorage.getItem('lodeflow:b') || 'null');
    localStorage.clear();
    return { aSaved: !!a, aHasEdit: !!a && !a.doc.nodes.some((n) => n.id === 'wip'), bHoldsA: !!b && b.doc.nodes.some((n) => n.id === 'cycle') };
  });
  assert.equal(r.aSaved && r.aHasEdit, true, 'key a holds the deletion');
  assert.equal(r.bHoldsA, false, 'key b never receives diagram A');
});

await scenario('the link list follows a collapse undone while it is open', async (page) => {
  const items = () => E(page, () => document.querySelector('lode-flow').linker?.items.map((it) => it.id) ?? null);
  await E(page, async () => {
    const f = document.querySelector('lode-flow');
    f.select(['delivery']);
    f.toggleCollapse();
    await new Promise((r) => setTimeout(r, 700));
    f.select(['wip']);
    f.openLinker('wip', true);
  });
  await settle(page, 500);
  let ids = await items();
  assert.ok(!ids.includes('cycle') && !ids.includes('rework'), `collapsed members are not offered (${ids.join(', ')})`);
  await E(page, () => document.querySelector('lode-flow').undo()); // the selection of wip
  await E(page, () => document.querySelector('lode-flow').undo()); // the collapse
  await settle(page, 900);
  ids = await items();
  assert.ok(ids && ids.includes('cycle') && ids.includes('rework'), `expanded again: its members are offered (${ids && ids.join(', ')})`);
});

await scenario('an edge label comes off with ⇧⌫ (or Remove label) and the edge stays; ⇧N on an edge adds a cause that merges into it', async (page) => {
  const f = () => document.querySelector('lode-flow');
  const id = await E(page, () => {
    const fl = document.querySelector('lode-flow');
    const e = fl.doc.edges.find((x) => x.from === 'slip' && x.to === 'trust');
    fl.select([e.id]);
    return e.id;
  });
  await settle(page, 300);
  await E(page, (i) => document.querySelector('lode-flow').startEdit(i), id);
  await settle(page, 200);
  await page.keyboard.type('fast');
  await page.keyboard.press('Enter');
  await settle(page, 600);
  await E(page, (i) => document.querySelector('lode-flow').select([i]), id);
  await settle(page, 300);
  const acts = await E(page, () => [...document.querySelector('lode-flow').shadowRoot.querySelectorAll('.node-magnet .mb:not([hidden])')].map((b) => b.textContent));
  assert.ok(acts.includes('Remove label⇧⌫'), `a labelled edge offers Remove label (${acts.join(', ')})`);
  const edges = (await el(page)).doc.edges.length;
  await E(page, () => document.querySelector('lode-flow').shadowRoot.querySelector('.vp').focus());
  await page.keyboard.press('Shift+Backspace');
  await settle(page, 600);
  let s = await el(page);
  assert.equal(s.doc.edges.length, edges, 'the edge stays');
  assert.equal(s.doc.edges.find((e) => e.id === id).label, undefined, 'its label is gone');
  assert.deepEqual(s.sel, [id], 'still selected');
  await E(page, () => document.querySelector('lode-flow').undo());
  await settle(page, 500);
  assert.equal((await el(page)).doc.edges.find((e) => e.id === id).label, 'fast', 'undo puts the label back');
  // ⇧N: a new cause joins the edge as a merge, with the caret in it.
  const before = await el(page);
  await E(page, (i) => document.querySelector('lode-flow').select([i]), id);
  await settle(page, 300);
  await E(page, () => document.querySelector('lode-flow').shadowRoot.querySelector('.vp').focus());
  await page.keyboard.press('Shift+N');
  await settle(page, 400);
  await page.keyboard.type('Reviews pile up');
  await page.keyboard.press('Enter');
  await settle(page, 700);
  s = await el(page);
  const added = s.doc.nodes.find((n) => n.text === 'Reviews pile up');
  assert.ok(added, 'a new node with the typed text');
  const j = s.doc.junctions.find((x) => s.doc.edges.some((e) => e.from === added.id && e.to === x.id));
  assert.ok(j, 'it joins a merge');
  const trunk = s.doc.edges.find((e) => e.from === j.id);
  assert.equal(trunk.id, id, 'the edge is the trunk, same id');
  assert.equal(trunk.to, 'trust', 'into the same effect');
  assert.equal(trunk.label, 'fast', 'keeping its label');
  await E(page, () => document.querySelector('lode-flow').undo());
  await settle(page, 600);
  s = await el(page);
  assert.equal(s.doc.nodes.length, before.doc.nodes.length, 'one undo removes the cause');
  assert.equal(s.doc.junctions.length, before.doc.junctions.length, 'and the merge');
  assert.ok(s.doc.edges.some((e) => e.id === id && e.from === 'slip' && e.to === 'trust' && e.label === 'fast'), 'the edge is as it was');
  assertNoOverlap(await boxes(page));
});

await scenario('lines are easy to pick: 10 px off a line still selects it, also inside a group box', async (page) => {
  const s0 = await el(page);
  const id = edgeId(s0.doc, 'rework', 'cycle'); // runs inside the Delivery box
  const m = await edgeMid(page, id);
  const inBox = await E(page, (pt) => {
    const f = document.querySelector('lode-flow');
    const hits = f.shadowRoot.elementsFromPoint(pt.x, pt.y + 10);
    return hits.some((h) => h.classList?.contains('gbox'));
  }, m);
  assert.ok(inBox, 'the test point lies on the group box');
  await page.mouse.move(m.x, m.y + 10);
  await settle(page, 150);
  assert.equal(await E(page, () => document.querySelector('lode-flow').shadowRoot.querySelector('.vp').classList.contains('over-edge')), true, 'hovering 10 px off the line marks it');
  await page.mouse.click(m.x, m.y + 10);
  await settle(page, 300);
  assert.deepEqual((await el(page)).sel, [id], 'a click 10 px off the line selects it');
  // Bare box background, away from every line, still selects the group.
  const bare = await E(page, () => {
    const f = document.querySelector('lode-flow');
    const vp = f.shadowRoot.querySelector('.vp').getBoundingClientRect();
    const b = f.shadowRoot.querySelector('.gbox[data-gid="delivery"]').getBoundingClientRect();
    for (let y = b.bottom - 6; y > b.top + 30; y -= 6)
      for (let x = b.left + 6; x < b.right - 6; x += 6) {
        const top = f.shadowRoot.elementFromPoint(x, y);
        if (top?.classList?.contains('gbox') && !f.edgeAt({ x: x - vp.left, y: y - vp.top }, 20)) return { x, y };
      }
    return null;
  });
  assert.ok(bare, 'found box background clear of lines');
  await page.mouse.click(bare.x, bare.y);
  await settle(page, 300);
  const after = await el(page);
  assert.deepEqual(after.sel, ['delivery'], `bare box background selects the group (got ${JSON.stringify(after.sel)} at ${JSON.stringify(bare)})`);
});

await scenario('typing a group title re-lays out only when the title wraps to another line', async (page) => {
  await E(page, () => {
    const f = document.querySelector('lode-flow');
    window.__gl = 0;
    const rl = f.relayout.bind(f);
    f.relayout = () => (window.__gl++, rl());
    f.startEdit('delivery');
  });
  await settle(page, 400);
  const h0 = await E(page, () => document.querySelector('lode-flow').shadowRoot.querySelector('.glabel[data-gid="delivery"]').offsetHeight);
  await E(page, () => (window.__gl = 0));
  await page.keyboard.press('End');
  await page.keyboard.type(' team');
  await settle(page, 400);
  assert.equal(await E(page, () => window.__gl), 0, 'a title that stays on one line: no re-layout');
  await page.keyboard.type(' and everyone who reviews, ships and supports what it builds');
  await settle(page, 600);
  const h1 = await E(page, () => document.querySelector('lode-flow').shadowRoot.querySelector('.glabel[data-gid="delivery"]').offsetHeight);
  assert.ok(h1 > h0, `the title wrapped (${h0} → ${h1} px)`);
  assert.ok((await E(page, () => window.__gl)) >= 1, 'a wrap re-lays out');
  await page.keyboard.press('Enter');
  await settle(page, 700);
  assertNoOverlap(await boxes(page));
});

await scenario('the link list stays quick on a 400-node diagram; 600-node diagrams open with nodes in view, radial too', async (page) => {
  const ms = await E(page, async () => {
    const { generate } = await import('/web/test/gen.mjs');
    const f = document.querySelector('lode-flow');
    f.setDoc(generate(400, { family: 'flow', seed: 4 }));
    await new Promise((r) => setTimeout(r, 1200));
    const id = f.doc.nodes[200].id;
    f.select([id]);
    let t = performance.now();
    f.openLinker(id, true);
    const open = performance.now() - t;
    const input = f.shadowRoot.querySelector('.lk-filter');
    input.value = 'cost';
    t = performance.now();
    input.dispatchEvent(new Event('input'));
    const key = performance.now() - t;
    f.closeLinker(false);
    const seen = async (doc) => {
      f.setDoc(doc);
      await new Promise((r) => setTimeout(r, 1500));
      const vp = f.shadowRoot.querySelector('.vp').getBoundingClientRect();
      return [...f.shadowRoot.querySelectorAll('.node[data-id]')].filter((n) => {
        const b = n.getBoundingClientRect();
        return b.right > vp.left && b.left < vp.right && b.bottom > vp.top && b.top < vp.bottom && getComputedStyle(n).visibility !== 'hidden';
      }).length;
    };
    const inView = await seen(generate(600, { family: 'flow', seed: 6 }));
    // Radial: a crowded first ring leaves the middle empty.
    const radial = [];
    for (const orientation of ['in-out', 'out-in']) radial.push(await seen(generate(600, { family: 'plain', seed: 6, orientation })));
    return { open, key, inView, radial };
  });
  assert.ok(ms.open < 50 && ms.key < 50, `link list: open ${ms.open.toFixed(1)} ms, keystroke ${ms.key.toFixed(1)} ms`);
  assert.ok(ms.inView >= 5, `a big diagram opens on its nodes (${ms.inView} in view)`);
  assert.ok(ms.radial.every((k) => k >= 3), `big radial diagrams open on their nodes (${ms.radial.join(', ')} in view)`);
});

await scenario('saved histories from before merges still undo', async (page) => {
  await E(page, () => {
    const f = document.querySelector('lode-flow');
    const old = JSON.parse(JSON.stringify(f.getState()));
    const strip = (d) => { delete d.junctions; delete d.settings.tightGroups; return d; };
    const before = strip(JSON.parse(JSON.stringify(old.doc)));
    const after = strip(JSON.parse(JSON.stringify(old.doc)));
    after.nodes = after.nodes.filter((n) => n.id !== 'wip');
    after.edges = after.edges.filter((e) => e.from !== 'wip');
    f.setState({ doc: after, history: { v: 1, index: 1, entries: [{ label: 'Delete 1 node', kind: 'delete', before: { doc: before, view: old.view }, after: { doc: after, view: old.view }, t: 0 }] } });
  });
  await settle(page, 400);
  await page.keyboard.press('Control+z');
  await E(page, () => document.querySelector('lode-flow').undo());
  await settle(page, 600);
  const s = await el(page);
  assert.ok(s.doc.nodes.some((n) => n.id === 'wip'), 'undo into an old document works');
  assert.deepEqual(s.doc.junctions, []);
});

for (const spec of motionCases) await scenario(`group motion: ${spec.name}`, async (page) => {
  await verifyMotion(page, spec);
});

await server.close();
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} scenarios passed`);
if (shots) {
  const { writeFile } = await import('node:fs/promises');
  await writeFile(join(shots, 'results.json'), JSON.stringify(results, null, 2));
}
process.exit(failed.length ? 1 : 0);
