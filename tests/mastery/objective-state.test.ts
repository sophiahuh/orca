import test from "node:test";
import assert from "node:assert/strict";
import {
  EMPTY_ACCUMULATOR,
  MASTERY_RULES,
  applyAnswer,
  computeObjectiveState,
  stateAt,
} from "../../src/lib/mastery/objective-state.ts";
import type { AnswerEvent as EvidenceEvent, ConfusionEvent } from "../../src/lib/mastery/types.ts";

/** Noon UTC on 2026-10-<n>. */
const day = (n: number, hour = 12) => new Date(Date.UTC(2026, 9, n, hour)).toISOString();
const at = (n: number, hour = 13) => new Date(day(n, hour));
const utcDay = (iso: string) => iso.slice(0, 10);
const msBefore = (iso: string) => new Date(Date.parse(iso) - 1);

let seq = 0;
function ev(questionId: string, when: string, over: Partial<EvidenceEvent> = {}): EvidenceEvent {
  seq += 1;
  return {
    id: `e${seq}`,
    at: when,
    courseId: "ald",
    topicId: "t",
    objectiveId: "t/o",
    questionId,
    tier: null,
    outcome: "correct",
    grader: "choice",
    kind: "answer",
    source: "quiz",
    // One session per calendar day unless a test says otherwise.
    sessionId: when.slice(0, 10),
    ...over,
  };
}

const opts = (hasMechanismQuestions = false) => ({ hasMechanismQuestions, dayKey: utcDay });
const state = (events: EvidenceEvent[], now: Date, hasMechanismQuestions = false) =>
  computeObjectiveState("t/o", events, now, opts(hasMechanismQuestions));

/** Mastered on day 2: q1, q2 on day 1 and q3 on day 2. */
const masteredOnDay2 = () => [ev("q1", day(1)), ev("q2", day(1)), ev("q3", day(2))];
const dueAfter = (events: EvidenceEvent[]) => state(events, at(2)).dueAt!;


/* ── The mastery bar (Orca's rule) ─────────────────────────────────── */

test("no answers is unseen", () => {
  const s = state([], at(1));
  assert.equal(s.status, "unseen");
  assert.equal(s.credit, 0);
  assert.equal(s.dueAt, null);
  assert.equal(s.recall, null);
  assert.equal(s.lastEvidenceAt, null);
});

test("events for other objectives are ignored", () => {
  assert.equal(state([ev("q1", day(1), { objectiveId: "t/other" })], at(1)).status, "unseen");
});

test("three correct answers on one day is still learning", () => {
  const s = state([ev("q1", day(1)), ev("q2", day(1)), ev("q3", day(1))], at(1));
  assert.equal(s.status, "learning");
  assert.equal(s.credit, 3);
  assert.equal(s.creditDays, 1);
  assert.equal(s.dueAt, null);
});

test("three credited answers over two days with the last two correct is mastered", () => {
  const s = state(masteredOnDay2(), at(2));
  assert.equal(s.status, "mastered");
  assert.ok(s.dueAt && Date.parse(s.dueAt) > Date.parse(day(2)), "a check is scheduled after mastery");
  assert.ok(s.stabilityDays && s.stabilityDays > 0);
  assert.equal(s.spacedChecks, 0);
});

test("repeating a question never adds credit", () => {
  const s = state([ev("q1", day(1)), ev("q1", day(2)), ev("q2", day(2))], at(2));
  assert.equal(s.credit, 2);
  assert.equal(s.status, "learning");
});

test("a question first missed earns nothing when later answered correctly", () => {
  const s = state([ev("q1", day(1), { outcome: "incorrect" }), ev("q1", day(2))], at(2));
  assert.equal(s.credit, 0);
});

test("self-marked answers count half", () => {
  const events = [ev("q1", day(1)), ev("q2", day(1)), ev("q3", day(2), { grader: "self" }), ev("q4", day(2), { grader: "self" })];
  const s = state(events, at(2));
  assert.equal(s.credit, 3);
  assert.equal(s.status, "mastered");
});

