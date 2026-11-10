"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import type { Course, Exam, Objective } from "@/lib/data";
import { cardExam, daysUntil, examObjectives, scopeFromSetup } from "@/lib/course/exam-card";
import { canFlagHard } from "@/lib/mastery/flags";
import type { CourseMastery } from "@/lib/mastery/course-mastery";
import { IconClose } from "@/components/icons";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { MultiSelect } from "@/components/ui/MultiSelect";
import { RoundButton } from "@/components/ui/RoundButton";
import { useDayKey, useOrca } from "@/lib/store";
import { useNow } from "@/hooks/useNow";
import { fadeUp, overlayFade, popIn } from "@/lib/motion";

/** The most a professor's quote holds (the connector's limit for a scope quote). */
const WORDS_MAX = 500;
const PILL = "pressable rounded-pill bg-parchment px-[12px] py-[6px] text-[13px] font-bold text-prussian ring-2 ring-inset ring-alice-deep lip-2 lip-alice";

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
 * The course page's exam card (contract section 5): the soonest upcoming exam (the one being
 * crammed for first), days left, how much of its scope is verified, and Cram for this exam, which
 * opens the setup. While cramming: the plan line, Study with Claude, Edit scope, Stop cramming.
 */
export function ExamCard({ course, mastery }: { course: Course; mastery: CourseMastery }) {
  const { exams, objectives, updateExam } = useOrca();
  const dayKey = useDayKey();
  const nowMs = useNow();
  const [setup, setSetup] = useState(false);
  const closeSetup = useCallback(() => setSetup(false), []);
  const today = dayKey(new Date(nowMs).toISOString());
  const exam = cardExam(exams, course.id, today);
  const connected = useConnectorStatus(Boolean(exam?.cramming));
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

  return (
    <>
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
              <p className="mt-[4px] text-[15px] font-semibold text-prussian" data-part="cram-plan">
                {days >= 0 ? `${days} day${days === 1 ? "" : "s"}. ` : ""}
                Verified: {share}%.
              </p>
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
                <button type="button" onClick={() => setSetup(true)} data-part="cram-edit" className={PILL}>
                  Edit scope
                </button>
                <button type="button" onClick={() => updateExam(exam.id, { cramming: false })} data-part="cram-stop" className={PILL}>
                  Stop cramming
                </button>
              </div>
            </>
          ) : (
            <Button size="sm" className="mt-[6px] self-start" data-part="cram-start" onClick={() => setSetup(true)}>
              Cram for this exam
            </Button>
          )}
        </Card>
      </motion.div>
      <CramSetup exam={setup ? exam : null} course={course} covered={covered} catalogue={catalogue} mastery={mastery} onClose={closeSetup} />
    </>
  );
}

/**
 * Whether the student's Claude is connected (a connector token exists), read once the card shows
 * the cramming state: null until known. Study with Claude links to Settings only when it isn't.
 */
function useConnectorStatus(wanted: boolean): boolean | null {
  const [connected, setConnected] = useState<boolean | null>(null);
  useEffect(() => {
    if (!wanted) return;
    let live = true;
    fetch("/api/connector", { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Couldn't read the connector: ${res.status}`);
        const body = (await res.json()) as { connected: boolean };
        if (live) setConnected(body.connected);
      })
      .catch(() => {
        // Unknown stays null: the link to Settings is shown, which works either way.
        if (live) setConnected(null);
      });
    return () => {
      live = false;
    };
  }, [wanted]);
  return connected;
}

/**
 * Cram setup: the professor's words (saved as `professor` evidence on the scope), a link to add a
 * practice exam held back, the objectives the student worries about (a manual struggled flag each),
 * then Confirm, which sets the exam cramming.
 */
function CramSetup({ exam, course, covered, catalogue, mastery, onClose }: { exam: Exam | null; course: Course; covered: readonly string[]; catalogue: Readonly<Record<string, Objective>>; mastery: CourseMastery; onClose: () => void }) {
  useEffect(() => {
    if (!exam) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [exam, onClose]);

  return (
    <AnimatePresence>
      {exam && (
        <motion.div key="overlay" className="fixed inset-0 z-50 flex items-center justify-center bg-prussian/70 p-6" variants={overlayFade} initial="hidden" animate="show" exit="exit" onClick={onClose}>
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="cram-setup-title"
            variants={popIn}
            initial="hidden"
            animate="show"
            exit="exit"
            onClick={(e) => e.stopPropagation()}
            className="relative flex max-h-full w-[560px] max-w-full flex-col gap-[16px] overflow-y-auto rounded-[32px] bg-parchment px-[36px] pb-[32px] pt-[36px] lip-8 lip-alice"
            data-part="cram-setup"
          >
            <RoundButton size={44} label="Close" onClick={onClose} className="absolute right-[24px] top-[24px]">
              <IconClose size={20} />
            </RoundButton>
            {/* Mounted fresh each time the setup opens, so its fields start from the exam as it is then. */}
            <CramSetupForm key={exam.id} exam={exam} course={course} covered={covered} catalogue={catalogue} mastery={mastery} onClose={onClose} />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function CramSetupForm({ exam, course, covered, catalogue, mastery, onClose }: { exam: Exam; course: Course; covered: readonly string[]; catalogue: Readonly<Record<string, Objective>>; mastery: CourseMastery; onClose: () => void }) {
  const { updateExam, flagObjectives } = useOrca();
  // Starts from the quote already on the scope, so Edit scope shows what was said.
  const [words, setWords] = useState(() => exam.scope?.objectives.flatMap((o) => o.evidence).find((e) => e.signal === "professor" && e.quote)?.quote ?? "");
  const [worries, setWorries] = useState<string[]>([]);

  const options = covered.map((id) => ({
    id,
    name: catalogue[id]?.name ?? id,
  }));
  const confirm = () => {
    // A worry is a struggled flag (manual); one already being learned needs no second flag.
    const toFlag = worries.filter((id) => canFlagHard(mastery.objectives.get(id)?.status ?? "unseen"));
    if (toFlag.length) flagObjectives(course.id, toFlag);
    updateExam(exam.id, {
      cramming: true,
      scope: scopeFromSetup(exam.scope, covered, words),
    });
    onClose();
  };

  return (
    <>
      <div className="flex flex-col gap-[6px] pr-[56px]">
        <h2 id="cram-setup-title" className="text-[28px] font-semibold text-prussian">
          Cram for {exam.title}
        </h2>
        <p className="text-[15px] font-medium text-wisteria-deep">Tell Orca what the exam covers. Claude teaches from it, and Orca keeps score.</p>
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

      <p className="text-[14px] font-medium text-wisteria-deep" data-part="cram-scope-size">
        {covered.length} objective{covered.length === 1 ? "" : "s"} in scope.
      </p>

      <div className="flex items-center justify-end gap-[10px] border-t-2 border-alice-deep pt-[16px]">
        <Button size="sm" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button size="sm" onClick={confirm} data-part="cram-confirm">
          Confirm
        </Button>
      </div>
    </>
  );
}
