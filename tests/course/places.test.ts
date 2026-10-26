import test from "node:test";
import assert from "node:assert/strict";
import { addRanges, describePlaces, pagesIn, toRanges, unionPlaces } from "../../src/lib/course/places.ts";

test("ranges in one material merge when they overlap or touch; other materials are kept apart", () => {
  const a = addRanges([], "m1", [{ from: 4, to: 6 }]);
  const b = addRanges(a, "m1", [{ from: 7, to: 9 }, { from: 14, to: 14 }]);
  const c = addRanges(b, "m2", [{ from: 1, to: 2 }]);
  assert.deepEqual(c, [{ materialId: "m1", from: 4, to: 9 }, { materialId: "m1", from: 14, to: 14 }, { materialId: "m2", from: 1, to: 2 }]);
  assert.deepEqual([...pagesIn(c, "m1")].sort((x, y) => x - y), [4, 5, 6, 7, 8, 9, 14]);
  assert.deepEqual(toRanges([3, 1, 2, 7]), [{ from: 1, to: 3 }, { from: 7, to: 7 }]);
  assert.deepEqual(unionPlaces(a, [{ materialId: "m1", from: 5, to: 8 }]), [{ materialId: "m1", from: 4, to: 8 }]);
  assert.equal(describePlaces(c, new Map([["m1", "L3.pdf"], ["m2", "HW2.pdf"]])), "L3.pdf p4–9, 14; HW2.pdf p1–2");
});