test("self-marked answers alone can't master an objective", () => {
  const selfOnly = ["q1", "q2", "q3", "q4"].map((q) => ev(q, day(1), { grader: "self" }));
  const events = [...selfOnly, ev("q5", day(2), { grader: "self" }), ev("q6", day(2), { grader: "self" })];
  const s = state(events, at(2));
  assert.equal(s.credit, 3);
  assert.equal(s.status, "learning");
});

test("the last two answers must be correct", () => {
  const events = [ev("q1", day(1)), ev("q2", day(1)), ev("q3", day(2), { outcome: "incorrect" }), ev("q4", day(2))];
  assert.equal(state(events, at(2)).status, "learning");
  assert.equal(state([...events, ev("q5", day(3))], at(3)).status, "mastered");
});

test("partial answers count half and don't break the streak", () => {
  const events = [ev("q1", day(1)), ev("q2", day(1)), ev("q3", day(2), { outcome: "partial", grader: "rubric" }), ev("q4", day(2), { outcome: "partial", grader: "rubric" })];
  const s = state(events, at(2));
  assert.equal(s.credit, 3);
  assert.equal(s.status, "mastered");
});

/* ── Mix-ups ───────────────────────────────────────────────────────── */

test("two misses in a row on different questions is a mix-up, cleared only by a mechanism question", () => {
  const misses = [ev("q1", day(1), { outcome: "incorrect" }), ev("q2", day(1), { outcome: "incorrect" })];
  assert.equal(state(misses, at(1), true).status, "mixed-up");
  const retrieval = [...misses, ev("q3", day(1), { tier: "retrieval" })];
  assert.equal(state(retrieval, at(1), true).status, "mixed-up");
  const mechanism = [...retrieval, ev("q4", day(1), { tier: "mechanism" })];
  assert.equal(state(mechanism, at(1), true).status, "learning");
});

test("missing the same question twice is not a mix-up", () => {
  const s = state([ev("q1", day(1), { outcome: "incorrect" }), ev("q1", day(1), { outcome: "incorrect" })], at(1));
  assert.equal(s.status, "learning");
});

test("without mechanism questions any unaided correct answer clears a mix-up", () => {
  const events = [ev("q1", day(1), { outcome: "incorrect" }), ev("q2", day(1), { outcome: "incorrect" }), ev("q3", day(1))];
  assert.equal(state(events, at(1), false).status, "learning");
});

test("self-marked answers neither cause nor clear a mix-up", () => {
  const selfMisses = [ev("q1", day(1), { outcome: "incorrect", grader: "self" }), ev("q2", day(1), { outcome: "incorrect", grader: "self" })];
  assert.equal(state(selfMisses, at(1)).status, "learning");
  const misses = [ev("q1", day(1), { outcome: "incorrect" }), ev("q2", day(1), { outcome: "incorrect" }), ev("q3", day(1), { grader: "self" })];
  assert.equal(state(misses, at(1)).status, "mixed-up");
});

test("an open mix-up blocks mastery", () => {
  const events = [
    ev("q1", day(1), { outcome: "incorrect" }),
    ev("q2", day(1), { outcome: "incorrect" }),
    ev("q3", day(1), { tier: "retrieval" }),
    ev("q4", day(2), { tier: "retrieval" }),
    ev("q5", day(2), { tier: "retrieval" }),
  ];
  const s = state(events, at(2), true);
  assert.equal(s.credit, 3);
  assert.equal(s.status, "mixed-up");
});

/* ── Spacing (FSRS) ────────────────────────────────────────────────── */

test("a mastered objective fades the moment its check is due", () => {
  const due = dueAfter(masteredOnDay2());
  assert.equal(state(masteredOnDay2(), msBefore(due)).status, "mastered");
  assert.equal(state(masteredOnDay2(), new Date(due)).status, "fading");
});

