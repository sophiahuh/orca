/**
 * Read an uploaded PDF on the server into the pages Orca stores (`material_pages`): pdf.js in
 * Node, hidden text dropped and counted, every page's text sanitised (decision 13), at most
 * `LIMITS.pagesPerFile` pages (decision 10, refused before anything is read). Loads under plain
 * Node, so the unit tests read the real ALD decks with it.
 */
import { LIMITS } from "../limits.ts";
import { sanitize } from "../untrusted/sanitize.ts";
import { type PageBox, visibleItems } from "../untrusted/hidden-text.ts";
import { pageText } from "./page-text.ts";

export interface ReadPage {
  n: number;
  text: string;
}

/** What hidden text a file had: how many text items were dropped, and on which pages. */
export interface HiddenText {
  items: number;
  pages: number[];
}

export interface ReadPdf {
  pages: ReadPage[];
  hidden: HiddenText;
  /** Invisible or control characters removed by the sanitiser, over all pages. */
  removed: number;
  /** Pages cut at `LIMITS.pageChars`. */
  truncated: number[];
}

/** A file Orca won't read, with a message for the student. */
export class UnreadablePdfError extends Error {
  readonly status: number;
  constructor(message: string, status = 422) {
    super(message);
    this.name = "UnreadablePdfError";
    this.status = status;
  }
}

/** Whether the bytes start like a PDF ("%PDF-"; a few bytes of junk before it are allowed, as readers do). */
export function looksLikePdf(bytes: Uint8Array): boolean {
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 1024));
  return head.includes("%PDF-");
}

/**
 * `timeoutMs`: the overall budget; a file that takes longer (a pathological or hostile PDF) is
 * refused as unreadable rather than holding the request until the platform kills it.
 */
export async function readPdf(bytes: Uint8Array, { timeoutMs = LIMITS.readMs }: { timeoutMs?: number } = {}): Promise<ReadPdf> {
  if (bytes.byteLength > LIMITS.uploadBytes) throw new UnreadablePdfError(`This file is over ${LIMITS.uploadBytes / 1024 / 1024} MB.`, 413);
  if (!looksLikePdf(bytes)) throw new UnreadablePdfError("This file isn't a PDF.", 415);
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  // pdf.js takes ownership of the buffer it's given, so it gets a copy.
  // Errors only: missing standard font data (metrics) is a warning that changes nothing for text.
  const task = pdfjs.getDocument({ data: bytes.slice(), disableFontFace: true, useSystemFonts: false, verbosity: pdfjs.VerbosityLevel.ERRORS });
  const deadline = Date.now() + timeoutMs;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const tooSlow = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new UnreadablePdfError(`Orca gave up reading this PDF after ${Math.round(timeoutMs / 1000)} seconds.`)), timeoutMs);
  });
  // Every step races the overall budget.
  const inTime = <T>(p: Promise<T>): Promise<T> => (Date.now() > deadline ? tooSlow : Promise.race([p, tooSlow]));
  tooSlow.catch(() => undefined);
  try {
    let doc: Awaited<typeof task.promise>;
    try {
      doc = await inTime(task.promise);
    } catch (e) {
      if (e instanceof UnreadablePdfError) throw e;
      const name = e instanceof Error ? e.name : "";
      if (name === "PasswordException") throw new UnreadablePdfError("This PDF is password-protected; upload a copy without a password.");
      throw new UnreadablePdfError(`Orca couldn't read this PDF (${e instanceof Error ? e.message : String(e)}).`);
    }
    if (doc.numPages > LIMITS.pagesPerFile) {
      throw new UnreadablePdfError(`This PDF has ${doc.numPages} pages; Orca reads at most ${LIMITS.pagesPerFile} per file. Split it and upload the parts.`, 413);
    }
    const pages: ReadPage[] = [];
    const hidden: HiddenText = { items: 0, pages: [] };
    const truncated: number[] = [];
    let removed = 0;
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await inTime(doc.getPage(n));
      const content = await inTime(page.getTextContent());
      const visible = visibleItems(content.items, page.view as unknown as PageBox);
      if (visible.hidden) {
        hidden.items += visible.hidden;
        hidden.pages.push(n);
      }
      const clean = sanitize(pageText(visible.items), LIMITS.pageChars);
      removed += clean.removed;
      if (clean.truncated) truncated.push(n);
      pages.push({ n, text: clean.text });
      page.cleanup();
    }
    return { pages, hidden, removed, truncated };
  } finally {
    clearTimeout(timer);
    await task.destroy();
  }
}
