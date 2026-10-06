// An instructional fixture, with stable IDs so each guide step can find its example.
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

export const steps = [
  { title: 'Read the story', ids: ['start'], intro: 'Nodes hold ideas. Arrows show how one idea leads to another.',
    gesture: 'Follow the arrows from “Start with an idea” to “A useful outcome”. Drag empty space to pan; use Fit to bring everything back.',
    result: 'The layout follows the connections. You supply the meaning.' },
  { title: 'Make it yours', ids: ['rename'], intro: 'The highlighted node is ready to edit.',
    gesture: 'Press Enter, or click the highlighted node. Replace its words, then press Enter to save. Shift+Enter adds a line.',
    result: 'Try “My first idea”. The diagram makes room for your words.' },
  { title: 'Grow the flow', ids: ['grow'], intro: 'Add an idea after the highlighted node.',
    gesture: 'Press N, or tap Add node beside the selection. Type a next step and press Enter. Lodeflow adds the arrow and arranges the new node.',
    result: 'No dragging boxes into place. Shift+N adds before instead.' },
  { title: 'Join two ideas', ids: ['extra'], intro: '“An extra idea” has no link to the outcome yet.',
    gesture: 'With a mouse, drag from “An extra idea” onto “A useful outcome”. With touch or a keyboard, tap Link or press E, then choose “A useful outcome” from the list.',
    result: 'Click the new arrow and press Enter to give it a label. Escape closes the list.' },
  { title: 'Explore a group', ids: ['practice'], intro: 'The outline keeps related ideas together.',
    gesture: 'Press C, or tap the group’s fold control, to collapse or expand it. J selects what is inside; K returns to the surrounding group.',
    result: 'Use Layout in the diagram to try a different direction. Try Blueprint above the canvas for a drafting style.' },
  { title: 'Keep experimenting', ids: ['learn'], intro: 'Your changes stay in this browser, including undo history.',
    gesture: 'Use Undo and Redo above the canvas. Restore tutorial brings back these examples as one undoable change. Reload to return to your saved diagram.',
    result: 'Ready for your own flow? Rename, add and connect these ideas. This demo allows 100 items in total.' },
];

export const countItems = (doc) => ['nodes', 'edges', 'groups', 'junctions'].reduce((n, key) => n + (doc[key]?.length || 0), 0);