test("a correct answer before the check is due is not a spaced check", () => {
  const events = [...masteredOnDay2(), ev("q4", day(3))];
  const s = state(events, at(3));
  assert.equal(s.status, "mastered");
  assert.equal(s.spacedChecks, 0);
});

test("passing a check that was due counts it, grows stability and pushes the next check further out", () => {
  const events = masteredOnDay2();
  const first = state(events, at(2));
  events.push(ev("q4", first.dueAt!));
  const after = state(events, new Date(first.dueAt!));
  assert.equal(after.status, "mastered");
  assert.equal(after.spacedChecks, 1);
  assert.ok(after.stabilityDays! > first.stabilityDays!);
  const firstGap = Date.parse(first.dueAt!) - Date.parse(day(2));
  const secondGap = Date.parse(after.dueAt!) - Date.parse(first.dueAt!);
  assert.ok(secondGap > firstGap, "intervals grow");
});

test("a check passed in a deep review sets the next one 1.5× further out, capped at 60 days; FSRS memory is unchanged", () => {
  const events = masteredOnDay2();
  const first = state(events, at(2));
  const quiz = state([...events, ev("q4", first.dueAt!)], new Date(first.dueAt!));
  const deep = state([...events, ev("q4", first.dueAt!, { source: "deep-review" })], new Date(first.dueAt!));
  const gapDays = (s: { dueAt: string | null }) => (Date.parse(s.dueAt!) - Date.parse(first.dueAt!)) / 86_400_000;
  assert.equal(gapDays(deep), Math.round(gapDays(quiz) * 1.5));
  assert.equal(deep.stabilityDays, quiz.stabilityDays);
  assert.equal(deep.spacedChecks, 1);

  // Late in the schedule the cap still holds.
  const long = [...masteredOnDay2()];
  let s = state(long, at(2));
  for (let i = 0; i < 6; i++) {
    long.push(ev(`q${10 + i}`, s.dueAt!, { source: "deep-review" }));
    s = state(long, new Date(s.dueAt!));
    if (s.status === "retired") break;
    assert.ok((Date.parse(s.dueAt!) - Date.parse(long.at(-1)!.at)) / 86_400_000 <= 60);
  }
});

test("a miss after mastery fades it, cuts stability and is due again at once", () => {
  const events = masteredOnDay2();
  const before = state(events, at(2));
  events.push(ev("q4", day(3), { outcome: "incorrect" }));
  const missed = state(events, at(3));
  assert.equal(missed.status, "fading");
  assert.ok(missed.stabilityDays! < before.stabilityDays!);
  assert.equal(missed.dueAt, day(3), "due for the next review session, not held back");
});

test("a missed check is passed only in a later session, not by a retry in the same one", () => {
  const events = [...masteredOnDay2(), ev("q4", day(3), { outcome: "incorrect", sessionId: "morning" })];
  events.push(ev("q5", day(3, 13), { sessionId: "morning" }));
  assert.equal(state(events, at(3, 14)).status, "fading");
  events.push(ev("q6", day(3, 18), { sessionId: "evening" }));
  const s = state(events, at(3, 19));
  assert.equal(s.status, "mastered");
  assert.equal(s.spacedChecks, 1);
});

test("only an unaided correct answer passes a due check; partial and self-marked answers don't", () => {
  const due = dueAfter(masteredOnDay2());
  const partial = state([...masteredOnDay2(), ev("q4", due, { outcome: "partial", grader: "rubric" })], new Date(due));
  assert.equal(partial.status, "fading");
  assert.equal(partial.spacedChecks, 0);
  assert.equal(partial.dueAt, due);
  const selfMarked = state([...masteredOnDay2(), ev("q4", due, { grader: "self" })], new Date(due));
  assert.equal(selfMarked.status, "fading");
  assert.equal(selfMarked.spacedChecks, 0);
});

test("an early correct answer doesn't push the check later", () => {
  const due = dueAfter(masteredOnDay2());
  assert.equal(state([...masteredOnDay2(), ev("q4", day(3))], at(3)).dueAt, due);
});

