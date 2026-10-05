import test from "node:test";
import assert from "node:assert/strict";
import { streakDays } from "../../src/lib/mastery/streak.ts";
import type { EvidenceEvent } from "../../src/lib/mastery/types.ts";

const utcDay = (iso: string) => iso.slice(0, 10);
const ev = (at: string, grader: EvidenceEvent["grader"] = "choice"): EvidenceEvent => ({
  id: at,
  at,
  courseId: "c",
  topicId: "t",
  objectiveId: "t/o",
  questionId: "q",
  tier: null,
  outcome: "incorrect",
  grader,
  source: "quiz",
});
const now = new Date("2026-10-05T20:00:00Z");

test("no answers is a zero streak", () => {
  assert.equal(streakDays([], now, utcDay), 0);
});

test("counts consecutive days ending today, right or wrong answers alike", () => {
  assert.equal(streakDays([ev("2026-10-03T10:00:00Z"), ev("2026-10-04T10:00:00Z"), ev("2026-10-05T10:00:00Z")], now, utcDay), 3);
});

test("a streak isn't broken until today ends", () => {
  assert.equal(streakDays([ev("2026-10-03T10:00:00Z"), ev("2026-10-04T10:00:00Z")], now, utcDay), 2);
});

test("a gap ends the streak", () => {
  assert.equal(streakDays([ev("2026-10-01T10:00:00Z"), ev("2026-10-04T10:00:00Z"), ev("2026-10-05T10:00:00Z")], now, utcDay), 2);
  assert.equal(streakDays([ev("2026-10-02T10:00:00Z")], now, utcDay), 0);
});

test("self-marked answers don't keep a streak alive", () => {
  assert.equal(streakDays([ev("2026-10-05T10:00:00Z", "self")], now, utcDay), 0);
});
