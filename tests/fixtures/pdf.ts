/**
 * Tiny hand-built PDFs for tests: each page is a list of text runs placed at (x, y) in points
 * with a font size, on a 612×792 page, in Helvetica, plus, when a test needs a "figure", a number
 * of drawn line paths or one grey image. Enough for pdf.js to read text, sizes, positions and
 * drawings; nothing else.
 */
export interface Run {
  text: string;
  x: number;
  y: number;
  size: number;
  /** Continues from where the previous run ended (no gap), with its baseline moved by `dy` from the previous run's: a sub- or superscript. */
  cont?: { dy: number };
}

/** A page: its text runs, and what it draws besides (a figure: `paths` short lines, or one `image` of that many pixels a side). */
export interface Page {
  runs: Run[];
  paths?: number;
  image?: number;
}

const escape = (s: string) => s.replace(/[\\()]/g, (c) => `\\${c}`);

export function makePdf(pages: ReadonlyArray<Run[] | Page>): Uint8Array {
  const specs: Page[] = pages.map((p) => (Array.isArray(p) ? { runs: p } : p));
  const objects: string[] = [];
  const add = (body: string) => objects.push(body) - 1 + 1;
  add("<< /Type /Catalog /Pages 2 0 R >>");
  const kids = specs.map((_, i) => `${4 + i * 2} 0 R`).join(" ");
  add(`<< /Type /Pages /Kids [${kids}] /Count ${specs.length} >>`);
  add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  // Image XObjects come after the pages (one per page that has one); their object numbers are known up front.
  const firstImage = 4 + specs.length * 2;
  let images = 0;
  specs.forEach((page, i) => {
    const parts: string[] = [];
    page.runs.forEach((r, k) => {
      const next = page.runs[k + 1];
      const open = r.cont ? `/F1 ${r.size} Tf 0 ${r.cont.dy} Td (${escape(r.text)}) Tj` : `BT /F1 ${r.size} Tf ${r.x} ${r.y} Td (${escape(r.text)}) Tj`;
      parts.push(next?.cont ? open : `${open} ET`);
    });
    // Each stroked line is one path operation to pdf.js (what a drawn circuit or plot is made of).
    for (let k = 0; k < (page.paths ?? 0); k++) parts.push(`${80 + (k % 10) * 40} ${300 - Math.floor(k / 10) * 20} m ${100 + (k % 10) * 40} ${310 - Math.floor(k / 10) * 20} l S`);
    let resources = "/Font << /F1 3 0 R >>";
    if (page.image) {
      const n = firstImage + images++;
      resources += ` /XObject << /Im1 ${n} 0 R >>`;
      parts.push(`q 240 0 0 240 180 380 cm /Im1 Do Q`);
    }
    const stream = parts.join("\n");
    add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << ${resources} >> /Contents ${5 + i * 2} 0 R >>`);
    add(`<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`);
  });
  for (const page of specs) {
    if (!page.image) continue;
    // A grey gradient, raw 8-bit samples (no filter), so it decodes anywhere.
    const px = page.image;
    const bytes = Buffer.alloc(px * px);
    for (let y = 0; y < px; y++) for (let x = 0; x < px; x++) bytes[y * px + x] = (x * 255) / px;
    add(`<< /Type /XObject /Subtype /Image /Width ${px} /Height ${px} /ColorSpace /DeviceGray /BitsPerComponent 8 /Length ${bytes.length} >>\nstream\n${bytes.toString("latin1")}\nendstream`);
  }
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

/** The stand-in lecture deck's filename, as the tests upload it. */
export const DECK_NAME = "Logic_L02.pdf";

/**
 * A 24-slide stand-in for a real lecture deck (the real decks aren't in the repo), with the
 * shapes the reader has to handle: a text-only title (1); picture slides with only a slide number
 * (3, 4: read from their images); typed slides that draw a figure, as 25+ paths (5, 9, 12, 13, 14,
 * 18) or a big image (6, 10); a subscripted x₁ x₂ (15) and exponents 2¹⁶, 2⁴ (17), set the way
 * slides set them (smaller glyphs, shifted); and plain text everywhere else.
 */
export function makeDeck(): Uint8Array {
  const title = (text: string): Run => ({ text, x: 72, y: 720, size: 28 });
  const body = (...texts: string[]): Run[] => texts.map((text, i) => ({ text, x: 72, y: 660 - i * 24, size: 14 }));
  const slide = (n: number, heading: string, ...texts: string[]): Page => ({ runs: [title(heading), ...body(...texts), { text: String(n), x: 560, y: 30, size: 10 }] });
  // A script glyph follows the run before it with no gap, 9 pt against 14, shifted 4 down or up; the run after it comes back to the baseline.
  const flow = (y: number, ...segs: Array<string | ["_" | "^", string]>): Run[] => {
    let dy = 0;
    return segs.map((s, i) => {
      const script = Array.isArray(s);
      const want = script ? (s[0] === "_" ? -4 : 4) : 0;
      const run: Run = { text: script ? s[1] : s, x: 72, y, size: script ? 9 : 14, ...(i > 0 ? { cont: { dy: want - dy } } : {}) };
      dy = want;
      return run;
    });
  };
  const pages: Page[] = [
    { runs: [title("Combinational Logic"), ...body("Lecture 2", "Boolean algebra, gates and simplification.")] },
    slide(2, "Boolean algebra", "Theorems: identity, null, idempotent, complement.", "Absorption: x + xy = x."),
    { runs: [{ text: "3", x: 560, y: 30, size: 10 }] },
    { runs: [{ text: "4", x: 560, y: 30, size: 10 }] },
    { ...slide(5, "A two-level circuit", "The sum of products below computes the majority of three inputs, with one AND gate per minterm and a single OR gate.", "Gates are drawn with their inputs on the left."), paths: 58 },
    { ...slide(6, "Karnaugh map", "Adjacent cells differ in one variable."), image: 120 },
    slide(7, "Minterms", "A minterm is a product of every variable, each plain or complemented."),
    slide(8, "Maxterms", "A maxterm is a sum of every variable."),
    { ...slide(9, "Grouping ones", "Groups are powers of two: 1, 2, 4, 8."), paths: 30 },
    { ...slide(10, "Don't-cares", "A don't-care may join a group when it enlarges it."), image: 160 },
    slide(11, "Prime implicants", "A prime implicant can't be enlarged."),
    { ...slide(12, "Absorption on the map", "x + xy = x", "The two cells of xy sit inside the four of x."), paths: 40 },
    { ...slide(13, "NAND-only circuits", "Any function needs only NAND gates."), paths: 26 },
    { ...slide(14, "NOR-only circuits", "And only NOR gates."), paths: 27 },
    { runs: [title("Two-variable functions"), ...flow(660, "The function f(x", ["_", "1"], ", x", ["_", "2"], ") has sixteen forms, for example x", ["_", "1"], " x", ["_", "2"], "."), ...body("", "Each row of its truth table is one minterm."), { text: "15", x: 560, y: 30, size: 10 }] },
    slide(16, "Timing", "Propagation delay adds along the longest path."),
    { runs: [title("Fractions of a unit"), ...flow(660, "A 16-bit fixed-point step is (1/2", ["^", "16"], ") and a nibble's is (1/2", ["^", "4"], ")."), { text: "17", x: 560, y: 30, size: 10 }] },
    { ...slide(18, "A full adder", "Sum and carry from two half adders."), paths: 44 },
    slide(19, "Summary", "Simplify, then build."),
    slide(20, "Reading", "Chapter 2."),
    slide(21, "Exercises", "Simplify the given expressions."),
    slide(22, "Next lecture", "Arithmetic circuits."),
    slide(23, "Appendix: notation", "A bar over a variable is its complement."),
    slide(24, "Appendix: gate symbols", "Distinctive shapes for AND, OR, NOT, XOR."),
  ];
  return makePdf(pages);
}