test("a self-marked miss after mastery fades it at once", () => {
  const s = state([...masteredOnDay2(), ev("q4", day(3), { outcome: "incorrect", grader: "self" })], at(3));
  assert.equal(s.status, "fading");
});

test("FSRS tracks difficulty from the first answer: a hard-won objective gets a shorter first interval", () => {
  const clean = [ev("q1", day(1)), ev("q2", day(1)), ev("q3", day(2))];
  const struggled = [
    ev("x1", day(1), { outcome: "incorrect" }),
    ev("q1", day(1)),
    ev("q2", day(1)),
    ev("q3", day(2)),
  ];
  const cleanGap = Date.parse(state(clean, at(2)).dueAt!) - Date.parse(day(2));
  const struggledGap = Date.parse(state(struggled, at(2)).dueAt!) - Date.parse(day(2));
  assert.equal(state(struggled, at(2)).status, "mastered");
  assert.ok(struggledGap < cleanGap, `struggled ${struggledGap} vs clean ${cleanGap}`);
});

test("predicted recall is near 1 right after an answer and falls over time", () => {
  const events = masteredOnDay2();
  const soon = state(events, at(2)).recall!;
  const later = state(events, at(30)).recall!;
  assert.ok(soon > 0.95, `soon ${soon}`);
  assert.ok(later < soon, `later ${later}`);
});

test("no check is ever scheduled more than the maximum interval out", () => {
  const events = masteredOnDay2();
  let s = state(events, at(2));
  for (let i = 0; i < 4; i += 1) {
    const from = Date.parse(s.dueAt!);
    events.push(ev(`c${i}`, s.dueAt!));
    s = state(events, new Date(from));
    if (s.status === "retired") break;
    assert.ok(Date.parse(s.dueAt!) - from <= MASTERY_RULES.maxIntervalDays * 86_400_000, `check ${i + 1}`);
  }
});

test("passing every check on time eventually retires the objective", () => {
  const events = masteredOnDay2();
  let s = state(events, at(2));
  let checks = 0;
  while (s.status !== "retired" && checks < 10) {
    events.push(ev(`check${checks}`, s.dueAt!));
    checks += 1;
    s = state(events, new Date(s.dueAt!));
  }
  assert.equal(s.status, "retired");
  assert.ok(s.spacedChecks >= MASTERY_RULES.retireAfterChecks);
  assert.ok(s.stabilityDays! >= MASTERY_RULES.retireStabilityDays);
  assert.ok(checks <= 6, `took ${checks} checks`);
});

test("a retired objective comes back as fading after any miss, aided or not", () => {
  const retire = () => {
    const events = masteredOnDay2();
    let s = state(events, at(2));
    while (s.status !== "retired") {
      events.push(ev(`check${events.length}`, s.dueAt!));
      s = state(events, new Date(s.dueAt!));
    }
    return { events, at: Date.parse(s.lastEvidenceAt!) };
  };
  for (const grader of ["choice", "self"] as const) {
    const { events, at: last } = retire();
    const when = new Date(last + 86_400_000).toISOString();
    events.push(ev("late", when, { outcome: "incorrect", grader }));
    assert.equal(state(events, new Date(when)).status, "fading", grader);
  }
});

/* ── The fold ──────────────────────────────────────────────────────── */

test("events are ordered by time, not by array position", () => {
  const s = state([ev("q3", day(2)), ev("q1", day(1)), ev("q2", day(1))], at(2));
  assert.equal(s.status, "mastered");
});

test("applying answers one at a time gives the same state as replaying the log", () => {
  const events = [
    ev("q1", day(1), { outcome: "incorrect" }),
    ev("q2", day(1)),
    ev("q3", day(2)),
    ev("q4", day(2)),
    ev("q5", day(9)),
    ev("q6", day(12), { outcome: "incorrect" }),
    ev("q7", day(14)),
  ];
  let acc = EMPTY_ACCUMULATOR;
  for (let i = 0; i < events.length; i += 1) {
    acc = applyAnswer(acc, events[i], opts());
    const now = at(20);
    assert.deepEqual(stateAt("t/o", acc, now), state(events.slice(0, i + 1), now), `after answer ${i + 1}`);
  }
});

