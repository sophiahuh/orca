/**
 * Mastery rules v4 (docs/superpowers/specs/2026-11-10-cram-mode-contracts.md, section 3): how much
 * help Claude gave, Claude as a grader, work Claude set and judged, and what the student did
 * (signals). Every rule here changed the fold; RULES_VERSION 4.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { EMPTY_ACCUMULATOR, applyAnswer, applyConfusion, applyEvidence, applySignal, applyWork, replayObjective, stateAt } from "../../src/lib/mastery/objective-state.ts";
import type { AnswerEvent, ConfusionEvent, EvidenceEvent, SignalEvent, WorkEvent } from "../../src/lib/mastery/types.ts";

const day = (n: number, hour = 12) => new Date(Date.UTC(2027, 10, n, hour)).toISOString();
const options = { hasMechanismQuestions: false, dayKey: (iso: string) => iso.slice(0, 10) };
const at = (when: string) => new Date(Date.parse(when) + 60_000);

let seq = 0;
const answer = (questionId: string, when: string, over: Partial<AnswerEvent> = {}): AnswerEvent => ({
  kind: "answer",
  id: `a${++seq}`,
  at: when,
  courseId: "c",
  topicId: "t",
  objectiveId: "o",
  questionId,
  tier: null,
  outcome: "correct",
  grader: "claude",
  source: "connector",
  sessionId: "chat",
  ...over,
});
const work = (id: string, when: string, over: Partial<WorkEvent> = {}): WorkEvent => ({
  kind: "work",
  id,
  at: when,
  courseId: "c",
  topicId: "t",
  objectiveId: "o",
  problem: "Add 0110 and 0011 with a carry-save adder.",
  basis: "known-answer",
  outcome: "correct",
  source: "connector",
  sessionId: "chat",
  ...over,
});
const signal = (kind: SignalEvent["signal"], when: string): SignalEvent => ({ kind: "signal", id: `s-${kind}-${when}`, at: when, courseId: "c", topicId: "t", objectiveId: "o", signal: kind, note: null, source: "connector", sessionId: "chat" });
const flag = (when: string, flagSource: ConfusionEvent["flagSource"]): ConfusionEvent => ({ kind: "confusion", id: `f-${when}`, at: when, courseId: "c", topicId: "t", objectiveId: "o", materialId: null, note: null, flagSource, page: null });

/* ── help ── */

test("help none (or absent) with grader claude is a graded answer: full credit, verified, graded credit", () => {
  for (const help of [undefined, "none"] as const) {
    const acc = applyAnswer(EMPTY_ACCUMULATOR, answer("q1", day(1), help ? { help } : {}), options);
    assert.deepEqual([acc.credit, acc.gradedCredit, acc.verifiedUnaided], [1, 1, true], `help ${help}`);
    assert.equal(stateAt("o", acc, at(day(1))).status, "verified");
  }
});

test("help hint is assisted: half credit, no graded credit, never verifies, rated Hard", () => {
  const hinted = applyAnswer(EMPTY_ACCUMULATOR, answer("q1", day(1), { help: "hint" }), options);
  assert.deepEqual([hinted.credit, hinted.gradedCredit, hinted.verifiedUnaided], [0.5, 0, false]);
  assert.equal(stateAt("o", hinted, at(day(1))).status, "unseen", "a hinted correct proves nothing");
  const self = applyAnswer(EMPTY_ACCUMULATOR, answer("q1", day(1), { grader: "self" }), options);
  assert.deepEqual(hinted.card, self.card, "FSRS rates a hinted answer as it rates a self-marked one (Hard)");
  const unaided = applyAnswer(EMPTY_ACCUMULATOR, answer("q1", day(1)), options);
  assert.ok(unaided.card!.stability > hinted.card!.stability, "Good beats Hard");
});

test("help shown is a miss whatever the outcome says: no credit, a miss in the run, rated Again, in rotation", () => {
  const shown = applyAnswer(EMPTY_ACCUMULATOR, answer("q1", day(1), { outcome: "correct", help: "shown" }), options);
  const missed = applyAnswer(EMPTY_ACCUMULATOR, answer("q1", day(1), { outcome: "incorrect" }), options);
  assert.deepEqual([shown.credit, shown.inRotation, shown.lastMissQuestion, shown.lastTwo, shown.verifiedUnaided], [0, true, "q1", ["incorrect"], false]);
  assert.deepEqual(shown.card, missed.card, "FSRS rates it Again");
  assert.equal(stateAt("o", shown, at(day(1))).status, "learning");
  // A second shown answer on another question is a mix-up, as two misses are.
  const twice = applyAnswer(shown, answer("q2", day(1, 13), { outcome: "partial", help: "shown" }), options);
  assert.equal(twice.mixedUp, true);
});

