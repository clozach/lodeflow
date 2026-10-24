// theditor in nodes (lodeflow/theditor): Edit mode with theditor, saved formatted documents,
// pasted images as inline thumbs, links, Help, and the plain fallback without the entry.
//   node test/theditor.mjs          (BROWSERS=chromium,webkit picks engines)
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { chromium, firefox, webkit } from 'playwright';

const core = await readFile(new URL('../dist/lode-flow.iife.js', import.meta.url));
const theditor = await readFile(new URL('../dist/theditor.iife.js', import.meta.url));
const html = (withTheditor) => `<!doctype html><style>body{margin:0}lode-flow{height:100vh}</style>
<script src="/core.js"></script>${withTheditor ? '<script src="/theditor.js"></script>' : ''}<lode-flow></lode-flow>`;
/** examples/theditor.html's shape: both classic scripts in <head>, the diagram as inline JSON after them. */
const headPage = (doc) => `<!doctype html><head><style>body{margin:0}lode-flow{height:100vh}</style>
<script src="/core.js"></script><script src="/theditor.js"></script></head>
<body><lode-flow><script type="application/json">${JSON.stringify(doc)}</script></lode-flow></body>`;
const server = createServer((req, res) => {
  const js = { '/core.js': core, '/theditor.js': theditor }[req.url];
  res.setHeader('content-type', js ? 'text/javascript' : 'text/html');
  res.end(js ?? (req.url === '/head' ? headPage({ ...seed, nodes: [{ id: 'a', text: '', content: boldDoc }, seed.nodes[1]] }) : html(req.url !== '/plain')));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}`;
const META = 'ControlOrMeta';
const seed = { nodes: [{ id: 'a', text: 'First' }, { id: 'b', text: 'Next' }], edges: [{ id: 'ab', from: 'a', to: 'b' }], settings: { orientation: 'lr' } };
const boldDoc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'bold', marks: [{ type: 'bold' }] }, { type: 'text', text: ' words' }] }] };
const results = [];
const flow = (p, fn, arg) => p.locator('lode-flow').evaluate(fn, arg);
const settle = (p, ms = 250) => p.waitForTimeout(ms);
const node = (p, id) => flow(p, (f, id) => f.doc.nodes.find((n) => n.id === id), id);
async function load(p, doc = seed, sel = ['a']) {
  await flow(p, (f, { doc, sel }) => { f.tun.animation = 0; f.setDoc(doc, { discardPendingSave: true }); f.select(sel); f.focus(); }, { doc, sel });
  await settle(p);
}
/** Enter Edit mode on the selected node with ↵. */
async function edit(p) {
  await p.keyboard.press('Enter');
  await p.waitForFunction(() => !!document.querySelector('lode-flow').shadowRoot.querySelector('.fm-ed .ProseMirror-focused'));
}
/** Paste image files into the active editor, the way a clipboard paste reaches ProseMirror. */
const pasteImages = (p, sizes) => flow(p, async (f, sizes) => {
  const dt = new DataTransfer();
  for (const [w, h, color] of sizes) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const x = c.getContext('2d');
    x.fillStyle = color; x.fillRect(0, 0, w, h);
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    dt.items.add(new File([blob], `${color}.png`, { type: 'image/png' }));
  }
  const pm = f.shadowRoot.querySelector('.fm-ed .ProseMirror');
  const e = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(e, 'clipboardData', { value: dt });
  pm.dispatchEvent(e);
}, sizes);

async function check(engine, name, label, path, fn) {
  const browser = await engine.launch(), context = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' }), p = await context.newPage(), errors = [];
  p.setDefaultTimeout(6e3);
  p.on('pageerror', (e) => errors.push(e.message));
  try {
    await p.goto(url + path);
    await p.waitForFunction(() => document.querySelector('lode-flow')?.layoutInfo);
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

for (const [name, engine] of Object.entries({ chromium, firefox, webkit })) {
  if (process.env.BROWSERS && !process.env.BROWSERS.split(',').includes(name)) continue;

  await check(engine, name, 'Edit mode opens theditor with everything selected', '/', async (p) => {
    await load(p);
    await edit(p);
    assert.equal(await flow(p, (f) => f.shadowRoot.querySelectorAll('textarea').length), 0, 'no textarea');
    await p.keyboard.type('X');
    await p.keyboard.press('Enter');
    await settle(p);
    assert.equal((await node(p, 'a')).text, 'X', 'typing replaced the whole text');
    assert.equal(await flow(p, (f) => !!f.editing), false, '↵ saved and left Edit mode');
    assert.deepEqual(await flow(p, (f) => f.selection), ['a']);
  });

  await check(engine, name, 'typed *bold* saves a document with a bold mark; its text is derived', '/', async (p) => {
    await load(p);
    await edit(p);
    await p.keyboard.type('*bold* words');
    await p.keyboard.press('Enter');
    await settle(p);
    const n = await node(p, 'a');
    assert.equal(n.text, '**bold** words', 'text is formattedText(content)');
    assert.deepEqual(n.content, boldDoc);
    assert.equal(await flow(p, (f) => f.shadowRoot.querySelector('.node[data-id="a"] .t strong')?.textContent), 'bold', 'the node draws it bold');
    assert.equal(await flow(p, (f) => f.hist.peekUndo().label), 'Edit ‘**bold** words’');
    await p.keyboard.press(`${META}+z`);
    await settle(p);
    assert.deepEqual(await node(p, 'a'), { id: 'a', text: 'First' }, 'one Undo puts the plain node back');
  });

  await check(engine, name, '⇧↵ makes a new paragraph or list item; ↵ saves', '/', async (p) => {
    await load(p);
    await edit(p);
    await p.keyboard.type('one');
    await p.keyboard.press('Shift+Enter');
    await p.keyboard.type('two');
    assert.equal(await flow(p, (f) => f.shadowRoot.querySelectorAll('.fm-ed p').length), 2, 'two paragraphs while editing');
    await p.keyboard.press('Enter');
    await settle(p);
    assert.deepEqual(await node(p, 'a'), { id: 'a', text: 'one\ntwo' }, 'plain paragraphs are stored as text alone');
    await edit(p);
    await p.keyboard.type('- one');
    await p.keyboard.press('Shift+Enter');
    await p.keyboard.type('two');
    await p.keyboard.press('Enter');
    await settle(p);
    const n = await node(p, 'a');
    assert.equal(n.text, '- one\n- two');
    assert.equal(n.content.content[0].type, 'bulletList');
    assert.equal(n.content.content[0].content.length, 2);
    assert.equal(await flow(p, (f) => f.shadowRoot.querySelectorAll('.node[data-id="a"] .t li').length), 2);
  });

  await check(engine, name, 'Esc saves and keeps the node selected; ⌘↵ on a plain line changes nothing', '/', async (p) => {
    await load(p);
    await edit(p);
    await p.keyboard.type('_kept_');
    await p.keyboard.press('Escape');
    await settle(p);
    const n = await node(p, 'a');
    assert.equal(n.text, '_kept_');
    assert.equal(n.content.content[0].content[0].marks[0].type, 'italic');
    assert.equal(await flow(p, (f) => !!f.editing), false);
    assert.deepEqual(await flow(p, (f) => f.selection), ['a']);
    const before = await flow(p, (f) => ({ doc: f.doc, entries: f.hist.entries.length }));
    await edit(p);
    await p.keyboard.press(`${META}+Enter`);
    await settle(p);
    assert.equal(await flow(p, (f) => f.editing?.kind === 'node' && f.editing.id), 'a', 'still editing the same node');
    assert.equal(await flow(p, (f) => f.shadowRoot.querySelector('.fm-ed .ProseMirror').textContent), 'kept', 'the words are untouched');
    assert.deepEqual(await flow(p, (f) => ({ doc: f.doc, entries: f.hist.entries.length })), before, 'no save, no new node');
    await p.keyboard.press('Enter');
    await settle(p);
    assert.deepEqual((await node(p, 'a')).content, n.content, 'formatting unchanged by an unchanged save');
  });

  await check(engine, name, 'a new node opens an editor the width of the node, showing “Type…”', '/', async (p) => {
    await load(p);
    await p.keyboard.press('n');
    await p.waitForFunction(() => !!document.querySelector('lode-flow').shadowRoot.querySelector('.fm-ed .ProseMirror-focused'));
    await settle(p, 400);
    const m = await flow(p, (f) => {
      const ed = f.shadowRoot.querySelector('.fm-ed'), pm = ed.querySelector('.ProseMirror'), t = ed.closest('.t');
      return { ed: ed.getBoundingClientRect().width, pm: pm.getBoundingClientRect().width, t: t.getBoundingClientRect().width, position: getComputedStyle(ed).position, ph: getComputedStyle(ed, '::before').content };
    });
    assert.equal(m.position, 'relative', 'not the empty-canvas hint’s absolute box');
    assert.ok(Math.abs(m.ed - m.t) < 1 && Math.abs(m.pm - m.t) < 1, `editor ${m.ed} / ${m.pm} px fills the node's text box ${m.t} px`);
    assert.equal(m.ph, '"Type…"', 'the placeholder shows');
    await p.keyboard.type('Third');
    await p.keyboard.press('Enter');
    await settle(p);
    assert.equal(await flow(p, (f) => f.doc.nodes.at(-1).text), 'Third');
  });

  await check(engine, name, '⌘↵ on a to-do line ticks its box; the saved document keeps it and no node is added', '/', async (p) => {
    await load(p);
    await edit(p);
    await p.keyboard.type('- [ ] milk');
    await p.keyboard.press('Shift+Enter');
    await p.keyboard.type('eggs');
    const nodes = await flow(p, (f) => f.doc.nodes.length);
    await p.keyboard.press(`${META}+Enter`);
    assert.deepEqual(await flow(p, (f) => [...f.shadowRoot.querySelectorAll('.fm-ed ul[data-type="taskList"] > li')].map((li) => li.dataset.checked)), ['false', 'true'], 'the caret’s line is ticked, the other not');
    assert.equal(await flow(p, (f) => !!f.editing), true, 'still in Edit mode');
    await p.keyboard.press(`${META}+Enter`);
    assert.equal(await flow(p, (f) => f.shadowRoot.querySelector('.fm-ed ul[data-type="taskList"] > li:last-child').dataset.checked), 'false', 'a second ⌘↵ unticks it');
    await p.keyboard.press(`${META}+Enter`);
    await p.keyboard.press('Enter');
    await settle(p);
    assert.equal(await flow(p, (f) => f.doc.nodes.length), nodes, 'no node was added');
    const n = await node(p, 'a');
    const items = n.content.content[0].content;
    assert.equal(n.content.content[0].type, 'taskList');
    assert.deepEqual(items.map((i) => i.attrs.checked), [false, true], 'the saved document holds the tick');
    assert.equal(n.text, '- [ ] milk\n- [x] eggs');
    assert.deepEqual(await flow(p, (f) => [...f.shadowRoot.querySelectorAll('.node[data-id="a"] .t input[type="checkbox"]')].map((i) => i.checked)), [false, true], 'the node draws the tick');
    await p.keyboard.press(`${META}+z`);
    await settle(p);
    assert.deepEqual(await node(p, 'a'), { id: 'a', text: 'First' }, 'one Undo takes back the edit');
  });

  await check(engine, name, '⌘↵ on a toggle closes and opens it; open or closed is not stored', '/', async (p) => {
    await load(p);
    await edit(p);
    await p.keyboard.type('>v Summary');
    await p.keyboard.press('Shift+Enter');
    await p.keyboard.type('inside');
    const shown = () => flow(p, (f) => {
      const d = f.shadowRoot.querySelector('.fm-ed .kk-fm-details');
      return { open: d.dataset.open ?? 'true', contents: getComputedStyle(d.querySelector('.kk-fm-details-content')).display !== 'none', marker: getComputedStyle(d.querySelector('.kk-fm-summary'), '::before').content };
    });
    assert.deepEqual(await shown(), { open: 'true', contents: true, marker: '"▾"' }, 'a new toggle is open');
    await p.keyboard.press(`${META}+Enter`);
    assert.deepEqual(await shown(), { open: 'false', contents: false, marker: '"▸"' }, '⌘↵ from inside closes it');
    await p.keyboard.press(`${META}+Enter`);
    assert.deepEqual(await shown(), { open: 'true', contents: true, marker: '"▾"' }, 'and again opens it');
    await p.keyboard.press(`${META}+Enter`);
    await p.keyboard.press('Enter');
    await settle(p);
    const n = await node(p, 'a');
    assert.equal(n.content.content[0].type, 'details');
    assert.equal(JSON.stringify(n.content).includes('open'), false, 'nothing about open or closed in the document');
    assert.equal(await flow(p, (f) => getComputedStyle(f.shadowRoot.querySelector('.node[data-id="a"] .kk-fm-details-content')).display !== 'none'), true, 'the drawn node shows what it opens to');
  });

  await check(engine, name, 'a pasted image becomes a thumb a third of the text width; three share a row', '/', async (p) => {
    await load(p);
    await edit(p);
    await p.keyboard.press('Backspace'); // the words were selected: a line of images alone
    await pasteImages(p, [[300, 200, 'red'], [200, 300, 'green'], [400, 400, 'blue']]);
    await p.waitForFunction(() => document.querySelector('lode-flow').shadowRoot.querySelectorAll('.fm-ed .kk-fm-image').length === 3);
    await p.keyboard.press('Enter');
    await settle(p, 400);
    const n = await node(p, 'a');
    const images = n.content.content.flatMap((b) => b.content ?? []).filter((i) => i.type === 'image');
    assert.equal(images.length, 3);
    for (const image of images) {
      assert.deepEqual(Object.keys(image.attrs), ['src'], 'defaults are left out');
      assert.match(image.attrs.src, /^data:image\/(webp|png);base64,/);
    }
    assert.equal(n.text, '![]![]![]', 'each image reads as ![] in the text');
    await p.waitForFunction(() => [...document.querySelector('lode-flow').shadowRoot.querySelectorAll('.node[data-id="a"] .kk-fm-image img')].every((i) => i.complete && i.naturalWidth));
    const m = await flow(p, (f) => {
      const t = f.shadowRoot.querySelector('.node[data-id="a"] .t');
      const tw = t.getBoundingClientRect().width;
      const boxes = [...t.querySelectorAll('.kk-fm-image')].map((e) => { const r = e.getBoundingClientRect(); return { w: r.width, h: r.height, top: r.top }; });
      const row = t.querySelector('.kk-fm-image').parentElement.getBoundingClientRect().width;
      const radius = getComputedStyle(t.querySelector('.kk-fm-image')).borderRadius;
      return { tw, row, boxes, radius };
    });
    // The row lends its trailing gap back (8 px past the text), so three thumbs and three gaps fill it.
    assert.ok(Math.abs(m.row - (m.tw + 8)) < 1, `row ${m.row} = text width ${m.tw} + one gap`);
    const want = 0.333 * m.row - 8;
    for (const b of m.boxes) assert.ok(Math.abs(b.w - want) < 1, `thumb width ${b.w} ≈ ${want} (a third of the text width)`);
    assert.ok(m.boxes.every((b) => Math.abs(b.top - m.boxes[0].top) < 1), `three thumbs share one row: ${m.boxes.map((b) => b.top)}`);
    assert.ok(m.boxes[1].h > m.boxes[0].h && m.boxes[2].h > m.boxes[0].h, 'proportional to the originals (tall > square > wide)');
    assert.equal(m.radius, '10px', 'round-rect plain look');
    // A fourth wraps to the next row.
    await edit(p);
    await p.keyboard.press('ArrowRight'); // from everything selected to the end
    await pasteImages(p, [[100, 100, 'gold']]);
    await p.waitForFunction(() => document.querySelector('lode-flow').shadowRoot.querySelectorAll('.fm-ed .kk-fm-image').length === 4);
    await p.keyboard.press('Enter');
    await settle(p, 400);
    const tops = await flow(p, (f) => [...f.shadowRoot.querySelectorAll('.node[data-id="a"] .kk-fm-image')].map((e) => e.getBoundingClientRect().top));
    assert.ok(tops[3] > tops[2] + 10, 'the fourth image starts a new row');
  });

  await check(engine, name, 'a dropped image file lands where it was dropped', '/', async (p) => {
    await load(p);
    await edit(p);
    await p.keyboard.press('ArrowRight');
    await flow(p, async (f) => {
      const c = document.createElement('canvas');
      c.width = 2400; c.height = 1200;
      c.getContext('2d').fillRect(0, 0, 2400, 1200);
      const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
      const dt = new DataTransfer();
      dt.items.add(new File([blob], 'wide.png', { type: 'image/png' }));
      const pm = f.shadowRoot.querySelector('.fm-ed .ProseMirror');
      const r = pm.getBoundingClientRect();
      const e = new Event('drop', { bubbles: true, cancelable: true });
      Object.defineProperties(e, { dataTransfer: { value: dt }, clientX: { value: r.right - 2 }, clientY: { value: r.top + r.height / 2 } });
      pm.dispatchEvent(e);
    });
    await p.waitForFunction(() => document.querySelector('lode-flow').shadowRoot.querySelectorAll('.fm-ed .kk-fm-image').length === 1);
    await p.keyboard.press('Enter');
    await settle(p);
    const n = await node(p, 'a');
    assert.equal(n.text, 'First![]', 'the image follows the words');
    const size = await flow(p, (f) => new Promise((r) => { const i = new Image(); i.onload = () => r([i.naturalWidth, i.naturalHeight]); i.src = f.doc.nodes[0].content.content[0].content[1].attrs.src; }));
    assert.deepEqual(size, [1024, 512], 'downscaled to 1024 px on its long side, proportions kept');
  });

  await check(engine, name, 'links from the link mark open in a new tab without selecting or editing', '/', async (p) => {
    const href = `${url}/source?from=formatted`;
    const content = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'See ' }, { type: 'text', text: 'source', marks: [{ type: 'link', attrs: { href } }] }] }] };
    await load(p, { ...seed, nodes: [{ id: 'a', text: '', content }, seed.nodes[1]] }, ['b']);
    assert.equal((await node(p, 'a')).text, `See [source](${href})`);
    const link = p.locator('.node[data-id="a"] a.node-link');
    assert.equal(await link.getAttribute('href'), href);
    assert.equal(await link.getAttribute('target'), '_blank');
    assert.equal(await link.getAttribute('rel'), 'noopener noreferrer');
    const before = await flow(p, (f) => ({ doc: f.doc, sel: f.selection, entries: f.hist.entries.length }));
    const opened = p.waitForEvent('popup');
    await link.click();
    const tab = await opened;
    await tab.close();
    assert.deepEqual(await flow(p, (f) => ({ doc: f.doc, sel: f.selection, entries: f.hist.entries.length })), before);
    assert.equal(await flow(p, (f) => !!f.editing), false);
  });

  await check(engine, name, 'refused content is dropped on load; copy and paste carry formatting', '/', async (p) => {
    const bad = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'image', attrs: { src: 'javascript:alert(1)' } }] }] };
    await load(p, { ...seed, nodes: [{ id: 'a', text: 'Safe words', content: bad }, { id: 'b', text: '', content: boldDoc }] }, ['b']);
    assert.deepEqual(await node(p, 'a'), { id: 'a', text: 'Safe words' }, 'a document the model refuses is dropped');
    assert.equal((await node(p, 'b')).text, '**bold** words', 'valid content: words derived on load');
    assert.equal(await flow(p, (f) => f.shadowRoot.querySelectorAll('img').length), 0);
    await p.keyboard.press(`${META}+c`);
    await p.keyboard.press(`${META}+v`);
    await settle(p);
    const copies = await flow(p, (f) => f.doc.nodes.filter((n) => n.id !== 'b' && n.text === '**bold** words'));
    assert.equal(copies.length, 1);
    assert.deepEqual(copies[0].content, boldDoc);
  });

  await check(engine, name, 'Help lists typed formatting, ⌘↵ and image pasting', '/', async (p) => {
    await load(p, seed, []);
    await flow(p, (f) => f.openHelp());
    await settle(p);
    const text = await p.locator('lode-flow').evaluate((f) => f.shadowRoot.querySelector('.help').textContent);
    for (const words of ['Writing in a node', '*words* or **words**', '- [ ] ', '>v ', '[words](https://…)', '⇧↵', 'Tick or untick a to-do, open or close a toggle', 'Paste or drop an image']) assert.ok(text.includes(words), words);
  });

  await check(engine, name, 'without theditor: words shown, plain editor, changed words drop formatting', '/plain', async (p) => {
    await load(p, { ...seed, nodes: [{ id: 'a', text: '', content: boldDoc }, seed.nodes[1]] });
    assert.equal((await node(p, 'a')).text, '**bold** words');
    assert.equal(await flow(p, (f) => f.shadowRoot.querySelector('.node[data-id="a"] .t').textContent), '**bold** words');
    assert.equal(await flow(p, (f) => f.shadowRoot.querySelectorAll('.t.fm, .fm-ed').length), 0);
    await flow(p, (f) => f.openHelp());
    assert.equal(await flow(p, (f) => f.shadowRoot.querySelector('.help').textContent.includes('Writing in a node')), false);
    await flow(p, (f) => { f.closeHelp(); f.select(['a']); f.focus(); });
    await p.keyboard.press('Enter');
    await p.waitForSelector('lode-flow >> textarea.ed');
    await p.keyboard.press('Escape');
    await settle(p);
    assert.deepEqual((await node(p, 'a')).content, boldDoc, 'unchanged words keep the formatting');
    await p.keyboard.press('Enter');
    await p.waitForSelector('lode-flow >> textarea.ed');
    await p.keyboard.type('plain now');
    await p.keyboard.press('Enter');
    await settle(p);
    assert.deepEqual(await node(p, 'a'), { id: 'a', text: 'plain now' }, 'changed words drop it');
  });

  await check(engine, name, 'editor="plain" keeps the plain editor while theditor is loaded', '/', async (p) => {
    await flow(p, (f) => f.setAttribute('editor', 'plain'));
    await load(p, { ...seed, nodes: [{ id: 'a', text: '', content: boldDoc }, seed.nodes[1]] });
    assert.equal(await flow(p, (f) => f.shadowRoot.querySelector('.node[data-id="a"] .t strong')?.textContent), 'bold', 'still drawn formatted');
    await p.keyboard.press('Enter');
    await p.waitForSelector('lode-flow >> textarea.ed');
    assert.equal(await flow(p, (f) => f.shadowRoot.querySelector('textarea.ed').value), '**bold** words');
    assert.deepEqual(await flow(p, (f) => { const t = f.shadowRoot.querySelector('textarea.ed'); return [t.selectionStart, t.selectionEnd]; }), [0, 14], 'whole text selected');
    await p.keyboard.press('Escape');
  });

  await check(engine, name, 'scripts in <head> still read the inline JSON written after them', '/head', async (p) => {
    assert.equal(await flow(p, (f) => f.shadowRoot.querySelectorAll('.node').length), 2, 'both nodes drawn');
    assert.equal(await flow(p, (f) => f.shadowRoot.querySelector('.node[data-id="a"] .t strong')?.textContent), 'bold', 'formatted content drawn');
    assert.equal((await node(p, 'b')).text, 'Next');
  });
}

server.close();
const ok = results.filter(Boolean).length;
console.log(`\n${ok}/${results.length} theditor checks pass`);
if (ok !== results.length) process.exit(1);
