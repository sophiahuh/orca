import test from "node:test";
import assert from "node:assert/strict";
import { ALD_QUESTION_BANK, ALD_TOPICS } from "../../src/lib/content/ald.ts";
import { ALD_OBJECTIVES, ALD_QUESTION_OBJECTIVE } from "../../src/lib/content/ald-objectives.ts";

const allQuestions = Object.values(ALD_QUESTION_BANK).flat();

test("every built-in ALD question has an objective from the catalogue", () => {
  assert.equal(allQuestions.length, 69);
  for (const q of allQuestions) {
    assert.ok(q.objectiveId, `${q.id} has no objectiveId`);
    assert.ok(ALD_OBJECTIVES[q.objectiveId], `${q.id} points at unknown objective ${q.objectiveId}`);
  }
});

test("each question's objective belongs to the question's own topic", () => {
  for (const topic of ALD_TOPICS) {
    for (const q of ALD_QUESTION_BANK[topic.id]) {
      assert.equal(ALD_OBJECTIVES[q.objectiveId!].topicId, topic.id, q.id);
    }
  }
});

test("the mapping names only questions that exist, and every objective has a question", () => {
  const ids = new Set(allQuestions.map((q) => q.id));
  for (const qid of Object.keys(ALD_QUESTION_OBJECTIVE)) assert.ok(ids.has(qid), `mapping names missing question ${qid}`);
  const used = new Set(allQuestions.map((q) => q.objectiveId));
  for (const oid of Object.keys(ALD_OBJECTIVES)) assert.ok(used.has(oid), `objective ${oid} has no questions`);
});
