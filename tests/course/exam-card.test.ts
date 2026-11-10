import test from "node:test";
import assert from "node:assert/strict";
import type { ExamScope, Objective, Topic } from "../../src/lib/data.ts";
import { cardExam, daysUntil, examObjectives, scopeFromSetup } from "../../src/lib/course/exam-card.ts";

const topic = (id: string, extra: Partial<Topic> = {}): Topic => ({ id, name: id, review: "confirmed", pos: { x: 0, y: 0 }, source: [], ...extra });
const objective = (id: string, topicId: string, extra: Partial<Objective> = {}): Objective => ({ id, topicId, name: id, description: "", origin: "material", review: "confirmed", materialId: "m", runId: "r", signals: [], ...extra });
const exam = (date: string, extra: Partial<{ cramming: boolean; courseId: string }> = {}) => ({ courseId: "c", date, cramming: false, ...extra });

const topics = [topic("t1"), topic("t2"), topic("old", { mergedInto: "t2" }), topic("gone", { review: "archived" })];
const objectives = {
  a: objective("a", "t1"),
  b: objective("b", "t2"),
  c: objective("c", "old"),
  d: objective("d", "t1", { review: "archived" }),
  e: objective("e", "gone"),
};

test("the card shows the cramming exam first, else the soonest exam from today on", () => {
  assert.equal(cardExam([exam("2026-11-20"), exam("2026-11-12"), exam("2026-11-09")], "c", "2026-11-10")?.date, "2026-11-12");
  assert.equal(cardExam([exam("2026-11-12"), exam("2026-12-20", { cramming: true })], "c", "2026-11-10")?.date, "2026-12-20");
  assert.equal(cardExam([exam("2026-11-10")], "c", "2026-11-10")?.date, "2026-11-10", "today's exam still shows");
  assert.equal(cardExam([exam("2026-11-09"), exam("2026-11-12", { courseId: "d" })], "c", "2026-11-10"), null);
});

test("days left are whole days, 0 on the day", () => {
  assert.equal(daysUntil("2026-11-15", "2026-11-10"), 5);
  assert.equal(daysUntil("2026-11-10", "2026-11-10"), 0);
  assert.equal(daysUntil("2026-03-30", "2026-03-27"), 3, "daylight saving doesn't skip a day");
  assert.equal(daysUntil("2026-11-09", "2026-11-10"), -1);
});

test("an exam covers its topics' live objectives (merges followed), every topic when it names none", () => {
  assert.deepEqual(examObjectives({ topicIds: ["t1"], scope: null }, topics, objectives), ["a"]);
  assert.deepEqual(examObjectives({ topicIds: ["old"], scope: null }, topics, objectives), ["b", "c"], "a merged topic's objectives count under its survivor");
  assert.deepEqual(examObjectives({ topicIds: [], scope: null }, topics, objectives), ["a", "b", "c"]);
  assert.deepEqual(examObjectives({ topicIds: ["gone"], scope: null }, topics, objectives), []);
});

test("with a scope, the card counts the listed objectives that weigh more than 0", () => {
  const scope: ExamScope = { objectives: [{ objectiveId: "a", weight: 2, evidence: [] }, { objectiveId: "b", weight: 0, evidence: [] }, { objectiveId: "d", weight: 1, evidence: [] }], sources: ["professor"] };
  assert.deepEqual(examObjectives({ topicIds: [], scope }, topics, objectives), ["a"], "excluded and archived ones don't count");
  assert.deepEqual(examObjectives({ topicIds: ["t1"], scope: { objectives: [], sources: [] } }, topics, objectives), ["a"], "an empty scope falls back to the topics");
});

test("the setup's scope lists every covered objective at weight 1 with the professor's words; without words it's unchanged", () => {
  assert.equal(scopeFromSetup(null, ["a", "b"], "  "), null);
  const made = scopeFromSetup(null, ["a", "b"], "Chapters 3 and 4, no proofs.")!;
  assert.deepEqual(made.sources, ["professor"]);
  assert.deepEqual(
    made.objectives,
    ["a", "b"].map((objectiveId) => ({ objectiveId, weight: 1, evidence: [{ signal: "professor", strength: "strong", quote: "Chapters 3 and 4, no proofs." }] })),
  );
  // Editing keeps earlier weights and other evidence, replaces the professor's quote, and keeps the format.
  const before: ExamScope = {
    objectives: [{ objectiveId: "a", weight: 3, evidence: [{ signal: "practice-exam", strength: "strongest" }, { signal: "professor", strength: "strong", quote: "old" }] }],
    format: { minutes: 90 },
    sources: ["practice-exam", "professor"],
  };
  const edited = scopeFromSetup(before, ["a", "b"], "new")!;
  assert.deepEqual(edited.objectives[0], { objectiveId: "a", weight: 3, evidence: [{ signal: "practice-exam", strength: "strongest" }, { signal: "professor", strength: "strong", quote: "new" }] });
  assert.deepEqual(edited.objectives[1], { objectiveId: "b", weight: 1, evidence: [{ signal: "professor", strength: "strong", quote: "new" }] });
  assert.deepEqual(edited.format, { minutes: 90 });
  assert.deepEqual(edited.sources, ["practice-exam", "professor"]);
  assert.equal(scopeFromSetup(before, ["a"], ""), before);
});
