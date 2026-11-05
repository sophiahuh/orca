import test from "node:test";
import assert from "node:assert/strict";
import type { Objective, Topic } from "../../src/lib/data.ts";
import { objectivesOnPage } from "../../src/lib/course/slides.ts";

const sig = (materialId: string, locator: string) => ({ materialId, materialType: "Lecture" as const, places: [{ locator, excerpt: "" }] });
const obj = (id: string, topicId: string, signals: Objective["signals"] = [], extra: Partial<Objective> = {}): Objective => ({ id, topicId, name: id, description: "", origin: "material", review: "confirmed", materialId: "m", runId: null, signals, ...extra });
const topics: Topic[] = [
  { id: "t", name: "T", review: "confirmed", pos: { x: 0, y: 0 }, source: [{ materialId: "m", from: 1, to: 10 }] },
  { id: "u", name: "U", review: "confirmed", pos: { x: 0, y: 0 }, source: [{ materialId: "m", from: 11, to: 12 }] },
  { id: "gone", name: "Gone", review: "archived", pos: { x: 0, y: 0 }, source: [{ materialId: "m", from: 7, to: 7 }] },
];

test("a page's anchored objectives; else its topic's objectives not anchored elsewhere in the file", () => {
  const objectives: Record<string, Objective> = {
    a: obj("a", "t", [sig("m", "slide 4")]),
    b: obj("b", "t", [sig("m", "slides 3-5")]),
    c: obj("c", "t", [sig("m", "slide 9")]),
    d: obj("d", "t"),
    other: obj("other", "t", [sig("x", "slide 7")]),
    e: obj("e", "u"),
    rejected: obj("rejected", "t", [sig("m", "slide 4")], { review: "archived" }),
    merged: obj("merged", "t", [sig("m", "slide 4")], { mergedInto: "a" }),
    inGone: obj("inGone", "gone"),
  };
  assert.deepEqual(objectivesOnPage("m", 4, objectives, topics).sort(), ["a", "b"]);
  assert.deepEqual(objectivesOnPage("m", 7, objectives, topics).sort(), ["d", "other"], "nothing anchored on 7: topic t's objectives not anchored in this file");
  assert.deepEqual(objectivesOnPage("m", 11, objectives, topics), ["e"]);
  assert.deepEqual(objectivesOnPage("m", 20, objectives, topics), []);
  assert.deepEqual(objectivesOnPage("x", 7, objectives, topics), ["other"], "another file's anchors");
});
