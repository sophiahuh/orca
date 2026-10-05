"use client";

/** A document's text, slide by slide, read on the device. */
export interface DocumentText {
  filename: string;
  type: string;
  pages: Array<{ n: number; text: string }>;
}

/**
 * Read a PDF's text in the browser so the file itself never leaves the device.
 * pdf.js is loaded lazily; the worker ships as a static asset via import.meta.url.
 */
export async function extractPdfText(file: File, onProgress?: (done: number, total: number) => void): Promise<DocumentText> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).toString();

  const data = await file.arrayBuffer();
  const task = pdfjs.getDocument({ data });
  const doc = await task.promise;
  const pages: DocumentText["pages"] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    const lines: string[] = [];
    let line = "";
    for (const item of content.items) {
      if (!("str" in item)) continue;
      line += item.str;
      if (item.hasEOL) {
        lines.push(line);
        line = "";
      } else if (item.str && !item.str.endsWith(" ")) {
        line += " ";
      }
    }
    if (line) lines.push(line);
    pages.push({ n, text: lines.join("\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim() });
    onProgress?.(n, doc.numPages);
  }
  await task.destroy();
  return { filename: file.name, type: "PDF", pages };
}

/** Render one slide to a JPEG data URL (for figures a question depends on). */
export async function renderPdfSlide(file: File, pageNumber: number, maxWidth = 960, quality = 0.8): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).toString();
  const task = pdfjs.getDocument({ data: await file.arrayBuffer() });
  try {
    const doc = await task.promise;
    const page = await doc.getPage(pageNumber);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: Math.min(2, maxWidth / base.width) });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas unavailable");
    await page.render({ canvas, canvasContext: ctx, viewport }).promise;
    await maskProse(page, ctx, viewport);
    return canvas.toDataURL("image/jpeg", quality);
  } finally {
    await task.destroy();
  }
}

/**
 * Paint over sentence-length text so a slide used as a figure doesn't hand the
 * student the answer in its bullets. Short labels (x1, Light, cout) are kept so
 * diagrams still read.
 */
const PROSE_MIN_CHARS = 18;

async function maskProse(
  page: Awaited<ReturnType<Awaited<ReturnType<typeof import("pdfjs-dist/legacy/build/pdf.mjs")["getDocument"]>["promise"]>["getPage"]>>,
  ctx: CanvasRenderingContext2D,
  viewport: { convertToViewportPoint: (x: number, y: number) => number[] },
) {
  const content = await page.getTextContent();
  ctx.fillStyle = "#ffffff";
  for (const item of content.items) {
    if (!("str" in item) || item.str.trim().length < PROSE_MIN_CHARS) continue;
    const [, , , , x, y] = item.transform;
    const [ax, ay] = viewport.convertToViewportPoint(x, y);
    const [bx, by] = viewport.convertToViewportPoint(x + item.width, y + item.height);
    const left = Math.min(ax, bx);
    const top = Math.min(ay, by);
    const w = Math.abs(bx - ax);
    const h = Math.abs(by - ay);
    ctx.fillRect(left - 2, top - h * 0.3, w + 4, h * 1.6);
  }
}

export function isPdf(file: File) {
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name);
}
