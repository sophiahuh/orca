/**
 * The pattern screen (Phase 4 plan, decision 13): looks for known prompt-injection phrasing in
 * untrusted text (material, reflection notes, prose answers) and in payloads hidden in Base64 or
 * hex. A hit never blocks: course material can legitimately discuss these things (a security
 * course would). It marks the text `suspected` and quotes the span, so the run record and
 * `security_events` can say what was seen and the review screen can warn. Pure; loads under plain
 * Node. Patterns follow OWASP's LLM Prompt Injection Prevention Cheat Sheet.
 */

export type Severity = "strong" | "weak";

export interface ScreenHit {
  /** Which check matched: "phrase", "role-tag", "encoded-base64", "encoded-hex". */
  check: "phrase" | "role-tag" | "encoded-base64" | "encoded-hex";
  /**
   * How sure the check is. "strong": phrasing with no place in course material or an honest answer
   * (ignore the instructions, system prompt, mark this correct, a chat role tag, an encoded payload).
   * "weak": phrasing ordinary prose also uses ("the output only changes on the clock edge", "you are
   * a designer"); it is logged and shown, never used to refuse text or to turn grading off.
   */
  severity: Severity;
  /** The matched text, with a little context, at most `QUOTE_MAX` characters. */
  quote: string;
}

export interface Screened {
  /** Any hit at all (weak ones included): worth logging. */
  suspected: boolean;
  /** At least one strong hit: worth refusing (generated text), warning about or counting against a student. */
  strong: boolean;
  hits: ScreenHit[];
}

export const QUOTE_MAX = 240;
const MAX_HITS = 20;

/**
 * Phrases that address or steer a model. Letters may be separated by spaces, dots or dashes
 * ("i.g.n.o.r.e") and one letter may be swapped or dropped (common misspellings); `fuzzy()` builds
 * the pattern. Each entry is a sequence of words. Strong phrases don't occur in honest course text
 * or answers; weak ones can (a logic deck says "the output only changes on the clock edge", an exam
 * says "you are a designer; given the truth table…", an ISA was "extended with new instructions").
 */
const STRONG_PHRASES: string[][] = [
  ["ignore", "previous", "instructions"],
  ["ignore", "all", "previous", "instructions"],
  ["ignore", "the", "above"],
  ["ignore", "prior", "instructions"],
  ["ignore", "earlier", "instructions"],
  ["disregard", "previous", "instructions"],
  ["disregard", "the", "instructions"],
  ["forget", "your", "instructions"],
  ["system", "prompt"],
  ["developer", "message"],
  ["developer", "mode"],
  ["jailbreak"],
  ["do", "anything", "now"],
  ["override", "your", "instructions"],
  ["mark", "this", "correct"],
  ["mark", "all", "correct"],
  ["mark", "every", "answer", "correct"],
  ["grade", "this", "as", "correct"],
  ["ignore", "the", "rubric"],
  ["reset", "every", "objective"],
  ["reset", "all", "objectives"],
  ["dear", "ai"],
  ["if", "you", "are", "an", "ai"],
  ["helpful", "assistant"],
];
const WEAK_PHRASES: string[][] = [
  ["new", "instructions"],
  ["you", "are", "now"],
  ["you", "are", "a"],
  ["act", "as"],
  ["pretend", "to", "be"],
  ["output", "only"],
  ["to", "the", "ai"],
  ["to", "the", "assistant"],
  ["to", "the", "model"],
  ["as", "an", "ai"],
];

