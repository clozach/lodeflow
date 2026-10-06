// Times re-layout operations on a live <lode-flow>. Plain JavaScript, no imports: the Playwright
// harness (test/perf.mjs) loads it as a module and the stress page inlines it.
//
// Each sample is synchronous: the operation, then the element's own frame work (DOM update, text
// measuring, engine, first draw) run immediately instead of on the next display refresh, then a
// forced browser layout of what was written. So a sample is the time the page is busy, without the
// up-to-16 ms wait for the next frame. Painting on the GPU is not included.
//
// These call the element's internal methods (the same paths a click or key takes). They are test
// hooks, not public API, and may change with the element.

const raf = () => new Promise((r) => requestAnimationFrame(r));

/** Waits until the element has no frame pending and no animation running. */
export async function settle(f, maxFrames = 120) {
  for (let i = 0; i < maxFrames; i++) {
    await raf();
    if (!f.raf && !f.from && !f.camFrom) break;
  }
}

/** Runs the element's pending frame now. */
function flushNow(f) {
  if (f.raf) {
    cancelAnimationFrame(f.raf);
    f.raf = 0;
  }
  f.flush();
}

const nodesOf = (f) => f.doc.nodes.filter((n) => f.geo?.nodes.get(n.id)?.visible !== false);
const degree = (f) => {
  const d = new Map();
  for (const e of f.doc.edges) for (const x of [e.from, e.to]) d.set(x, (d.get(x) || 0) + 1);
  return d;
};
const hub = (f) => {
  const d = degree(f);
  let best = null;
  for (const n of nodesOf(f)) if (!best || (d.get(n.id) || 0) > (d.get(best) || 0)) best = n.id;
  return best;
};
const middle = (f) => {
  const ns = nodesOf(f);
  return ns[Math.floor(ns.length / 2)]?.id;
};
const plainEdge = (f) => {
  const j = new Set(f.doc.junctions.map((x) => x.id));
  const es = f.doc.edges.filter((e) => !j.has(e.from) && !j.has(e.to));
  return es[Math.floor(es.length / 2)]?.id;
};
const unlinkedPair = (f) => {
  const ns = nodesOf(f);
  const have = new Set(f.doc.edges.map((e) => e.from + '>' + e.to));
  for (let k = 0; k < ns.length; k++) {
    const a = ns[Math.floor(ns.length / 3)]?.id;
    const b = ns[(Math.floor((2 * ns.length) / 3) + k) % ns.length]?.id;
    if (a && b && a !== b && !have.has(a + '>' + b)) return [a, b];
  }
  return null;
};

/** The operations Al asked about (2026-10-01), plus the ones a person does most while editing. */
export const OPS = {
  reorient: {
    label: 'Reorient (Auto → top to bottom)',
    run: (f) => f.changeSetting('orientation', 'tb'),
    cleanup: (f) => f.undo(),
  },
  addNode: {
    label: 'Add a node on a new edge (N)',
    prepare: (f) => f.select([middle(f)]),
    run: (f) => f.addLinked(f.selection[0], 'after'),
    cleanup: (f) => f.finishEdit(false),
  },
  splitEdge: {
    label: 'Split an edge (edge selected, N)',
    prepare: (f) => f.select([plainEdge(f)]),
    run: (f) => f.splitEdge(f.selection[0]),
    cleanup: (f) => f.finishEdit(false),
  },
  deleteHub: {
    label: 'Delete the best-connected node',
    prepare: (f) => f.select([hub(f)]),
    run: (f) => f.deleteSelection(),
    cleanup: (f) => f.undo(),
  },
  undoDelete: {
    label: 'Undo that delete',
    prepare: (f) => {
      f.select([hub(f)]);
      f.deleteSelection();
    },
    run: (f) => f.undo(),
  },
  typeChar: {
    label: 'Type one character in a node',
    prepare: (f) => f.startEdit(middle(f)),
    run: (f) => {
      const ta = f.editing?.ta;
      if (!ta) return;
      ta.value += ' x';
      ta.dispatchEvent(new Event('input'));
    },
    cleanup: (f) => f.finishEdit(false),
  },
  link: {
    label: 'Link two nodes (drag or E)',
    run: (f) => {
      const p = unlinkedPair(f);
      if (p) f.performLink(p[0], { type: 'node', id: p[1] }, 'drag');
    },
    cleanup: (f) => f.undo(),
  },
  pan: {
    label: 'Pan one step (no re-layout)',
    run: (f) => f.panScreen(-40, -10),
    cleanup: (f) => f.undo(),
  },
};

