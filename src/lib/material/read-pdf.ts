/**
 * Read an uploaded PDF on the server into the pages Orca stores (`material_pages`): pdf.js in
 * Node, hidden text dropped and counted, every page's text sanitised (decision 13), at most
 * `LIMITS.pagesPerFile` pages (decision 10, refused before anything is read). Loads under plain
 * Node, so the unit tests read the real ALD decks with it.
 *
 * Parsing runs in a worker thread. In Node, pdf.js otherwise parses on the main thread (its "fake
 * worker"), where a hostile or broken file that never yields can't be interrupted: a timer can only
 * fire between awaits, so the 40 s budget held only for files that cooperated. With the parser on
 * its own thread the budget is real: when it runs out the worker is terminated, whatever it was
 * doing, and the file is refused. If the worker can't start at all (an environment without
 * `worker_threads`), the read falls back to the main thread and says so in `engine`.
 */
import { MessageChannel, Worker } from "node:worker_threads";
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
  /** Where pdf.js parsed the file: its own thread (the rule) or this one (the worker couldn't start). */
  engine: "worker" | "main-thread";
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
 * The worker thread's whole program: pdf.js's own worker module, listening on the port it's given.
 * Evaluated from a string so nothing has to resolve a file path through a bundler; the bare import
 * resolves from the process's working directory, where `node_modules` is (dev, Vercel, Trigger.dev).
 */
const PDF_WORKER_SOURCE = `
const { workerData } = require("node:worker_threads");
import("pdfjs-dist/legacy/build/pdf.worker.mjs").then((m) => m.WorkerMessageHandler.initializeFromPort(workerData.port));
`;

/** The parser's memory, so one file can't take the process down with it (a 25 MB PDF needs far less). */
const WORKER_HEAP_MB = 1024;

export interface ReadOptions {
  /** The overall budget; a file that takes longer is refused as unreadable, and its parser stopped. */
  timeoutMs?: number;
  /** Tests only: the worker's program (e.g. one that never answers), instead of pdf.js's. */
  workerSource?: string;
}

/** The parser thread stopped; `beforeDocument` when it never got as far as opening the file. */
class WorkerDied extends Error {
  beforeDocument = false;
}

/** A pdf.js worker on its own thread: `port` is what pdf.js talks to; `down` rejects if the thread dies. */
function startParser(source: string) {
  const { port1, port2 } = new MessageChannel();
  const worker = new Worker(source, { eval: true, workerData: { port: port2 }, transferList: [port2], resourceLimits: { maxOldGenerationSizeMb: WORKER_HEAP_MB } });
  let stopped = false;
  const down = new Promise<never>((_, reject) => {
    worker.once("error", (e) => reject(new WorkerDied(e instanceof Error ? e.message : String(e))));
    worker.once("exit", (code) => {
      if (!stopped) reject(new WorkerDied(`the parser stopped (exit code ${code})`));
    });
  });
  down.catch(() => undefined);
  port1.start();
  const stop = async () => {
    stopped = true;
    port1.close();
    await worker.terminate();
  };
  return { port: port1, down, stop };
}

export async function readPdf(bytes: Uint8Array, { timeoutMs = LIMITS.readMs, workerSource = PDF_WORKER_SOURCE }: ReadOptions = {}): Promise<ReadPdf> {
  if (bytes.byteLength > LIMITS.uploadBytes) throw new UnreadablePdfError(`This file is over ${LIMITS.uploadBytes / 1024 / 1024} MB.`, 413);
  if (!looksLikePdf(bytes)) throw new UnreadablePdfError("This file isn't a PDF.", 415);
  const deadline = Date.now() + timeoutMs;
  try {
    return await read(bytes, deadline, workerSource);
  } catch (e) {
    // The worker thread itself couldn't start (not the file's fault): read here instead, with the
    // time left. A worker that died while parsing a loaded document is the file's fault (below).
    if (e instanceof WorkerDied && e.beforeDocument) return read(bytes, deadline, null);
    throw e;
  }
}

async function read(bytes: Uint8Array, deadline: number, workerSource: string | null): Promise<ReadPdf> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const parser = workerSource === null ? null : startParser(workerSource);
  const budget = Math.max(1, deadline - Date.now());
  let timer: ReturnType<typeof setTimeout> | undefined;
  const tooSlow = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new UnreadablePdfError(`Orca gave up reading this PDF after ${Math.round(budget / 1000)} seconds.`)), budget);
  });
  tooSlow.catch(() => undefined);
  // Every step races the budget and, with a worker, the worker's death.
  const inTime = <T>(p: Promise<T>): Promise<T> => {
    if (Date.now() > deadline) return tooSlow;
    return parser ? Promise.race([p, tooSlow, parser.down]) : Promise.race([p, tooSlow]);
  };
  // pdf.js takes ownership of the buffer it's given, so it gets a copy.
  // Errors only: missing standard font data (metrics) is a warning that changes nothing for text.
  const task = pdfjs.getDocument({
    data: bytes.slice(),
    disableFontFace: true,
    useSystemFonts: false,
    verbosity: pdfjs.VerbosityLevel.ERRORS,
    // pdf.js's types say a port is browser-only (null in Node); a Node MessagePort speaks the same protocol.
    ...(parser ? { worker: new pdfjs.PDFWorker({ port: parser.port } as unknown as ConstructorParameters<typeof pdfjs.PDFWorker>[0]) } : {}),
  });
  let documentLoaded = false;
  try {
    let doc: Awaited<typeof task.promise>;
    try {
      doc = await inTime(task.promise);
    } catch (e) {
      if (e instanceof UnreadablePdfError) throw e;
      if (e instanceof WorkerDied) {
        e.beforeDocument = true;
        throw e;
      }
      const name = e instanceof Error ? e.name : "";
      if (name === "PasswordException") throw new UnreadablePdfError("This PDF is password-protected; upload a copy without a password.");
      throw new UnreadablePdfError(`Orca couldn't read this PDF (${e instanceof Error ? e.message : String(e)}).`);
    }
    documentLoaded = true;
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
    return { pages, hidden, removed, truncated, engine: parser ? "worker" : "main-thread" };
  } catch (e) {
    if (e instanceof WorkerDied && documentLoaded) throw new UnreadablePdfError(`Orca couldn't read this PDF (${e.message}).`);
    throw e;
  } finally {
    clearTimeout(timer);
    // Stop the parser first: a destroy() message to a thread that's stuck would never be answered.
    if (parser) await parser.stop();
    await Promise.race([task.destroy(), new Promise((r) => setTimeout(r, 1000))]).catch(() => undefined);
  }
}
