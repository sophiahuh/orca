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
  deepReview: { due: false, dueDay: null, tomorrow: false, candidates: 0 },
};

test("nothing due, no cards", () => {
  assert.deepEqual(todoCards(empty, DEFAULT_CONFIG, names), []);
});

test("quick review shows its size and the top reason", () => {
  const cards = todoCards({ ...empty, quickReviewDue: true, dueToday: [ranked("a", "t", "Not mastered yet: 1 of 3 correct"), ranked("b", "t", "x")] }, DEFAULT_CONFIG, names);
  assert.deepEqual(cards.map((c) => [c.kind, c.when, c.title, c.detail]), [["quick", "today", "Quick review · 10 min", "2 objectives due · Not mastered yet: 1 of 3 correct"]]);
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