test("a graded partial with a hint is still partial credit, but assisted", () => {
  const acc = applyAnswer(EMPTY_ACCUMULATOR, answer("q1", day(1), { outcome: "partial", help: "hint" }), options);
  assert.deepEqual([acc.credit, acc.gradedCredit, acc.inRotation], [0.5, 0, true]);
});

test("the grade for FSRS: incorrect or shown Again; partial, self or hint Hard; else Good", () => {
  const stability = (over: Partial<AnswerEvent>) => applyAnswer(EMPTY_ACCUMULATOR, answer("q1", day(1), over), options).card!.stability;
  const again = stability({ outcome: "incorrect" });
  const hard = stability({ outcome: "partial" });
  const good = stability({});
  assert.ok(again < hard && hard < good);
  assert.equal(stability({ help: "shown" }), again);
  assert.equal(stability({ outcome: "partial", help: "shown" }), again);
  assert.equal(stability({ grader: "self" }), hard);
  assert.equal(stability({ help: "hint" }), hard);
  assert.equal(stability({ grader: "rubric" }), good);
  assert.equal(stability({ grader: "claude", help: "none" }), good);
});

test("confidence and errorType ride the event and never change the fold", () => {
  const plain = applyAnswer(EMPTY_ACCUMULATOR, answer("q1", day(1), { outcome: "partial" }), options);
  const noted = applyAnswer(EMPTY_ACCUMULATOR, answer("q1", day(1), { outcome: "partial", confidence: 3, errorType: "sign" }), options);
  assert.deepEqual(noted, plain);
});

/* ── work ── */

test("work folds like an answer to a question with the event's own id", () => {
  const acc = applyWork(EMPTY_ACCUMULATOR, work("w1", day(1)), options);
  assert.deepEqual([acc.answered, acc.attempted, acc.credited, acc.credit, acc.gradedCredit, acc.verifiedUnaided], [1, ["w1"], ["w1"], 1, 1, true]);
  assert.deepEqual(acc, applyAnswer(EMPTY_ACCUMULATOR, answer("w1", day(1), { id: "w1", grader: "claude" }), options), "the same as a graded answer to question w1");
  const again = applyWork(acc, work("w1", day(1, 13)), options);
  assert.equal(again.credit, 1, "the same piece of work earns credit once");
});

test("work judged against an official solution or a known answer is graded; judged by Claude alone it is assisted", () => {
  for (const basis of ["official-solution", "known-answer"] as const) {
    const acc = applyWork(EMPTY_ACCUMULATOR, work("w1", day(1), { basis }), options);
    assert.deepEqual([acc.credit, acc.gradedCredit, acc.verifiedUnaided], [1, 1, true], basis);
  }
  const claude = applyWork(EMPTY_ACCUMULATOR, work("w1", day(1), { basis: "claude" }), options);
  assert.deepEqual([claude.credit, claude.gradedCredit, claude.verifiedUnaided], [0.5, 0, false], "half credit, never verifies");
  assert.deepEqual(claude.card, applyAnswer(EMPTY_ACCUMULATOR, answer("w1", day(1), { grader: "self" }), options).card, "rated Hard");
});

test("help applies to work as to an answer: a hint is assisted, shown is a miss", () => {
  const hinted = applyWork(EMPTY_ACCUMULATOR, work("w1", day(1), { help: "hint" }), options);
  assert.deepEqual([hinted.credit, hinted.gradedCredit, hinted.verifiedUnaided], [0.5, 0, false]);
  const shown = applyWork(EMPTY_ACCUMULATOR, work("w1", day(1), { help: "shown" }), options);
  assert.deepEqual([shown.credit, shown.inRotation, shown.lastMissQuestion], [0, true, "w1"]);
  const missed = applyWork(EMPTY_ACCUMULATOR, work("w1", day(1), { outcome: "incorrect" }), options);
  assert.deepEqual([missed.credit, missed.inRotation, missed.lastMissQuestion], [0, true, "w1"]);
  assert.equal(stateAt("o", missed, at(day(1))).status, "learning");
});

