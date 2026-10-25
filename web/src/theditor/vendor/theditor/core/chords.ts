// Vendored copy; do not edit here. Canonical: theditor (projects/theditor/src/core/chords.ts).
// Refresh with `node projects/theditor/src/scripts/vendor-sync.mjs`; `--check` reports drift.
/**
 * The formatting chords, read by physical key like every composer chord.
 * Four modifier shapes, chosen to stay clear of the conversation's own
 * chords while the cursor is in the message (⌥⌘ letters and digits, ⌃⌘
 * digits, ⌘↩, ⌥⌘⌫):
 *
 * - `mod`: ⌘ alone (Ctrl off the Mac): ⌘B, ⌘I, ⌘E, ⌘K, as everywhere else.
 * - `mod-shift`: ⇧⌘ with a digit, the lists' usual chords (⇧⌘7, ⇧⌘8, ⇧⌘9).
 * - `block`: ⌃⌥⌘ (Ctrl+Alt+Shift off the Mac, since Ctrl+Alt is AltGr).
 *   macOS binds ⌃⌥⌘8 (invert colours), so no block chord uses 8.
 * - `hyper`: ⌃⌥⇧⌘, the Hyper key, used only with ⌫ for Plain text.
 */
export type ChordShape = "mod" | "mod-shift" | "block" | "hyper";

export interface Chord {
    shape: ChordShape;
    /** `KeyboardEvent.code`: "KeyB", "Digit1", "Minus", "Quote", "Backspace". */
    code: string;
}

interface Modifiers {
    metaKey: boolean;
    ctrlKey: boolean;
    altKey: boolean;
    shiftKey: boolean;
    code: string;
}

export function chordMatches(chord: Chord, event: Modifiers): boolean {
    if (event.code !== chord.code) return false;
    const {
        metaKey: meta,
        ctrlKey: ctrl,
        altKey: alt,
        shiftKey: shift,
    } = event;
    switch (chord.shape) {
        case "mod":
            return meta !== ctrl && !alt && !shift;
        case "mod-shift":
            return meta !== ctrl && !alt && shift;
        case "block":
            return (
                (meta && ctrl && alt && !shift) ||
                (!meta && ctrl && alt && shift)
            );
        case "hyper":
            return ctrl && alt && shift;
    }
}

const KEY_GLYPHS: Record<string, string> = {
    Backspace: "⌫",
    Minus: "-",
    Quote: "'",
    BracketLeft: "[",
    BracketRight: "]",
};

function keyGlyph(code: string): string {
    return KEY_GLYPHS[code] || code.replace(/^Key/, "").replace(/^Digit/, "");
}

const PREFIX: Record<ChordShape, string> = {
    mod: "⌘",
    "mod-shift": "⇧⌘",
    block: "⌃⌥⌘",
    hyper: "⌃⌥⇧⌘",
};

/** How the badge shows it: "⌘B", "⇧⌘8", "⌃⌥⌘1", "⌃⌥⇧⌘⌫". */
export function chordLabel(chord: Chord): string {
    return `${PREFIX[chord.shape]}${keyGlyph(chord.code)}`;
}

/** The same chord for assistive tech, Mac first. */
export function chordAria(chord: Chord): string {
    const key =
        chord.code === "Backspace"
            ? "Backspace"
            : chord.code === "Minus"
              ? "-"
              : chord.code === "Quote"
                ? "'"
                : keyGlyph(chord.code);
    switch (chord.shape) {
        case "mod":
            return `Meta+${key} Control+${key}`;
        case "mod-shift":
            return `Shift+Meta+${key} Shift+Control+${key}`;
        case "block":
            return `Control+Alt+Meta+${key} Control+Alt+Shift+${key}`;
        case "hyper":
            return `Control+Alt+Shift+Meta+${key} Control+Alt+Shift+${key}`;
    }
}
