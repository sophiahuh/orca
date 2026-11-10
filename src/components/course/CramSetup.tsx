"use client";

import { useState } from "react";
import Link from "next/link";
import { DEFAULT_CONFIG, type Course, type Exam, type ExamScope, type Material, type MaterialType, type Objective } from "@/lib/data";
import { hoursFromDuration, perDayHours, remainingDays, weekdayName } from "@/lib/course/cram-page";
import { scopeFromSetup, splitByMaterials } from "@/lib/course/exam-card";
import { HOUR_STEP, budgetFromPerDay, isHalfHours, perDayOf } from "@/lib/mastery/cram-budget";
import { canFlagHard } from "@/lib/mastery/flags";
import type { CourseMastery } from "@/lib/mastery/course-mastery";
import { Button } from "@/components/ui/Button";
import { MultiSelect } from "@/components/ui/MultiSelect";
import { useOrca } from "@/lib/store";

/** The most a professor's quote holds (the connector's limit for a scope quote). */
const WORDS_MAX = 500;
const FIELD = "h-[40px] rounded-[12px] border-2 border-alice-deep bg-parchment px-[12px] text-[15px] font-semibold text-prussian focus:border-wisteria focus:outline-none";
/** Materials ticked by default: what the course teaches from. Exam files (held back) start unticked. */
const PICKED_TYPES: ReadonlySet<MaterialType> = new Set(["Lecture", "Handwritten notes", "Typed notes"]);

/** "Tue, Nov 11" for a YYYY-MM-DD day (pure date arithmetic, so the zone can't shift it). */
const dayLabel = (day: string) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
};
const hoursText = (h: number) => (Number.isInteger(h) ? `${h}` : `${Math.round(h * 10) / 10}`);
/** A field's text as hours: a whole number of half hours from 0, else null. */
const parseHours = (text: string): number | null => {
  if (text.trim() === "") return null;
  const n = Number(text);
  return isHalfHours(n) ? n : null;
};

/**
 * Cram setup (cram mode contract, section 6 and its per-day addendum), on the cram page: the
 * professor's words (saved as `professor` evidence on the scope), the files the exam covers (the
 * materials picked: objectives taught only elsewhere weigh 0), a link to add a practice exam held
 * back, the objectives the student worries about (a manual struggled flag each), and the hours
 * they can put in on each remaining day (half-hour steps, 0 for a day off; "Same for every day"
 * fills every row); the budget stores the days, with the total derived. Confirm sets the exam
 * cramming with its budget (`since` = now, kept with the past days' hours when the scope of a
 * running cram is edited).
 */
