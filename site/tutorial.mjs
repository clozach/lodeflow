// The demo’s starting diagram. Stable IDs also make browser scenarios reproducible.
export const storageKey = 'public-tutorial-v1';
export const appearanceKey = 'lodeflow-tutorial:appearance:v1';
export const seed = {
  settings: { orientation: 'auto', bias: 'start', compactness: 'comfortable', incremental: false, tightGroups: true, untangle: true },
  groups: [
    { id: 'ideas', text: 'Ideas you can change' },
    { id: 'practice', text: 'Your practice space' },
  ],
  nodes: [
    { id: 'start', text: 'Start with an idea', group: 'ideas' },
    { id: 'rename', text: 'Rename this idea', group: 'ideas' },
    { id: 'grow', text: 'Grow from here', group: 'practice' },
    { id: 'arrange', text: 'New nodes arrange themselves', group: 'practice' },
    { id: 'extra', text: 'An extra idea' },
    { id: 'outcome', text: 'A useful outcome' },
    { id: 'learn', text: 'Experiment, then undo' },
  ],
  edges: [
    { id: 'start-rename', from: 'start', to: 'rename', label: 'make it yours' },
    { id: 'start-grow', from: 'start', to: 'grow' },
    { id: 'grow-arrange', from: 'grow', to: 'arrange' },
    { id: 'arrange-outcome', from: 'arrange', to: 'outcome' },
    { id: 'start-extra', from: 'start', to: 'extra' },
    { id: 'rename-learn', from: 'rename', to: 'learn' },
  ],
  junctions: [],
};

export const countItems = (doc) => ['nodes', 'edges', 'groups', 'junctions'].reduce((n, key) => n + (doc[key]?.length || 0), 0);
