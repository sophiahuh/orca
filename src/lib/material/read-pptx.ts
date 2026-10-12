/**
 * Read an uploaded PowerPoint deck (.pptx) on the server into the pages Orca stores, one page per
 * slide in the deck's order: the slide's text (text boxes, placeholders, tables) then its speaker
 * notes. No model is involved; a .pptx is a zip of XML. Like the PDF reader, text too small to see
 * (under 2 pt) and shapes marked hidden are dropped and counted, every page is sanitised, and a deck
 * over `LIMITS.pagesPerFile` slides is refused. Pictures, charts and SmartArt aren't read
 * (`docs/TO-DISCUSS.md`), and slides can't be rendered as figures. Loads under plain Node.
 */
import { LIMITS } from "../limits.ts";
import { sanitize } from "../untrusted/sanitize.ts";
import { type HiddenText, type ReadPage, UnreadablePdfError } from "./read-pdf.ts";
import { ZipError, looksLikeZip, openZip } from "./unzip.ts";

export interface ReadPptx {
  pages: ReadPage[];
  hidden: HiddenText;
  removed: number;
  truncated: number[];
}

/** Text runs under this size (hundredths of a point, as the XML stores it) are too small to see. */
const MIN_VISIBLE_SZ = 200;
/** Placeholders that hold furniture, not content: slide numbers, dates, footers, the notes page's slide picture. */
const FURNITURE = new Set(["sldNum", "dt", "ftr", "hdr", "sldImg"]);

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : "";
    }
    return ENTITIES[e] ?? whole;
  });
}

const attr = (tag: string, name: string) => tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1] ?? null;

/** A part's relationships: id → target path inside the archive (resolved against the part's folder). */
function relationships(zip: ReturnType<typeof openZip>, part: string): Array<{ id: string; type: string; target: string }> {
  const slash = part.lastIndexOf("/");
  const folder = part.slice(0, slash);
  const xml = zip.text(`${folder}/_rels/${part.slice(slash + 1)}.rels`);
  if (!xml) return [];
  return [...xml.matchAll(/<Relationship\b[^>]*>/g)].map(([tag]) => {
    const target = attr(tag, "Target") ?? "";
    const parts = target.startsWith("/") ? target.slice(1).split("/") : [...folder.split("/"), ...target.split("/")];
    const path: string[] = [];
    for (const p of parts) {
      if (p === "..") path.pop();
      else if (p && p !== ".") path.push(p);
    }
    return { id: attr(tag, "Id") ?? "", type: attr(tag, "Type") ?? "", target: path.join("/") };
  });
}

/** The visible text of a slide or notes page, paragraph by paragraph; what was hidden is counted. */
function partText(xml: string): { text: string; hidden: number } {
  let hidden = 0;
  const lines: string[] = [];
  // Shapes and table frames (a group's shapes are matched one by one; shapes don't nest).
  for (const [shape] of xml.matchAll(/<p:(sp|graphicFrame)\b[\s\S]*?<\/p:\1>/g)) {
    const runs = (shape.match(/<a:t[\s>]/g) ?? []).length;
    if (/<p:cNvPr\b[^>]*\bhidden="(1|true)"/.test(shape)) {
      hidden += runs;
      continue;
    }
    const ph = shape.match(/<p:ph\b[^>]*>/)?.[0];
    if (ph && FURNITURE.has(attr(ph, "type") ?? "")) continue;
    // A table reads a row to a line, its cells joined with " | ".
    const rows = [...shape.matchAll(/<a:tr\b[\s\S]*?<\/a:tr>/g)].map(([row]) => row);
    if (rows.length) {
      for (const row of rows) {
        const cells = [...row.matchAll(/<a:tc\b[\s\S]*?<\/a:tc>/g)].map(([cell]) => paragraphs(cell).join(" "));
        if (cells.some((c) => c.trim())) lines.push(cells.join(" | "));
      }
      continue;
    }
    lines.push(...paragraphs(shape));
  }
  return { text: lines.join("\n"), hidden };

  function paragraphs(xml: string): string[] {
    const out: string[] = [];
    for (const [paragraph] of xml.matchAll(/<a:p>[\s\S]*?<\/a:p>/g)) {
      let line = "";
      for (const [piece] of paragraph.matchAll(/<a:(r|fld)\b[\s\S]*?<\/a:\1>|<a:br\b[^>]*\/>/g)) {
        if (piece.startsWith("<a:br")) {
          line += "\n";
          continue;
        }
        const size = Number(attr(piece.match(/<a:rPr\b[^>]*>/)?.[0] ?? "", "sz") ?? NaN);
        const t = piece.match(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/)?.[1] ?? "";
        if (!t) continue;
        if (size < MIN_VISIBLE_SZ) {
          hidden++;
          continue;
        }
        line += decode(t);
      }
      if (line.trim()) out.push(line);
    }
    return out;
  }
}

export async function readPptx(bytes: Uint8Array): Promise<ReadPptx> {
  if (bytes.byteLength > LIMITS.uploadBytes) throw new UnreadablePdfError(`This file is over ${LIMITS.uploadBytes / 1024 / 1024} MB.`, 413);
  if (!looksLikeZip(bytes)) throw new UnreadablePdfError("This file isn't a PowerPoint (.pptx) deck.", 415);
  try {
    const zip = openZip(bytes);
    const presentation = zip.text("ppt/presentation.xml");
    if (!presentation) throw new UnreadablePdfError("This file isn't a PowerPoint (.pptx) deck.", 415);
    // The deck's order is the slide list in presentation.xml, not the file names.
    const rels = new Map(relationships(zip, "ppt/presentation.xml").map((r) => [r.id, r.target]));
    const order = [...(presentation.match(/<p:sldIdLst>[\s\S]*?<\/p:sldIdLst>/)?.[0] ?? "").matchAll(/<p:sldId\b[^>]*>/g)]
      .map(([tag]) => rels.get(attr(tag, "r:id") ?? ""))
      .filter((p): p is string => !!p && zip.has(p));
    if (!order.length) throw new UnreadablePdfError("This deck has no slides.", 422);
    if (order.length > LIMITS.pagesPerFile) {
      throw new UnreadablePdfError(`This deck has ${order.length} slides; Orca reads at most ${LIMITS.pagesPerFile} per file. Split it and upload the parts.`, 413);
    }

    const pages: ReadPage[] = [];
    const hidden: HiddenText = { items: 0, pages: [] };
    const truncated: number[] = [];
    let removed = 0;
    order.forEach((part, i) => {
      const n = i + 1;
      const slide = partText(zip.text(part) ?? "");
      const notesPart = relationships(zip, part).find((r) => r.type.endsWith("/notesSlide"))?.target;
      const notesXml = notesPart ? zip.text(notesPart) : null;
      const notes = notesXml ? partText(notesXml) : { text: "", hidden: 0 };
      const dropped = slide.hidden + notes.hidden;
      if (dropped) {
        hidden.items += dropped;
        hidden.pages.push(n);
      }
      const text = notes.text.trim() ? `${slide.text}\n\n[Speaker notes]\n${notes.text}` : slide.text;
      const clean = sanitize(text, LIMITS.pageChars);
      removed += clean.removed;
      if (clean.truncated) truncated.push(n);
      pages.push({ n, text: clean.text });
    });
    return { pages, hidden, removed, truncated };
  } catch (e) {
    if (e instanceof ZipError) throw new UnreadablePdfError(`Orca couldn't read this deck (${e.message}).`);
    throw e;
  }
}
