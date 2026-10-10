import test from "node:test";
import assert from "node:assert/strict";
import { ISLAND, ISLAND_LAYOUT, islandMapSize, islandSpot } from "../../src/lib/course/islands.ts";

/** An island with its widest name pill, centred under it. */
const footprint = (i: number) => {
  const s = islandSpot(i);
  const centre = s.x + ISLAND.w / 2;
  const left = Math.min(s.x, centre - ISLAND_LAYOUT.pillMax / 2);
  return { left, right: Math.max(s.x + ISLAND.w, centre + ISLAND_LAYOUT.pillMax / 2), top: s.y, bottom: s.y + ISLAND_LAYOUT.cellH };
};
const overlap = (a: ReturnType<typeof footprint>, b: ReturnType<typeof footprint>) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

test("no two islands (with their widest pills) overlap, for as many courses as there are", () => {
  for (let i = 0; i < 40; i++) for (let j = 0; j < i; j++) assert.equal(overlap(footprint(i), footprint(j)), false, `${i} and ${j}`);
});

test("every island and pill fits the map's width, and the map grows a row at a time", () => {
  for (let i = 0; i < 20; i++) {
    const f = footprint(i);
    assert.ok(f.left >= 0 && f.right <= ISLAND_LAYOUT.minW, `island ${i} spans ${f.left}–${f.right}`);
  }
  assert.deepEqual(islandMapSize(0), { w: 900, h: 834 });
  assert.equal(islandMapSize(6).h, 834, "three rows fit the design frame");
  assert.ok(islandMapSize(8).h > 834 && islandMapSize(8).h >= islandSpot(7).y + ISLAND.h, "a fourth row makes it taller");
});
