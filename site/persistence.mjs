// Browser-only tutorial metadata follows the component's saved revision.
import { appearanceKey, countItems, entryKey, lastEntry, progressKey, validReached } from './tutorial.mjs';
export function readProgress(storage, revision) {
  try {
    const value = JSON.parse(storage.getItem(progressKey));
    if (!Number.isFinite(revision) || value?.v !== 1 || value.rev !== revision || !validReached(value.reached)) return null;
    return { reached: value.reached, checkpoints: (value.checkpoints || []).filter((point) => typeof point.key === 'string' && validReached(point.before) && validReached(point.after)).slice(-100) };
  }
  catch { return null; }
}
export function writeProgress(storage, key, state, reached, checkpoints = []) {
  try {
    const saved = JSON.parse(storage.getItem(key));
    if (JSON.stringify(saved?.doc) !== JSON.stringify(state.doc) || JSON.stringify(saved?.view?.sel) !== JSON.stringify(state.view.sel)) return false;
    const savedHistory = JSON.parse(storage.getItem(`${key}:history`) || 'null');
    const history = saved.history || (savedHistory?.rev === saved.rev ? savedHistory.history : undefined);
    if (entryKey(lastEntry({ history })) !== entryKey(lastEntry(state))) return false;
    storage.setItem(progressKey, JSON.stringify({ v: 1, rev: saved.rev, reached, checkpoints }));
    return true;
  } catch { return false; }
}
export function inspectStorage(storage, key) {
  try {
    const raw = storage.getItem(key);
    let kind = 'local', invalid = false, message = '';
    if (raw) {
      try {
        const value = JSON.parse(raw);
        if (!Array.isArray(value?.doc?.nodes) || !Array.isArray(value?.doc?.edges)) throw new Error('Invalid diagram');
        if (countItems(value.doc) > 100) { kind = 'protected'; message = 'Saved diagram exceeds the 100-item limit. Saved data is kept until you reset.'; }
      } catch { invalid = true; message = 'Saved data could not be read. A blank practice diagram is restored; your next change saves a fresh copy.'; }
    }
    const appearance = storage.getItem(appearanceKey) === 'blueprint' ? 'blueprint' : 'light';
    const probe = `${progressKey}:probe`;
    storage.setItem(probe, '1'); storage.removeItem(probe);
    return { kind, invalid, message, appearance };
  } catch { return { kind: 'unavailable', invalid: false, appearance: 'light', message: 'Browser storage is unavailable or full. This session stays editable.' }; }
}
