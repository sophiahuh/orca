import test from "node:test";
import assert from "node:assert/strict";
import { ISLAND_LAYOUT, islandFootprint, islandMapSize, placeIslands } from "../../src/lib/course/islands.ts";

const ids = (n: number) => Array.from({ length: n }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
const apart = (a: ReturnType<typeof islandFootprint>, b: ReturnType<typeof islandFootprint>) => {
  const g = ISLAND_LAYOUT.gap;
  return a.right + g <= b.left || b.right + g <= a.left || a.bottom + g <= b.top || b.bottom + g <= a.top;
};

test("islands (with their widest pills) keep the minimum gap, however many there are", () => {
  const spots = placeIslands(ids(40)).map(islandFootprint);
  for (let i = 0; i < spots.length; i++) {
    assert.ok(spots[i].left >= ISLAND_LAYOUT.margin && spots[i].top >= ISLAND_LAYOUT.margin, `island ${i} inside the margin`);
    for (let j = 0; j < i; j++) assert.ok(apart(spots[i], spots[j]), `${i} and ${j}`);
  }
});

test("placement is stable: same ids, same spots, and adding a course doesn't move the others", () => {
  const five = placeIslands(ids(5));
  assert.deepEqual(placeIslands(ids(5)), five);
  assert.deepEqual(placeIslands(ids(6)).slice(0, 5), five);
});

test("the map holds every island and is at least the design frame", () => {
  assert.deepEqual(islandMapSize([]), { w: 900, h: 834 });
  const spots = placeIslands(ids(12));
  const size = islandMapSize(spots);
  for (const f of spots.map(islandFootprint)) assert.ok(f.right <= size.w && f.bottom <= size.h);
});
