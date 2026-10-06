import { appearanceKey, countItems, seed, steps, storageKey } from './tutorial.mjs';

const byId = (id) => document.getElementById(id);
const flow = byId('flow');
const savedKey = `lodeflow:${storageKey}`;
const cloneSeed = () => structuredClone(seed);
let currentStep = 0;
let saving = { kind: 'local' };
let savedAppearance = 'light';
let invalidSaved = false;
let pendingSaved = null;
let initializing = true;

// The example exists before the element is defined. Its own saved state takes precedence.
const inline = document.createElement('script');
inline.type = 'application/json';
inline.textContent = JSON.stringify(seed);
flow.append(inline);
// Loading can fail before the import finishes; catch its cap event before upgrading the element.
flow.addEventListener('lode-limit', (event) => {
  if (initializing) {
    saving = { kind: 'protected' };
    notice('Your saved diagram or its undo history exceeds this demo’s 100-item limit. The saved data is kept. Restore tutorial to replace it with these examples.');
  } else {
    notice(`${event.detail.message} Delete an item to make room, or restore the tutorial.`);
    renderStatus();
  }
});

function notice(message) {
  byId('notice').textContent = message;
  byId('notice').hidden = !message;
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
          notice('Your saved diagram exceeds this demo’s 100-item limit. It is kept in storage. Restore tutorial to replace it with these examples.');
        }
      } catch {
        invalidSaved = true;
        notice('Saved data could not be read. The tutorial is restored; your next change saves a fresh copy.');
      }
    }
    const preference = localStorage.getItem(appearanceKey);
    if (preference === 'blueprint') savedAppearance = preference;
    const probe = `${appearanceKey}:probe`;
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
  } catch {
    saving = { kind: 'unavailable' };
    notice('Browser storage is unavailable. You can still edit and undo here; reloading will return to the tutorial.');
  }
}

function renderStatus() {
  const count = countItems(flow.doc);
  byId('item-count').textContent = `${count} / 100 items`;
  byId('item-count').classList.toggle('full', count >= 100);
  byId('undo').disabled = !flow.canUndo;
  byId('redo').disabled = !flow.canRedo;
  byId('save-status').dataset.mode = saving.kind;
  byId('save-status').textContent = saving.kind === 'local' ? 'Local saving enabled · this browser' :
    saving.kind === 'protected' ? 'Saved diagram protected · use Restore tutorial' : 'Session only · storage unavailable';
  byId('missing-example').hidden = steps[currentStep].ids.every((id) => [...flow.doc.nodes, ...flow.doc.groups].some((item) => item.id === id));
}

function showStep(index, highlight = true) {
  currentStep = index;
  const step = steps[index];
  byId('step-counter').textContent = `${index + 1} / ${steps.length}`;
  byId('guide-title').textContent = step.title;
  byId('step-intro').textContent = step.intro;
  byId('step-gesture').textContent = step.gesture;
  byId('step-result').textContent = step.result;
  byId('mobile-gesture').textContent = `${index + 1}. ${step.title}: ${step.gesture}`;
  byId('previous').disabled = index === 0;
  byId('next').disabled = index === steps.length - 1;
  byId('next').textContent = index === steps.length - 1 ? 'Make it yours' : 'Try the next step →';
  for (const [i, button] of [...byId('step-list').children].entries()) {
    if (i === index) button.setAttribute('aria-current', 'step');
    else button.removeAttribute('aria-current');
  }
  if (highlight) {
    flow.select(step.ids);
    flow.showSelection();
    flow.focus({ preventScroll: true });
    if (matchMedia('(max-width: 700px)').matches) byId('playground').scrollIntoView({ block: 'start', behavior: 'auto' });
  }
  renderStatus();
}

checkStorage();
flow.setAttribute('theme', savedAppearance);
byId('appearance').value = savedAppearance;
try {
  await import('./assets/lode-flow.js');
  await customElements.whenDefined('lode-flow');
  if (invalidSaved) flow.setDoc(cloneSeed());
  for (const [index, step] of steps.entries()) {
    const button = document.createElement('button');
    button.textContent = String(index + 1);
    button.title = step.title;
    button.setAttribute('aria-label', `Step ${index + 1}: ${step.title}`);
    button.addEventListener('click', () => showStep(index));
    byId('step-list').append(button);
  }
  byId('previous').addEventListener('click', () => showStep(Math.max(0, currentStep - 1)));
  byId('next').addEventListener('click', () => showStep(Math.min(steps.length - 1, currentStep + 1)));
  byId('appearance').addEventListener('change', (event) => {
    flow.setAttribute('theme', event.target.value);
    try { localStorage.setItem(appearanceKey, event.target.value); } catch { /* diagram reports its own save errors */ }
  });
  for (const action of ['undo', 'redo', 'fit']) byId(action).addEventListener('click', () => {
    flow[action]();
    flow.focus({ preventScroll: true });
    renderStatus();
  });
  byId('reset').addEventListener('click', () => {
    const replacingProtected = saving.kind === 'protected';
    flow.setDoc(cloneSeed(), { resetHistory: false });
    if (replacingProtected) saving = { kind: 'local' };
    notice(replacingProtected ? 'Tutorial restored. The saved data above this demo’s limit was replaced.' : 'Tutorial restored. Undo brings your previous diagram back.');
    showStep(0, false);
    flow.focus({ preventScroll: true });
  });
  window.addEventListener('storage', (event) => {
    if (event.key === appearanceKey && ['light', 'blueprint'].includes(event.newValue)) {
      flow.setAttribute('theme', event.newValue);
      byId('appearance').value = event.newValue;
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
      notice('Changes from the other tab loaded. Undo brings your previous diagram back.');
      flow.focus({ preventScroll: true });
      renderStatus();
    } catch {
      notice('The saved diagram exceeds this demo’s 100-item limit. Your current diagram is kept.');
    }
  });
  for (const event of ['lode-change', 'lode-history', 'lode-select']) flow.addEventListener(event, renderStatus);
  flow.addEventListener('lode-save', (event) => {
    saving = event.detail.ok ? { kind: 'local' } : { kind: 'unavailable' };
    if (!event.detail.ok) notice('Browser storage is full or blocked. Edits and undo still work in this session, but are not being saved.');
    renderStatus();
  });
  showStep(0, false); // Do not steal focus or replace a returning visitor’s saved selection.
  initializing = false;
} catch (error) {
  saving = { kind: 'unavailable' };
  byId('save-status').textContent = 'The editor could not start.';
  notice('The editor could not load. Reload this page to try again; your saved diagram is kept in browser storage.');
  console.error(error);
}
