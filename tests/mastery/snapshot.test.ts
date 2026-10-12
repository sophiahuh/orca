/**
 * The snapshot path (Phase 4 Task 3): a stored accumulator plus new events equals a full replay;
 * RULES_VERSION moves whenever the rules do; day keys follow the student's timezone.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  EMPTY_ACCUMULATOR,
  FSRS_PARAMETERS,
  MASTERY_RULES,
  RULES_VERSION,
  type ObjectiveAccumulator,
  applyEvidence,
  dayKeyIn,
  replayObjective,
} from "../../src/lib/mastery/objective-state.ts";
import type { AnswerEvent, ConfusionEvent, EvidenceEvent } from "../../src/lib/mastery/types.ts";

const day = (n: number, hour = 12) => new Date(Date.UTC(2026, 9, n, hour)).toISOString();
const utcDay = (iso: string) => iso.slice(0, 10);

let seq = 0;
function answer(questionId: string, when: string, over: Partial<AnswerEvent> = {}): AnswerEvent {
  seq += 1;
  return {
    kind: "answer",
    id: `e${seq}`,
    at: when,
    courseId: "c",
    topicId: "t",
    objectiveId: "o",
    questionId,
    tier: null,
    outcome: "correct",
    grader: "choice",
    source: "quiz",
    sessionId: when.slice(0, 10),
    ...over,
  };
}
const confusion = (when: string): ConfusionEvent => ({
  kind: "confusion",
  id: `c-${when}`,
  at: when,
  courseId: "c",
  topicId: "t",
  objectiveId: "o",
  materialId: "m",
  note: "I don't get it",
});

/**
 * A fixed history touching every rule: credit over two days, a mix-up cleared by a mechanism
 * question, mastery, a passed check, a deep-review check, a miss, a same-session retry, a later
 * pass, self-marking, partial credit and confusion.
 */
const GOLDEN_LOG: EvidenceEvent[] = [
  answer("q1", day(1), { outcome: "incorrect" }),
  answer("q2", day(1), { outcome: "incorrect" }),
  answer("q3", day(1)),
  answer("q4", day(1), { tier: "mechanism" }),
  answer("q5", day(2), { grader: "self" }),
  answer("q6", day(2), { outcome: "partial" }),
  answer("q7", day(3)),
  answer("q8", day(3)),
  answer("q1", day(9)),
  answer("q2", day(25), { source: "deep-review" }),
  answer("q3", day(28), { outcome: "incorrect", sessionId: "s-miss" }),
  answer("q3", day(28, 13), { sessionId: "s-miss" }),
  answer("q4", day(29)),
  confusion(day(30)),
  answer("q9", day(31)),
];
const GOLDEN_OPTIONS = { hasMechanismQuestions: true, dayKey: utcDay };

/* ── RULES_VERSION ────────────────────────────────────────────────────── */

/**
 * The hash of MASTERY_RULES plus the FSRS parameters each RULES_VERSION was released with. When a
 * rule or the scheduler's parameters change, bump RULES_VERSION and add a line here (never edit
 * an old one): every stored snapshot with an older version is then rebuilt from the log.
 */
const RULES_HASHES: Record<number, string> = {
  1: "eb9aeb80f48d781505b46862b41eeb1176b1e06e54dc833f4c95263d0503a2e0",
};

/**
 * The golden log's accumulator under each RULES_VERSION, just before the confusion event and at the
 * end. A change to the fold's logic shows up here even when no constant moved.
 */
const GOLDEN: Record<number, { beforeConfusion: ObjectiveAccumulator; end: ObjectiveAccumulator }> = {
  1: {
    beforeConfusion: {
      answered: 13,
      lastAt: "2026-10-29T12:00:00.000Z",
      attempted: ["q1", "q2", "q3", "q4", "q5", "q6"],
      credit: 3,
      gradedCredit: 2.5,
      creditDays: ["2026-10-01", "2026-10-02"],
      lastTwo: ["correct", "correct"],
      mixedUp: false,
      lastMissQuestion: null,
      mastered: true,
      checkDueAt: "2026-11-01T12:00:00.000Z",
      spacedChecks: 3,
      missPending: false,
      missSessionId: null,
      retired: false,
      card: { due: "2026-11-01T12:00:00.000Z", stability: 1.85155726, difficulty: 9.75256268, elapsed_days: 1, scheduled_days: 3, learning_steps: 0, reps: 13, lapses: 2, state: 2, last_review: "2026-10-29T12:00:00.000Z" },
    },
    end: {
      answered: 14,
      lastAt: "2026-10-31T12:00:00.000Z",
      attempted: ["q9"],
      credit: 1,
      gradedCredit: 1,
      creditDays: ["2026-10-31"],
      lastTwo: ["correct"],
      mixedUp: false,
      lastMissQuestion: null,
      mastered: false,
      checkDueAt: null,
      spacedChecks: 0,
      missPending: false,
      missSessionId: null,
      retired: false,
      card: { due: "2026-11-04T12:00:00.000Z", stability: 3.03761629, difficulty: 9.73803849, elapsed_days: 2, scheduled_days: 4, learning_steps: 0, reps: 14, lapses: 2, state: 2, last_review: "2026-10-31T12:00:00.000Z" },
    },
  },
};

const rulesHash = () => createHash("sha256").update(JSON.stringify({ rules: MASTERY_RULES, fsrs: FSRS_PARAMETERS })).digest("hex");

