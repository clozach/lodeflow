import { appearanceKey, countItems, seed, storageKey } from './tutorial.mjs';

const byId = (id) => document.getElementById(id);
const savedKey = `lodeflow:${storageKey}`;
const cloneSeed = () => structuredClone(seed);
let flow = byId('flow');
let saving = { kind: 'local' };
let invalidSaved = false;
let pendingSaved = null;
let initializing = true;

function notice(message) {
  byId('notice').textContent = message;
  byId('notice').hidden = !message;
}

function addSeed(element) {
  const inline = document.createElement('script');
  inline.type = 'application/json';
  inline.textContent = JSON.stringify(seed);
  element.append(inline);
}

function renderStatus() {
  const count = countItems(flow.doc);
  byId('item-count').textContent = `${count} / 100 items`;
  byId('item-count').classList.toggle('full', count >= 100);
  byId('save-status').dataset.mode = saving.kind;
  byId('save-status').textContent = saving.kind === 'local' ? 'Local saving' :
    saving.kind === 'protected' ? 'Saved data protected' : 'Session only';
}

function bindFlow(element) {
  element.addEventListener('lode-limit', (event) => {
    if (initializing) {
      saving = { kind: 'protected' };
      notice('Saved diagram or undo history exceeds the 100-item limit. Saved data is kept until you reset.');
    } else {
      notice(`${event.detail.message} Delete an item to make room, or restore the tutorial.`);
      renderStatus();
    }
  });
  for (const event of ['lode-change', 'lode-history', 'lode-select']) element.addEventListener(event, renderStatus);
  element.addEventListener('lode-save', (event) => {
    saving = event.detail.ok ? { kind: 'local' } : { kind: 'unavailable' };
    if (!event.detail.ok) notice('Browser storage is full or blocked. This session remains editable; changes are not being saved.');
    renderStatus();
  });
}

function checkStorage() {
  try {
    const raw = localStorage.getItem(savedKey);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (!parsed?.doc || !Array.isArray(parsed.doc.nodes) || !Array.isArray(parsed.doc.edges)) throw new Error('Invalid document');
        if (countItems(parsed.doc) > 100) {
          saving = { kind: 'protected' };
          notice('Saved diagram exceeds the 100-item limit. Saved data is kept until you reset.');
        }
      } catch {
        invalidSaved = true;
        notice('Saved data could not be read. The tutorial is restored; your next change saves a fresh copy.');
      }
    }
    const preference = localStorage.getItem(appearanceKey);
    if (preference === 'blueprint') flow.setAttribute('theme', preference);
    const probe = `${appearanceKey}:probe`;
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
  } catch {
    saving = { kind: 'unavailable' };
    notice('Browser storage is unavailable. Reloading returns to the last saved diagram or tutorial.');
  }
  byId('appearance').value = flow.getAttribute('theme');
}

function hardReset() {
  // Cancel pending writes and discard the draft before touching browser storage.
  flow.setDoc(cloneSeed(), { resetHistory: true, discardPendingSave: true });
  let cleared = true;
  for (const key of [savedKey, `${savedKey}:history`, appearanceKey]) {
    try { localStorage.removeItem(key); } catch { cleared = false; }
  }
  // A fresh instance also resets camera, selection and layout tunables.
  const previous = flow;
  flow = previous.cloneNode(false);
  flow.setAttribute('theme', 'light');
  addSeed(flow);
  // Seed before connection so retained storage cannot reload erased edits.
  flow.setDoc(cloneSeed(), { resetHistory: true, discardPendingSave: true });
  bindFlow(flow);
  previous.replaceWith(flow);
  byId('appearance').value = 'light';
  pendingSaved = null;
  byId('tab-notice').hidden = true;
  if (cleared) {
    try { localStorage.setItem(savedKey, JSON.stringify({ v: 2, rev: Date.now(), ...flow.getState() })); }
    catch { cleared = false; }
  }
  saving = cleared ? { kind: 'local' } : { kind: 'unavailable' };
  notice(cleared ? '' : 'Hard Reset cleared this session. Browser storage is unavailable or full; the reset could not be saved.');
  flow.focus({ preventScroll: true });
  renderStatus();
}

addSeed(flow); // Saved state takes precedence over this inline example during upgrade.
bindFlow(flow); // Capture an oversized saved history before the import finishes.
checkStorage();
try {
  await import('./assets/lode-flow.js');
  await customElements.whenDefined('lode-flow');
  if (invalidSaved) flow.setDoc(cloneSeed());
  byId('appearance').addEventListener('change', (event) => {
    flow.setAttribute('theme', event.target.value);
    try { localStorage.setItem(appearanceKey, event.target.value); } catch { /* diagram reports its own save errors */ }
  });
  byId('reset').addEventListener('click', () => {
    const replacingProtected = saving.kind === 'protected';
    flow.setDoc(cloneSeed(), { resetHistory: false });
    if (replacingProtected) saving = { kind: 'local' };
    notice(replacingProtected ? 'Tutorial restored. Saved data above this demo’s limit was replaced.' : 'Tutorial restored. Undo brings your previous diagram back.');
    flow.focus({ preventScroll: true });
    renderStatus();
  });
  byId('hard-reset').addEventListener('click', hardReset);
  window.addEventListener('storage', (event) => {
    if (event.key === appearanceKey && (event.newValue === null || ['light', 'blueprint'].includes(event.newValue))) {
      const appearance = event.newValue || 'light';
      flow.setAttribute('theme', appearance);
      byId('appearance').value = appearance;
      return;
    }
    if (event.key !== savedKey || !event.newValue) return;
    try {
      const incoming = JSON.parse(event.newValue);
      if (!incoming?.doc || JSON.stringify(incoming.doc) === JSON.stringify(flow.doc)) return;
      pendingSaved = incoming.doc;
      byId('tab-notice').hidden = false;
    } catch { /* an invalid value cannot replace the current diagram */ }
  });
  byId('load-saved').addEventListener('click', () => {
    try {
      flow.setDoc(pendingSaved, { resetHistory: false });
      pendingSaved = null;
      byId('tab-notice').hidden = true;
      notice('Saved changes loaded. Undo brings your previous diagram back.');
      flow.focus({ preventScroll: true });
      renderStatus();
    } catch {
      notice('Saved diagram exceeds the 100-item limit. Your current diagram is kept.');
    }
  });
  renderStatus();
  initializing = false;
  document.body.dataset.ready = 'true';
} catch (error) {
  saving = { kind: 'unavailable' };
  byId('save-status').textContent = 'The editor could not start.';
  notice('The editor could not load. Reload to try again; your saved diagram is kept in browser storage.');
  console.error(error);
}
