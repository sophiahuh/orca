/**
 * One page's text items joined into lines, the way every reader of Orca's PDFs does it. Pure.
 *
 * Superscripts and subscripts in slides are usually not special characters: they're ordinary
 * glyphs drawn smaller and above or below the baseline (the ALD decks write 1/2¹⁶ as "1/2" then a
 * raised "16", and x₁ as "x" then a lowered "1"). Read as plain text that becomes "1/2 16" and
 * "x 1", which a model can't tell from a product or a list. An item on the same line whose
 * baseline sits at least a fifth of the current size above or below it, and which isn't bigger,
 * is written as `^{…}` or `_{…}` instead.
 */
export interface TextRun {
  str: string;
  hasEOL?: boolean;
  /** pdf.js's [a, b, c, d, x, y]: (x, y) the baseline start, |(c, d)| the glyph height. */
  transform?: number[];
}

/** A baseline shift of this fraction of the running text's size marks a super- or subscript. */
export const SCRIPT_SHIFT = 0.2;
/** A super- or subscript may be at most this much bigger than the running text (equation fonts vary a little). */
const SCRIPT_MAX_SIZE = 1.05;

interface Geometry {
  y: number;
  size: number;
}

function geometry(transform: number[] | undefined): Geometry | null {
  if (!transform || transform.length < 6) return null;
  const size = Math.hypot(transform[2], transform[3]);
  return size > 0 && Number.isFinite(transform[5]) ? { y: transform[5], size } : null;
}

export function pageText(items: ReadonlyArray<object>): string {
  const lines: string[] = [];
  let line = "";
  let base: Geometry | null = null;
  let script: { kind: "^" | "_"; text: string } | null = null;
  let afterScript = false;

  const flushScript = () => {
    if (!script) return;
    const text = script.text.trim();
    if (text) {
      line = `${line.replace(/ $/, "")}${script.kind}{${text}}`;
      afterScript = true;
    }
    script = null;
  };
  const endLine = () => {
    flushScript();
    lines.push(line);
    line = "";
    base = null;
    afterScript = false;
  };

  for (const item of items) {
    if (!("str" in item)) continue;
    const { str, hasEOL, transform } = item as TextRun;
    const geo = geometry(transform);
    let kind: "^" | "_" | null = null;
    if (geo && base && geo.size <= base.size * SCRIPT_MAX_SIZE) {
      const shift = geo.y - base.y;
      if (shift >= SCRIPT_SHIFT * base.size) kind = "^";
      else if (shift <= -SCRIPT_SHIFT * base.size) kind = "_";
    }
    if (kind) {
      if (script && script.kind !== kind) flushScript();
      script ??= { kind, text: "" };
      script.text += str;
    } else {
      flushScript();
      // After a script, the next word gets its space back; a closing bracket or punctuation doesn't.
      if (afterScript && str && !/^[\s)\]}.,;:!?]/.test(str)) line += " ";
      afterScript = false;
      if (geo && str.trim()) base = geo;
      line += str;
      if (!hasEOL && str && !str.endsWith(" ")) line += " ";
    }
    if (hasEOL) endLine();
  }
  if (script || line) endLine();
  return lines.join("\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
