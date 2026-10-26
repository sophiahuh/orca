import test from "node:test";
import assert from "node:assert/strict";
import type { Objective, ObjectiveSignal, Relation, Topic } from "../../src/lib/data.ts";
import { WEIGHT_RULES, courseObjectiveWeights, objectiveWeight, topicUses, topicWeight } from "../../src/lib/course/weights.ts";

const lecture = (places: number, extra: Partial<ObjectiveSignal> = {}): ObjectiveSignal => ({
  materialId: "m",
  materialType: "Lecture",
  places: Array.from({ length: places }, (_, i) => ({ locator: `slide ${i + 1}`, excerpt: "…" })),
  ...extra,
});
const objective = (id: string, signals: ObjectiveSignal[], extra: Partial<Objective> = {}): Objective => ({
  id,
  topicId: "t",
  name: id,
  description: "",
 
  origin: "material",
  review: "confirmed",
  materialId: "m",
  runId: "r",
  signals,
  ...extra,
});
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≈ ${b}`);

test("every covering place counts the same, whatever its material type", () => {
  const lectureOnly = objective("o", [lecture(2)]);
  const examOnly = objective("o", [{ ...lecture(2), materialType: "Past exam" }]);
  close(objectiveWeight(lectureOnly, 0), objectiveWeight(examOnly, 0));
});

test("coverage has diminishing returns between 0.75 and 1.5", () => {
  const sig = (n: number): ObjectiveSignal => ({ materialId: "m", materialType: "Other", places: Array.from({ length: n }, () => ({ locator: "", excerpt: "" })) });
  close(objectiveWeight(objective("o", [sig(0)]), 0), 0.75);
  close(objectiveWeight(objective("o", [sig(1)]), 0), 0.75 + 0.75 * (1 - Math.exp(-1 / 1.5)));
  const many = objectiveWeight(objective("o", [sig(40)]), 0);
  assert.ok(many > 1.49 && many <= 1.5);
});

test("objectives that others build on weigh more, up to the cap", () => {
  const o = objective("o", [lecture(5)]);
  const base = objectiveWeight(o, 0);
  close(objectiveWeight(o, 2), Math.min(2, base * 1.2));
  close(objectiveWeight(o, 9), Math.min(2, base * (1 + WEIGHT_RULES.buildsOnStep * WEIGHT_RULES.buildsOnCap)));
});

test("explicit emphasis: tested ×1.5, skipped is 0, the latest statement wins, clamped to 0.5–2", () => {
  const tested = objective("o", [lecture(1, { emphasis: { kind: "tested", quote: "on the exam" } })]);
  close(objectiveWeight(tested, 0), objectiveWeight(objective("o", [lecture(1)]), 0) * 1.5);
  const skippedThenTested = objective("o", [lecture(1, { emphasis: { kind: "skipped", quote: "not examinable" } }), lecture(1, { emphasis: { kind: "tested", quote: "on the final" } })]);
  assert.ok(objectiveWeight(skippedThenTested, 0) > 1);
  assert.equal(objectiveWeight(objective("o", [lecture(9, { emphasis: { kind: "skipped", quote: "you won't be tested" } })]), 5), 0);
  assert.equal(objectiveWeight(objective("o", [lecture(40, { emphasis: { kind: "tested", quote: "" } })]), 5), 2);
});

test("inferred objectives sit at 1.0 unless emphasised", () => {
  close(objectiveWeight(objective("o", [], { origin: "inferred" }), 0), 1);
});

test("an objective counts the topics its topic is used in, through merges, leaving out archived topics and other link kinds", () => {
  const topic = (id: string, extra: Partial<Topic> = {}): Topic => ({ id, name: id, review: "confirmed", pos: { x: 0, y: 0 }, ...extra });
  const topics = [topic("t"), topic("u"), topic("v"), topic("old", { review: "archived", mergedInto: "v" }), topic("gone", { review: "archived" })];
  const rel = (from: string, to: string, type: Relation["type"] = "used-in"): Relation => ({ id: `${from}-${to}-${type}`, from, to, type, anchor: null, review: "confirmed", materialId: "m", reason: null });
  const relations = [rel("t", "u"), rel("t", "old"), rel("t", "v"), rel("t", "gone"), rel("t", "u", "related"), rel("u", "t", "has-a-kind")];
  // t is used in u and v (old was merged into v, so it's the same topic; gone was rejected).
  assert.deepEqual([...topicUses(topics, relations).get("t")!].sort(), ["u", "v"]);
  assert.equal(topicUses(topics, relations).get("u")!.size, 0);
  const objectives = {
    a: objective("a", [lecture(2)]),
    c: objective("c", [lecture(2)]),
    x: objective("x", [lecture(2)], { review: "archived" }),
  };
  const weights = courseObjectiveWeights(objectives, topics, relations);
  assert.deepEqual([...weights.keys()].sort(), ["a", "c"]);
  close(weights.get("a")!, objectiveWeight(objectives.a, 2));
  close(topicWeight("t", objectives, weights)!, (weights.get("a")! + weights.get("c")!) / 2);
  assert.equal(topicWeight("empty", objectives, weights), null);
});
