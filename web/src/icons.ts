// 16px stroke icons (currentColor). Kept tiny and generic.

const s = (body: string) =>
  `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const ICON = {
  edit: s('<path d="M10.5 2.5l3 3L6 13H3v-3z"/><path d="M9 4l3 3"/>'),
  node: s('<rect x="1" y="4.5" width="14" height="7" rx="1.8"/>'),
  dive: s('<rect x="1.5" y="1.5" width="13" height="13" rx="3" stroke-dasharray="2.5 2"/><path d="M8 3.8v6.4M5.6 7.9L8 10.3l2.4-2.4"/>'),
  surface: s('<rect x="1.5" y="1.5" width="13" height="13" rx="3" stroke-dasharray="2.5 2"/><path d="M8 12.2V5.8M5.6 8.1L8 5.7l2.4 2.4"/>'),
  before:s('<rect x="8.5" y="5" width="6" height="6" rx="1.5"/><path d="M1.5 8H8M5.5 5.5L8 8l-2.5 2.5"/>'),
  link: s('<rect x="1.5" y="2" width="5" height="4.5" rx="1.2"/><rect x="9.5" y="9.5" width="5" height="4.5" rx="1.2"/><path d="M4 6.5v2.2a2.5 2.5 0 002.5 2.5h1.7M7 9.7l1.4 1.5L7 12.7"/>'),
  linkIn: s('<rect x="1.5" y="2" width="5" height="4.5" rx="1.2"/><rect x="9.5" y="9.5" width="5" height="4.5" rx="1.2"/><path d="M9.2 11.2H6.5A2.5 2.5 0 014 8.7V7.2M2.5 8.6L4 7.1l1.5 1.5"/>'),
  nextEdge: s('<circle cx="8" cy="8" r="2"/><path d="M8 2.2A5.8 5.8 0 0113.8 8M12.1 6.5l1.7 1.6 1.6-1.7"/>'),
  prevEdge: s('<circle cx="8" cy="8" r="2"/><path d="M8 2.2A5.8 5.8 0 002.2 8M3.9 6.5L2.2 8.1.6 6.4"/>'),
  label: s('<path d="M2 3.5h6.5l5 4.5-5 4.5H2z"/><circle cx="5" cy="8" r="1"/>'),
  unlabel: s('<path d="M2 3.5h6.5l5 4.5-5 4.5H2z"/><path d="M1.5 14L14.5 2"/>'),
  plus: s('<path d="M8 3v10M3 8h10"/>'),
  group: s('<rect x="1.5" y="1.5" width="13" height="13" rx="3" stroke-dasharray="2.5 2"/><rect x="4.5" y="4.5" width="3" height="3" rx=".8"/><rect x="8.5" y="8.5" width="3" height="3" rx=".8"/>'),
  ungroup: s('<rect x="2" y="2" width="5" height="5" rx="1.2"/><rect x="9" y="9" width="5" height="5" rx="1.2"/><path d="M9.5 2.5l4 4M13.5 2.5l-4 4" stroke-width="1.2"/>'),
  trash: s('<path d="M2.5 4.5h11M6 4.5V3h4v1.5M4 4.5l.7 9h6.6l.7-9"/>'),
  collapse: s('<path d="M4 6l4 4 4-4"/>'),
  expand: s('<path d="M6 4l4 4-4 4"/>'),
  undo: s('<path d="M5.5 3.5L2.5 6.5l3 3"/><path d="M2.5 6.5H10a3.5 3.5 0 010 7H7"/>'),
  redo: s('<path d="M10.5 3.5l3 3-3 3"/><path d="M13.5 6.5H6a3.5 3.5 0 000 7h3"/>'),
  magnet: s('<path d="M3.5 2.5v6a4.5 4.5 0 009 0v-6"/><path d="M3.5 5.5h3M9.5 5.5h3"/><path d="M6.5 2.5v6a1.5 1.5 0 003 0v-6"/>'),
  fit: s('<path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10"/>'),
  upright: s('<path d="M8 13.5V3M4.5 6.5L8 3l3.5 3.5"/>'),
  help: s('<circle cx="8" cy="8" r="6"/><path d="M6.3 6.2a1.8 1.8 0 113 1.4c-.7.5-1.3.9-1.3 1.8M8 11.5v.1"/>'),
  close: s('<path d="M4 4l8 8M12 4l-8 8"/>'),
  locate: s('<circle cx="8" cy="8" r="2.5"/><path d="M8 1.5V4M8 12v2.5M1.5 8H4M12 8h2.5"/>'),
  auto: s('<rect x="1.5" y="3.5" width="13" height="9" rx="1.5"/><path d="M4.5 8h4M7 6l2 2-2 2M11.5 5.5v5"/>'),
  lr: s('<path d="M2 8h11M10 5l3 3-3 3"/>'),
  rl: s('<path d="M14 8H3M6 5L3 8l3 3"/>'),
  tb: s('<path d="M8 2v11M5 10l3 3 3-3"/>'),
  bt: s('<path d="M8 14V3M5 6l3-3 3 3"/>'),
  inout: s('<circle cx="8" cy="8" r="1.6"/><path d="M8 4.2V1.8M8 11.8v2.4M4.2 8H1.8M11.8 8h2.4"/><path d="M6.8 2.9L8 1.8l1.2 1.1M6.8 13.1L8 14.2l1.2-1.1M2.9 6.8L1.8 8l1.1 1.2M13.1 6.8L14.2 8l-1.1 1.2" stroke-width="1.1"/>'),
  outin: s('<circle cx="8" cy="8" r="1.6"/><path d="M8 1.8v2.4M8 14.2v-2.4M1.8 8h2.4M14.2 8h-2.4"/><path d="M6.9 3.1L8 4.2l1.1-1.1M6.9 12.9L8 11.8l1.1 1.1M3.1 6.9L4.2 8 3.1 9.1M12.9 6.9L11.8 8l1.1 1.1" stroke-width="1.1"/>'),
};
