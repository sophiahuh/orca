"use client";

import { useState } from "react";
import Link from "next/link";
import { DEFAULT_CONFIG, type Course, type Exam, type ExamScope, type Objective } from "@/lib/data";
import { hoursFromDuration, remainingDays } from "@/lib/course/cram-page";
import { scopeFromSetup } from "@/lib/course/exam-card";
import { canFlagHard } from "@/lib/mastery/flags";
import type { CourseMastery } from "@/lib/mastery/course-mastery";
import { Button } from "@/components/ui/Button";
import { MultiSelect } from "@/components/ui/MultiSelect";
import { useOrca } from "@/lib/store";

/** The most a professor's quote holds (the connector's limit for a scope quote). */
const WORDS_MAX = 500;
const FIELD = "h-[40px] rounded-[12px] border-2 border-alice-deep bg-parchment px-[12px] text-[15px] font-semibold text-prussian focus:border-wisteria focus:outline-none";

/** "Tue, Nov 11" for a YYYY-MM-DD day (pure date arithmetic, so the zone can't shift it). */
const dayLabel = (day: string) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
};

/**
 * Cram setup (cram mode contract, section 6), on the cram page: the professor's words (saved as
 * `professor` evidence on the scope), a link to add a practice exam held back, the objectives the
 * student worries about (a manual struggled flag each), the hours they can put in and the days
 * they're out; Confirm sets the exam cramming with its budget (`since` = now, kept when the scope
 * of a running cram is edited).
 */
export function CramSetup({ exam, course, covered, catalogue, mastery, today, onDone, onCancel }: { exam: Exam; course: Course; covered: readonly string[]; catalogue: Readonly<Record<string, Objective>>; mastery: CourseMastery; today: string; onDone: () => void; onCancel: () => void }) {
  const { updateExam, flagObjectives, configs } = useOrca();
  const budget = exam.scope?.budget;
  const days = remainingDays(today, exam.date);
  // Starts from the quote already on the scope, so Edit scope shows what was said.
  const [words, setWords] = useState(() => exam.scope?.objectives.flatMap((o) => o.evidence).find((e) => e.signal === "professor" && e.quote)?.quote ?? "");
  const [worries, setWorries] = useState<string[]>([]);
  const [hours, setHours] = useState(() => String(budget?.hours ?? hoursFromDuration((configs[course.id] ?? DEFAULT_CONFIG).exam.duration)));
  const [daysOut, setDaysOut] = useState<string[]>(() => (budget?.daysOut ?? []).filter((d) => days.includes(d)));
  const hoursValue = Number(hours);
  const hoursOk = hours.trim() !== "" && Number.isFinite(hoursValue) && hoursValue > 0;

  const options = covered.map((id) => ({ id, name: catalogue[id]?.name ?? id }));
  const confirm = () => {
    if (!hoursOk) return;
    // A worry is a struggled flag (manual); one already being learned needs no second flag.
    const toFlag = worries.filter((id) => canFlagHard(mastery.objectives.get(id)?.status ?? "unseen"));
    if (toFlag.length) flagObjectives(course.id, toFlag);
    const scope: ExamScope = scopeFromSetup(exam.scope, covered, words) ?? { objectives: [], sources: [] };
    updateExam(exam.id, {
      cramming: true,
      scope: { ...scope, budget: { hours: hoursValue, daysOut: [...daysOut].sort(), since: exam.cramming && budget ? budget.since : new Date().toISOString() } },
    });
    onDone();
  };

  return (
    <div className="flex flex-col gap-[16px]" data-part="cram-setup">
      <div className="flex flex-col gap-[6px]">
        <h2 className="text-[28px] font-semibold text-prussian">Cram for {exam.title}</h2>
        <p className="text-[15px] font-medium text-wisteria-deep">Tell Orca what the exam covers and how much time you have. Claude teaches from it, and Orca keeps score.</p>
      </div>

      <label className="flex flex-col gap-[6px]">
        <span className="text-[15px] font-bold text-prussian">What did your professor say about it?</span>
        <textarea
          value={words}
          onChange={(e) => setWords(e.target.value)}
          maxLength={WORDS_MAX}
          rows={3}
          placeholder="e.g. Chapters 3 to 5, no proofs, one design problem."
          data-part="professor-words"
          className="min-h-[88px] w-full resize-y rounded-[16px] border-2 border-alice-deep bg-parchment px-[16px] py-[12px] text-[16px] text-prussian outline-none focus:border-wisteria"
        />
      </label>

      <p className="text-[15px] font-medium text-prussian">
        Have a practice exam or a study guide?{" "}
        <Link href={`/add-material?course=${course.slug}&type=Practice%20exam&holdBack=1`} data-part="cram-add-material" className="font-bold text-wisteria-deep underline">
          Add material
        </Link>
        <span className="text-wisteria-deep"> (kept hidden for a practice test)</span>
      </p>

      <div className="flex flex-col gap-[6px]">
        <span className="text-[15px] font-bold text-prussian">Anything you&apos;re worried about?</span>
        {options.length ? (
          <MultiSelect
            options={options}
            chosen={worries}
            onToggle={(id) => setWorries((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]))}
            label="Objectives you're worried about"
            noun="objective"
            className="w-[320px] max-w-full"
          />
        ) : (
          <p className="text-[14px] font-medium text-wisteria-deep">This exam has no objectives in scope yet.</p>
        )}
      </div>

      <label className="flex flex-col gap-[6px]">
        <span className="text-[15px] font-bold text-prussian">How many hours can you put in before the exam?</span>
        <input type="number" min={0.5} step={0.5} value={hours} onChange={(e) => setHours(e.target.value)} aria-label="Hours before the exam" data-part="cram-hours" className={`${FIELD} w-[120px]`} />
        {!hoursOk && <span className="text-[13px] font-medium text-bad-text">Give a number of hours above 0.</span>}
      </label>

      {days.length > 0 && (
        <fieldset className="flex flex-col gap-[6px]">
          <legend className="text-[15px] font-bold text-prussian">Any days you can&apos;t study?</legend>
          <div className="flex flex-wrap gap-[8px]" data-part="cram-days-out">
            {days.map((day) => {
              const out = daysOut.includes(day);
              return (
                <label key={day} className={`flex cursor-pointer items-center gap-[6px] rounded-pill px-[12px] py-[6px] text-[13px] font-bold ring-2 ring-inset ${out ? "bg-alice text-prussian ring-alice-deep" : "bg-parchment text-prussian ring-alice-deep"}`}>
                  <input
                    type="checkbox"
                    checked={out}
                    onChange={(e) => setDaysOut((list) => (e.target.checked ? [...list, day] : list.filter((d) => d !== day)))}
                    className="size-[14px] accent-wisteria"
                    data-part="cram-day-out"
                    data-day={day}
                  />
                  {dayLabel(day)}
                </label>
              );
            })}
          </div>
        </fieldset>
      )}

      <p className="text-[14px] font-medium text-wisteria-deep" data-part="cram-scope-size">
        {covered.length} objective{covered.length === 1 ? "" : "s"} in scope.
      </p>

      <div className="flex items-center justify-end gap-[10px] border-t-2 border-alice-deep pt-[16px]">
        <Button size="sm" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" onClick={confirm} disabled={!hoursOk} data-part="cram-confirm">
          Confirm
        </Button>
      </div>
    </div>
  );
}
