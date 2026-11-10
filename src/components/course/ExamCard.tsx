"use client";

import Link from "next/link";
import { motion } from "motion/react";
import type { Course } from "@/lib/data";
import { cardExam, daysUntil, examObjectives } from "@/lib/course/exam-card";
import type { CourseMastery } from "@/lib/mastery/course-mastery";
import { Card } from "@/components/ui/Card";
import { useConnectorStatus, useCramPlan } from "@/components/course/useCram";
import { useDayKey, useOrca } from "@/lib/store";
import { useNow } from "@/hooks/useNow";
import { fadeUp } from "@/lib/motion";

const PILL = "pressable rounded-pill bg-parchment px-[12px] py-[6px] text-[13px] font-bold text-prussian ring-2 ring-inset ring-alice-deep lip-2 lip-alice";
/** Button/Primary, size sm, as a link. */
const PRIMARY = "pressable inline-flex items-center justify-center rounded-[20px] bg-wisteria px-5 py-3 text-[15px] font-bold leading-none text-parchment lip-5 lip-wisteria";

const daysText = (days: number) => (days === 0 ? "Today" : days === 1 ? "Tomorrow" : days > 1 ? `${days} days left` : days === -1 ? "Yesterday" : `${-days} days ago`);
const sourceName: Record<string, string> = {
  "practice-exam": "the practice exam",
  professor: "your professor's words",
  "study-guide": "the study guide",
  homework: "homework",
  "lecture-emphasis": "lecture emphasis",
  guess: "a guess",
};

/**
 * The course page's exam card (contract sections 5 and 6): the soonest upcoming exam (the one being
 * crammed for first), days left, how much of its scope is verified, and Cram for this exam, which
 * goes to the cram page's setup. While cramming: the plan line (to the page), Study with Claude,
 * Edit scope, Stop cramming.
 */
export function ExamCard({ course, mastery }: { course: Course; mastery: CourseMastery }) {
  const { exams, objectives, updateExam } = useOrca();
  const dayKey = useDayKey();
  const nowMs = useNow();
  const today = dayKey(new Date(nowMs).toISOString());
  const exam = cardExam(exams, course.id, today);
  const connected = useConnectorStatus(Boolean(exam?.cramming));
  const planned = useCramPlan(course, exam, mastery);
  if (!exam) return null;
  const catalogue = objectives[course.id] ?? {};
  const covered = examObjectives(exam, course.topics, catalogue);
  const verified = covered.filter((id) => {
    const status = mastery.objectives.get(id)?.status;
    return status === "verified" || status === "mastered";
  }).length;
  const share = covered.length ? Math.round((verified / covered.length) * 100) : 0;
  const days = daysUntil(exam.date, today);
  const from = exam.scope?.sources.length ? exam.scope.sources.map((s) => sourceName[s] ?? s) : [];
  const page = `/course/${course.slug}/cram`;

  return (
    <motion.div variants={fadeUp} initial="hidden" animate="show">
      <Card radius={24} lip={6} className="flex w-[300px] flex-col gap-[6px] px-[20px] pb-[16px] pt-[14px]" data-part="exam-card" data-cramming={exam.cramming ? "1" : undefined}>
        <p className="eyebrow text-[13px] text-wisteria-deep">{exam.cramming ? "Cramming" : "Next exam"}</p>
        <h2 className="text-[22px] font-bold leading-tight text-prussian">{exam.title}</h2>
        <p className="text-[15px] font-semibold text-prussian" data-part="exam-days">
          {daysText(days)}
        </p>
        <p className="text-[14px] font-medium text-wisteria-deep" data-part="exam-scope">
          {covered.length} objective{covered.length === 1 ? "" : "s"} in scope · {share}% verified
        </p>
        {from.length > 0 && <p className="text-[13px] font-medium text-wisteria-deep">Scope from {from.join(" and ")}.</p>}
        {exam.cramming ? (
          <>
            {/* The plan line, or, when cramming was set without a budget (set_exam, the Exams modal), the way to one. */}
            <Link href={page} data-part="cram-plan" className="mt-[4px] text-[15px] font-semibold text-prussian underline decoration-alice-deep underline-offset-4">
              {planned ? planned.plan.line : "No time budget yet: open the plan to set one."}
            </Link>
            <div className="mt-[4px] flex flex-wrap items-center gap-[8px]">
              {connected ? (
                <span className="text-[13px] font-medium text-wisteria-deep" data-part="study-with-claude">
                  Study with Claude: it has this exam&apos;s scope.
                </span>
              ) : (
                <Link href="/settings#connector" data-part="study-with-claude" className={PILL}>
                  Study with Claude
                </Link>
              )}
              <Link href={`${page}?edit=1`} data-part="cram-edit" className={PILL}>
                Edit scope
              </Link>
              <button type="button" onClick={() => updateExam(exam.id, { cramming: false })} data-part="cram-stop" className={PILL}>
                Stop cramming
              </button>
            </div>
          </>
        ) : (
          <Link href={page} data-part="cram-start" className={`${PRIMARY} mt-[6px] self-start`}>
            Cram for this exam
          </Link>
        )}
      </Card>
    </motion.div>
  );
}
