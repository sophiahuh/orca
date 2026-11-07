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

test("a tapped page flags whole topics: those taught on it and those of objectives anchored to it, wherever their objectives are taught", () => {
  const objectives: Record<string, Objective> = {
    a: obj("a", "t", [sig("m", "slide 4")]),
    b: obj("b", "t", [sig("m", "slides 3-5")]),
    c: obj("c", "t", [sig("m", "slide 9")]),
    d: obj("d", "t"),
    other: obj("other", "t", [sig("x", "slide 7")]),
    e: obj("e", "u"),
    // Anchored on slide 20 of m, which no topic's source covers: its topic comes in through the anchor.
    f: obj("f", "u", [sig("m", "slide 20")]),
    rejected: obj("rejected", "t", [sig("m", "slide 4")], { review: "archived" }),
    merged: obj("merged", "t", [sig("m", "slide 4")], { mergedInto: "a" }),
    inGone: obj("inGone", "gone", [sig("m", "slide 7")]),
  };
  const T = ["a", "b", "c", "d", "other"];
  assert.deepEqual(objectivesOnPage("m", 4, objectives, topics).sort(), T, "an anchored page still flags the whole topic");
  assert.deepEqual(objectivesOnPage("m", 7, objectives, topics).sort(), T, "an overview page: every objective of its topic, other files' included; the archived topic left out");
  assert.deepEqual(objectivesOnPage("m", 11, objectives, topics).sort(), ["e", "f"]);
  assert.deepEqual(objectivesOnPage("m", 20, objectives, topics).sort(), ["e", "f"], "through an anchor");
  assert.deepEqual(objectivesOnPage("m", 30, objectives, topics), []);
  assert.deepEqual(objectivesOnPage("x", 7, objectives, topics).sort(), T, "another file's anchor flags its topic");
});
