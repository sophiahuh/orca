import test from "node:test";
import assert from "node:assert/strict";
import { confusionEventId, stableUuid } from "../../src/lib/mastery/ids.ts";

test("a confusion event's id is the same for the same material and objective, and a valid UUID", () => {
  const a = confusionEventId("m-1", "o-1");
  assert.equal(a, confusionEventId("m-1", "o-1"));
  assert.notEqual(a, confusionEventId("m-1", "o-2"));
  assert.notEqual(a, confusionEventId("m-2", "o-1"));
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  // Parts aren't just concatenated: ("ab", "c") and ("a", "bc") differ.
  assert.notEqual(stableUuid("ab", "c"), stableUuid("a", "bc"));
});
