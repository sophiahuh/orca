"use client";

import { use, useState } from "react";
import Link from "next/link";
import { motion } from "motion/react";
import { cardExam, daysUntil, examObjectives } from "@/lib/course/exam-card";
import type { CramPlan, CramPlanInput } from "@/lib/mastery/cram-plan";
import type { ObjectiveStatus } from "@/lib/mastery/types";
import { useCourse, useDayKey, useMasteryByCourse, useOrca } from "@/lib/store";
import { useNow } from "@/hooks/useNow";
import { Screen } from "@/components/layout/Screen";
import { BackButton } from "@/components/layout/BackButton";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { CramSetup } from "@/components/course/CramSetup";
import { useConnectorStatus, useCramPlan } from "@/components/course/useCram";
import { MASTERY_LABEL } from "@/components/review/parts";
import { fadeUp, stagger } from "@/lib/motion";

const PILL = "pressable rounded-pill bg-parchment px-[12px] py-[6px] text-[13px] font-bold text-prussian ring-2 ring-inset ring-alice-deep lip-2 lip-alice";

const daysText = (days: number) => (days === 0 ? "Exam day" : days === 1 ? "Tomorrow" : days > 1 ? `${days} days left` : days === -1 ? "Yesterday" : `${-days} days ago`);
const hoursText = (h: number) => (Number.isInteger(h) ? `${h}` : (Math.round(h * 10) / 10).toFixed(1));
const minutesText = (m: number) => `${Math.round(m)} min`;

/**
 * The cram page (cram mode contract, section 6): setup (the professor's words, Add material held
 * back, worries, hours and days out) until the exam is cramming with a budget, then the plan: days
 * left, the budget, the line, the scope as topic rows with weak spots, today, the practice test,
 * the vault, Study with Claude, Edit scope and Stop cramming. The plan is computed here from the
 * store; nothing about it is stored.
 */
export default function CramPage({ params, searchParams }: PageProps<"/course/[slug]/cram">) {
  const { slug } = use(params);
  const sp = use(searchParams);
  const { hydrated, exams, objectives, materials, updateExam } = useOrca();
  const course = useCourse(slug);
  const mastery = useMasteryByCourse();
  const dayKey = useDayKey();
  const nowMs = useNow();
  // Edit scope (here or on the card, `?edit=1`) reopens the setup prefilled.
  const [editing, setEditing] = useState(sp.edit === "1");
  const today = dayKey(new Date(nowMs).toISOString());
  const exam = course ? cardExam(exams, course.id, today) : null;
  const m = course ? mastery[course.id] : undefined;
  const planned = useCramPlan(course, exam, m);
  const connected = useConnectorStatus(Boolean(exam?.cramming));

  if (!course || !m) {
    return (
      <Screen bg="ocean">
        <header className="px-[24px] pt-[20px]">
          <BackButton />
        </header>
        {hydrated && <p className="p-[32px] text-[22px] font-bold text-prussian">We couldn&apos;t find that course.</p>}
      </Screen>
    );
  }
  if (!exam) {
    return (
      <Screen bg="ocean">
        <header className="flex items-center gap-[12px] px-[24px] pt-[20px]">
          <BackButton href={`/course/${course.slug}`} />
          <h1 className="text-[40px] font-bold leading-none text-prussian">{course.name}</h1>
        </header>
        <p className="p-[32px] text-[22px] font-bold text-prussian" data-part="cram-no-exam">
          No upcoming exam. Add one with Edit Exams on the course page.
        </p>
      </Screen>
    );
  }

  const catalogue = objectives[course.id] ?? {};
  const covered = examObjectives(exam, course.topics, catalogue);
  const days = daysUntil(exam.date, today);
  const cramming = exam.cramming && planned !== null && !editing;
  const vault = materials.filter((mat) => mat.courseId === course.id && mat.heldBack);

  return (
    <Screen bg="ocean" className="overflow-auto">
      <header className="flex items-center gap-[12px] px-[24px] pt-[20px]">
        <BackButton href={`/course/${course.slug}`} />
        <div>
          <h1 className="text-[40px] font-bold leading-none text-prussian">
            {cramming ? "Cramming for " : "Cram for "}
            {exam.title}
          </h1>
          <p className="mt-[5px] text-[14px] font-medium text-wisteria-deep">
            {course.name} · {daysText(days)}
          </p>
        </div>
      </header>

      <motion.div variants={stagger(0.05, 0.08)} initial="hidden" animate="show" className="flex items-start gap-[12px] px-[24px] pb-[28px] pt-[20px]" data-part="cram-page" data-cramming={exam.cramming ? "1" : undefined}>
        {cramming ? (
          <CrammingView course={course} exam={exam} plan={planned.plan} topics={planned.topics} spentMinutes={planned.spentMinutes} objectiveName={(id) => catalogue[id]?.name ?? id} vault={vault.map((v) => v.filename)} connected={connected} onEdit={() => setEditing(true)} onStop={() => updateExam(exam.id, { cramming: false })} />
        ) : (
          <motion.div variants={fadeUp} className="w-[600px]">
            <Card className="px-[28px] pb-[24px] pt-[24px]">
              {/* Mounted fresh per exam, so its fields start from the exam as it is then. */}
              <CramSetup key={exam.id} exam={exam} course={course} covered={covered} catalogue={catalogue} mastery={m} today={today} onDone={() => setEditing(false)} onCancel={() => setEditing(false)} />
              {exam.cramming && !planned && <p className="mt-[12px] text-[13px] font-medium text-wisteria-deep">Cramming already, with no time budget yet: confirm to set one.</p>}
            </Card>
          </motion.div>
        )}
      </motion.div>
    </Screen>
  );
}