test("the accumulator survives a JSON round trip, so it can be stored as a snapshot", () => {
  const acc = masteredOnDay2().reduce((a, e) => applyAnswer(a, e, opts()), EMPTY_ACCUMULATOR);
  const restored = JSON.parse(JSON.stringify(acc));
  assert.deepEqual(restored, acc);
  const next = ev("q4", day(9));
  assert.deepEqual(applyAnswer(restored, next, opts()), applyAnswer(acc, next, opts()));
});

test("an answer older than the last one applied throws instead of corrupting the state", () => {
  const acc = applyAnswer(EMPTY_ACCUMULATOR, ev("q2", day(2)), opts());
  assert.throws(() => applyAnswer(acc, ev("q1", day(1)), opts()), /rebuild/);
});

test("applyAnswer never mutates the state it was given", () => {
  const before = applyAnswer(EMPTY_ACCUMULATOR, ev("q1", day(1)), opts());
  const snapshot = JSON.stringify(before);
  applyAnswer(before, ev("q2", day(2)), opts());
  assert.equal(JSON.stringify(before), snapshot);
});

test("an unparseable timestamp throws", () => {
  assert.throws(() => state([ev("q1", "garbage")], at(1)), /unparseable timestamp/);
});

/* ── Self-reported confusion (homework reflection) ─────────────────── */

const confused = (when: string, objectiveId = "t/o"): ConfusionEvent => ({
  kind: "confusion",
  id: `c-${when}`,
  at: when,
  courseId: "ald",
  topicId: "t",
  objectiveId,
  materialId: "hw1",
  note: "I don't get K-map groups",
});
const fold = (events: Array<EvidenceEvent | ConfusionEvent>, now: Date) => computeObjectiveState("t/o", events, now, opts());

test("confusion on a mastered objective resets it to learning with no credit and no check", () => {
  const s = fold([...masteredOnDay2(), confused(day(3))], at(3));
  assert.equal(s.status, "learning");
  assert.equal(s.credit, 0);
  assert.equal(s.creditDays, 0);
  assert.equal(s.dueAt, null);
  assert.equal(s.spacedChecks, 0);
  assert.equal(s.lastEvidenceAt, day(3));
});

test("after confusion the same questions earn credit again, and mastery needs two fresh days", () => {
  const again = [ev("q1", day(4)), ev("q2", day(4)), ev("q3", day(4))];
  assert.equal(fold([...masteredOnDay2(), confused(day(3)), ...again], at(4)).status, "learning", "one day isn't enough");
  const s = fold([...masteredOnDay2(), confused(day(3)), ...again, ev("q1", day(5))], at(5));
  assert.equal(s.credit, 3, "attempted questions were cleared, so q1–q3 credit again; the day-5 repeat doesn't");
  assert.equal(s.status, "learning", "credit came from one day only");
  assert.equal(fold([...masteredOnDay2(), confused(day(3)), ev("q1", day(4)), ev("q2", day(4)), ev("q3", day(5))], at(5)).status, "mastered");
});

test("confusion un-retires and un-fades, and does nothing to an objective with no answers", () => {
  assert.equal(fold([confused(day(1))], at(1)).status, "unseen");
  const missedCheck = [...masteredOnDay2(), ev("q1", day(30), { outcome: "incorrect" })];
  assert.equal(fold(missedCheck, at(30)).status, "fading");
  assert.equal(fold([...missedCheck, confused(day(31))], at(31)).status, "learning");
});

test("confusion is never credit: a confusion-only log stays unseen and other objectives are untouched", () => {
  assert.equal(fold([...masteredOnDay2(), confused(day(3), "t/other")], at(3)).status, "mastered");
});
