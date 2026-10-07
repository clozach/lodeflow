import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { chromium, firefox, webkit } from "playwright";
const bundle = await readFile(process.env.LF_BUNDLE || new URL("../dist/lode-flow.iife.js", import.meta.url));
const server = createServer((req, res) => {
  res.setHeader("content-type", req.url === "/bundle.js" ? "text/javascript" : "text/html");
  res.end(req.url === "/bundle.js" ? bundle : '<!doctype html><style>body{margin:0}lode-flow{height:100vh}</style><script src="/bundle.js"><\/script><lode-flow theme="blueprint"></lode-flow>');
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${server.address().port}`;
const seed = { nodes: [{ id: "a", text: "I flip it" }, { id: "b", text: "I eat grits" }, { id: "c", text: "I eat oats" }, { id: "d", text: "I eat toast" }], edges: [{ id: "ab", from: "a", to: "b", label: "OR" }], groups: [], junctions: [], settings: { orientation: "lr" } };
const results = [];
const state = (p) => p.locator("lode-flow").evaluate((f) => ({ doc: f.doc, selection: f.selection, camera: f.camera }));
const select = (p, id) => p.locator("lode-flow").evaluate((f, id2) => {
  f.select([id2]);
  f.focus();
}, id);
const fork = (p) => p.waitForFunction(() => document.querySelector("lode-flow").doc.junctions.some((j) => j.kind === "fork"), null, { timeout: 5e3 });
const settle = (p) => p.waitForTimeout(200);
async function check(engine, name, label, fn, touch = false) {
  const browser = await engine.launch(), context = await browser.newContext({ viewport: { width: touch ? 440 : 1100, height: 800 }, hasTouch: touch, reducedMotion: "reduce" }), p = await context.newPage(), errors = [];
  p.setDefaultTimeout(5e3);
  p.on("pageerror", (e) => errors.push(e.message));
  try {
    await p.goto(url);
    await p.waitForFunction(() => document.querySelector("lode-flow")?.layoutInfo);
    await p.locator("lode-flow").evaluate((f, doc) => {
      f.tun.animation = 0;
      f.setDoc(doc);
    }, seed);
    await settle(p);
    await fn(p);
    assert.deepEqual(errors, []);
    results.push(true);
    console.log(`\u2713 ${name}: ${label}`);
  } catch (e) {
    results.push(false);
    console.error(`\u2717 ${name}: ${label}
${e.stack}`);
  } finally {
    await context.close();
    await browser.close();
  }
}
try {
  for (const [name, engine] of Object.entries({ chromium, firefox, webkit })) {
    if (process.env.BROWSERS && !process.env.BROWSERS.split(",").includes(name)) continue;
    await check(engine, name, "Add effect shares the trunk and label; undo and redo retain its shape", async (p) => {
      await select(p, "ab");
      await p.locator('.node-magnet [data-act="effect"]').click();
      await p.locator("textarea").fill("I eat rice");
      await p.keyboard.press("Enter");
      await fork(p);
      let s = await state(p), j = s.doc.junctions[0];
      assert.equal(s.doc.edges.find((e) => e.id === "ab").to, j.id);
      assert.equal(s.doc.edges.filter((e) => e.from === j.id).length, 2);
      assert.equal(s.doc.edges.filter((e) => e.label === "OR").length, 1);
      await settle(p);
      assert.equal(await p.locator('.carrier[data-eid="ab"]').count(), 1);
      const arrows = await p.locator("lode-flow").evaluate((f) => [...f.edgeEls].filter(([id, el]) => el.arrow.getAttribute("d")).map(([id]) => id));
      assert.equal(arrows.length, 2);
      assert.ok(!arrows.includes("ab"));
      await p.keyboard.press("ControlOrMeta+z");
      assert.equal((await state(p)).doc.junctions.length, 0);
      await p.keyboard.press("ControlOrMeta+Shift+z");
      await fork(p);
    });
    await check(engine, name, "edge picker branches to existing nodes and preserves the shared label on every branch", async (p) => {
      await select(p, "ab");
      await p.keyboard.press("e");
      await p.locator(".lk-filter").fill("oats");
      await p.locator(".lk-list li[data-i]").click();
      await fork(p);
      await p.locator(".lk-filter").fill("toast");
      await p.locator(".lk-list li[data-i]").click();
      await p.keyboard.press("Escape");
      let s = await state(p), j = s.doc.junctions[0];
      assert.equal(s.doc.edges.filter((e) => e.from === j.id).length, 3);
      const branch = s.doc.edges.find((e) => e.to === "c");
      await select(p, branch.id);
      await p.keyboard.press("Enter");
      await p.locator("textarea").fill("Choose");
      await p.keyboard.press("Enter");
      s = await state(p);
      assert.equal(s.doc.edges.find((e) => e.id === "ab").label, "Choose");
      assert.equal(s.doc.edges.filter((e) => e.label).length, 1);
      await p.keyboard.press("Backspace");
      s = await state(p);
      assert.equal(s.doc.junctions.length, 1);
      assert.equal(s.doc.edges.filter((e) => e.from === j.id).length, 2);
      await select(p, "ab");
      await p.locator('.node-magnet [data-act="delete"]').click();
      assert.equal((await state(p)).doc.edges.length, 0);
    });
    await check(engine, name, "reverse node picker branches from an edge and S selects the touching branch", async (p) => {
      await select(p, "c");
      await p.keyboard.press("Shift+e");
      await p.locator(".lk-filter").fill("OR");
      await p.locator(".lk-list li[data-i]").click();
      await fork(p);
      await p.keyboard.press("Escape");
      const s = await state(p), branch = s.doc.edges.find((e) => e.to === "c");
      await select(p, "c");
      await p.keyboard.press("s");
      assert.deepEqual((await state(p)).selection, [branch.id]);
      await select(p, "ab");
      await settle(p);
      assert.equal(await p.locator("path.edge.sel").count(), 3);
    });
    await check(engine, name, "dragging an edge onto a node creates an outgoing fork", async (p) => {
      const a = await p.locator("lode-flow").evaluate((f) => {
        const path = f.edgeEls.get("ab").path, pt = path.getPointAtLength(path.getTotalLength() / 2), m = path.getScreenCTM();
        return { x: m.a * pt.x + m.c * pt.y + m.e, y: m.b * pt.x + m.d * pt.y + m.f };
      }), b = await p.locator('.node[data-id="c"]').boundingBox();
      await p.mouse.move(a.x, a.y);
      await p.mouse.down();
      await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 15 });
      await p.mouse.up();
      await fork(p);
      assert.equal((await state(p)).doc.edges.filter((e) => e.to === "c").length, 1);
    });
    await check(engine, name, "forks round-trip with history, collapse with their group and respect the item limit", async (p) => {
      await select(p, "ab");
      await p.keyboard.press("e");
      await p.locator(".lk-filter").fill("oats");
      await p.locator(".lk-list li[data-i]").click();
      await fork(p);
      await p.keyboard.press("Escape");
      const saved = await p.locator("lode-flow").evaluate((f) => f.getState());
      await p.reload();
      await p.waitForFunction(() => document.querySelector("lode-flow")?.layoutInfo);
      await p.locator("lode-flow").evaluate((f, s) => f.setState(s), saved);
      await fork(p);
      assert.deepEqual((await state(p)).doc, saved.doc);
      await p.locator("lode-flow").evaluate((f) => {
        const d = f.doc;
        f.setDoc({ ...d, groups: [{ id: "g", text: "Choices", collapsed: true }], nodes: d.nodes.map((n) => ({ ...n, group: "g" })) });
      });
      await settle(p);
      assert.equal(await p.locator("lode-flow").evaluate((f) => [...f.carrierEls.values()].filter((e) => getComputedStyle(e).visibility !== "hidden" && +e.style.opacity > 0.5).length), 0);
      await p.locator("lode-flow").evaluate((f, d) => {
        f.setDoc(d);
        f.setAttribute("max-items", "6");
      }, seed);
      await select(p, "ab");
      await p.locator('.node-magnet [data-act="effect"]').click();
      assert.equal((await state(p)).doc.junctions.length, 0);
      assert.equal((await state(p)).doc.nodes.length, 4);
    });
    await check(engine, name, "checked destinations form one undo step; reverse edge picker still merges", async (p) => {
      await select(p, "ab");
      await p.keyboard.press("e");
      await p.locator('[data-k="node:c"] .lk-ck').click();
      await p.locator('[data-k="node:d"] .lk-ck').click();
      await p.keyboard.press("Enter");
      await fork(p);
      await p.keyboard.press("Escape");
      assert.equal((await state(p)).doc.edges.length, 4);
      await p.keyboard.press("ControlOrMeta+z");
      assert.equal((await state(p)).doc.edges.length, 1);
      await select(p, "ab");
      await p.keyboard.press("Shift+e");
      await p.locator('.lk-filter').fill("oats");
      await p.locator('.lk-list li[data-i]').click();
      await settle(p);
      assert.equal((await state(p)).doc.junctions[0].kind, "merge");
      await p.locator('.lk-filter').fill("toast");
      await p.locator('.lk-list li[data-i]').click();
      assert.equal((await state(p)).doc.edges.length, 4);
    });
    await check(engine, name, "an empty new effect leaves the original labelled edge intact", async (p) => {
      await select(p, "ab");
      await p.locator('.node-magnet [data-act="effect"]').click();
      await p.keyboard.press("Escape");
      const s = await state(p);
      assert.equal(s.doc.junctions.length, 0);
      assert.deepEqual(s.doc.edges.map(({id,from,to,label})=>({id,from,to,label})), seed.edges);
      assert.equal(s.doc.nodes.length, seed.nodes.length);
    });
    if (name === "chromium") await check(engine, name, "touch Add effect is reachable and omits keyboard hints", async (p) => {
      await select(p, "ab");
      await p.locator('.node-magnet [data-act="effect"]').tap();
      await p.locator("textarea").fill("I eat rice");
      await p.keyboard.press("Enter");
      await fork(p);
      assert.equal(await p.locator("lode-flow").evaluate((f) => [...f.shadowRoot.querySelectorAll("kbd")].filter((e) => e.getBoundingClientRect().width).length), 0);
    }, true);
  }
} finally {
  server.close();
}
console.log(`
${results.filter(Boolean).length}/${results.length} fork browser checks pass`);
if (results.some((x) => !x)) process.exitCode = 1;
