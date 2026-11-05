"use client";

import Link from "next/link";
import { motion } from "motion/react";
import type { Course } from "@/lib/data";
import { examInWindow } from "@/lib/mastery/agenda";
import { diveObjectives } from "@/lib/mastery/practice";
import { fadeUp } from "@/lib/motion";
import { useNow } from "@/hooks/useNow";
import { useAgenda, useDayKey, useOrca } from "@/lib/store";

export const FOCUS_COPY = "Orca focuses on what you flag: star things in your notes, study with Claude, or tap the slides that were hard.";

/**
 * The caught-up card's props for a course, or null when it isn't caught up: something is due today
 * (by the agenda, whether or not the cadence asks for a review today), or the course has nothing to
 * practise at all yet (no objectives with questions).
 */
export function useCaughtUp(course: Course): { canPractise: boolean; examTopics: boolean } | null {
  const agenda = useAgenda()[course.id];
  const { exams } = useOrca();
  const dayKey = useDayKey();
  const nowMs = useNow();
  if (!agenda || agenda.ranked.length === 0 || agenda.dueToday.length > 0) return null;
  const exam = examInWindow(exams, course.id, dayKey(new Date(nowMs).toISOString()));
  return {
    canPractise: diveObjectives(agenda.ranked, "practice").length > 0,
    // Only an exam that names its topics gets its own button (otherwise it's the same as Practice other topics).
    examTopics: !!exam?.topicIds.length && diveObjectives(agenda.ranked, "exam", { examTopicIds: exam.topicIds }).length > 0,
  };
}

/**
 * Nothing due in a course: "You're caught up", with optional practice (a dive over objectives nobody
 * flagged) and, in an exam's week, practice on that exam's topics.
 */
export function CaughtUp({ course, canPractise, examTopics }: { course: Course; canPractise: boolean; examTopics: boolean }) {
  return (
    <motion.div variants={fadeUp} data-part="caught-up" className="flex flex-col gap-[10px] rounded-[20px] bg-alice px-[18px] py-[16px] lip-4 lip-alice">
      <p className="text-[17px] font-bold text-prussian">You&apos;re caught up</p>
      <p className="text-[14px] text-wisteria-deep">{FOCUS_COPY}</p>
      {canPractise ? (
        <div className="flex flex-wrap gap-[8px]">
          <Link href={`/session/${course.slug}?kind=deep&scope=practice`} data-part="practice-other" className="pressable rounded-pill bg-prussian px-[14px] py-[7px] text-[13px] font-bold text-parchment lip-2 lip-ink">
            Practice other topics
          </Link>
          {examTopics && (
            <Link
              href={`/session/${course.slug}?kind=deep&scope=exam`}
              data-part="practice-exam"
              className="pressable rounded-pill bg-parchment px-[14px] py-[7px] text-[13px] font-bold text-prussian ring-2 ring-inset ring-alice-deep lip-2 lip-alice"
            >
              Practice exam topics
            </Link>
          )}
        </div>
      ) : (
        <p className="text-[14px] font-semibold text-prussian">You&apos;ve practised everything here</p>
      )}
    </motion.div>
  );
}
