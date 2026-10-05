import test from "node:test";
import assert from "node:assert/strict";
import { promptKey, questionsByTopic, type Extraction } from "../src/lib/extraction.ts";

const extraction: Extraction = {
  topics: [{ name: "Boolean Algebra", summary: "Theorems.", slideStart: 1, slideEnd: 4, keyTerms: [] }],
  questions: [
    {
      topic: "Boolean Algebra",
      kind: "Short answer",
      tier: "retrieval",
      prompt: "Simplify x + xy.",
      options: [],
      answer: -1,
      exact: ["x"],
      explanation: "Absorption.",
      anchor: { locator: "slide 2", excerpt: "x + xy = x" },
    },
    {
      topic: "Boolean Algebra",
      kind: "Multiple choice",
      tier: "retrieval",
      prompt: "Which law gives x + xy = x?",
      options: ["Absorption", "Distribution", "DeMorgan", "Involution"],
      answer: 0,
      explanation: "Absorption.",
      anchor: { locator: "slide 2", excerpt: "x + xy = x" },
    },
  ],
};

test("question ids are random UUIDs, so re-uploading the same file never reuses one", () => {
  const first = questionsByTopic(extraction, () => "boolean-algebra", "material-1", "L02.pdf")["boolean-algebra"];
  const again = questionsByTopic(extraction, () => "boolean-algebra", "material-2", "L02.pdf")["boolean-algebra"];
  const ids = [...first, ...again].map((q) => q.id);
  for (const id of ids) assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(new Set(ids).size, 4);
});

test("each question records the upload it came from", () => {
  const qs = questionsByTopic(extraction, () => "boolean-algebra", "material-1", "L02.pdf")["boolean-algebra"];
  assert.deepEqual(qs.map((q) => q.materialId), ["material-1", "material-1"]);
});

test("promptKey ignores case, spacing and a trailing full stop", () => {
  assert.equal(promptKey("Simplify  x + xy."), promptKey("simplify x+xy"));
  assert.equal(promptKey("What is 0101 − 0010?"), promptKey("what is 0101−0010"));
});

test("promptKey keeps symbols that change the question", () => {
  assert.notEqual(promptKey("Simplify a + ac"), promptKey("Simplify a + a'c"));
  assert.notEqual(promptKey("Write -6 in 4 bits"), promptKey("Write 6 in 4 bits"));
});
