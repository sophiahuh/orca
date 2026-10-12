/**
 * Tiny hand-built PDFs for tests: each page is a list of text runs placed at (x, y) in points
 * with a font size, on a 612×792 page, in Helvetica. Enough for pdf.js to read text, sizes and
 * positions; nothing else.
 */
export interface Run {
  text: string;
  x: number;
  y: number;
  size: number;
}

const escape = (s: string) => s.replace(/[\\()]/g, (c) => `\\${c}`);

export function makePdf(pages: Run[][]): Uint8Array {
  const objects: string[] = [];
  const add = (body: string) => objects.push(body) ;
  add("<< /Type /Catalog /Pages 2 0 R >>");
  const kids = pages.map((_, i) => `${4 + i * 2} 0 R`).join(" ");
  add(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  pages.forEach((runs, i) => {
    const stream = runs.map((r) => `BT /F1 ${r.size} Tf ${r.x} ${r.y} Td (${escape(r.text)}) Tj ET`).join("\n");
    add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`);
    add(`<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`);
  });
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, "latin1"));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(out, "latin1"));
}

/** A page of plain lines, top to bottom. */
export const lines = (...texts: string[]): Run[] => texts.map((text, i) => ({ text, x: 72, y: 700 - i * 24, size: 14 }));
