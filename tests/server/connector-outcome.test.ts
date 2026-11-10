import test from "node:test";
import assert from "node:assert/strict";
import type { QuizQuestion } from "../../src/lib/data.ts";

/**
 * record_answer checks what Claude graded against the stored key when Orca can (cram mode contracts,
 * section 4): the pure comparison behind `corrected`. Loads the server connector module through
 * tests/support/hooks.mjs; nothing here touches a database.
 */
const base = { id: "a0000000-0000-4000-8000-000000000001", tier: "retrieval" as const, topic: "Two's Complement", explanation: "Fixture.", objectiveId: "f0000000-0000-4000-8000-000000000001" };
const choice: QuizQuestion = { ...base, kind: "Multiple choice", prompt: "Which 4-bit pattern is −5?", options: ["0101", "1011", "0110", "1111"], answer: 1 };
const exact: QuizQuestion = { ...base, kind: "Short answer", prompt: "Simplify x + xy.", options: [], answer: -1, exact: ["x"] };
const prose: QuizQuestion = { ...base, kind: "Short answer", prompt: "Why?", options: [], answer: -1, rubric: { requiredIdeas: ["The top bit is the sign"], acceptableAlternatives: [], knownMisconceptions: [] } };

test("Orca's own result for a choice or exact answer; null for prose or words no option fits", async () => {
  const { orcaOutcome } = await import("../../src/lib/server/connector.ts");
  assert.equal(orcaOutcome(choice, "2"), "correct", "the option's number as shown");
  assert.equal(orcaOutcome(choice, "B"), "correct");
  assert.equal(orcaOutcome(choice, "1011"), "correct");
  assert.equal(orcaOutcome(choice, "3"), "incorrect");
  assert.equal(orcaOutcome(choice, "one of the odd ones"), null, "no option fits: the stated outcome stands");
  assert.equal(orcaOutcome(exact, "it's x"), "correct");
  assert.equal(orcaOutcome(exact, "x or y"), "partial", "a hedge, as check_answer grades it");
  assert.equal(orcaOutcome(exact, "y"), "incorrect");
  assert.equal(orcaOutcome(prose, "because the top bit is the sign"), null, "prose has no key Orca checks itself");
});
