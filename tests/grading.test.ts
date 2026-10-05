import test from "node:test";
import assert from "node:assert/strict";
import { gradeExact, normaliseExact } from "../src/lib/grading.ts";

test("normaliseExact ignores case, spacing, middle dots and a trailing period", () => {
  assert.equal(normaliseExact(" X1 · X2' . "), "x1x2'");
});

test("gradeExact accepts an equivalent spelling and rejects a different answer", () => {
  assert.equal(gradeExact("1010", ["1010"]).outcome, "correct");
  const wrong = gradeExact("1011", ["1010"]);
  assert.equal(wrong.outcome, "incorrect");
  assert.match(wrong.feedback, /1010/);
});
