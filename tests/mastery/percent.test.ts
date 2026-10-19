import test from "node:test";
import assert from "node:assert/strict";
import { masteryPercent, reviewPhrase } from "../../src/lib/mastery/percent.ts";
import type { ObjectiveState } from "../../src/lib/mastery/types.ts";

const base: ObjectiveState = { objectiveId: "o", status: "learning", credit: 0, creditDays: 0, stabilityDays: null, dueAt: null, spacedChecks: 0, recall: null, lastEvidenceAt: null };

test("the display percent climbs with credit before mastery and follows recall after it", () => {
  assert.equal(masteryPercent(undefined), 0);
  assert.equal(masteryPercent({ ...base, status: "unseen" }), 0);
  assert.equal(masteryPercent({ ...base, credit: 1.5 }), 40);
  assert.equal(masteryPercent({ ...base, credit: 3 }), 80, "never shows 100 before the rule says mastered");
  assert.equal(masteryPercent({ ...base, status: "mixed-up", credit: 3 }), 40);
  assert.equal(masteryPercent({ ...base, status: "mastered", recall: 0.93 }), 93);
  assert.equal(masteryPercent({ ...base, status: "fading", recall: 0.52 }), 52);
  // A missed check: FSRS's recall is ~100% right after the answer, but the display drops under the line.
  assert.equal(masteryPercent({ ...base, status: "fading", recall: 0.999 }), 80, "a miss never reads as a rise");
  assert.equal(masteryPercent({ ...base, status: "retired", recall: null }), 100);
});

test("the review phrase reads the next due day in the student's day", () => {
  const dayKey = (iso: string) => iso.slice(0, 10);
  const now = new Date("2026-10-06T15:00:00Z");
  assert.equal(reviewPhrase(undefined, now, dayKey), "comes up in your next quiz");
  assert.equal(reviewPhrase({ ...base, status: "mastered", dueAt: "2026-10-07T03:00:00Z" }, now, dayKey), "back in review tomorrow");
  assert.equal(reviewPhrase({ ...base, status: "mastered", dueAt: "2026-10-09T03:00:00Z" }, now, dayKey), "back in review in 3 days");
  assert.equal(reviewPhrase({ ...base, status: "fading", dueAt: "2026-10-05T03:00:00Z" }, now, dayKey), "comes back in your next quick review");
  assert.equal(reviewPhrase({ ...base, status: "mixed-up" }, now, dayKey), "comes back in your next quick review to untangle it");
});
