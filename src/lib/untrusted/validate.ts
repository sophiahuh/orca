/**
 * Output validators (Phase 4 plan, decision 13): nothing the model writes reaches a student
 * without passing these in code. Generated text (question prompts, options, explanations, rubric
 * lines, topic and objective names, descriptions, excerpts) is sanitised like input and refused
 * when it holds a URL the material doesn't, HTML, a markdown link, or instruction-like phrasing
 * (the pattern screen's strong hits; its weak phrases are ordinary prose too, so a generated
 * explanation may say "the output only changes on the clock edge"). Refused items are dropped with
 * a reason, never repaired. Pure.
 */
import { sanitize } from "./sanitize.ts";
import { screen } from "./screen.ts";

const URL = /\b(?:https?:\/\/|www\.)[^\s<>"')\]]+/gi;
/** An HTML tag (`<b>`, `</div>`, `<img …>`, a comment or doctype); `<` as "less than" in math isn't one. */
const HTML = /<\/?[a-zA-Z][a-zA-Z0-9-]*(?:\s[^<>]*)?\/?>|<!--|<!doctype/i;
const MARKDOWN_LINK = /\[[^\]\n]{1,200}\]\((?:https?:\/\/|www\.|\/)[^)\s]*\)/i;

export interface TextRule {
  /** URLs the text may contain (those in the material). Anything else is refused. */
  allowedUrls?: ReadonlySet<string>;
  /** Longest the text may be after sanitising; unset, any length. */
  maxChars?: number;
}

export type Validated = { ok: true; text: string } | { ok: false; reason: string };

/** The URLs in a body of text, normalised the way `validateText` compares them (lowercase, no trailing punctuation). */
export function urlsIn(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.matchAll(URL)) out.add(normaliseUrl(m[0]));
  return out;
}

const normaliseUrl = (u: string) => u.toLowerCase().replace(/[.,;:!?]+$/, "");

/** Sanitise one generated string and refuse what decision 13 refuses. */
export function validateText(text: string, rule: TextRule): Validated {
  const clean = sanitize(text, rule.maxChars);
  if (clean.truncated) return { ok: false, reason: `longer than ${rule.maxChars} characters` };
  const t = clean.text;
  if (HTML.test(t)) return { ok: false, reason: "contains HTML" };
  if (MARKDOWN_LINK.test(t)) return { ok: false, reason: "contains a link" };
  for (const u of urlsIn(t)) if (!rule.allowedUrls?.has(u)) return { ok: false, reason: `contains a URL not in the material (${u.slice(0, 60)})` };
  const s = screen(t);
  if (s.strong) return { ok: false, reason: `reads like an instruction to an AI ("${s.hits.find((h) => h.severity === "strong")!.quote.slice(0, 80)}")` };
  return { ok: true, text: t };
}

/** Validate several named strings at once; the first failure names its field. */
export function validateFields(fields: Record<string, string | null | undefined>, rule: TextRule): { ok: true; values: Record<string, string> } | { ok: false; reason: string } {
  const values: Record<string, string> = {};
  for (const [name, value] of Object.entries(fields)) {
    if (value === null || value === undefined) continue;
    const v = validateText(value, rule);
    if (!v.ok) return { ok: false, reason: `${name} ${v.reason}` };
    values[name] = v.text;
  }
  return { ok: true, values };
}
