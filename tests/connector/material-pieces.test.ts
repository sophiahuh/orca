import test from "node:test";
import assert from "node:assert/strict";
import type { Material, Objective, Topic } from "../../src/lib/data.ts";
import { MATERIAL_FOR_RULES, heldBackAmong, materialsToRead, piecesFor } from "../../src/lib/connector/material-pieces.ts";

const material = (id: string, extra: Partial<Material> = {}): Material => ({ id, courseId: "c", filename: `${id}.pdf`, type: "Lecture", assigned: null, due: null, reflect: false, heldBack: false, ...extra });
const topic: Topic = { id: "t", name: "Adders", review: "confirmed", pos: { x: 0, y: 0 }, source: [{ materialId: "L2", from: 10, to: 11 }] };
const objective = (extra: Partial<Objective> = {}): Objective => ({
  id: "o",
  topicId: "t",
  name: "Objective",
  description: "",
  origin: "material",
  review: "confirmed",
  materialId: "L1",
  runId: "r",
  signals: [{ materialId: "L1", materialType: "Lecture", places: [{ locator: "slide 3", excerpt: "x" }] }],
  ...extra,
});
const pages = (n: number, text = (i: number) => `Page ${i}`) => Array.from({ length: n }, (_, i) => ({ n: i + 1, text: text(i + 1) }));

test("pieces are the objective's anchored pages (with a neighbour either side) in the material's page order, with the file's name", () => {
  const got = piecesFor(objective(), topic, { materials: [material("L1")], pages: { L1: pages(6) } });
  assert.deepEqual(got.map((p) => [p.materialId, p.filename, p.page, p.text]), [["L1", "L1.pdf", 2, "Page 2"], ["L1", "L1.pdf", 3, "Page 3"], ["L1", "L1.pdf", 4, "Page 4"]]);
});

test("materials come most anchored places first, then the upload that created the objective; at most 6 pieces, each cut at 2,500 characters", () => {
  const o = objective({
    materialId: "L1",
    signals: [
      { materialId: "L1", materialType: "Lecture", places: [{ locator: "slide 3", excerpt: "x" }] },
      { materialId: "L3", materialType: "Homework", places: [{ locator: "page 1", excerpt: "x" }, { locator: "page 5", excerpt: "x" }] },
    ],
  });
  const long = "y".repeat(3000);
  const got = piecesFor(o, topic, { materials: [material("L1"), material("L3")], pages: { L1: pages(6), L3: pages(6, () => long) } });
  assert.equal(got.length, MATERIAL_FOR_RULES.piecesPerObjective);
  assert.deepEqual(got.map((p) => [p.materialId, p.page]), [["L3", 1], ["L3", 2], ["L3", 4], ["L3", 5], ["L3", 6], ["L1", 2]], "L3 (two places) before L1 (one), then the cap");
  assert.ok(got.slice(0, 5).every((p) => p.text.length === MATERIAL_FOR_RULES.pieceChars));
});

test("a held-back material is skipped and counted; a removed one (not among the materials) and one without pages are skipped silently", () => {
  const o = objective({
    materialId: "L1",
    signals: [
      { materialId: "L1", materialType: "Lecture", places: [{ locator: "slide 3", excerpt: "x" }] },
      { materialId: "exam", materialType: "Past exam", places: [{ locator: "page 1", excerpt: "x" }, { locator: "page 2", excerpt: "x" }, { locator: "page 3", excerpt: "x" }] },
      { materialId: "gone", materialType: "Lecture", places: [{ locator: "slide 1", excerpt: "x" }, { locator: "slide 2", excerpt: "x" }] },
      { materialId: "textless", materialType: "Typed notes", places: [{ locator: "page 1", excerpt: "x" }, { locator: "page 2", excerpt: "x" }] },
    ],
  });
  const materials = [material("L1"), material("exam", { heldBack: true, type: "Past exam" }), material("textless")];
  assert.deepEqual(materialsToRead([o], materials), ["textless", "L1"], "only live materials are read, held-back ones never");
  assert.equal(heldBackAmong([o], materials), 1);
  assert.equal(heldBackAmong([o, objective({ id: "p", materialId: "exam", signals: [] })], materials), 1, "counted once across objectives");
  const got = piecesFor(o, topic, { materials, pages: { L1: pages(6), exam: pages(3) } });
  assert.deepEqual(got.map((p) => [p.materialId, p.page]), [["L1", 2], ["L1", 3], ["L1", 4]]);
});

test("with no anchors in a material, the topic's slide range there is used, else a short material whole; a long unanchored one gives nothing", () => {
  const o = objective({ materialId: "L2", signals: [] });
  const viaTopic = piecesFor(o, topic, { materials: [material("L2")], pages: { L2: pages(12) } });
  assert.deepEqual(viaTopic.map((p) => p.page), [10, 11]);
  const whole = piecesFor(o, undefined, { materials: [material("L2")], pages: { L2: pages(3) } });
  assert.deepEqual(whole.map((p) => p.page), [1, 2, 3]);
  assert.deepEqual(piecesFor(o, undefined, { materials: [material("L2")], pages: { L2: pages(61) } }), []);
});