export function CramSetup({ exam, course, candidates, materials, catalogue, mastery, today, onDone, onCancel }: { exam: Exam; course: Course; candidates: readonly string[]; materials: readonly Material[]; catalogue: Readonly<Record<string, Objective>>; mastery: CourseMastery; today: string; onDone: () => void; onCancel: () => void }) {
  const { updateExam, flagObjectives, configs } = useOrca();
  const budget = exam.scope?.budget;
  const days = remainingDays(today, exam.date);
  // Starts from the quote already on the scope, so Edit scope shows what was said.
  const [words, setWords] = useState(() => exam.scope?.objectives.flatMap((o) => o.evidence).find((e) => e.signal === "professor" && e.quote)?.quote ?? "");
  const [picked, setPicked] = useState<string[]>(() => {
    const known = new Set(materials.map((m) => m.id));
    const stored = (exam.scope?.materialIds ?? []).filter((id) => known.has(id));
    return stored.length ? stored : materials.filter((m) => !m.heldBack && PICKED_TYPES.has(m.type)).map((m) => m.id);
  });
  const [worries, setWorries] = useState<string[]>([]);
  // The budget's hours by day (a budget saved before per-day budgets gets its spread); the past days' hours are kept as they were.
  const stored = budget ? perDayOf(budget, exam.date) : null;
  // What a day starts from when the budget doesn't name it: the course's exam review duration over the days left, else the budget's own average.
  const sameDefault = perDayHours(hoursFromDuration((configs[course.id] ?? DEFAULT_CONFIG).exam.duration), days.length);
  const [same, setSame] = useState(() => String(sameDefault));
  const [perDay, setPerDay] = useState<Record<string, string>>(() => Object.fromEntries(days.map((d) => [d, stored && d in stored ? hoursText(stored[d]) : String(sameDefault)])));
  const hoursByDay = days.map((d) => parseHours(perDay[d] ?? ""));
  const hoursOk = hoursByDay.every((h) => h !== null);
  const studyDays = days.filter((d, i) => (hoursByDay[i] ?? 0) > 0);
  const total = hoursOk ? hoursByDay.reduce((sum, h) => sum + (h ?? 0), 0) : 0;
  const fillAll = (text: string) => {
    setSame(text);
    if (parseHours(text) !== null) setPerDay(Object.fromEntries(days.map((d) => [d, text])));
  };

  const { inScope } = splitByMaterials(candidates, picked, catalogue);
  const options = candidates.map((id) => ({ id, name: catalogue[id]?.name ?? id }));
  const confirm = () => {
    if (!hoursOk) return;
    // A worry is a struggled flag (manual); one already being learned needs no second flag.
    const toFlag = worries.filter((id) => canFlagHard(mastery.objectives.get(id)?.status ?? "unseen"));
    if (toFlag.length) flagObjectives(course.id, toFlag);
    const scope: ExamScope = scopeFromSetup(exam.scope, candidates, words, picked, catalogue) ?? { objectives: [], sources: [] };
    // The days before today keep the hours they had (what the plan's "behind" compares with); the rest are the rows.
    const past = Object.fromEntries(Object.entries(stored ?? {}).filter(([d]) => d < today && d < exam.date));
    const entered = Object.fromEntries(days.map((d, i) => [d, hoursByDay[i] ?? 0]));
    updateExam(exam.id, {
      cramming: true,
      scope: { ...scope, budget: budgetFromPerDay({ ...past, ...entered }, exam.cramming && budget ? budget.since : new Date().toISOString()) },
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

      <fieldset className="flex flex-col gap-[6px]">
        <legend className="text-[15px] font-bold text-prussian">Which files does it cover?</legend>
        {materials.length ? (
          <ul className="flex max-h-[220px] flex-col gap-[4px] overflow-auto rounded-[12px] border-2 border-alice-deep bg-parchment px-[12px] py-[8px]" data-part="cram-materials">
            {materials.map((m) => {
              const on = picked.includes(m.id);
              return (
                <li key={m.id}>
                  <label className="flex cursor-pointer items-center gap-[8px] text-[14px] font-semibold text-prussian">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={(e) => setPicked((ids) => (e.target.checked ? [...ids, m.id] : ids.filter((x) => x !== m.id)))}
                      className="size-[14px] accent-wisteria"
                      data-part="cram-material"
                      data-id={m.id}
                    />
                    <span className="truncate">{m.filename}</span>
                    <span className="shrink-0 text-[12px] font-medium text-wisteria-deep">
                      {m.type}
                      {m.heldBack ? " · held back" : ""}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-[14px] font-medium text-wisteria-deep" data-part="cram-materials">
            No files in this course yet.
          </p>
        )}
        <p className="text-[14px] font-medium text-wisteria-deep" data-part="cram-scope-size">
          {picked.length
            ? `${inScope.length} of ${candidates.length} objective${candidates.length === 1 ? "" : "s"} in scope.`
            : `Nothing picked, so all ${candidates.length} objective${candidates.length === 1 ? "" : "s"} are in scope.`}
        </p>
      </fieldset>

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

      <fieldset className="flex flex-col gap-[6px]">
        <legend className="text-[15px] font-bold text-prussian">How much time each day?</legend>
        <p className="text-[13px] font-medium text-wisteria-deep">Hours in half-hour steps; 0 for a day off.</p>
        <label className="flex items-center gap-[8px] text-[13px] font-semibold text-wisteria-deep">
          <input type="number" min={0} max={24} step={HOUR_STEP} value={same} onChange={(e) => fillAll(e.target.value)} aria-label="Same for every day" data-part="cram-hours" className={`${FIELD} w-[88px]`} />
          Same for every day
        </label>
        {days.length > 0 && (
          <ul className="flex max-h-[240px] flex-col gap-[4px] overflow-auto rounded-[12px] border-2 border-alice-deep bg-parchment px-[12px] py-[8px]" data-part="cram-days">
            {days.map((day, i) => {
              const bad = hoursByDay[i] === null;
              return (
                <li key={day} className="flex items-center justify-between gap-[12px]" data-part="cram-day" data-day={day} data-today={day === today ? "1" : undefined}>
                  <span className={`text-[14px] font-semibold ${day === today ? "text-wisteria-deep" : "text-prussian"}`}>
                    {dayLabel(day)}
                    {day === today ? " · today" : ""}
                  </span>
                  <label className="flex items-center gap-[6px] text-[13px] font-semibold text-wisteria-deep">
                    <input
                      type="number"
                      min={0}
                      max={24}
                      step={HOUR_STEP}
                      value={perDay[day] ?? ""}
                      onChange={(e) => setPerDay((map) => ({ ...map, [day]: e.target.value }))}
                      aria-label={`Hours on ${dayLabel(day)}`}
                      aria-invalid={bad || undefined}
                      data-part="cram-day-hours"
                      className={`${FIELD} w-[88px] ${bad ? "border-bad-text" : ""}`}
                    />
                    h
                  </label>
                </li>
              );
            })}
          </ul>
        )}
        {!hoursOk && <span className="text-[13px] font-medium text-bad-text">Give each day a number of hours from 0 to 24, in half hours.</span>}
      </fieldset>

      <p className="text-[15px] font-semibold text-prussian" data-part="cram-hours-total">
        {days.length === 0
          ? "Exam day: no study days left."
          : !hoursOk
            ? `${days.length} day${days.length === 1 ? "" : "s"} before ${weekdayName(exam.date)}.`
            : studyDays.length === 0
              ? `Every day is off: 0 hours before ${weekdayName(exam.date)}.`
              : `${hoursText(total)} hour${total === 1 ? "" : "s"} before ${weekdayName(exam.date)}, ${studyDays.length} study day${studyDays.length === 1 ? "" : "s"}`}
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
