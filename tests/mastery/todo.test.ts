import test from "node:test";
import assert from "node:assert/strict";
import { todoCards } from "../../src/lib/mastery/todo.ts";
import type { CourseAgenda, RankedObjective } from "../../src/lib/mastery/agenda.ts";
import { DEFAULT_CONFIG } from "../../src/lib/data.ts";

const ranked = (objectiveId: string, topicId: string, reason: string): RankedObjective => ({
  objectiveId,
  topicId,
  status: "learning",
  priority: { objectiveId, score: 2, terms: [{ term: "gap", value: 1, reason }] },
  weight: 1,
  reached: true,
});
const names = { objective: (id: string) => `Obj ${id}`, topic: (id: string) => `Topic ${id}` };
const empty: CourseAgenda = {
  courseId: "c",
  ranked: [],
  dueToday: [],
  heldForNext: [],
  dueTomorrow: [],
  quickReviewDue: false,
  nextQuickDay: null,
  upNext: [],
  quickTomorrow: false,
  deepReview: { due: false, dueDay: null, tomorrow: false, candidates: 0 },
};

test("nothing due, no cards", () => {
  assert.deepEqual(todoCards(empty, DEFAULT_CONFIG, names), []);
});

test("quick review shows how many objectives it covers", () => {
  const cards = todoCards({ ...empty, quickReviewDue: true, dueToday: [ranked("a", "t", "Not mastered yet: 1 of 3 correct"), ranked("b", "t", "x")] }, DEFAULT_CONFIG, names, 2);
  assert.deepEqual(cards.map((c) => [c.kind, c.when, c.title, c.detail]), [["quick", "today", "Quick review · 10 min", "Covers 2 objectives"]]);
});

test("a due quick review with nothing it can ask (dive-only or thumbed-down questions) shows no card", () => {
  assert.deepEqual(todoCards({ ...empty, quickReviewDue: true, dueToday: [ranked("a", "t", "x")] }, DEFAULT_CONFIG, names, 0), []);
});

test("deep review today or tomorrow and tomorrow's checks", () => {
  const cards = todoCards(
    {
      ...empty,
      deepReview: { due: true, dueDay: "2026-10-05", tomorrow: false, candidates: 2 },
      dueTomorrow: [ranked("c", "t2", ""), ranked("d", "t2", "")],
    },
    DEFAULT_CONFIG,
    names,
  );
  assert.deepEqual(cards.map((c) => [c.kind, c.when, c.title]), [
    ["deep", "today", "Dive in"],
    ["checks", "tomorrow", "Topic t2 · 2 checks"],
  ]);
  const tomorrow = todoCards({ ...empty, deepReview: { due: false, dueDay: "2026-10-06", tomorrow: true, candidates: 1 } }, DEFAULT_CONFIG, names);
  assert.deepEqual(tomorrow.map((c) => [c.kind, c.when]), [["deep", "tomorrow"]]);
});

test("a quick review that can't fit every due objective says only how many it covers", () => {
  const agenda = { ...empty, quickReviewDue: true, dueToday: [ranked("a", "t", ""), ranked("b", "t", ""), ranked("c", "t", "")] };
  assert.equal(todoCards(agenda, DEFAULT_CONFIG, names, 1)[0].detail, "Covers 1 objective");
});

test("tomorrow's quick review: a card under Due tomorrow, sized like the session, that can be started early", () => {
  const agenda = { ...empty, heldForNext: [ranked("a", "t", ""), ranked("b", "t", "")], upNext: [ranked("a", "t", ""), ranked("b", "t", "")], quickTomorrow: true };
  assert.deepEqual(todoCards(agenda, DEFAULT_CONFIG, names, undefined, 2).map((c) => [c.kind, c.when, c.title, c.detail]), [["quick", "tomorrow", "Quick review · 10 min", "Covers 2 objectives · start early anytime"]]);
  assert.deepEqual(todoCards(agenda, DEFAULT_CONFIG, names, undefined, 0), [], "nothing it can ask, no card");
  assert.throws(() => todoCards(agenda, DEFAULT_CONFIG, names));
});
