/**
 * Marked passages (weak points first, Plan B): when the student has described how they mark confusion
 * in their notes, the page reader writes a passage next to one of those marks as
 * "[marked: <mark>] <passage> [/marked]". Only pages read from their images (`source: "vision"`) can
 * carry them, so an uploaded file's own text can't plant a struggle flag. Pure.
 */
const SPAN = /\[marked:[^\]]{0,40}\]([\s\S]*?)\[\/marked\]/g;

const norm = (s: string) =>
  s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[“”"‘’'`]/g, "")
    .replace(/\s+/g, " ")
    .trim();

/** The marked passages on a page, normalised. */
export function markedSpans(text: string): string[] {
  return [...text.matchAll(SPAN)].map((m) => norm(m[1])).filter((s) => s.length > 0);
}

/** Whether a struggled item quotes a marked passage on one of `pages` (the ones its call was sent), read from its image. */
export function struggledItemOk(item: { page: number; quote: string }, pages: ReadonlyArray<{ n: number; text: string; source?: string }>): boolean {
  const p = pages.find((x) => x.n === item.page);
  const quote = norm(item.quote);
  if (!p || p.source !== "vision" || quote.length < 2) return false;
  return markedSpans(p.text).some((span) => span.includes(quote));
}

/** Whether any page carries a marked passage (the objectives step's rule is added only then). */
export function hasMarks(pages: ReadonlyArray<{ text: string }>): boolean {
  return pages.some((p) => p.text.includes("[marked:"));
}
