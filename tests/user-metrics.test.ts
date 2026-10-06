import test from "node:test";
import assert from "node:assert/strict";
import { userMetrics } from "../src/lib/user-metrics.ts";

test("metrics roll up persisted session time, correct answers, topics, and local-day streaks", () => {
  const metrics = userMetrics({
    courses: [{ id: "c1", name: "Data Structures" }, { id: "c2", name: "Fundies" }],
    topics: [{ id: "t1", courseId: "c1", name: "Merge sort" }, { id: "t2", courseId: "c1", name: "Heaps" }],
    sessions: [{ courseId: "c1", topicId: "t1", seconds: 300, finishedAt: "2026-10-01T18:00:00Z" }, { courseId: "c2", topicId: null, seconds: 120, finishedAt: "2026-10-02T18:00:00Z" }],
    answers: [{ courseId: "c1", topicId: "t1", at: "2026-10-01T18:00:00Z", outcome: "correct" }, { courseId: "c1", topicId: "t2", at: "2026-10-02T18:00:00Z", outcome: "incorrect" }, { courseId: "c1", topicId: "t2", at: "2026-10-03T18:00:00Z", outcome: "correct" }],
    timezone: "America/New_York",
  });
  assert.equal(metrics.seconds, 420);
  assert.equal(metrics.solved, 2);
  assert.equal(metrics.longestStreak, 3);
  assert.deepEqual(metrics.courses[0], { courseId: "c1", name: "Data Structures", seconds: 300, solved: 2, topics: [{ topicId: "t1", name: "Merge sort", seconds: 300, solved: 1 }, { topicId: "t2", name: "Heaps", seconds: 0, solved: 1 }] });
});
