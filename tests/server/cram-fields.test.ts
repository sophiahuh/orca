import test from "node:test";
import assert from "node:assert/strict";
import { connectorMinutes, cramFields, topErrorsOf, type CramFieldsInput } from "../../src/lib/server/connector/cram-plan.ts";
import type { ExamLine, ObjectiveLine } from "../../src/lib/connector/mcp.ts";
import { fakeDb } from "../support/fake-db.ts";

const OWNER = "owner-1";
const COURSE = "c0000000-0000-4000-8000-000000000001";
const AT = new Date("2026-11-13T15:00:00.000Z");
const SINCE = "2026-11-10T09:00:00.000Z";

const objective = (id: string, topicId: string, status: string): ObjectiveLine => ({ id, topicId, topic: `Topic ${topicId}`, name: `Objective ${id}`, status, recall: null, questions: 1 });
const topics = [
  { id: "A", name: "Adders" },
  { id: "B", name: "Buses" },
  { id: "C", name: "Counters" },
];
const objectives = [objective("a1", "A", "learning"), objective("a2", "A", "verified"), objective("b1", "B", "unseen"), objective("c1", "C", "mastered"), objective("x", "C", "unseen")];
const weights = new Map([
  ["a1", 1],
  ["a2", 1],
  ["b1", 1],
  ["c1", 1],
  ["x", 0], // excluded by the scope
]);
const exam = (extra: Partial<ExamLine> = {}): ExamLine => ({ id: "e1", title: "Final", date: "2026-11-19", topicIds: [], cramming: true, scope: { objectives: [], sources: [], budget: { hours: 6, daysOut: [], since: SINCE } }, mode: "exam-week", ...extra });
const event = (at: string, extra: Record<string, unknown> = {}) => ({ owner_id: OWNER, course_id: COURSE, at, kind: "answer", source: "connector", error_type: null, ...extra });
const input = (exams: ExamLine[]): CramFieldsInput => ({ courseId: COURSE, at: AT, timezone: "UTC", today: "2026-11-13", exams, topics, objectives, weights });

test("course_state's plan counts the sessions and the connector's chat since the cram started against the budget", async () => {
  const db = fakeDb({
    session_results: [
      { owner_id: OWNER, course_id: COURSE, finished_at: "2026-11-11T10:00:00.000Z", seconds: 1800 },
      { owner_id: OWNER, course_id: COURSE, finished_at: "2026-11-01T10:00:00.000Z", seconds: 9000 }, // before the cram: not counted
      { owner_id: "someone-else", course_id: COURSE, finished_at: "2026-11-12T10:00:00.000Z", seconds: 9000 },
    ],
    evidence_events: [
      // A 20-minute chat on the 12th, and a 5-hour one on the 13th capped at 120 minutes.
      event("2026-11-12T20:00:00.000Z"),
      event("2026-11-12T20:20:00.000Z", { kind: "work" }),
      event("2026-11-13T09:00:00.000Z"),
      event("2026-11-13T14:00:00.000Z"),
      event("2026-11-13T14:30:00.000Z", { source: "quiz" }), // the app's own session, not the chat
      event("2026-11-05T10:00:00.000Z"), // before the cram
    ],
  });
  const { plan, coverage, topErrors } = await cramFields(db as never, OWNER, input([exam()]));
  assert.ok(plan);
  // 30 session minutes + 20 + 120 chat minutes.
  assert.equal(plan.hoursLeft, 6 - 170 / 60);
  assert.equal(plan.daysLeft, 6);
  assert.match(plan.line, /^6 days to the exam\. Done: Counters\. Today: /);
  assert.deepEqual(plan.verified, { done: 2, total: 4, share: 0.5 });
  assert.deepEqual(plan.topics.map((t) => [t.id, t.done, t.weakSpots]), [
    ["A", false, ["a1"]],
    ["B", false, []],
    ["C", true, ["c1"]],
  ]);
  assert.deepEqual(coverage, { verified: 2, total: 4, share: 0.5, byTopic: [{ topicId: "A", verified: 1, total: 2 }, { topicId: "B", verified: 0, total: 1 }, { topicId: "C", verified: 1, total: 1 }] });
  assert.deepEqual(topErrors, []);
});

