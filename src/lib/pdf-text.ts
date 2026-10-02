"use client";

import type { DocumentText } from "./extraction";

/**
 * Read a PDF's text in the browser so the file itself never leaves the device.
 * pdf.js is loaded lazily; the worker ships as a static asset via import.meta.url.
 */
export async function extractPdfText(file: File, onProgress?: (done: number, total: number) => void): Promise<DocumentText> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

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

export function isPdf(file: File) {
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name);
}
