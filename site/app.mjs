import { appearanceKey, countItems, entryKey, example, guideDocument, lastEntry, levels, observe, progressKey, recover, seed, steps, storageKey } from './tutorial.mjs';
import { inspectStorage, readProgress, writeProgress } from './persistence.mjs';

const $ = (id) => document.getElementById(id);
const storage = { getItem: (key) => localStorage.getItem(key), setItem: (key, value) => localStorage.setItem(key, value), removeItem: (key) => localStorage.removeItem(key) };
const savedKey = `lodeflow:${storageKey}`;
const cloneSeed = () => structuredClone(seed);
let flow = $('flow'), reached = -1, previousState, progressTimer = 0, generation = 0, checkpoints = [];
let guideView = { kind: 'steady', levels: 0 }, foldedThrough = 0;
const openLevels = new Set();
let saving = { kind: 'local' }, pendingSaved = null, initializing = true;
let touch = matchMedia('(pointer: coarse)').matches;
const notice = (message) => { $('notice').textContent = message; $('notice').hidden = !message; };

function renderStatus() {
  $('item-count').textContent = `${countItems(flow.doc)} / 100 items`;
  $('item-count').classList.toggle('full', countItems(flow.doc) >= 100);
  $('save-status').dataset.mode = saving.kind;
  $('save-status').textContent = saving.kind === 'local' ? 'Local saving · data stays in this browser.' : saving.kind === 'protected' ? 'Saved data protected.' : 'Session only · browser storage is unavailable or full.';
}

function renderGuide(reveal = false) {
  const guide = $('guide');
  guide.setDoc(guideDocument(reached, guideView.levels, openLevels, touch));
  guide.disabledNodeIds = steps.filter((step) => step.index > reached).map((step) => step.id);
  const chosen = steps[Math.min(reached, steps.length - 1)];
  const selected = chosen && chosen.level < guideView.levels ? chosen.id : null;
  guide.select(selected ? [selected] : []);
  if (reveal) guide.showSelection();
  document.body.dataset.step = reached < 0 ? 'blank' : steps[reached]?.id || 'complete';
}

async function advanceGuide() {
  if (guideView.kind === 'finishing') return;
  const completed = Math.floor(Math.max(0, reached) / 4);
  if (guideView.levels > 0 && completed > foldedThrough) {
    const level = guideView.levels - 1, token = generation;
    guideView = { kind: 'finishing', levels: guideView.levels, level };
    openLevels.add(level);
    const layout = new Promise((done) => {
      const finish = () => { clearTimeout(timeout); $('guide').removeEventListener('lode-layout', finish); done(); };
      const timeout = setTimeout(finish, 1200);
      $('guide').addEventListener('lode-layout', finish, { once: true });
    });
    renderGuide();
    await layout;
    await new Promise((done) => setTimeout(done, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 420));
    if (token !== generation) return;
    openLevels.delete(level);
    foldedThrough = level + 1;
    guideView = { kind: 'steady', levels: Math.min(levels.length, guideView.levels + 1) };
    renderGuide(true);
    if (completed > foldedThrough) void advanceGuide();
  } else {
    if (!guideView.levels && reached >= 0) guideView = { kind: 'steady', levels: 1 };
    renderGuide(true);
  }
}

function persistProgress() {
  clearTimeout(progressTimer);
  progressTimer = 0;
  if (saving.kind !== 'protected') writeProgress(storage, savedKey, flow.getState(), reached, checkpoints);
}

function observePractice() {
  if (initializing) return;
  const state = flow.getState();
  const undone = checkpoints.find((point) => point.key === entryKey(lastEntry(previousState)) && point.key === entryKey(state.history.entries[state.history.index]));
  const redone = checkpoints.find((point) => point.key === entryKey(previousState?.history?.entries[previousState.history.index]) && point.key === entryKey(lastEntry(state)));
  const next = undone ? undone.before : redone ? redone.after : observe(reached, previousState, state);
  previousState = state;
  if (next !== reached) {
    if (undone || redone) restartGuide(next);
    else { reached = next; void advanceGuide(); }
  }
  renderStatus();
  clearTimeout(progressTimer);
  progressTimer = setTimeout(persistProgress, 340);
}

