import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { likelyHeadings, pageText } from "../../src/lib/material/page-text.ts";
import { readPdf } from "../../src/lib/material/read-pdf.ts";

/** A pdf.js-like text item: size and baseline from the transform. */
const run = (str: string, size: number, y: number, hasEOL = false) => ({ str, hasEOL, transform: [size, 0, 0, size, 100, y], width: str.length * size * 0.5, height: size });

test("raised and lowered smaller runs on a line become ^{…} and _{…}, with spacing kept sensible", () => {
  // L03, slide 17: "Precision: 0.0000152… (1/2" then "16" drawn at 19 pt, 8 pt above the 28 pt baseline, then ")".
  assert.equal(pageText([run("Precision: 0.0000152… (1/2", 28, 147.4), run("16", 19, 155.5), run(")", 28, 147.4, true)]), "Precision: 0.0000152… (1/2^{16})");
  // L02, slide 15: x₁ x₂ … xₙ from an equation editor: "x" at 15 pt, then "1" at 14 pt, 6 pt below.
  const eq = [run("x", 15, 180.2), run("1", 14, 174.2), run(" ", 14, 174.2), run("x", 15, 180.2), run("2", 14, 174.2), run("…", 16, 178.6), run("x", 15, 180.2), run("n", 14, 174.2), run("+", 15, 180.2, true)];
  assert.equal(pageText(eq), "x_{1} x_{2} … x_{n} +");
  // A script at the end of a line, a mixed super then sub, and a comma after a script.
  assert.equal(pageText([run("a", 12, 100), run("2", 8, 104, true), run("b", 12, 80), run("i", 8, 77), run(",", 12, 80), run("c", 12, 80, true)]), "a^{2}\nb_{i}, c");
});

test("same-size text on one line, a bigger run, and the next line are never scripts", () => {
  assert.equal(pageText([run("Boolean", 14, 700), run("algebra", 14, 700, true), run("next", 14, 676, true)]), "Boolean algebra\nnext");
  // A heading word in a larger font sits above the baseline of small text but isn't a superscript.
  assert.equal(pageText([run("small", 10, 500), run("BIG", 24, 505, true)]), "small BIG");
  // Items without a transform (older readers, tests) read as before.
  assert.equal(pageText([{ str: "Hello", hasEOL: true }, { str: "world " }, { str: "again" }]), "Hello\nworld again");
});

test("larger text supplies conservative heading hints", () => {
  assert.deepEqual(likelyHeadings([run("MIPS instruction formats", 28, 700, true), run("The instruction fields", 12, 660, true), run("are decoded by the control unit.", 12, 640, true)]), ["MIPS instruction formats"]);
  assert.deepEqual(likelyHeadings([run("Body text", 12, 700, true), run("More body text", 12, 680, true)]), []);
});

test("the ALD decks read their exponents and indices unambiguously", async () => {
  const l03 = await readPdf(new Uint8Array(await readFile("docs/samples/ald/L03_Arithmetic.pdf")));
  assert.match(l03.pages[16].text, /\(1\/2\^\{16\}\)/);
  assert.match(l03.pages[16].text, /\(1\/2\^\{4\}\)/);
  const l02 = await readPdf(new Uint8Array(await readFile("docs/samples/ald/L02_Combinational.pdf")));
  assert.match(l02.pages[14].text, /x_\{1\} x_\{2\}/);
  assert.doesNotMatch(l02.pages[14].text, /\bx 1 x 2\b/);
});
