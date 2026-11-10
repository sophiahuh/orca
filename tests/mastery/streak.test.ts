import test from "node:test";
import assert from "node:assert/strict";
import { streakDays } from "../../src/lib/mastery/streak.ts";
import type { AnswerEvent as EvidenceEvent, WorkEvent } from "../../src/lib/mastery/types.ts";

const utcDay = (iso: string) => iso.slice(0, 10);
const ev = (at: string, grader: EvidenceEvent["grader"] = "choice", help?: EvidenceEvent["help"]): EvidenceEvent => ({
  id: at,
  at,
  courseId: "c",
  topicId: "t",
  objectiveId: "t/o",
  questionId: "q",
  tier: null,
  outcome: "incorrect",
  grader,
  kind: "answer",
  source: "quiz",
  sessionId: "s1",
  ...(help ? { help } : {}),
});
const work = (at: string, basis: WorkEvent["basis"] = "known-answer", help?: WorkEvent["help"]): WorkEvent => ({ kind: "work", id: `w-${at}`, at, courseId: "c", topicId: "t", objectiveId: "t/o", problem: "Add 0110 and 0011.", basis, outcome: "incorrect", source: "connector", sessionId: "chat", ...(help ? { help } : {}) });
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

test("rules v4: an answer Claude graded keeps the streak alive only unaided; a hint or a shown answer doesn't", () => {
  assert.equal(streakDays([ev("2026-10-05T10:00:00Z", "claude")], now, utcDay), 1);
  assert.equal(streakDays([ev("2026-10-05T10:00:00Z", "claude", "none")], now, utcDay), 1);
  assert.equal(streakDays([ev("2026-10-05T10:00:00Z", "claude", "hint")], now, utcDay), 0);
  assert.equal(streakDays([ev("2026-10-05T10:00:00Z", "claude", "shown")], now, utcDay), 0);
  assert.equal(streakDays([ev("2026-10-05T10:00:00Z", "rubric", "shown")], now, utcDay), 0);
});

test("rules v4: graded work counts like an answer; work judged by Claude alone, hinted or shown doesn't", () => {
  assert.equal(streakDays([work("2026-10-05T10:00:00Z")], now, utcDay), 1);
  assert.equal(streakDays([work("2026-10-05T10:00:00Z", "official-solution")], now, utcDay), 1);
  assert.equal(streakDays([work("2026-10-05T10:00:00Z", "claude")], now, utcDay), 0);
  assert.equal(streakDays([work("2026-10-05T10:00:00Z", "known-answer", "hint")], now, utcDay), 0);
  assert.equal(streakDays([work("2026-10-05T10:00:00Z", "known-answer", "shown")], now, utcDay), 0);
});

test("confusion events don't count toward the streak", () => {
  const confusion = { kind: "confusion" as const, id: "c", at: "2026-10-05T12:00:00.000Z", courseId: "c", topicId: "t", objectiveId: "o", materialId: "m", note: "", flagSource: "homework" as const, page: null };
  assert.equal(streakDays([confusion], new Date("2026-10-05T15:00:00.000Z"), (iso) => iso.slice(0, 10)), 0);
});
