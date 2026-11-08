import test from "node:test";
import assert from "node:assert/strict";
import { objectivesOnlyTaughtBy } from "../../src/lib/server/materials.ts";

test("removing a file archives only the objectives no other live file teaches", () => {
  const created = [
    { id: "o-only", signals: [{ materialId: "m-gone", places: [] }] },
    { id: "o-shared", signals: [{ materialId: "m-gone", places: [] }, { materialId: "m-live", places: [] }] },
    { id: "o-shared-with-removed", signals: [{ materialId: "m-gone", places: [] }, { materialId: "m-removed", places: [] }] },
    { id: "o-no-signals", signals: null },
  ];
  assert.deepEqual(objectivesOnlyTaughtBy("m-gone", created, ["m-live", "m-gone"]).sort(), ["o-no-signals", "o-only", "o-shared-with-removed"]);
  assert.deepEqual(objectivesOnlyTaughtBy("m-gone", created, []).sort(), ["o-no-signals", "o-only", "o-shared", "o-shared-with-removed"], "with no other live file, everything it created goes");
});
