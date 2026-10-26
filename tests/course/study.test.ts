import test from "node:test";
import assert from "node:assert/strict";
import { slideRanges, whereTaught } from "../../src/lib/course/study.ts";
import type { Material, Objective, Topic } from "../../src/lib/data.ts";

test("slide locators collapse into ranges; other locators stay as written", () => {
  assert.equal(slideRanges(["slide 20", "slide 18", "slide 19", "slide 24"]), "slides 18–20, 24");
  assert.equal(slideRanges(["slides 3-5", "Slide 4"]), "slides 3–5");
  assert.equal(slideRanges(["slide 7"]), "slide 7");
  assert.equal(slideRanges(["slide 7", "page 2 (problem 3)"]), "slide 7; page 2 (problem 3)");
  assert.equal(slideRanges([]), "");
});

const material = (id: string, filename: string): Material => ({ id, courseId: "c", filename, type: "Lecture", assigned: null, due: null, reflect: false });
const objective = (signals: Objective["signals"]): Objective => ({
  id: "o",
  topicId: "t",
  name: "Negate",
  description: "",
 
  origin: "material",
  review: "confirmed",
  materialId: "m1",
  runId: "r",
  signals,
});
const topic: Topic = { id: "t", name: "2's complement", review: "confirmed", pos: { x: 0, y: 0 }, source: [{ materialId: "m1", from: 12, to: 30 }] };

test("where an objective is taught, per file", () => {
  const o = objective([
    { materialId: "m1", materialType: "Lecture", places: [{ locator: "slide 18", excerpt: "" }, { locator: "slide 19", excerpt: "" }] },
    { materialId: "m2", materialType: "Homework", places: [{ locator: "problem 3", excerpt: "" }] },
    { materialId: "m1", materialType: "Lecture", places: [{ locator: "slide 24", excerpt: "" }] },
  ]);
  assert.deepEqual(whereTaught(o, topic, [material("m1", "L03.pdf"), material("m2", "HW2.pdf")]), [
    { filename: "L03.pdf", where: "slides 18–19, 24" },
    { filename: "HW2.pdf", where: "problem 3" },
  ]);
});

test("no recorded places: the topic's range; nothing at all: empty", () => {
  assert.deepEqual(whereTaught(objective([]), topic, [material("m1", "L03.pdf")]), [{ filename: "L03.pdf", where: "slides 12–30" }]);
  assert.deepEqual(whereTaught(objective([]), { ...topic, source: undefined }, []), []);
});

test("a place in a material the course doesn't have is a bug", () => {
  const o = objective([{ materialId: "gone", materialType: "Lecture", places: [{ locator: "slide 1", excerpt: "" }] }]);
  assert.throws(() => whereTaught(o, topic, []), /isn't in the course/);
});
