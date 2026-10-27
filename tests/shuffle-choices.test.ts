import test from "node:test";
import assert from "node:assert/strict";
import type { QuizQuestion } from "../src/lib/data.ts";
import { shuffleChoices } from "../src/lib/shuffle-choices.ts";

const mc = (answer: number): QuizQuestion => ({ id: "q", kind: "Multiple choice", tier: "retrieval", topic: "t", prompt: "p", options: ["right", "w1", "w2", "w3"].map((o, i) => (i === answer ? "right" : o === "right" ? "w0" : o)), answer, explanation: "", objectiveId: "o" });

test("the options are reordered and the answer follows its option", () => {
  let seed = 0.37;
  const random = () => (seed = (seed * 9301 + 0.4927) % 1);
  for (let i = 0; i < 50; i++) {
    const q = shuffleChoices(mc(0), random);
    assert.equal(q.options[q.answer], "right");
    assert.deepEqual([...q.options].sort(), ["right", "w0", "w1", "w2", "w3"].filter((o) => mc(0).options.includes(o)).sort());
  }
});

test("over many askings the right answer lands in every position", () => {
  const seen = new Set<number>();
  for (let i = 0; i < 200; i++) seen.add(shuffleChoices(mc(0)).answer);
  assert.deepEqual([...seen].sort(), [0, 1, 2, 3]);
});

test("true/false and short answers are left as they are", () => {
  const tf: QuizQuestion = { ...mc(0), kind: "True or false", options: ["True", "False"], answer: 1 };
  assert.equal(shuffleChoices(tf), tf);
  const short: QuizQuestion = { ...mc(0), kind: "Short answer", options: [], answer: -1 };
  assert.equal(shuffleChoices(short), short);
});

test("an option like \"none of the above\" keeps the order it was written in", () => {
  const q: QuizQuestion = { ...mc(0), options: ["right", "w1", "w2", "None of the above"] };
  assert.equal(shuffleChoices(q), q);
});