/** Markers of chat-transcript roles that a payload uses to pose as the conversation itself. */
const ROLE_TAGS = /<\|im_start\|>|<\|im_end\|>|<\|system\|>|<\|user\|>|<\|assistant\|>|\[INST\]|\[\/INST\]|<<SYS>>|<\/?SYS>>|<\/?system>|<\/?assistant>|<\/?user>|^\s*(?:###\s*)?(?:system|assistant|human|user)\s*:/gim;

/** One word, letters optionally separated, with one substitution, insertion, deletion or transposition allowed for words of 5+ letters. */
function fuzzyWord(word: string): string {
  const letters = [...word];
  const sep = "[\\s._\\-*]{0,2}";
  const exact = letters.map((c) => escape(c)).join(sep);
  if (letters.length < 5) return exact;
  const variants = [exact];
  for (let i = 0; i < letters.length; i++) {
    const before = letters.slice(0, i).map(escape).join(sep);
    const after = letters.slice(i + 1).map(escape).join(sep);
    const join = (a: string, b: string) => [a, b].filter(Boolean).join(sep);
    variants.push(join(before, after)); // one letter dropped
    variants.push(join(join(before, "[a-z]"), after)); // one letter swapped
    variants.push(join(join(before, `${escape(letters[i])}[a-z]`), after)); // one letter added
    if (i + 1 < letters.length) variants.push(join(join(before, `${escape(letters[i + 1])}${sep}${escape(letters[i])}`), letters.slice(i + 2).map(escape).join(sep))); // two letters swapped ("instrcutions")
  }
  return `(?:${variants.join("|")})`;
}
const escape = (c: string) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const phrasePattern = (words: string[]) => new RegExp(`(?<![a-z])${words.map(fuzzyWord).join("[\\s._\\-*,;:]{1,6}")}(?![a-z])`, "i");
const PHRASE_PATTERNS: Array<{ pattern: RegExp; severity: Severity }> = [
  ...STRONG_PHRASES.map((w) => ({ pattern: phrasePattern(w), severity: "strong" as const })),
  ...WEAK_PHRASES.map((w) => ({ pattern: phrasePattern(w), severity: "weak" as const })),
];

const BASE64_RUN = /[A-Za-z0-9+/]{40,}={0,2}/g;
const HEX_RUN = /(?:[0-9a-fA-F]{2}[\s:-]?){20,}/g;

function quoteAround(text: string, index: number, length: number): string {
  const pad = Math.max(0, Math.floor((QUOTE_MAX - length) / 2));
  const start = Math.max(0, index - pad);
  return text.slice(start, Math.min(text.length, index + length + pad)).replace(/\s+/g, " ").trim().slice(0, QUOTE_MAX);
}

/** Decoded bytes that are mostly printable text; otherwise null (an image or random data, not a payload). */
function printable(bytes: Uint8Array): string | null {
  if (!bytes.length) return null;
  let good = 0;
  for (const b of bytes) if ((b >= 0x20 && b < 0x7f) || b === 0x0a || b === 0x0d || b === 0x09) good++;
  if (good / bytes.length < 0.9) return null;
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

function scanPlain(text: string, hits: ScreenHit[]): void {
  for (const { pattern, severity } of PHRASE_PATTERNS) {
    const m = pattern.exec(text);
    if (m && hits.length < MAX_HITS) hits.push({ check: "phrase", severity, quote: quoteAround(text, m.index, m[0].length) });
  }
  ROLE_TAGS.lastIndex = 0;
  for (let m = ROLE_TAGS.exec(text); m && hits.length < MAX_HITS; m = ROLE_TAGS.exec(text)) {
    hits.push({ check: "role-tag", severity: "strong", quote: quoteAround(text, m.index, m[0].length) });
    if (m[0].length === 0) ROLE_TAGS.lastIndex++;
  }
}

/**
 * Screen one piece of untrusted text. Long Base64 and hex runs are decoded and the decoded text
 * screened too (a hit there is reported as "encoded-…" with the decoded span quoted).
 */
export function screen(text: string): Screened {
  const hits: ScreenHit[] = [];
  scanPlain(text, hits);
  for (const m of text.matchAll(BASE64_RUN)) {
    if (hits.length >= MAX_HITS) break;
    let decoded: string | null = null;
    try {
      decoded = printable(Uint8Array.from(Buffer.from(m[0], "base64")));
    } catch {
      decoded = null;
    }
    if (!decoded) continue;
    const inner: ScreenHit[] = [];
    scanPlain(decoded, inner);
    // A payload hidden in an encoding is suspect whatever it says.
    for (const h of inner) hits.push({ check: "encoded-base64", severity: "strong", quote: h.quote });
  }
  for (const m of text.matchAll(HEX_RUN)) {
    if (hits.length >= MAX_HITS) break;
    const hex = m[0].replace(/[^0-9a-fA-F]/g, "");
    if (hex.length % 2) continue;
    const decoded = printable(Uint8Array.from(Buffer.from(hex, "hex")));
    if (!decoded) continue;
    const inner: ScreenHit[] = [];
    scanPlain(decoded, inner);
    for (const h of inner) hits.push({ check: "encoded-hex", severity: "strong", quote: h.quote });
  }
  // Several phrases often match one sentence and quote the same span: one hit per distinct quote,
  // the strong one kept when both severities quote it.
  const byKey = new Map<string, ScreenHit>();
  for (const h of hits) {
    const key = `${h.check}\u0000${h.quote}`;
    const had = byKey.get(key);
    if (!had || (had.severity === "weak" && h.severity === "strong")) byKey.set(key, h);
  }
  const unique = [...byKey.values()].slice(0, MAX_HITS);
  return { suspected: unique.length > 0, strong: unique.some((h) => h.severity === "strong"), hits: unique };
}