test("the plan covers only the exam's topics when it names some, and is null without a cram or a budget; coverage follows the scoping exam", async () => {
  const db = fakeDb({ session_results: [], evidence_events: [] });
  const named = await cramFields(db as never, OWNER, input([exam({ topicIds: ["A"] })]));
  assert.deepEqual(named.plan?.topics.map((t) => t.id), ["A"]);
  assert.deepEqual(named.coverage, { verified: 1, total: 2, share: 0.5, byTopic: [{ topicId: "A", verified: 1, total: 2 }] });

  const noBudget = await cramFields(db as never, OWNER, input([exam({ scope: null })]));
  assert.equal(noBudget.plan, null, "cramming without a budget: no plan yet");
  assert.ok(noBudget.coverage, "coverage still follows the cramming exam");

  const soon = await cramFields(db as never, OWNER, input([exam({ cramming: false, scope: null, date: "2026-11-15", mode: "exam-week" })]));
  assert.equal(soon.plan, null, "no exam is cramming");
  assert.equal(soon.coverage?.total, 4, "the soonest exam within the window scopes coverage");

  const far = await cramFields(db as never, OWNER, input([exam({ cramming: false, scope: null, date: "2026-12-19", mode: "normal" })]));
  assert.deepEqual([far.plan, far.coverage], [null, null]);
});

test("topErrors count the kinds of mistake since the cram started, else over the last 30 days, most frequent first and at most six", async () => {
  const rows = [
    event("2026-11-12T10:00:00.000Z", { error_type: "sign" }),
    event("2026-11-12T10:05:00.000Z", { error_type: "sign" }),
    event("2026-11-12T10:10:00.000Z", { kind: "work", error_type: "units" }),
    event("2026-11-12T10:15:00.000Z", { kind: "confusion", error_type: "concept" }), // not an answer or work event
    event("2026-11-08T10:00:00.000Z", { error_type: "misread" }), // before the cram, within 30 days
    event("2026-10-01T10:00:00.000Z", { error_type: "arithmetic" }), // older than 30 days
  ];
  const db = fakeDb({ session_results: [], evidence_events: rows });
  const cram = await cramFields(db as never, OWNER, input([exam()]));
  assert.deepEqual(cram.topErrors, [{ errorType: "sign", count: 2 }, { errorType: "units", count: 1 }]);
  const plain = await cramFields(db as never, OWNER, input([exam({ cramming: false, scope: null, date: "2026-12-19", mode: "normal" })]));
  assert.deepEqual(plain.topErrors, [{ errorType: "sign", count: 2 }, { errorType: "misread", count: 1 }, { errorType: "units", count: 1 }]);
  const many = topErrorsOf(["arithmetic", "units", "sign", "misread", "notation", "concept", "sign"].map((error_type) => ({ kind: "answer", error_type })));
  assert.equal(many.length, 6);
  assert.deepEqual(many[0], { errorType: "sign", count: 2 });
  assert.deepEqual(topErrorsOf([{ kind: "answer", error_type: "typo" }]), [], "an unknown kind is ignored");
});

test("the connector estimate is each day's span in the student's timezone, capped at 120 minutes", () => {
  const events = [
    // 23:50 to 00:10 UTC is one evening in New York (two days in UTC).
    { at: "2026-11-12T23:50:00.000Z", source: "connector" },
    { at: "2026-11-13T00:10:00.000Z", source: "connector" },
    { at: "2026-11-13T00:05:00.000Z", source: "quiz" },
  ];
  assert.equal(connectorMinutes(events, "America/New_York"), 20);
  assert.equal(connectorMinutes(events, "UTC"), 0, "one event a day spans nothing");
  assert.equal(connectorMinutes([{ at: "2026-11-13T08:00:00.000Z", source: "connector" }, { at: "2026-11-13T20:00:00.000Z", source: "connector" }], "UTC"), 120);
});
