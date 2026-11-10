/** The sidebar's to-do cards for one course, from its agenda. Derived on every render, never stored. */
import type { ReviewConfig } from "../data.ts";
import type { CourseAgenda } from "./agenda.ts";

export type TodoKind = "quick" | "deep" | "checks" | "warmup";

export interface TodoCard {
  id: string;
  courseId: string;
  kind: TodoKind;
  when: "today" | "tomorrow";
  title: string;
  /** A second line: how many objectives the quick review covers. */
  detail: string | null;
  /** The topic (checks) the card is about. */
  ref: string | null;
}

export interface TodoNames {
  objective: (id: string) => string;
  topic: (id: string) => string;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * `covered`: how many of today's due objectives the quick review's time budget fits (the session
 * plans the same way); required when a quick review is due. `coveredTomorrow`: the same for the
 * next quick review when it's tomorrow (`upNext`); required then. Tomorrow's card can be started
 * early (owner, 2026-11-07). `warmUp`: how many questions a warm-up would ask (0: none), for a
 * course with nothing flagged yet (owner, 2026-11-08).
 */
export function todoCards(agenda: CourseAgenda, config: ReviewConfig, names: TodoNames, covered?: number, coveredTomorrow?: number, warmUp = 0): TodoCard[] {
  const c = agenda.courseId;
  const cards: TodoCard[] = [];
  // Nothing flagged yet, but questions to try (src/lib/mastery/warmup.ts): the first thing to do in a new course.
  if (warmUp > 0 && !agenda.quickReviewDue && agenda.dueToday.length === 0) {
    cards.push({ id: `${c}:warmup`, courseId: c, kind: "warmup", when: "today", title: "Warm-up · 5 min", detail: `Try ${plural(warmUp, "question")}`, ref: null });
  }
  if (agenda.quickReviewDue) {
    if (covered === undefined) throw new Error(`Quick review due in course ${c} without its planned size`);
  }
  // A due weak point whose questions are all dive-only or thumbed down has nothing a quick review can ask yet.
  if (agenda.quickReviewDue && covered !== undefined && covered > 0) {
    cards.push({
      id: `${c}:quick`,
      courseId: c,
      kind: "quick",
      when: "today",
      title: `Quick review · ${config.quick.duration}`,
      detail: `Covers ${plural(covered, "objective")}`,
      ref: null,
    });
  }
  if (agenda.deepReview.due) {
    cards.push({ id: `${c}:deep`, courseId: c, kind: "deep", when: "today", title: "Dive in", detail: null, ref: null });
  }
  if (agenda.quickTomorrow) {
    if (coveredTomorrow === undefined) throw new Error(`Quick review due tomorrow in course ${c} without its planned size`);
    if (coveredTomorrow > 0) {
      cards.push({ id: `${c}:quick:tomorrow`, courseId: c, kind: "quick", when: "tomorrow", title: `Quick review · ${config.quick.duration}`, detail: `Covers ${plural(coveredTomorrow, "objective")} · start early anytime`, ref: null });
    }
  }
  const byTopic = new Map<string, number>();
  for (const r of agenda.quickReviewEnabled ? agenda.dueTomorrow : []) byTopic.set(r.topicId, (byTopic.get(r.topicId) ?? 0) + 1);
  for (const [topicId, n] of byTopic) {
    cards.push({ id: `${c}:checks:${topicId}`, courseId: c, kind: "checks", when: "tomorrow", title: `${names.topic(topicId)} · ${plural(n, "check")}`, detail: null, ref: topicId });
  }
  if (agenda.deepReview.tomorrow) {
    cards.push({ id: `${c}:deep:tomorrow`, courseId: c, kind: "deep", when: "tomorrow", title: "Dive in", detail: null, ref: null });
  }
  return cards;
}
