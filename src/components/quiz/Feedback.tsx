"use client";

import { motion } from "motion/react";
import type { QuizQuestion } from "@/lib/data";
import type { GradeResult } from "@/lib/grading";
import type { Outcome } from "@/lib/mastery/types";
import { DueCard } from "@/components/ui/DueCard";
import { cn } from "@/lib/cn";
import { fadeUp } from "@/lib/motion";

/**
 * Figma: Feedback (04a · Quiz — Feedback (wrong), 138:511; 04b correct): the Solution (the
 * explanation, the key for a prose answer, where it comes from in the material), Your mastery (the
 * objective, how the answer moved its number, when it comes back) and a Suggested review card.
 * The formula chip and the truth-table row note in the mockup need content the questions don't
 * carry yet, so they aren't drawn.
 */
export interface FeedbackProps {
  question: QuizQuestion;
  outcome: Outcome;
  /** A graded prose answer's feedback and self-mark state. */
  grade?: GradeResult | null;
  objectiveName: string;
  /** Display percents (src/lib/mastery/percent.ts) before and after this answer. */
  before: number;
  after: number;
  reviewLine: string;
  suggested?: { course: string; title: string; detail?: string | null; href: string; kind: string } | null;
}

function Divider() {
  return <div className="h-[2px] w-full bg-alice" />;
}

export function Feedback({ question: q, outcome, grade, objectiveName, before, after, reviewLine, suggested }: FeedbackProps) {
  const delta = after - before;
  const up = delta > 0;
  const down = delta < 0;
  const lo = Math.min(before, after);
  const hi = Math.max(before, after);
  return (
    <motion.section
      variants={fadeUp}
      initial="hidden"
      animate="show"
      exit="exit"
      data-part="feedback"
      aria-label="Feedback"
      className="mt-[24px] flex flex-col gap-[24px] rounded-[28px] border-2 border-alice-deep bg-card px-[32px] py-[28px] lip-5 lip-alice"
    >
      <div className="flex flex-col gap-[12px]">
        <h2 className="text-[24px] font-bold text-prussian">Solution</h2>
        {grade?.feedback && outcome !== "correct" && <p className="text-[18px] font-medium leading-[26px] text-prussian">{grade.feedback}</p>}
        <p className="text-[18px] font-medium leading-[26px] text-prussian">{q.explanation}</p>
        {q.kind === "Short answer" && q.rubric && outcome !== "correct" && (
          <p className="inline-flex max-w-full flex-wrap gap-x-[10px] self-start rounded-[12px] bg-alice px-[14px] py-[8px] text-[16px] font-semibold text-prussian" data-part="feedback-key">
            <span className="font-bold">Key</span>
            <span className="text-wisteria-deep">{q.rubric.requiredIdeas.join(" · ")}</span>
          </p>
        )}
        {q.anchor && (
          <p className="text-[14px] font-semibold text-[#3f58b5]" data-part="feedback-source">
            From {q.anchor.locator}
            {q.anchor.excerpt ? `: “${q.anchor.excerpt}”` : ""}
          </p>
        )}
      </div>

      <Divider />

      <div className="flex flex-col gap-[10px]" data-part="feedback-mastery">
        <span className="text-[12px] font-semibold uppercase tracking-[1.2px] text-wisteria-deep">Your mastery</span>
        <div className="flex items-center justify-between gap-[12px]">
          <span className="truncate text-[18px] font-bold text-prussian">{objectiveName}</span>
          <span
            data-part="mastery-delta"
            className={cn(
              "shrink-0 rounded-pill px-[10px] py-[3px] text-[15px] font-bold",
              up ? "bg-good-tint text-good-text" : down ? "bg-bad-tint text-bad-text" : "bg-alice text-prussian",
            )}
          >
            {up ? `+${delta}%` : down ? `−${-delta}%` : "±0%"}
          </span>
        </div>
        <div className="relative h-[14px] w-full overflow-hidden rounded-[7px] bg-alice" role="img" aria-label={`${before}% to ${after}% mastered`}>
          <div className="absolute inset-y-0 left-0 bg-wisteria" style={{ width: `${lo}%` }} />
          {hi > lo && (
            <div
              className={cn("absolute inset-y-0 border-[1.5px] border-dashed", up ? "border-good bg-good/35" : "border-bad bg-bad/35")}
              style={{ left: `${lo}%`, width: `${hi - lo}%` }}
            />
          )}
        </div>
        <p className="text-[15px] font-medium text-[#4a5578]">
          {before}% → {after}% mastered · {reviewLine}
        </p>
      </div>

      {suggested && (
        <>
          <Divider />
          <div className="flex flex-col gap-[10px]" data-part="feedback-suggested">
            <span className="text-[12px] font-semibold uppercase tracking-[1.2px] text-wisteria-deep">Suggested review</span>
            <DueCard course={suggested.course} title={suggested.title} detail={suggested.detail} href={suggested.href} kind={suggested.kind} />
          </div>
        </>
      )}
    </motion.section>
  );
}