test("MASTERY_RULES and the FSRS parameters hash to what this RULES_VERSION was released with", () => {
  assert.equal(
    rulesHash(),
    RULES_HASHES[RULES_VERSION],
    `The mastery rules changed. Bump RULES_VERSION and record its hash and golden accumulator in this file (hash: ${rulesHash()})`,
  );
});

test("every recorded RULES_VERSION has its own hash", () => {
  const hashes = Object.values(RULES_HASHES);
  assert.equal(new Set(hashes).size, hashes.length);
  assert.equal(Math.max(...Object.keys(RULES_HASHES).map(Number)), RULES_VERSION);
});

test("the golden log replays to the accumulators recorded for this RULES_VERSION", () => {
  const confusionAt = GOLDEN_LOG.findIndex((e) => e.kind === "confusion");
  const replayed = {
    beforeConfusion: replayObjective("o", GOLDEN_LOG.slice(0, confusionAt), GOLDEN_OPTIONS),
    end: replayObjective("o", GOLDEN_LOG, GOLDEN_OPTIONS),
  };
  const recorded = GOLDEN[RULES_VERSION];
  assert.ok(recorded, `No golden accumulators for RULES_VERSION ${RULES_VERSION}. Check this replay is right, then record it:\n${JSON.stringify(replayed)}`);
  assert.deepEqual(replayed, recorded, "The fold's logic changed: bump RULES_VERSION and record the new golden accumulators");
});

/* ── Snapshot plus events equals replay ──────────────────────────────── */

test("a stored snapshot plus the events after it equals a full replay, split at every point", () => {
  const full = replayObjective("o", GOLDEN_LOG, GOLDEN_OPTIONS);
  for (let split = 0; split <= GOLDEN_LOG.length; split += 1) {
    const stored: ObjectiveAccumulator = JSON.parse(JSON.stringify(replayObjective("o", GOLDEN_LOG.slice(0, split), GOLDEN_OPTIONS)));
    const continued = GOLDEN_LOG.slice(split).reduce((acc, e) => applyEvidence(acc, e, GOLDEN_OPTIONS), stored);
    assert.deepEqual(continued, full, `split at ${split}`);
  }
});

test("the empty accumulator is what a log with nothing for the objective replays to", () => {
  assert.deepEqual(replayObjective("o", [], GOLDEN_OPTIONS), EMPTY_ACCUMULATOR);
});

/* ── dayKeyIn ─────────────────────────────────────────────────────────── */

test("dayKeyIn gives the calendar day in the named timezone", () => {
  const ny = dayKeyIn("America/New_York");
  assert.equal(ny("2026-10-05T03:59:00Z"), "2026-10-04");
  assert.equal(ny("2026-10-05T04:00:00Z"), "2026-10-05");
  assert.equal(dayKeyIn("UTC")("2026-10-05T23:59:59Z"), "2026-10-05");
  assert.equal(dayKeyIn("Asia/Kolkata")("2026-10-05T18:29:00Z"), "2026-10-05");
  assert.equal(dayKeyIn("Asia/Kolkata")("2026-10-05T18:30:00Z"), "2026-10-06");
  assert.equal(dayKeyIn("Pacific/Kiritimati")("2026-10-05T10:00:00Z"), "2026-10-06");
});

test("dayKeyIn follows daylight saving changes", () => {
  const ny = dayKeyIn("America/New_York");
  // Spring forward, 2026-03-08: midnight is 05:00Z before, 04:00Z after.
  assert.equal(ny("2026-03-08T04:59:00Z"), "2026-03-07");
  assert.equal(ny("2026-03-08T05:00:00Z"), "2026-03-08");
  assert.equal(ny("2026-03-09T03:59:00Z"), "2026-03-08");
  assert.equal(ny("2026-03-09T04:00:00Z"), "2026-03-09");
  // Fall back, 2026-11-01: the day is 25 hours long.
  assert.equal(ny("2026-11-01T03:59:00Z"), "2026-10-31");
  assert.equal(ny("2026-11-01T04:00:00Z"), "2026-11-01");
  assert.equal(ny("2026-11-02T04:59:00Z"), "2026-11-01");
  assert.equal(ny("2026-11-02T05:00:00Z"), "2026-11-02");
});

test("dayKeyIn refuses an unknown timezone and an unparseable time", () => {
  assert.throws(() => dayKeyIn("Mars/Olympus_Mons"), RangeError);
  assert.throws(() => dayKeyIn("Mars/Olympus_Mons"), RangeError, "and keeps refusing it: nothing was cached for it");
  assert.throws(() => dayKeyIn("UTC")("yesterday"), /unparseable/);
});

test("dayKeyIn reuses one formatter per timezone, so folding a long log doesn't build one per event", () => {
  const ny = dayKeyIn("America/New_York");
  const again = dayKeyIn("America/New_York");
  const times = Array.from({ length: 2000 }, (_, i) => new Date(Date.UTC(2026, 0, 1, i)).toISOString());
  const started = performance.now();
  for (const t of times) assert.equal(ny(t), again(t));
  // 4,000 keys; building a formatter each time would take well over a second.
  assert.ok(performance.now() - started < 1000, "day keys come from a cached formatter");
});

test("credit days follow the student's timezone: two UTC days can be one local day", () => {
  // 23:00 and 01:00 UTC are the same evening in New York.
  const log = [answer("q1", "2026-10-05T23:00:00Z"), answer("q2", "2026-10-06T01:00:00Z")];
  assert.equal(replayObjective("o", log, { hasMechanismQuestions: false, dayKey: utcDay }).creditDays.length, 2);
  assert.equal(replayObjective("o", log, { hasMechanismQuestions: false, dayKey: dayKeyIn("America/New_York") }).creditDays.length, 1);
});
