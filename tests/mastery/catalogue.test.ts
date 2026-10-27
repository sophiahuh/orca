import test from "node:test";
import assert from "node:assert/strict";
import { currentTopicOf, fileQuestions, liveObjectiveOf, objectivesForTopic, resolveObjectiveId, withCurrentTopics } from "../../src/lib/mastery/catalogue.ts";

const catalogue = {
  "t/a": { id: "t/a", topicId: "t", name: "Do A", review: "confirmed" as const },
  "t/b": { id: "t/b", topicId: "t", name: "Do B", review: "confirmed" as const },
  "other/c": { id: "other/c", topicId: "other", name: "Do C", review: "confirmed" as const },
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

test("an objective missing from the catalogue throws instead of guessing", () => {
  assert.throws(() => objectivesForTopic("t", [{ id: "q1", objectiveId: "t/zzz" }], catalogue), /not in the catalogue/);
});

test("an objective from another topic throws", () => {
  assert.throws(() => objectivesForTopic("t", [{ id: "q1", objectiveId: "other/c" }], catalogue), /belongs to "other"/);
});

test("a topic with no questions has no objectives", () => {
  assert.deepEqual(objectivesForTopic("t", [], catalogue), []);
});

test("a merged objective's questions count for the objective it was merged into", () => {
  const merged = { ...catalogue, "t/a": { ...catalogue["t/a"], review: "archived" as const, mergedInto: "t/b" } };
  const list = objectivesForTopic("t", [{ id: "q1", objectiveId: "t/a" }, { id: "q2", objectiveId: "t/b" }], merged);
  assert.deepEqual(list.map((o) => [o.id, o.questionIds]), [["t/b", ["q1", "q2"]]]);
});

test("questions of an archived objective are left out", () => {
  const archived = { ...catalogue, "t/a": { ...catalogue["t/a"], review: "archived" as const } };
  const list = objectivesForTopic("t", [{ id: "q1", objectiveId: "t/a" }, { id: "q2", objectiveId: "t/b" }], archived);
  assert.deepEqual(list.map((o) => o.id), ["t/b"]);
  assert.equal(liveObjectiveOf({ objectiveId: "t/a" }, archived), null);
  assert.equal(liveObjectiveOf({ objectiveId: "t/b" }, archived)?.id, "t/b");
});

test("merge chains resolve to the end and cycles throw", () => {
  const chain = {
    x: { id: "x", topicId: "t", name: "X", review: "archived" as const, mergedInto: "y" },
    y: { id: "y", topicId: "t", name: "Y", review: "archived" as const, mergedInto: "z" },
    z: { id: "z", topicId: "t", name: "Z", review: "confirmed" as const },
  };
  assert.equal(resolveObjectiveId("x", chain), "z");
  assert.throws(() => resolveObjectiveId("x", { ...chain, z: { ...chain.z, mergedInto: "x" } }), /cycle/);
});

const filing = {
  X: { topicId: "T1", mergedInto: "Y" },
  Y: { topicId: "T2" },
  Z: { topicId: "T3" },
};
const topicMerges = new Map([["T3", "T2"]]);

test("a question is filed under its objective's current topic, following objective and topic merges", () => {
  assert.equal(currentTopicOf("X", filing, topicMerges), "T2", "X was merged into Y, which lives in T2");
  assert.equal(currentTopicOf("Z", filing, topicMerges), "T2", "Z's topic T3 was merged into T2");
  const bank = fileQuestions(
    [
      { id: "dive-q", objectiveId: "X" }, // saved by a dive after X was merged into Y
      { id: "q2", objectiveId: "Y" },
      { id: "q3", objectiveId: "Z" },
    ],
    filing,
    topicMerges,
  );
  assert.deepEqual(Object.keys(bank), ["T2"]);
  assert.deepEqual(bank.T2.map((q) => q.id), ["dive-q", "q2", "q3"], "order is kept");
});

test("a question naming an objective the course doesn't have throws instead of being filed somewhere", () => {
  assert.throws(() => fileQuestions([{ id: "q", objectiveId: "nope" }], filing, topicMerges), /Question q points at objective "nope", which isn't in the course/);
});

test("objectives follow topic merges; nothing moves when no topic was merged", () => {
  const objectives = { Z: { id: "Z", topicId: "T3" }, Y: { id: "Y", topicId: "T2" } };
  assert.deepEqual(withCurrentTopics(objectives, topicMerges), { Z: { id: "Z", topicId: "T2" }, Y: objectives.Y });
  assert.equal(withCurrentTopics(objectives, new Map()), objectives);
});

test("a topic merge cycle throws instead of looping", () => {
  assert.throws(() => currentTopicOf("Y", filing, new Map([["T2", "T4"], ["T4", "T2"]])), /Topic merge cycle/);
});