function bindFlow(element) {
  element.addEventListener('lode-limit', (event) => {
    if (initializing) { saving = { kind: 'protected' }; notice('Saved diagram or undo history exceeds the 100-item limit. Saved data is kept until you reset.'); }
    else notice(`${event.detail.message} Delete an item to make room.`);
    renderStatus();
  });
  for (const event of ['lode-change', 'lode-history', 'lode-select']) element.addEventListener(event, observePractice);
  element.addEventListener('lode-save', (event) => {
    saving = { kind: event.detail.ok ? 'local' : 'unavailable' };
    if (!event.detail.ok) notice('Browser storage is full or blocked. Changes remain editable in this session.');
    renderStatus();
  });
}

function restartGuide(next = -1) {
  generation++;
  clearTimeout(progressTimer);
  reached = next;
  foldedThrough = Math.floor(Math.max(0, reached) / 4);
  openLevels.clear();
  guideView = { kind: 'steady', levels: reached < 0 ? 0 : Math.min(levels.length, Math.floor(reached / 4) + 1) };
  previousState = flow.getState();
  if (reached < 0) {
    $('guide').style.width = '100%'; $('guide').style.height = '180px'; $('guide').parentElement.style.height = '180px';
    $('guide').parentElement.scrollLeft = 0; $('guide').parentElement.scrollTop = 0;
  }
  renderGuide(true);
}

function runExample(index) {
  if (index > reached || index < 0) return;
  const id = steps[index].id;
  try {
    if (id === 'undo' || id === 'redo') {
      if (id === 'undo' && !flow.canUndo) flow.setDoc(example(flow.doc, 'rename'), { resetHistory: false });
      if (id === 'redo' && !flow.canRedo) { flow.setDoc(example(flow.doc, 'rename'), { resetHistory: false }); flow.undo(); }
      flow[id]();
    } else {
      const next = example(flow.doc, id);
      flow.setDoc(next, { resetHistory: false });
      if (id === 'dive') {
        const group = next.groups.find((item) => next.nodes.filter((node) => node.group === item.id).length >= 2);
        flow.select(next.nodes.filter((node) => node.group === group?.id).map((node) => node.id));
      }
    }
    reached = Math.max(reached, index + 1);
    previousState = flow.getState();
    void advanceGuide();
    clearTimeout(progressTimer); progressTimer = setTimeout(persistProgress, 340);
    flow.focus({ preventScroll: true });
    renderStatus();
  } catch (error) { notice(error instanceof RangeError ? 'This example needs more room. Delete an item and try again.' : 'The example could not run. Your current diagram is kept.'); }
}

function hardReset() {
  flow.setDoc(cloneSeed(), { resetHistory: true, discardPendingSave: true });
  let cleared = true;
  for (const key of [savedKey, `${savedKey}:history`, progressKey, appearanceKey]) {
    try { storage.removeItem(key); } catch { cleared = false; }
  }
  const previous = flow, settings = previous.querySelector('[slot="help"]');
  flow = previous.cloneNode(false);
  flow.removeAttribute('storage-key');
  flow.setAttribute('theme', 'light');
  flow.setDoc(cloneSeed(), { resetHistory: true, discardPendingSave: true });
  flow.append(settings);
  bindFlow(flow);
  previous.replaceWith(flow);
  flow.setAttribute('storage-key', storageKey);
  $('appearance').value = 'light';
  pendingSaved = null; $('tab-notice').hidden = true;
  checkpoints = [];
  restartGuide();
  if (cleared) {
    try { const rev = Date.now(); storage.setItem(savedKey, JSON.stringify({ v: 2, rev, ...flow.getState() })); storage.setItem(progressKey, JSON.stringify({ v: 1, rev, reached })); }
    catch { cleared = false; }
  }
  saving = { kind: cleared ? 'local' : 'unavailable' };
  notice(cleared ? '' : 'Hard Reset cleared this session. Browser storage is unavailable or full; the reset could not be saved.');
  flow.focus({ preventScroll: true }); renderStatus();
}

