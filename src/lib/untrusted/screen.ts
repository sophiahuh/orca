/**
 * The pattern screen (Phase 4 plan, decision 13): looks for known prompt-injection phrasing in
 * untrusted text (material, reflection notes, prose answers) and in payloads hidden in Base64 or
 * hex. A hit never blocks: course material can legitimately discuss these things (a security
 * course would). It marks the text `suspected` and quotes the span, so the run record and
 * `security_events` can say what was seen and the review screen can warn. Pure; loads under plain
 * Node. Patterns follow OWASP's LLM Prompt Injection Prevention Cheat Sheet.
 */

export interface ScreenHit {
  /** Which check matched: "phrase", "role-tag", "encoded-base64", "encoded-hex". */
  check: "phrase" | "role-tag" | "encoded-base64" | "encoded-hex";
  /** The matched text, with a little context, at most `QUOTE_MAX` characters. */
  quote: string;
}

export interface Screened {
  suspected: boolean;
  hits: ScreenHit[];
}

export const QUOTE_MAX = 240;
const MAX_HITS = 20;

/**
 * Phrases that address or steer a model. Letters may be separated by spaces, dots or dashes
 * ("i.g.n.o.r.e") and one letter may be swapped or dropped (common misspellings); `fuzzy()` builds
 * the pattern. Each entry is a sequence of words.
 */
const PHRASES: string[][] = [
  ["ignore", "previous", "instructions"],
  ["ignore", "all", "previous", "instructions"],
  ["ignore", "the", "above"],
  ["ignore", "prior", "instructions"],
  ["ignore", "earlier", "instructions"],
  ["disregard", "previous", "instructions"],
  ["disregard", "the", "instructions"],
  ["forget", "your", "instructions"],
  ["new", "instructions"],
  ["you", "are", "now"],
  ["you", "are", "a"],
  ["act", "as"],
  ["pretend", "to", "be"],
  ["system", "prompt"],
  ["developer", "message"],
  ["developer", "mode"],
  ["jailbreak"],
  ["do", "anything", "now"],
  ["override", "your", "instructions"],
  ["output", "only"],
  ["mark", "this", "correct"],
  ["mark", "all", "correct"],
  ["mark", "every", "answer", "correct"],
  ["grade", "this", "as", "correct"],
  ["ignore", "the", "rubric"],
  ["reset", "every", "objective"],
  ["reset", "all", "objectives"],
  ["to", "the", "ai"],
  ["to", "the", "assistant"],
  ["to", "the", "model"],
  ["dear", "ai"],
  ["if", "you", "are", "an", "ai"],
  ["as", "an", "ai"],
];

/** Markers of chat-transcript roles that a payload uses to pose as the conversation itself. */
const ROLE_TAGS = /<\|im_start\|>|<\|im_end\|>|<\|system\|>|<\|user\|>|<\|assistant\|>|\[INST\]|\[\/INST\]|<<SYS>>|<\/?SYS>>|<\/?system>|<\/?assistant>|<\/?user>|^\s*(?:###\s*)?(?:system|assistant|human|user)\s*:/gim;

/** One word, letters optionally separated, with one substitution, insertion or deletion allowed for words of 5+ letters. */
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
  }
  return `(?:${variants.join("|")})`;
}
const escape = (c: string) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const PHRASE_PATTERNS: RegExp[] = PHRASES.map((words) => new RegExp(`(?<![a-z])${words.map(fuzzyWord).join("[\\s._\\-*,;:]{1,6}")}(?![a-z])`, "i"));

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
  for (const pattern of PHRASE_PATTERNS) {
    const m = pattern.exec(text);
    if (m && hits.length < MAX_HITS) hits.push({ check: "phrase", quote: quoteAround(text, m.index, m[0].length) });
  }
  ROLE_TAGS.lastIndex = 0;
  for (let m = ROLE_TAGS.exec(text); m && hits.length < MAX_HITS; m = ROLE_TAGS.exec(text)) {
    hits.push({ check: "role-tag", quote: quoteAround(text, m.index, m[0].length) });
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
    for (const h of inner) hits.push({ check: "encoded-base64", quote: h.quote });
  }
  for (const m of text.matchAll(HEX_RUN)) {
    if (hits.length >= MAX_HITS) break;
    const hex = m[0].replace(/[^0-9a-fA-F]/g, "");
    if (hex.length % 2) continue;
    const decoded = printable(Uint8Array.from(Buffer.from(hex, "hex")));
    if (!decoded) continue;
    const inner: ScreenHit[] = [];
    scanPlain(decoded, inner);
    for (const h of inner) hits.push({ check: "encoded-hex", quote: h.quote });
  }
  // Several phrases often match one sentence and quote the same span: one hit per distinct quote.
  const seen = new Set<string>();
  const unique = hits.filter((h) => {
    const key = `${h.check}\u0000${h.quote}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { suspected: unique.length > 0, hits: unique.slice(0, MAX_HITS) };
}