const isVerified = (s: ObjectiveStatus) => s === "verified" || s === "mastered";

function CrammingView({ course, exam, plan, topics, spentMinutes, objectiveName, vault, connected, onEdit, onStop }: { course: { slug: string }; exam: { title: string; scope: { budget?: { hours: number } } | null }; plan: CramPlan; topics: CramPlanInput["topics"]; spentMinutes: number; objectiveName: (id: string) => string; vault: string[]; connected: boolean | null; onEdit: () => void; onStop: () => void }) {
  const hours = exam.scope?.budget?.hours ?? 0;
  const topicName = new Map(plan.topics.map((t) => [t.id, t.name]));
  // Per topic: its in-scope objectives (weight > 0), how many are verified, and each one's status.
  const scoped = new Map(topics.map((t) => [t.id, t.objectives.filter((o) => o.weight > 0)]));
  const statusOf = new Map(topics.flatMap((t) => t.objectives.map((o) => [o.id, o.status] as const)));
  return (
    <>
      <div className="flex w-[600px] flex-col gap-[12px]">
        <motion.div variants={fadeUp}>
          <Card className="flex flex-col gap-[10px] px-[24px] pb-[20px] pt-[20px]">
            <p className="eyebrow text-[13px] text-wisteria-deep">Your time</p>
            <p className="text-[22px] font-bold text-prussian" data-part="cram-budget">
              {hoursText(plan.hoursLeft)} hours left of {hoursText(hours)}
              {plan.behindMinutes > 0 && <span className="text-wisteria-deep"> · {plan.behindMinutes} minutes behind</span>}
            </p>
            <p className="text-[13px] font-medium text-wisteria-deep">
              {minutesText(spentMinutes)} studied in Orca since you started · {plan.studyDays.length} study day{plan.studyDays.length === 1 ? "" : "s"} left
              {plan.minutesPerDay > 0 ? ` · about ${minutesText(plan.minutesPerDay)} a day` : ""}
            </p>
            <p className="text-[16px] font-semibold text-prussian" data-part="cram-plan">
              {plan.line}
            </p>
          </Card>
        </motion.div>

        <motion.div variants={fadeUp}>
          <Card className="flex flex-col gap-[14px] px-[24px] pb-[20px] pt-[20px]">
            <div className="flex items-baseline justify-between">
              <h2 className="text-[22px] font-bold text-prussian">The scope</h2>
              <p className="text-[14px] font-medium text-wisteria-deep" data-part="cram-verified">
                {plan.verified.done} of {plan.verified.total} verified
              </p>
            </div>
            {plan.topics.length === 0 && <p className="text-[14px] font-medium text-wisteria-deep">This exam has no objectives in scope yet.</p>}
            <ul className="flex flex-col gap-[12px]">
              {plan.topics.map((t) => {
                const inScope = scoped.get(t.id) ?? [];
                const verified = inScope.filter((o) => isVerified(o.status)).length;
                return (
                  <li key={t.id} className="flex flex-col gap-[6px] rounded-[16px] border-2 border-alice-deep px-[16px] py-[12px]" data-part="cram-topic" data-topic={t.id} data-done={t.done ? "1" : undefined}>
                    <div className="flex items-center justify-between gap-[12px]">
                      <p className="text-[17px] font-bold text-prussian">{t.name}</p>
                      <p className="text-[14px] font-semibold text-wisteria-deep" data-part="cram-topic-minutes">
                        {t.done ? "Done" : t.minutesToday > 0 ? `${t.minutesToday} min today` : "Not today"}
                      </p>
                    </div>
                    <div className="flex items-center gap-[10px]">
                      <ProgressBar value={inScope.length ? verified / inScope.length : 0} height={10} label={`${t.name} verified`} className="flex-1" />
                      <span className="shrink-0 text-[13px] font-semibold text-wisteria-deep" data-part="cram-topic-verified">
                        {verified}/{inScope.length} verified
                      </span>
                    </div>
                    {t.weakSpots.length > 0 && (
                      <ul className="flex flex-col gap-[2px]" data-part="cram-weak-spots">
                        {t.weakSpots.map((id) => (
                          <li key={id} className="text-[13px] font-medium text-prussian" data-part="cram-weak-spot" data-objective={id}>
                            {objectiveName(id)} <span className="text-wisteria-deep">· {MASTERY_LABEL[statusOf.get(id) ?? "unseen"]}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          </Card>
        </motion.div>
      </div>

      <div className="flex w-[360px] flex-col gap-[12px]">
        <motion.div variants={fadeUp}>
          <Card className="flex flex-col gap-[8px] px-[24px] pb-[18px] pt-[18px]" data-part="cram-today">
            <h2 className="text-[20px] font-bold text-prussian">Today</h2>
            {plan.daysLeft === 0 ? (
              <p className="text-[14px] font-medium text-wisteria-deep">Light review only, nothing new.</p>
            ) : plan.today.length === 0 ? (
              <p className="text-[14px] font-medium text-wisteria-deep">Nothing planned today.</p>
            ) : (
              <ul className="flex flex-col gap-[4px]">
                {plan.today.map((t) => (
                  <li key={t.topicId} className="flex justify-between text-[15px] font-semibold text-prussian" data-part="cram-today-topic" data-topic={t.topicId}>
                    <span>{topicName.get(t.topicId) ?? t.topicId}</span>
                    <span className="text-wisteria-deep">{t.minutes} min</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </motion.div>

        <motion.div variants={fadeUp}>
          <Card className="flex flex-col gap-[8px] px-[24px] pb-[18px] pt-[18px]" data-part="cram-mock">
            <h2 className="text-[20px] font-bold text-prussian">Practice test</h2>
            <p className="text-[14px] font-medium text-wisteria-deep">No practice test yet</p>
          </Card>
        </motion.div>

        <motion.div variants={fadeUp}>
          <Card className="flex flex-col gap-[8px] px-[24px] pb-[18px] pt-[18px]" data-part="cram-vault">
            <h2 className="text-[20px] font-bold text-prussian">Held back</h2>
            {vault.length ? (
              <ul className="flex flex-col gap-[2px]">
                {vault.map((name) => (
                  <li key={name} className="text-[14px] font-medium text-prussian" data-part="cram-vault-item">
                    {name}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[14px] font-medium text-wisteria-deep">Nothing held back yet.</p>
            )}
            <Link href={`/add-material?course=${course.slug}&type=Practice%20exam&holdBack=1`} data-part="cram-add-material" className="text-[13px] font-bold text-wisteria-deep underline">
              Add a practice exam
            </Link>
          </Card>
        </motion.div>

        <motion.div variants={fadeUp} className="flex flex-wrap items-center gap-[8px]">
          {connected ? (
            <span className="text-[13px] font-medium text-prussian" data-part="study-with-claude">
              Study with Claude: it has this exam&apos;s scope.
            </span>
          ) : (
            <Link href="/settings#connector" data-part="study-with-claude" className={PILL}>
              Study with Claude
            </Link>
          )}
          <button type="button" onClick={onEdit} data-part="cram-edit" className={PILL}>
            Edit scope
          </button>
          <Button size="xs" variant="secondary" onClick={onStop} data-part="cram-stop">
            Stop cramming
          </Button>
        </motion.div>
      </div>
    </>
  );
}

