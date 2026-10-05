import test from "node:test";
import assert from "node:assert/strict";
import { promptKey } from "../../src/lib/pipeline/questions.ts";

test("promptKey ignores case, spacing and a trailing full stop", () => {
  assert.equal(promptKey("Simplify  x + xy."), promptKey("simplify x+xy"));
  assert.equal(promptKey("What is 0101 − 0010?"), promptKey("what is 0101−0010"));
});

test("promptKey keeps symbols that change the question", () => {
  assert.notEqual(promptKey("Simplify a + ac"), promptKey("Simplify a + a'c"));
  assert.notEqual(promptKey("Write -6 in 4 bits"), promptKey("Write 6 in 4 bits"));
});
