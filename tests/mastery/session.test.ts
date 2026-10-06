import test from "node:test";
import assert from "node:assert/strict";
import {
  type SessionCandidate,
  type SessionQuestion,
  assembleQuickReview,
  assembleRequiz,
  durationSeconds,
  questionSeconds,
} from "../../src/lib/mastery/session.ts";
import type { QuestionTier } from "../../src/lib/data.ts";

const utcDay = (iso: string) => iso.slice(0, 10);
const now = new Date("2026-10-05T09:00:00Z");
const mc = (id: string, tier: QuestionTier = "retrieval", materialId?: string): SessionQuestion => ({ id, kind: "Multiple choice", tier, materialId });
const exact = (id: string, tier: QuestionTier = "retrieval"): SessionQuestion => ({ id, kind: "Short answer", tier, exact: ["1"] });
const sentence = (id: string, tier: QuestionTier = "mechanism"): SessionQuestion => ({
  id,
  kind: "Short answer",
  tier,
  rubric: { requiredIdeas: ["x"], acceptableAlternatives: [], knownMisconceptions: [] },
});
const cand = (objectiveId: string, status: SessionCandidate["status"], questions: SessionQuestion[], dueAt: string | null = null): SessionCandidate => ({
  objectiveId,
  topicId: "t",
  status,
  dueAt,
  questions,
});
const ctx = (budgetSeconds: number, lastSeen: Record<string, string> = {}) => ({ lastSeen: new Map(Object.entries(lastSeen)), budgetSeconds, now, dayKey: utcDay });
const ids = (s: { items: { questionId: string }[] }) => s.items.map((i) => i.questionId);

test("time per question and configured durations", () => {
  assert.equal(questionSeconds(mc("q")), 30);
  assert.equal(questionSeconds(exact("q")), 45);
  assert.equal(questionSeconds(sentence("q")), 90);
  assert.equal(durationSeconds("5 min"), 300);
  assert.equal(durationSeconds("1 hour"), 3600);
  assert.equal(durationSeconds("10 hours"), 36000);
});

test("quick review order: mixed-up, overdue, learning, due today, unseen; priority order inside a group", () => {
  const s = assembleQuickReview(
    [
      cand("unseen", "unseen", [mc("u1")]),
      cand("today", "fading", [mc("f1")], "2026-10-05T08:00:00Z"),
      cand("learning", "learning", [mc("l1")]),
      cand("overdue", "fading", [mc("o1")], "2026-10-02T08:00:00Z"),
      cand("mixed", "mixed-up", [mc("m1")]),
      cand("learning2", "learning", [mc("l2")]),
    ],
    ctx(600),
  );
  assert.deepEqual(ids(s).slice(0, 6), ["m1", "o1", "l1", "l2", "f1", "u1"]);
});

test("fits the budget, spreads across objectives before repeating, and repeats only objectives not yet mastered", () => {
  const s = assembleQuickReview(
    [cand("a", "learning", [mc("a1"), mc("a2"), mc("a3")]), cand("b", "fading", [mc("b1"), mc("b2")], "2026-10-01T00:00:00Z"), cand("c", "unseen", [mc("c1"), mc("c2")])],
    ctx(150),
  );
  assert.deepEqual(ids(s), ["b1", "a1", "c1", "a2", "c2"]);
  assert.equal(s.plannedSeconds, 150);
  const big = assembleQuickReview([cand("a", "learning", [mc("a1"), mc("a2")]), cand("b", "fading", [mc("b1"), mc("b2")], "2026-10-01T00:00:00Z")], ctx(6000));
  assert.deepEqual(ids(big), ["b1", "a1", "a2"], "a fading objective gets one check, not two");
});

test("always at least one question, even over budget; nothing to ask is an empty session", () => {
  assert.deepEqual(ids(assembleQuickReview([cand("a", "learning", [sentence("a1")])], ctx(30))), ["a1"]);
  assert.deepEqual(assembleQuickReview([cand("a", "learning", [])], ctx(600)).items, []);
});

test("unseen questions first, then the one seen longest ago, marked seen before", () => {
  const seen = { a1: "2026-10-03T00:00:00Z", a2: "2026-10-01T00:00:00Z" };
  const s = assembleQuickReview([cand("a", "learning", [mc("a1"), mc("a2"), mc("a3")])], ctx(90, seen));
  assert.deepEqual(ids(s), ["a3", "a2", "a1"]);
  assert.deepEqual(s.items.map((i) => i.seenBefore), [false, true, true]);
});

test("a mixed-up objective leads with a mechanism question", () => {
  const s = assembleQuickReview([cand("m", "mixed-up", [mc("m1"), sentence("m2")])], ctx(90));
  assert.equal(ids(s)[0], "m2");
});

test("at least one mechanism question: the last pick makes room for one", () => {
  const s = assembleQuickReview([cand("a", "learning", [mc("a1"), mc("a2")]), cand("b", "learning", [mc("b1"), sentence("b2")])], ctx(120));
  assert.deepEqual(ids(s), ["a1", "b2"]);
  assert.ok(s.plannedSeconds <= 120);
  const none = assembleQuickReview([cand("a", "learning", [mc("a1"), mc("a2")])], ctx(120));
  assert.deepEqual(ids(none), ["a1", "a2"], "no mechanism question anywhere: nothing to swap in");
});

test("a re-quiz only asks the weak objectives", () => {
  const s = assembleRequiz([cand("a", "learning", [mc("a1")]), cand("b", "learning", [mc("b1")])], ["b"], ctx(600));
  assert.deepEqual(ids(s), ["b1"]);
});

test("candidates keep priority order and leave out objectives with no questions; last seen is the latest answer", async () => {
  const { sessionCandidates, lastSeenOf } = await import("../../src/lib/mastery/session.ts");
  const ranked = [
    { objectiveId: "b", topicId: "t", status: "learning" as const },
    { objectiveId: "a", topicId: "t", status: "unseen" as const },
    { objectiveId: "z", topicId: "t", status: "unseen" as const },
  ];
  const states = new Map([["a", { dueAt: null }], ["b", { dueAt: null }], ["z", { dueAt: null }]]);
  const c = sessionCandidates(ranked, states, new Map([["a", [mc("a1")]], ["b", [mc("b1")]]]));
  assert.deepEqual(c.map((x) => x.objectiveId), ["b", "a"]);
  const answer = (questionId: string, at: string) => ({ kind: "answer" as const, id: at, at, courseId: "c", topicId: "t", objectiveId: "a", questionId, tier: null, outcome: "correct" as const, grader: "exact" as const, source: "quiz" as const, sessionId: "s" });
  assert.deepEqual([...lastSeenOf([answer("q", "2026-10-02T00:00:00Z"), answer("q", "2026-10-01T00:00:00Z")])], [["q", "2026-10-02T00:00:00Z"]]);
});
