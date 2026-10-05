/**
 * Hidden text in PDFs (Phase 4 plan, decision 13): text a reader can't see but a model would read,
 * a common way to plant instructions in a document. A text item drawn under 2 pt, or entirely
 * outside the page box, is dropped and counted. Pure; works on pdf.js text items.
 *
 * pdf.js (v4 and later) already leaves glyphs outside the page box out of `getTextContent`, so
 * off-page text never reaches this check and can't be counted; the check below still drops it, in
 * case a pdf.js update stops doing so. Tiny text does arrive, and is what gets counted.
 *
 * pdf.js gives each item's transform in the page's user space (points), with the font size folded
 * in: [a, b, c, d, x, y], where (x, y) is the baseline start, |(c, d)| is the glyph height and
 * (a, b) runs along the baseline.
 */
export const MIN_VISIBLE_PT = 2;

export interface TextItemLike {
  str: string;
  transform: number[];
  width: number;
  height: number;
  hasEOL?: boolean;
}

/** The page box: [x0, y0, x1, y1] (pdf.js `page.view`). */
export type PageBox = readonly [number, number, number, number];

export interface Visible<T> {
  items: T[];
  /** Text items with something in them that were dropped. */
  hidden: number;
}

function isTextItem(item: object): item is TextItemLike {
  return "str" in item && "transform" in item && Array.isArray((item as TextItemLike).transform);
}

/** Whether a text item would be invisible: too small to read, or wholly off the page. */
export function isHidden(item: TextItemLike, box: PageBox): boolean {
  const [a, b, c, d, x, y] = item.transform;
  const size = Math.hypot(c, d) || item.height;
  if (size < MIN_VISIBLE_PT) return true;
  const run = Math.hypot(a, b) || 1;
  // The baseline's two ends; text is off the page when both are past the same edge.
  const ends = [
    [x, y],
    [x + (item.width * a) / run, y + (item.width * b) / run],
  ];
  const [x0, y0, x1, y1] = box;
  const past = (test: (p: number[]) => boolean) => ends.every(test);
  // A line whose baseline is just under the bottom edge still shows its top, so allow its height.
  return past((p) => p[0] < x0) || past((p) => p[0] > x1) || past((p) => p[1] > y1) || past((p) => p[1] + size < y0);
}

/**
 * The items to read from one page. Non-text items (marked-content markers) pass through; text
 * items that are hidden are dropped, and counted when they held anything besides whitespace.
 * Line breaks carried by a dropped item are kept, so the lines around it don't run together.
 */
export function visibleItems<T extends object>(items: readonly T[], box: PageBox): Visible<T> {
  const out: T[] = [];
  let hidden = 0;
  for (const item of items) {
    if (!isTextItem(item) || !isHidden(item, box)) {
      out.push(item);
      continue;
    }
    if (item.str.trim()) hidden += 1;
    if (item.hasEOL) out.push({ str: "", hasEOL: true } as unknown as T);
  }
  return { items: out, hidden };
}