test("work counts toward the bar with answers: three pieces over two days master the objective", () => {
  const log: EvidenceEvent[] = [flag(day(1), "connector-struggled"), work("w1", day(2)), answer("q1", day(2)), work("w2", day(3))];
  const acc = replayObjective("o", log, options);
  assert.deepEqual([acc.mastered, acc.credit, acc.creditDays], [true, 3, ["2027-11-02", "2027-11-03"]]);
  assert.equal(stateAt("o", acc, at(day(3))).status, "mastered");
});

/* ── signals ── */

test("lost does exactly what a struggled flag does", () => {
  const before = replayObjective("o", [answer("q1", day(1)), answer("q2", day(2))], options);
  const lost = applySignal(before, signal("lost", day(3)));
  const struggled = applyConfusion(before, flag(day(3), "connector-struggled"));
  assert.deepEqual(lost, struggled);
  assert.deepEqual([lost.inRotation, lost.credit, lost.mastered], [true, 0, false]);
  assert.equal(stateAt("o", lost, at(day(3))).status, "learning");
  assert.equal(applySignal(EMPTY_ACCUMULATOR, signal("lost", day(3))).inRotation, true, "also on an objective never answered");
});

test("got-it opens a check on an objective not in rotation and not mastered, like a check flag", () => {
  const got = applySignal(EMPTY_ACCUMULATOR, signal("got-it", day(1)));
  assert.deepEqual(got, applyConfusion(EMPTY_ACCUMULATOR, flag(day(1), "connector")));
  assert.deepEqual([got.checkOpen, got.credit, got.inRotation], [true, 0, false], "no credit: I get it is checked, not believed");
  assert.equal(stateAt("o", got, at(day(1))).status, "check-due");
  const verified = applyAnswer(EMPTY_ACCUMULATOR, answer("q1", day(1)), options);
  assert.equal(stateAt("o", applySignal(verified, signal("got-it", day(2))), at(day(2))).status, "check-due", "a verified objective is checked again");
});

test("got-it does nothing on an objective in rotation or already mastered", () => {
  const learning = applyAnswer(EMPTY_ACCUMULATOR, answer("q1", day(1), { outcome: "incorrect" }), options);
  assert.deepEqual(applySignal(learning, signal("got-it", day(2))), learning);
  const mastered = replayObjective("o", [answer("p1", day(1)), answer("p2", day(1)), answer("p3", day(2))], options);
  assert.deepEqual([mastered.mastered, mastered.inRotation], [true, false]);
  assert.deepEqual(applySignal(mastered, signal("got-it", day(3))), mastered, "mastered unflagged: nothing, not a check");
});

test("asked-answer and asked-harder change no state", () => {
  const before = replayObjective("o", [answer("q1", day(1), { outcome: "partial" }), answer("q2", day(2))], options);
  for (const kind of ["asked-answer", "asked-harder"] as const) assert.deepEqual(applySignal(before, signal(kind, day(3))), before, kind);
  for (const kind of ["asked-answer", "asked-harder", "got-it"] as const) assert.equal(applySignal(EMPTY_ACCUMULATOR, signal(kind, day(3))).credit, 0, `${kind} never adds credit`);
});

test("a signal out of order is refused like any other event", () => {
  const acc = applyAnswer(EMPTY_ACCUMULATOR, answer("q1", day(2)), options);
  assert.throws(() => applySignal(acc, signal("lost", day(1))), /older than/);
  assert.throws(() => applyWork(acc, work("w1", day(1)), options), /older than/);
});

/* ── dispatch ── */

test("applyEvidence and replayObjective dispatch on every kind", () => {
  const log: EvidenceEvent[] = [signal("got-it", day(1)), answer("q1", day(2), { help: "hint" }), work("w1", day(3)), flag(day(4), "connector"), signal("lost", day(5))];
  const stepped = log.reduce((acc, e) => applyEvidence(acc, e, options), EMPTY_ACCUMULATOR);
  assert.deepEqual(replayObjective("o", log, options), stepped);
  const statuses = log.map((e, i) => stateAt("o", replayObjective("o", log.slice(0, i + 1), options), at(e.at)).status);
  assert.deepEqual(statuses, ["check-due", "unseen", "verified", "check-due", "learning"]);
});
