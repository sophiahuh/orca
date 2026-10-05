import test from "node:test";
import assert from "node:assert/strict";
import { objectiveIdOf, objectivesForTopic, unsortedObjectiveId } from "../../src/lib/mastery/catalogue.ts";

const catalogue = {
  "t/a": { id: "t/a", topicId: "t", name: "Do A" },
  "t/b": { id: "t/b", topicId: "t", name: "Do B" },
  "other/c": { id: "other/c", topicId: "other", name: "Do C" },
};

test("groups questions by objective in first-seen order and notes mechanism questions", () => {
  const list = objectivesForTopic(
    "t",
    [
      { id: "q1", objectiveId: "t/b", tier: "retrieval" },
      { id: "q2", objectiveId: "t/a", tier: "mechanism" },
      { id: "q3", objectiveId: "t/b" },
    ],
    catalogue,
  );
  assert.deepEqual(list.map((o) => o.id), ["t/b", "t/a"]);
  assert.deepEqual(list[0].questionIds, ["q1", "q3"]);
  assert.equal(list[0].hasMechanismQuestions, false);
  assert.equal(list[1].hasMechanismQuestions, true);
  assert.equal(list[1].name, "Do A");
});

test("a question without an objective lands in the topic's explicit unsorted objective", () => {
  const [o] = objectivesForTopic("t", [{ id: "q1" }], catalogue);
  assert.equal(o.id, unsortedObjectiveId("t"));
  assert.equal(o.id, "t#unsorted");
  assert.equal(o.name, "Questions not yet sorted into objectives");
  assert.equal(objectiveIdOf({}, "t"), "t#unsorted");
});

test("an objective missing from the catalogue throws instead of guessing", () => {
  assert.throws(() => objectivesForTopic("t", [{ id: "q1", objectiveId: "t/zzz" }], catalogue), /not in the catalogue/);
});

test("an objective from another topic throws", () => {
  assert.throws(() => objectivesForTopic("t", [{ id: "q1", objectiveId: "other/c" }], catalogue), /belongs to "other"/);
});

test("a topic with no questions has no objectives", () => {
  assert.deepEqual(objectivesForTopic("t", [], catalogue), []);
});
