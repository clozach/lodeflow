// Vendored copy; do not edit here. Canonical: theditor (projects/theditor/src/core/keys.ts).
// Refresh with `node projects/theditor/src/scripts/vendor-sync.mjs`; `--check` reports drift.
/**
 * What a key pressed in theditor's words asks for, before the host or the
 * editor's own keymap sees it: one router both renderers call, so a chord
 * means the same thing in the swamikk composer and in a lodeflow node.
 *
 * - A selected picture's magnets answer first: ⌃⌥⌘S Style, ⌃⌥⌘L Alignment,
 *   ⌃⌥⌘T Tweak (tracker `tweak-chord = keep`: ⌃⌥⌘T is Toggle otherwise).
 * - Then every formatting action's chord (FORMAT_ACTIONS).
 * - ⌘↩ is not routed here: each host binds it (toggleBlockControl in
 *   lodeflow; the composer's send is Al's open question).
 */
import { FORMAT_ACTIONS, type FormatAction } from "./actions";
import { chordMatches } from "./chords";
import { imageToolForKey, type ImageTool } from "./image-tools";

export interface ChordEvent {
    code: string;
    metaKey: boolean;
    ctrlKey: boolean;
    altKey: boolean;
    shiftKey: boolean;
}

export type EditorChord =
    | { kind: "image"; tool: ImageTool }
    | { kind: "action"; action: FormatAction };

export function editorChord(
    event: ChordEvent,
    context: { imageSelected: boolean },
): EditorChord | null {
    const tool = context.imageSelected ? imageToolForKey(event) : null;
    if (tool) return { kind: "image", tool };
    const action = FORMAT_ACTIONS.find((item) => chordMatches(item.chord, event));
    return action ? { kind: "action", action } : null;
}

/** An action may run now: it has no availability test, or passes it. */
export function actionAvailable<E>(
    action: { isAvailable?: (editor: E) => boolean },
    editor: E,
): boolean {
    return !action.isAvailable || action.isAvailable(editor);
}
