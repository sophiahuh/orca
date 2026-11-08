import { test } from "node:test";
import assert from "node:assert/strict";
import { hasMath, mathProblem, renderMath, splitMath } from "../src/lib/math-text.ts";
import { validateText } from "../src/lib/untrusted/validate.ts";

test("splitMath cuts inline and display math out of the text", () => {
  assert.deepEqual(splitMath("Solve \\(x^2 = 4\\) for x:\\[x = \\pm 2\\]done"), [
    { kind: "text", value: "Solve " },
    { kind: "math", value: "x^2 = 4", display: false },
    { kind: "text", value: " for x:" },
    { kind: "math", value: "x = \\pm 2", display: true },
    { kind: "text", value: "done" },
  ]);
});

test("plain text, dollar amounts and unclosed delimiters stay text", () => {
  assert.equal(hasMath("It costs $5 and $6."), false);
  assert.deepEqual(splitMath("open \\(x + 1 never closed"), [{ kind: "text", value: "open \\(x + 1 never closed" }]);
  assert.deepEqual(splitMath(""), []);
});

test("mathProblem passes good math and names the problem with bad math", () => {
  assert.equal(mathProblem("Runs in \\(O(n \\log n)\\) time; \\(\\overline{A}B\\)"), null);
  assert.equal(mathProblem("no math here"), null);
  assert.match(mathProblem("\\(\\frac{1}{\\)") ?? "", /doesn't render/);
  assert.match(mathProblem("open \\(x") ?? "", /isn't closed/);
  assert.match(mathProblem("empty \\( \\)") ?? "", /empty math/);
});

test("KaTeX runs untrusted: links and raw HTML commands don't render", () => {
  assert.match(mathProblem("\\(\\href{https://evil.example}{x}\\)") ?? "", /href, which isn.t allowed/);
  assert.match(mathProblem("\\(\\htmlClass{x}{y}\\)") ?? "", /isn.t allowed/);
  assert.doesNotMatch(renderMath("\\href{https://evil.example}{x}", false), /<a |href=/);
});

test("the output validator refuses math that doesn't render", () => {
  const bad = validateText("What is \\(\\frac{1}{\\)?", {});
  assert.equal(bad.ok, false);
  assert.ok(validateText("What is \\(\\frac{1}{2}\\)?", {}).ok);
});