const checked = inspectStorage(storage, savedKey);
saving = { kind: checked.kind };
flow.setAttribute('theme', checked.appearance);
$('appearance').value = checked.appearance;
notice(checked.message);
bindFlow(flow);
try {
  await import('./assets/lode-flow.js');
  await customElements.whenDefined('lode-flow');
  if (checked.invalid) flow.setDoc(cloneSeed());
  let stored = null;
  try { stored = JSON.parse(storage.getItem(savedKey)); } catch { /* session-only */ }
  const progress = readProgress(storage, stored?.rev);
  checkpoints = progress?.checkpoints || [];
  restartGuide(checked.invalid ? -1 : progress?.reached ?? recover(flow.getState()));
  $('guide').addEventListener('lode-activate', ({ detail }) => runExample(steps.findIndex((step) => step.id === detail.id)));
  $('guide').addEventListener('lode-group-activate', ({ detail }) => {
    const index = Number(detail.id.replace('level-', ''));
    if (openLevels.has(index)) openLevels.delete(index); else openLevels.add(index);
    renderGuide(); $('guide').select([detail.id]); $('guide').showSelection();
  });
  $('guide').addEventListener('lode-layout', () => {
    const info = $('guide').layoutInfo;
    $('guide').style.width = `${Math.max($('guide').parentElement.clientWidth, Math.ceil(info.width + 64))}px`;
    $('guide').style.height = `${Math.max(180, Math.ceil(info.height + 64))}px`;
    $('guide').parentElement.style.height = `${Math.min(360, Math.max(180, Math.ceil(info.height + 64)))}px`;
    $('guide').showSelection();
  });
  $('appearance').addEventListener('change', (event) => {
    flow.setAttribute('theme', event.target.value);
    try { storage.setItem(appearanceKey, event.target.value); } catch { /* diagram saving reports its own failures */ }
  });
  $('reset').addEventListener('click', () => {
    const before = reached;
    flow.setDoc(cloneSeed(), { resetHistory: false });
    checkpoints = [...checkpoints, { key: entryKey(lastEntry(flow.getState())), before, after: -1 }].slice(-100);
    restartGuide();
    if (saving.kind === 'protected') saving = { kind: 'local' };
    notice('Tutorial restored to blank.');
    flow.focus({ preventScroll: true }); renderStatus();
    clearTimeout(progressTimer); progressTimer = setTimeout(persistProgress, 340);
  });
  $('hard-reset').addEventListener('click', hardReset);
  window.addEventListener('storage', (event) => {
    if (event.key === appearanceKey && (event.newValue === null || ['light', 'blueprint'].includes(event.newValue))) {
      flow.setAttribute('theme', event.newValue || 'light'); $('appearance').value = event.newValue || 'light'; return;
    }
    if (event.key === progressKey && pendingSaved) {
      const progress = readProgress(storage, pendingSaved.rev);
      if (progress) pendingSaved.reached = progress.reached;
      return;
    }
    if (event.key !== savedKey || !event.newValue) return;
    try {
      const value = JSON.parse(event.newValue);
      if (!value?.doc || JSON.stringify(value.doc) === JSON.stringify(flow.doc)) return;
      pendingSaved = { doc: value.doc, rev: value.rev, reached: readProgress(storage, value.rev)?.reached };
      $('tab-notice').hidden = false;
    } catch { /* invalid saved data cannot replace current work */ }
  });
  $('load-saved').addEventListener('click', async () => {
    try {
      const incoming = pendingSaved;
      for (let tries = 0; incoming.reached === undefined && tries < 10; tries++) {
        await new Promise((done) => setTimeout(done, 50));
        incoming.reached = readProgress(storage, incoming.rev)?.reached;
      }
      const before = reached;
      flow.setDoc(incoming.doc, { resetHistory: false });
      const after = incoming.reached ?? recover(flow.getState());
      checkpoints = [...checkpoints, { key: entryKey(lastEntry(flow.getState())), before, after }].slice(-100);
      restartGuide(after);
      pendingSaved = null; $('tab-notice').hidden = true;
      notice('Saved changes loaded. Undo brings your practice diagram back.');
      flow.focus({ preventScroll: true }); renderStatus();
    } catch { notice('Saved diagram exceeds the 100-item limit. Your current work is kept.'); }
  });
  window.addEventListener('pagehide', persistProgress);
  window.addEventListener('pointerdown', (event) => {
    const next = event.pointerType === 'touch' || (event.pointerType !== 'mouse' && touch);
    if (next !== touch) { touch = next; renderGuide(); }
  });
  initializing = false;
  renderStatus(); flow.focus({ preventScroll: true }); document.body.dataset.ready = 'true';
} catch (error) { saving = { kind: 'unavailable' }; notice('The editor could not start. Reload to try again; saved browser data is kept.'); console.error(error); }
