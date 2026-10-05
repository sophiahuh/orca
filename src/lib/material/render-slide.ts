/**
 * Render one slide of a PDF as a JPEG data URL, on the server, for a question that needs its
 * figure (pdf.js in Node draws on its own canvas, `@napi-rs/canvas`). Sentence-length text is painted
 * over so the figure doesn't hand the student the answer in its bullets; short labels (x1, cout)
 * stay so diagrams still read. Loads under plain Node.
 */
import { LIMITS } from "../limits.ts";

/** Text items at least this long are prose, painted over. */
const PROSE_MIN_CHARS = 18;

export async function renderSlide(bytes: Uint8Array, pageNumber: number, { maxWidth = 960, quality = 80 }: { maxWidth?: number; quality?: number } = {}): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({ data: bytes.slice(), verbosity: pdfjs.VerbosityLevel.ERRORS });
  try {
    const doc = await task.promise;
    if (doc.numPages > LIMITS.pagesPerFile || pageNumber < 1 || pageNumber > doc.numPages) throw new Error(`no slide ${pageNumber}`);
    const page = await doc.getPage(pageNumber);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: Math.min(2, maxWidth / base.width) });
    const { canvas, context } = (doc.canvasFactory as { create: (w: number, h: number) => unknown }).create(Math.ceil(viewport.width), Math.ceil(viewport.height)) as {
      canvas: { encode: (format: "jpeg", quality: number) => Promise<Uint8Array> };
      context: CanvasRenderingContext2D;
    };
    await page.render({ canvas: canvas as unknown as HTMLCanvasElement, canvasContext: context, viewport }).promise;
    const content = await page.getTextContent();
    context.fillStyle = "#ffffff";
    for (const item of content.items) {
      if (!("str" in item) || item.str.trim().length < PROSE_MIN_CHARS) continue;
      const [, , , , x, y] = item.transform as number[];
      const [ax, ay] = viewport.convertToViewportPoint(x, y);
      const [bx, by] = viewport.convertToViewportPoint(x + item.width, y + item.height);
      const h = Math.abs(by - ay);
      context.fillRect(Math.min(ax, bx) - 2, Math.min(ay, by) - h * 0.3, Math.abs(bx - ax) + 4, h * 1.6);
    }
    const jpeg = await canvas.encode("jpeg", quality);
    return `data:image/jpeg;base64,${Buffer.from(jpeg).toString("base64")}`;
  } finally {
    await task.destroy();
  }
}
