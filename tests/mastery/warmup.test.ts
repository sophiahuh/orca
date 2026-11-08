import test from "node:test";
import assert from "node:assert/strict";
import { WARM_UP_QUESTIONS, warmUpCandidates } from "../../src/lib/mastery/warmup.ts";
import type { ObjectiveStatus } from "../../src/lib/mastery/types.ts";

const r = (objectiveId: string, status: ObjectiveStatus, weight = 1) => ({ objectiveId, status, weight });
const askable = (...ids: string[]) => new Map(ids.map((id) => [id, [{ id: `q-${id}` }]]));

test("a warm-up is the heaviest unflagged objectives with an askable question, up to five, while nothing in the course is flagged", () => {
  const ranked = [r("a", "unseen", 1), r("b", "unseen", 3), r("c", "unseen", 2), r("e", "verified", 5), r("f", "unseen", 4)];
  assert.deepEqual(warmUpCandidates(ranked, askable("a", "b", "c", "d", "e")).map((x) => x.objectiveId), ["b", "c", "a"], "heaviest first; verified (e) and without questions (f) are left out");
  const many = Array.from({ length: 8 }, (_, i) => r(`o${i}`, "unseen", 8 - i));
  assert.equal(warmUpCandidates(many, askable(...many.map((x) => x.objectiveId))).length, WARM_UP_QUESTIONS);
});

test("once anything is in rotation or waiting on a check, there is no warm-up: the due list takes over", () => {
  assert.deepEqual(warmUpCandidates([r("a", "unseen"), r("b", "learning")], askable("a", "b")), []);
  assert.deepEqual(warmUpCandidates([r("a", "unseen"), r("b", "check-due")], askable("a", "b")), []);
  assert.deepEqual(warmUpCandidates([r("a", "unseen"), r("b", "mastered")], askable("a")), []);
});