/** Overlaps between visible nodes and labels, and broken geometry, after an operation. */
export function problems(f) {
  const out = [];
  const g = f.geo;
  if (!g) return ['no layout'];
  const boxes = [];
  for (const [id, n] of g.nodes) {
    if (!n.visible) continue;
    if (![n.x, n.y, n.w, n.h].every(Number.isFinite)) out.push(`node ${id} has no position`);
    boxes.push({ id, x: n.x - n.w / 2, y: n.y - n.h / 2, w: n.w, h: n.h });
  }
  for (const [key, c] of g.carriers) {
    if (!c.visible) continue;
    if (![c.x, c.y].every(Number.isFinite)) out.push(`label ${key} has no position`);
    if (c.w > 14) boxes.push({ id: key, x: c.x - c.w / 2, y: c.y - c.h / 2, w: c.w, h: c.h });
  }
  // Sweep along x so big diagrams stay cheap to check.
  boxes.sort((a, b) => a.x - b.x);
  for (let i = 0; i < boxes.length && out.length < 5; i++) {
    const a = boxes[i];
    for (let j = i + 1; j < boxes.length && boxes[j].x < a.x + a.w - 1; j++) {
      const b = boxes[j];
      if (a.y < b.y + b.h - 1 && b.y < a.y + a.h - 1) out.push(`${a.id} overlaps ${b.id}`);
    }
  }
  for (const [id, e] of g.edges) if (!e.hidden && !Array.from(e.path).every(Number.isFinite)) out.push(`edge ${id} has a broken route`);
  if (f.error) out.push(f.error);
  return out;
}

/** Times one operation `reps` times (median of the busy time). */
export async function measure(f, op, reps = 3) {
  const samples = [];
  for (let k = 0; k < reps; k++) {
    await settle(f);
    if (op.prepare) {
      op.prepare(f);
      flushNow(f);
      await settle(f);
    }
    // Time a real layout: an earlier repetition must not leave a reusable result behind.
    f.engineCache?.clear();
    const t0 = performance.now();
    op.run(f);
    flushNow(f);
    const t1 = performance.now();
    // Make the browser lay out what was just written.
    void f.shadowRoot.querySelector('.vp').getBoundingClientRect().width;
    void document.body.offsetHeight;
    const t2 = performance.now();
    const timing = f.layoutInfo?.timing;
    const bad = problems(f);
    samples.push({ js: t1 - t0, total: t2 - t0, timing: timing && t1 - t0 >= (timing.totalMs || 0) - 0.5 ? { ...timing } : null, problems: bad });
    if (op.cleanup) {
      op.cleanup(f);
      flushNow(f);
    }
  }
  await settle(f);
  samples.sort((a, b) => a.total - b.total);
  const mid = samples[Math.floor(samples.length / 2)];
  return { ...mid, max: samples[samples.length - 1].total, problems: [...new Set(samples.flatMap((s) => s.problems))] };
}

/**
 * Loads a generated diagram of each size and times every operation on it.
 * `onResult` gets each row as it is measured; returns all rows.
 */
export async function runSuite(f, { sizes, family = 'flow', ops = Object.keys(OPS), reps = 3, generate, onResult, stopAboveMs = Infinity, orientation }) {
  const rows = [];
  for (const n of sizes) {
    const doc = generate(n, { family, seed: n, orientation });
    const t0 = performance.now();
    f.setDoc(doc);
    flushNow(f);
    const load = performance.now() - t0;
    await settle(f);
    const row = { n, family, edges: f.doc.edges.length, load, info: { ...f.layoutInfo, timing: f.layoutInfo?.timing }, ops: {} };
    let worst = load;
    for (const key of ops) {
      const r = await measure(f, OPS[key], reps);
      row.ops[key] = r;
      worst = Math.max(worst, r.total);
    }
    row.problems = [...new Set(Object.values(row.ops).flatMap((r) => r.problems))];
    // Leave the diagram as it loaded: nothing selected, no controls over it.
    if (f.selection.length) f.select([]);
    rows.push(row);
    onResult?.(row);
    if (worst > stopAboveMs) break;
  }
  return rows;
}
