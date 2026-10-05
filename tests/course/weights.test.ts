import test from "node:test";
import assert from "node:assert/strict";
import type { Objective, ObjectiveSignal, Relation } from "../../src/lib/data.ts";
import { DEFAULT_WEIGHTS } from "../../src/lib/data.ts";
import { WEIGHT_RULES, courseObjectiveWeights, objectiveWeight, placeValue, sliderFor, topicWeight } from "../../src/lib/course/weights.ts";

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
  aliases: [],
  origin: "material",
  review: "confirmed",
  materialId: "m",
  runId: "r",
  signals,
  ...extra,
});
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≈ ${b}`);

test("material types map onto the Settings sliders; Other is neutral", () => {
  assert.equal(sliderFor("Lecture"), "lectures");
  assert.equal(sliderFor("Syllabus"), "lectures");
  assert.equal(sliderFor("Past exam"), "practiceExams");
  assert.equal(sliderFor("Other"), null);
});

test("by default every material type is worth the same", () => {
  for (const type of ["Lecture", "Syllabus", "Homework", "Past exam", "Practice exam", "Practice problems", "Other"] as const) {
    close(placeValue(type, DEFAULT_WEIGHTS), 1);
  }
});

test("a place is worth its slider relative to the course's average slider", () => {
  const moved = { homework: 30, practiceExams: 35, practiceProblems: 25, lectures: 10 }; // average 25
  close(placeValue("Lecture", moved), 0.4);
  close(placeValue("Homework", moved), 1.2);
  close(placeValue("Practice exam", moved), 1.4);
  close(placeValue("Other", moved), 1);
});

test("coverage has diminishing returns between 0.75 and 1.5", () => {
  const w = { a: 1 }; // "Other"-free: one slider, so every typed place is worth 1
  const sig = (n: number): ObjectiveSignal => ({ materialId: "m", materialType: "Other", places: Array.from({ length: n }, () => ({ locator: "", excerpt: "" })) });
  close(objectiveWeight(objective("o", [sig(0)]), 0, w), 0.75);
  close(objectiveWeight(objective("o", [sig(1)]), 0, w), 0.75 + 0.75 * (1 - Math.exp(-1 / 1.5)));
  const many = objectiveWeight(objective("o", [sig(40)]), 0, w);
  assert.ok(many > 1.49 && many <= 1.5);
});

test("objectives that others build on weigh more, up to the cap", () => {
  const o = objective("o", [lecture(5)]);
  const base = objectiveWeight(o, 0, DEFAULT_WEIGHTS);
  close(objectiveWeight(o, 2, DEFAULT_WEIGHTS), Math.min(2, base * 1.2));
  close(objectiveWeight(o, 9, DEFAULT_WEIGHTS), Math.min(2, base * (1 + WEIGHT_RULES.buildsOnStep * WEIGHT_RULES.buildsOnCap)));
});

test("explicit emphasis: tested ×1.5, skipped is 0, the latest statement wins, clamped to 0.5–2", () => {
  const tested = objective("o", [lecture(1, { emphasis: { kind: "tested", quote: "on the exam" } })]);
  close(objectiveWeight(tested, 0, DEFAULT_WEIGHTS), objectiveWeight(objective("o", [lecture(1)]), 0, DEFAULT_WEIGHTS) * 1.5);
  const skippedThenTested = objective("o", [lecture(1, { emphasis: { kind: "skipped", quote: "not examinable" } }), lecture(1, { emphasis: { kind: "tested", quote: "on the final" } })]);
  assert.ok(objectiveWeight(skippedThenTested, 0, DEFAULT_WEIGHTS) > 1);
  assert.equal(objectiveWeight(objective("o", [lecture(9, { emphasis: { kind: "skipped", quote: "you won't be tested" } })]), 5, DEFAULT_WEIGHTS), 0);
  assert.equal(objectiveWeight(objective("o", [lecture(40, { emphasis: { kind: "tested", quote: "" } })]), 5, DEFAULT_WEIGHTS), 2);
});

test("inferred objectives sit at 1.0 unless emphasised", () => {
  close(objectiveWeight(objective("o", [], { origin: "inferred" }), 0, DEFAULT_WEIGHTS), 1);
});

test("course weights count builds-on through merges and ignore archived objectives", () => {
  const objectives = {
    a: objective("a", [lecture(2)]),
    b: objective("b", [lecture(2)], { review: "archived", mergedInto: "c" }),
    c: objective("c", [lecture(2)]),
    x: objective("x", [lecture(2)], { review: "archived" }),
  };
  const rel = (from: string, to: string): Relation => ({ id: `${from}-${to}`, from, to, type: "builds-on", anchor: null, review: "confirmed", materialId: "m" });
  const weights = courseObjectiveWeights(objectives, [rel("b", "a"), rel("c", "a"), rel("x", "a")], DEFAULT_WEIGHTS);
  assert.deepEqual([...weights.keys()].sort(), ["a", "c"]);
  close(weights.get("a")!, objectiveWeight(objectives.a, 1, DEFAULT_WEIGHTS)); // b and c are the same objective; x is rejected
  close(topicWeight("t", objectives, weights)!, (weights.get("a")! + weights.get("c")!) / 2);
  assert.equal(topicWeight("empty", objectives, weights), null);
});
