/**
 * Multiple-choice options in a random order each time a question is asked (owner, 2026-10-18): the
 * model writing questions tends to put the right answer first (A in 31% of 409 questions, D in 17%),
 * so the position gives it away. Only the order shown changes; the answer index follows its option.
 * True/false keeps True before False, and a question with an option like "all of the above" (which
 * only makes sense in its place) keeps its order. Pure; `random` is injected for tests.
 */
import type { QuizQuestion } from "./data.ts";

export function shuffleChoices(q: QuizQuestion, random: () => number = Math.random): QuizQuestion {
  if (q.kind !== "Multiple choice" || q.options.length < 2 || q.answer < 0 || q.answer >= q.options.length) return q;
  if (q.options.some((o) => /\b(all|none|both|neither) of the (above|others)\b/i.test(o))) return q;
  const order = q.options.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return { ...q, options: order.map((i) => q.options[i]), answer: order.indexOf(q.answer) };
}
