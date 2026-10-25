/** The sidebar's to-do cards for one course, from its agenda. Derived on every render, never stored. */
import type { ReviewConfig } from "../data.ts";
import type { CourseAgenda } from "./agenda.ts";

export type TodoKind = "quick" | "deep" | "checks";

export interface TodoCard {
  id: string;
  courseId: string;
  kind: TodoKind;
  when: "today" | "tomorrow";
  title: string;
  /** A second line: how much is due. */
  detail: string | null;
  /** The topic (checks) the card is about. */
  ref: string | null;
}

export interface TodoNames {
  objective: (id: string) => string;
  topic: (id: string) => string;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function todoCards(agenda: CourseAgenda, config: ReviewConfig, names: TodoNames): TodoCard[] {
  const c = agenda.courseId;
  const cards: TodoCard[] = [];
  if (agenda.quickReviewDue) {
    cards.push({
      id: `${c}:quick`,
      courseId: c,
      kind: "quick",
      when: "today",
      title: `Quick review · ${config.quick.duration}`,
      detail: `${plural(agenda.dueToday.length, "objective")} due`,
      ref: null,
    });
  }
  if (agenda.deepReview.due) {
    cards.push({ id: `${c}:deep`, courseId: c, kind: "deep", when: "today", title: "Dive in", detail: null, ref: null });
  }
  const byTopic = new Map<string, number>();
  for (const r of agenda.dueTomorrow) byTopic.set(r.topicId, (byTopic.get(r.topicId) ?? 0) + 1);
  for (const [topicId, n] of byTopic) {
    cards.push({ id: `${c}:checks:${topicId}`, courseId: c, kind: "checks", when: "tomorrow", title: `${names.topic(topicId)} · ${plural(n, "check")}`, detail: null, ref: topicId });
  }
  if (agenda.deepReview.tomorrow) {
    cards.push({ id: `${c}:deep:tomorrow`, courseId: c, kind: "deep", when: "tomorrow", title: "Dive in", detail: null, ref: null });
  }
  return cards;
}
