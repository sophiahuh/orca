import test from "node:test";
import assert from "node:assert/strict";
import { reviewDates } from "../../src/lib/mastery/calendar.ts";
import type { CourseAgenda, RankedObjective } from "../../src/lib/mastery/agenda.ts";
import type { ObjectiveState } from "../../src/lib/mastery/types.ts";

const ranked = (objectiveId: string, status: RankedObjective["status"]): RankedObjective => ({ objectiveId, topicId: "t", status, priority: { objectiveId, score: 1, terms: [] } });
const state = (objectiveId: string, dueAt: string | null): ObjectiveState => ({ objectiveId, status: "mastered", credit: 3, creditDays: 2, stabilityDays: 5, dueAt, spacedChecks: 0, recall: 0.9, lastEvidenceAt: null });
const empty: CourseAgenda = { courseId: "c", ranked: [], dueToday: [], heldForNext: [], dueTomorrow: [], quickReviewDue: false, nextQuickDay: "2026-10-07", deepReview: { due: false, dueDay: null, tomorrow: false, candidates: 0 } };
const day = (iso: string) => iso.slice(0, 10);
const TODAY = "2026-10-06";

test("no courses or nothing scheduled, no review dates", () => {
  assert.deepEqual(reviewDates([], TODAY, day), []);
  assert.deepEqual(reviewDates([{ id: "c", short: "LOG", agenda: empty, objectives: new Map() }], TODAY, day), []);
});

test("today's quick review, what was missed today on the next one, later spaced checks by day, and an overdue deep review today", () => {
  const agenda: CourseAgenda = {
    ...empty,
    ranked: [ranked("a", "learning"), ranked("b", "mastered"), ranked("c", "mastered"), ranked("d", "mastered")],
    dueToday: [ranked("a", "learning")],
    heldForNext: [ranked("e", "learning"), ranked("f", "fading")],
    quickReviewDue: true,
    deepReview: { due: true, dueDay: "2026-10-01", tomorrow: false, candidates: 3 },
  };
  const objectives = new Map([
    ["b", state("b", "2026-10-09T10:00:00Z")],
    ["c", state("c", "2026-10-09T18:00:00Z")],
    ["d", state("d", "2026-10-20T10:00:00Z")],
  ]);
  const out = reviewDates([{ id: "c", short: "LOG", agenda, objectives }], TODAY, day);
  assert.deepEqual(out.map((e) => [e.date, e.kind, e.title]), [
    [TODAY, "rev", "LOG Dive in"],
    [TODAY, "rev", "LOG quick review · 1 objective"],
    ["2026-10-07", "rev", "LOG quick review · 2 objectives"],
    ["2026-10-09", "rev", "LOG quick review · 2 objectives"],
    ["2026-10-20", "rev", "LOG quick review · 1 objective"],
  ]);
});

test("with today's quick review done (or not on the cadence), today's due list moves to the next one", () => {
  const agenda: CourseAgenda = { ...empty, dueToday: [ranked("a", "learning")], heldForNext: [ranked("b", "learning")] };
  assert.deepEqual(reviewDates([{ id: "c", short: "LOG", agenda, objectives: new Map() }], TODAY, day).map((e) => [e.date, e.title]), [["2026-10-07", "LOG quick review · 2 objectives"]]);
});
