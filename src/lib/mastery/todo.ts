/** The sidebar's to-do cards for one course, from its agenda. Derived on every render, never stored. */
import type { ReviewConfig } from "../data.ts";
import type { CourseAgenda } from "./agenda.ts";
import { reasonsOf } from "./priority.ts";

export type TodoKind = "quick" | "deep" | "study" | "requiz" | "checks";

export interface TodoCard {
  id: string;
  courseId: string;
  kind: TodoKind;
  when: "today" | "tomorrow";
  title: string;
  /** A second line: size, or the top reason. */
  detail: string | null;
  /** The objective (study) or topic (checks) the card is about. */
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
    const top = agenda.dueToday[0];
    const reason = top ? reasonsOf(top.priority)[0] : undefined;
    cards.push({
      id: `${c}:quick`,
      courseId: c,
      kind: "quick",
      when: "today",
      title: `Quick review · ${config.quick.duration}`,
      detail: `${plural(agenda.dueToday.length, "objective")} due${reason ? ` · ${reason}` : ""}`,
      ref: null,
    });
  }
  if (agenda.deepReview.due) {
    cards.push({ id: `${c}:deep`, courseId: c, kind: "deep", when: "today", title: "Deep review", detail: `On your ${config.deep.cadence.toLowerCase()} cadence · you choose how long`, ref: null });
  }
  for (const item of agenda.study) {
    cards.push({ id: `${c}:study:${item.objectiveId}`, courseId: c, kind: "study", when: "today", title: `Review: ${names.objective(item.objectiveId)}`, detail: `${plural(item.missedQuestionIds.length, "missed question")} to go over`, ref: item.objectiveId });
  }
  for (const when of ["today", "tomorrow"] as const) {
    const items = agenda.study.filter((s) => s.requiz === when);
    if (items.length) {
      cards.push({ id: `${c}:requiz:${when}`, courseId: c, kind: "requiz", when, title: `Re-quiz · ${plural(items.length, "objective")}`, detail: items.map((s) => names.objective(s.objectiveId)).join(", "), ref: null });
    }
  }
  const byTopic = new Map<string, number>();
  for (const r of agenda.dueTomorrow) byTopic.set(r.topicId, (byTopic.get(r.topicId) ?? 0) + 1);
  for (const [topicId, n] of byTopic) {
    cards.push({ id: `${c}:checks:${topicId}`, courseId: c, kind: "checks", when: "tomorrow", title: `${names.topic(topicId)} · ${plural(n, "check")}`, detail: null, ref: topicId });
  }
  if (agenda.deepReview.tomorrow) {
    cards.push({ id: `${c}:deep:tomorrow`, courseId: c, kind: "deep", when: "tomorrow", title: "Deep review", detail: null, ref: null });
  }
  return cards;
}
