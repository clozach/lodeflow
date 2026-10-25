// Vendored copy; do not edit here. Canonical: theditor (projects/theditor/src/core/search-text.ts).
// Refresh with `node projects/theditor/src/scripts/vendor-sync.mjs`; `--check` reports drift.
/** One word of a searchable field: its folded form plus where it sits in the
 * original text, so highlights are cut from the text the person reads. */
export interface Token {
    term: string;
    start: number;
    end: number;
    position: number;
}

// A word starts with a letter or digit, may carry combining marks, and may
// join parts with an apostrophe ("KK’s"). Hyphens, colons and slashes split.
// No Intl.Segmenter: Firefox 109-124 are still browser targets and lack it.
// Built with the constructor: the type-checker's es5 target rejects the
// literal's `u` flag, while every browser target supports it.
const WORD = new RegExp(
    "[\\p{L}\\p{N}][\\p{L}\\p{N}\\p{M}]*(?:['’ʼ][\\p{L}\\p{N}][\\p{L}\\p{N}\\p{M}]*)*",
    "gu",
);
const MARKS = new RegExp("\\p{M}", "gu");
const MARK = new RegExp("^\\p{M}$", "u");
const APOSTROPHES = /['’ʼ]/g;
const LETTERS: Record<string, string> = {
    ß: "ss",
    æ: "ae",
    œ: "oe",
    ø: "o",
    đ: "d",
    ł: "l",
    ı: "i",
};
const SPECIAL = /[ßæœøđłı]/g;
const ASCII_WORD = /^[A-Za-z0-9]+$/;
const ASCII_TEXT = /^[\x00-\x7f]*$/;
const DIGIT = new RegExp("\\p{N}", "u");
const ALL_DIGITS = new RegExp("^\\p{N}+$", "u");

/** Case, compatibility and accent folding shared by the index and the query,
 * so "Café", "cafe" and "CAFÉ" are one term, "ﬁ" is "fi" and "ℍ" is "h".
 * Compatibility forms are decomposed before lowercasing, so letterlike and
 * mathematical capitals fold too and folding twice changes nothing. */
export function foldTerm(raw: string): string {
    // Plain ASCII words are most of the text; they only need lowercasing.
    if (ASCII_WORD.test(raw)) return raw.toLowerCase();
    return raw
        .normalize("NFKD")
        .toLowerCase()
        .replace(MARKS, "")
        .replace(SPECIAL, (letter) => LETTERS[letter] ?? letter)
        .replace(APOSTROPHES, "");
}

export function tokenize(text: string): Token[] {
    const tokens: Token[] = [];
    Array.from(text.matchAll(WORD)).forEach((match) => {
        const term = foldTerm(match[0]);
        if (!term) return;
        const start = match.index ?? 0;
        tokens.push({
            term,
            start,
            end: start + match[0].length,
            position: tokens.length,
        });
    });
    return tokens;
}

/** Characters, not UTF-16 units or decomposed jamo: "하" is one character. */
export function characterCount(term: string): number {
    return ASCII_TEXT.test(term) ? term.length : characters(term).length;
}

/** A term's characters as code points, after recomposing (NFC), so a
 * Hangul syllable or an astral letter is one character, as a reader sees. */
export function characters(term: string): Int32Array {
    if (ASCII_TEXT.test(term)) {
        const codes = new Int32Array(term.length);
        for (let i = 0; i < term.length; i++) codes[i] = term.charCodeAt(i);
        return codes;
    }
    return Int32Array.from(
        Array.from(term.normalize("NFC"), (character) =>
            character.codePointAt(0),
        ) as number[],
    );
}

/** Whether a term holds a digit of any script ("10th", "covid18", "٢٠٢٥"). */
export function hasDigit(term: string): boolean {
    return DIGIT.test(term);
}

/** Whether a quoted phrase's last word may match as a prefix: one character
 * or all digits (of any script) must match a whole word, so `"2"` never
 * matches "2026". */
export function prefixable(term: string): boolean {
    return characterCount(term) >= 2 && !ALL_DIGITS.test(term);
}

/** How one typed word may match an indexed term. Unquoted words match
 * anywhere and, from 4 characters, through small typos; quoted words and
 * phrase words match whole words (the last one also as a prefix). */
export interface WordRule {
    term: string;
    prefix: boolean;
    substring: boolean;
    /** Largest Damerau-Levenshtein distance allowed; 0 for none. */
    typos: number;
}

export type MatchKind = "exact" | "prefix" | "substring" | "typo";

/** How a term matched: `at` and `length` are the matched characters of the
 * folded term (the whole term for exact and typo matches); `factor` scales
 * the field weight, so exact > prefix > substring > one typo > two. */
export interface TermMatch {
    kind: MatchKind;
    at: number;
    length: number;
    factor: number;
}

/** Damerau-Levenshtein distance (adjacent transpositions count one), or
 * `max + 1` as soon as it must exceed `max`. */
export function editsWithin(first: string, second: string, max: number) {
    // Counted in characters, like the allowance: a Hangul syllable is one
    // edit, not the two or three jamo it decomposes into.
    const a = characters(first),
        b = characters(second);
    const n = a.length,
        m = b.length;
    if (Math.abs(n - m) > max) return max + 1;
    let before = new Int32Array(m + 1);
    let previous = new Int32Array(m + 1);
    let current = new Int32Array(m + 1);
    for (let j = 0; j <= m; j++) previous[j] = j;
    for (let i = 1; i <= n; i++) {
        current[0] = i;
        let lowest = i;
        for (let j = 1; j <= m; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            let value = Math.min(
                (previous[j] as number) + 1,
                (current[j - 1] as number) + 1,
                (previous[j - 1] as number) + cost,
            );
            if (
                i > 1 &&
                j > 1 &&
                a[i - 1] === b[j - 2] &&
                a[i - 2] === b[j - 1]
            )
                value = Math.min(value, (before[j - 2] as number) + 1);
            current[j] = value;
            if (value < lowest) lowest = value;
        }
        if (lowest > max) return max + 1;
        [before, previous, current] = [previous, current, before];
    }
    return Math.min(previous[m] as number, max + 1);
}

/** Which characters a term holds, hashed over 31 bits (a–z land on 26
 * distinct bits; every script spreads over all 31). A typo can only add or
 * drop a few, so a cheap mask comparison rules most terms out before edits
 * are counted; a collision only makes two terms look alike, never apart. */
export function letterMask(term: string): number {
    let mask = 0;
    const codes = characters(term);
    for (let i = 0; i < codes.length; i++)
        mask |= 1 << (codes[i] as number) % 31;
    return mask;
}

function bits(value: number) {
    let count = 0;
    for (let rest = value; rest; rest &= rest - 1) count++;
    return count;
}

/** Whether a term can be within `typos` edits of the typed word, judged by
 * the letters each has that the other lacks. Never rejects a true match. */
export function mayBeTypo(typedMask: number, termMask: number, typos: number) {
    return (
        bits(typedMask & ~termMask) <= typos &&
        bits(termMask & ~typedMask) <= typos
    );
}

/** The one place a typed word is compared with an indexed term. */
export function matchTerm(rule: WordRule, term: string): TermMatch | null {
    const typed = rule.term;
    if (term === typed)
        return { kind: "exact", at: 0, length: term.length, factor: 1 };
    const ratio = typed.length / term.length;
    if (rule.prefix && term.startsWith(typed))
        return {
            kind: "prefix",
            at: 0,
            length: typed.length,
            factor: 0.6 + 0.2 * ratio,
        };
    if (rule.substring) {
        const at = term.indexOf(typed);
        if (at !== -1)
            return {
                kind: "substring",
                at,
                length: typed.length,
                factor: 0.45 + 0.1 * ratio,
            };
    }
    if (rule.typos) {
        const distance = editsWithin(typed, term, rule.typos);
        if (distance <= rule.typos)
            return {
                kind: "typo",
                at: 0,
                length: term.length,
                factor: distance === 1 ? 0.4 : 0.25,
            };
    }
    return null;
}

/** The original-text span of folded characters [from, to) of a token, so a
 * mark covers exactly the matched letters even where folding changed the
 * length ("ß" → "ss", a stripped accent). Null when folding one character at
 * a time does not reproduce the token's term; mark the whole token then. */
export function foldedSpan(
    text: string,
    token: Token,
    from: number,
    to: number,
): [number, number] | null {
    const raw = text.slice(token.start, token.end);
    if (ASCII_WORD.test(raw))
        return [token.start + from, token.start + Math.min(to, raw.length)];
    const starts: number[] = [];
    const ends: number[] = [];
    let folded = "";
    let offset = 0;
    let previous = 0;
    for (const character of Array.from(raw)) {
        const piece = foldTerm(character);
        const next = offset + character.length;
        if (!piece && MARK.test(character)) {
            // A combining accent stays with the letter it sits on.
            for (let i = previous; i < ends.length; i++) ends[i] = next;
        } else if (piece) previous = ends.length;
        for (let i = 0; i < piece.length; i++) {
            starts.push(offset);
            ends.push(next);
        }
        folded += piece;
        offset = next;
    }
    if (folded !== token.term || from >= to || to > folded.length) return null;
    return [
        token.start + (starts[from] as number),
        token.start + (ends[to - 1] as number),
    ];
}
