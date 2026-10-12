/**
 * Untrusted text (Phase 4 plan, decision 13): material, reflection notes and answers. Every such
 * string goes through `sanitize` before it is stored or sent to a model, so what's stored is what
 * the model sees. Pure; loads under plain Node.
 *
 * - Superscript and subscript characters (x², 2⁻ⁿ, x₁) are written as `^{…}` and `_{…}` first:
 *   NFKC alone would flatten them into the base line (x2, 2-n), which reads as something else.
 * - Unicode NFKC, so look-alike forms (full-width letters, ligatures) become plain ones.
 * - Removed: format characters (zero-width spaces and joiners, bidirectional controls, the tag
 *   block U+E0000–E007F used for hidden "ASCII smuggling", soft hyphens, byte-order marks),
 *   variation selectors, fillers that render as nothing, and control characters except newline
 *   and tab.
 * - Collapsed: runs of spaces to one space and runs of tabs (with any spaces) to one tab, since a
 *   tab in slide text is a column break worth keeping; three or more line breaks to two; a letter
 *   or digit repeated more than 64 times (long bit strings stay intact) and any other character
 *   repeated more than 8 times.
 * - Capped at `maxChars`.
 */

/** Characters that draw nothing or reorder text: \p{Cf} covers zero-width, bidi, tags, soft hyphen and BOM. */
const INVISIBLE = /[\p{Cf}\u{E0000}-\u{E007F}\u034F\u115F\u1160\u17B4\u17B5\u180B-\u180F\u3164\uFFA0\uFE00-\uFE0F\u{E0100}-\u{E01EF}]/gu;
/** C0 and C1 controls except tab (U+0009) and newline (U+000A). */
const CONTROLS = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g;
const REPEAT_WORD_CHAR = 64;
const REPEAT_OTHER = 8;

const SUPERSCRIPTS: Record<string, string> = { "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9", "⁺": "+", "⁻": "-", "⁼": "=", "⁽": "(", "⁾": ")", "ⁱ": "i", "ⁿ": "n" };
const SUBSCRIPTS: Record<string, string> = { "₀": "0", "₁": "1", "₂": "2", "₃": "3", "₄": "4", "₅": "5", "₆": "6", "₇": "7", "₈": "8", "₉": "9", "₊": "+", "₋": "-", "₌": "=", "₍": "(", "₎": ")", "ₐ": "a", "ₑ": "e", "ₒ": "o", "ₓ": "x", "ₕ": "h", "ₖ": "k", "ₗ": "l", "ₘ": "m", "ₙ": "n", "ₚ": "p", "ₛ": "s", "ₜ": "t" };
const SUPERSCRIPT_RUN = new RegExp(`[${Object.keys(SUPERSCRIPTS).join("")}]+`, "g");
const SUBSCRIPT_RUN = new RegExp(`[${Object.keys(SUBSCRIPTS).join("")}]+`, "g");

/** x² → x^{2}, 2⁻ⁿ → 2^{-n}, x₁ → x_{1}: the same notation `pageText` uses for raised and lowered glyphs. */
export function spellScripts(text: string): string {
  return text
    .replace(SUPERSCRIPT_RUN, (run) => `^{${[...run].map((c) => SUPERSCRIPTS[c]).join("")}}`)
    .replace(SUBSCRIPT_RUN, (run) => `_{${[...run].map((c) => SUBSCRIPTS[c]).join("")}}`);
}

export interface Sanitized {
  text: string;
  /** Invisible and control characters removed (a count, for reporting; never the characters). */
  removed: number;
  /** Whether the text was cut at `maxChars`. */
  truncated: boolean;
}

function count(text: string, pattern: RegExp): number {
  return text.match(pattern)?.length ?? 0;
}

export function sanitize(input: string, maxChars: number): Sanitized {
  if (!Number.isInteger(maxChars) || maxChars < 1) throw new Error(`sanitize: maxChars must be a positive integer, got ${maxChars}`);
  // Line separators become newlines before anything else, so they aren't removed as format characters.
  let text = spellScripts(input.replace(/\r\n?|[\u2028\u2029\u0085]/g, "\n")).normalize("NFKC");
  const removed = count(text, INVISIBLE) + count(text, CONTROLS);
  text = text
    .replace(INVISIBLE, "")
    .replace(CONTROLS, "")
    .replace(/[ \u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]+/g, " ")
    .replace(/[ \t]*\t[ \t]*/g, "\t")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/([\p{L}\p{N}])\1{64,}/gu, (_, c: string) => c.repeat(REPEAT_WORD_CHAR))
    .replace(/([^\p{L}\p{N}\s])\1{8,}/gu, (_, c: string) => c.repeat(REPEAT_OTHER))
    .trim();
  let truncated = false;
  if (text.length > maxChars) {
    truncated = true;
    text = text.slice(0, maxChars);
    // Don't leave half of a surrogate pair at the end.
    if (/[\uD800-\uDBFF]$/.test(text)) text = text.slice(0, -1);
  }
  return { text, removed, truncated };
}
