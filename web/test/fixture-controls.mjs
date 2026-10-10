// Model and platform-adapter contracts; browser interaction is covered by the manual fixture.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const load = async (name) => {
  const out = await build({ entryPoints: [new URL(`../src/${name}.ts`, import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'error' });
  return import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));
};
const [{ nodeTextParts }, { removeNodesFromGroup, normalizeDoc }, { History }, { fullscreenControl }] = await Promise.all(['node-links', 'model', 'history', 'fullscreen'].map(load));
let checks = 0;
const check = async (fn) => { await fn(); checks++; };
const site = 'https://example.com/messages?conversation=177';
for (const text of [site, `Source: ${site}.`, `(${site})`, `https://example.org/wiki/Practice_(yoga).`, '<script>alert(1)</script>', 'javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'https://', `http://localhost:5198/path?q=one&other=two#part`, 'https://x.test/"><svg onload=alert(1)>']) {
  await check(() => {
    const parts = nodeTextParts(text);
    assert.equal(parts.map((p) => p.text).join(''), text, 'link rendering preserves every source character');
    assert.ok(parts.filter((p) => p.href).every((p) => ['http:', 'https:'].includes(new URL(p.href).protocol)));
  });
}
await check(() => assert.deepEqual(nodeTextParts(`(${site}).`), [{ text: '(' }, { text: site, href: site }, { text: ').' }]));
await check(() => assert.equal(nodeTextParts('https://example.org/wiki/Practice_(yoga).')[0].href, 'https://example.org/wiki/Practice_(yoga)'));
await check(() => assert.ok(nodeTextParts('javascript:alert(1) data:text/html,test //x.test').every((p) => !p.href)));
const doc = normalizeDoc({ nodes: [{ id: 'a', text: 'Nested', group: 'inner' }, { id: 'b', text: 'Sibling', group: 'inner' }, { id: 'c', text: 'Outer', group: 'outer' }, { id: 'd', text: 'Root' }], groups: [{ id: 'outer', text: 'Outer' }, { id: 'inner', text: 'Inner', parent: 'outer' }], edges: [{ id: 'ab', from: 'a', to: 'b', label: 'status' }] });
const original = structuredClone(doc);
const moved = removeNodesFromGroup(doc, ['a', 'c', 'd', 'inner', 'ab', 'unknown']);
await check(() => {
  assert.deepEqual(moved.nodes.map((n) => n.group ?? null), ['outer', 'inner', null, null]);
  assert.equal(moved.groups, doc.groups, 'groups and siblings remain intact');
  assert.equal(moved.edges, doc.edges, 'connections and labels remain intact');
  assert.deepEqual(doc, original, 'the original document remains a valid undo snapshot');
});
await check(() => {
  const root = removeNodesFromGroup(moved, ['a']);
  assert.equal(root.nodes[0].group, null);
  assert.equal(removeNodesFromGroup(root, ['a', 'd', 'unknown']), root, 'a root-only selection is a true no-op');
});
await check(() => {
  const view = { sel: ['a', 'c'], cam: { x: 0, y: 0, z: 1, r: 0 }, follow: true };
  const history = new History();
  history.push({ label: 'Remove from group', kind: 'ungroup', before: { doc, view }, after: { doc: moved, view }, t: 1 });
  const restored = History.fromJSON(history.toJSON());
  assert.deepEqual(restored.undo().before.doc, doc);
  assert.deepEqual(restored.redo().after.doc, moved);
  assert.deepEqual(restored.peekUndo().after.view.sel, view.sel);
});
const platform = ({ native = true, denied = false } = {}) => {
  const ownerDocument = new EventTarget(); ownerDocument.fullscreenEnabled = native;
  const attrs = new Map();
  let nativeOpen = false, popoverOpen = false, changes = 0;
  const messages = [];
  const host = {
    ownerDocument,
    matches: () => nativeOpen,
    requestFullscreen: async () => { if (denied) throw Error('embed policy'); nativeOpen = true; ownerDocument.dispatchEvent(new Event('fullscreenchange')); },
    showPopover: () => { popoverOpen = true; }, hidePopover: () => { popoverOpen = false; },
    hasAttribute: (key) => attrs.has(key), setAttribute: (key, value) => attrs.set(key, value), removeAttribute: (key) => attrs.delete(key),
  };
  ownerDocument.exitFullscreen = async () => { nativeOpen = false; ownerDocument.dispatchEvent(new Event('fullscreenchange')); };
  const control = fullscreenControl(host, () => changes++, (m) => messages.push(m));
  control.connect();
  return { control, ownerDocument, attrs, messages, state: () => ({ nativeOpen, popoverOpen, changes }) };
};
await check(async () => {
  const p = platform();
  await p.control.toggle(); assert.equal(p.control.active(), true); assert.equal(p.state().nativeOpen, true);
  await p.control.toggle(); assert.equal(p.control.active(), false);
  assert.deepEqual(p.messages, []); p.control.disconnect();
});
await check(async () => {
  const p = platform();
  await p.control.toggle();
  const escape = new Event('keydown', { cancelable: true }); Object.defineProperty(escape, 'key', { value: 'Escape' });
  p.ownerDocument.dispatchEvent(escape);
  assert.equal(escape.defaultPrevented, true, 'native fullscreen Escape is consumed before canvas edits');
  assert.equal(p.control.active(), false); p.control.disconnect();
});
await check(async () => {
  const p = platform(); await p.control.toggle();
  await p.ownerDocument.exitFullscreen(); // WebView event order: close first, then deliver Escape.
  const escape = new Event('keydown', { cancelable: true }); Object.defineProperty(escape, 'key', { value: 'Escape' });
  p.ownerDocument.dispatchEvent(escape);
  assert.equal(escape.defaultPrevented, true, 'the trailing browser Escape cannot deselect the canvas');
  const next = new Event('keydown', { cancelable: true }); Object.defineProperty(next, 'key', { value: 'Escape' });
  p.ownerDocument.dispatchEvent(next); assert.equal(next.defaultPrevented, false, 'the next independent Escape keeps its ordinary meaning');
  p.control.disconnect();
});
for (const options of [{ native: false }, { denied: true }]) await check(async () => {
  const p = platform(options);
  await p.control.toggle(); assert.equal(p.control.active(), true); assert.equal(p.state().popoverOpen, true);
  const escape = new Event('keydown', { cancelable: true }); Object.defineProperty(escape, 'key', { value: 'Escape' });
  p.ownerDocument.dispatchEvent(escape);
  assert.equal(escape.defaultPrevented, true); assert.equal(p.control.active(), false); assert.equal(p.state().popoverOpen, false);
  assert.equal(p.attrs.size, 0, 'fallback attributes are removed on exit');
  await p.control.toggle(); p.control.disconnect(); assert.equal(p.state().popoverOpen, false); assert.equal(p.attrs.size, 0);
  assert.deepEqual(p.messages, []);
});
console.log(`✓ fixture controls: ${checks} URL, group/history and fullscreen platform checks`);
