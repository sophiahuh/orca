"use client";


import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import type { Course, QuizQuestion, SessionMode } from "@/lib/data";
import { liveObjectiveOf } from "@/lib/mastery/catalogue";
import type { EvidenceSource, Grader, Outcome } from "@/lib/mastery/types";
import { useDayKey, useMasteryByCourse, useOrca, useStreak, useTodos } from "@/lib/store";
import { useNow } from "@/hooks/useNow";
import { masteryPercent, reviewPhrase } from "@/lib/mastery/percent";
import { todoHref } from "@/components/layout/Sidebar";
import { Feedback } from "@/components/quiz/Feedback";
import { ResultBanner } from "@/components/quiz/ResultBanner";
import { IconClose } from "@/components/icons";
import { Screen } from "@/components/layout/Screen";
import { AnswerOption, type AnswerState } from "@/components/ui/AnswerOption";
import { Button } from "@/components/ui/Button";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { RoundButton } from "@/components/ui/RoundButton";
import { TruthTable } from "@/components/quiz/TruthTable";
import { ShortAnswer } from "@/components/quiz/ShortAnswer";
import { type GradeResult, gradeExact } from "@/lib/grading";
import { useServerStatus } from "@/hooks/useServerModel";
import { type TopUpStatus, useTopUp } from "@/hooks/useTopUp";
import { QuizEnd } from "@/components/quiz/QuizEnd";
import { Pill } from "@/components/review/parts";
import { fadeUp, stagger } from "@/lib/motion";

const LETTERS = "ABCDEFGH";

/** One question in a run, with the topic it's filed under and any lines to show above it ("Seen before", why it's due). */
export interface RunnerItem {
  question: QuizQuestion;
  topicId: string;
  notes: string[];
}

const SOURCE: Record<SessionMode, EvidenceSource> = { topic: "quiz", quick: "quick-review", deep: "deep-review", requiz: "requiz" };

export interface QuizRunnerProps {
  course: Course;
  items: RunnerItem[];
  mode: SessionMode;
  /** Shown on the end card ("Boolean Algebra is getting stronger"). */
  title: string;
  backHref: string;
  /** An end-card button that starts another session of the same kind (deep review). */
  again?: { label: string; onStart: () => void };
}

/**
 * The quiz itself, for a topic quiz or a scheduled session: asks the items in order, grades each
 * answer, records one evidence event per graded answer, records the finished session, then tops up
 * the stock for the objectives it asked about.
 */
export function QuizRunner({ course, items: allItems, mode, title, backHref, again }: QuizRunnerProps) {
  const router = useRouter();
  const streak = useStreak();
  const { recordQuiz, recordEvidence, objectives } = useOrca();
  const masteryByCourse = useMasteryByCourse();
  const todos = useTodos();
  const dayKey = useDayKey();
  const nowMs = useNow();
  const serverStatus = useServerStatus();
  const serverModel = serverStatus === undefined ? undefined : serverStatus.serverModel;
  const topUp = useTopUp(serverModel);
  const catalogue = objectives[course.id];
  // null = every item; a list = the "review misses" subset.
  const [subset, setSubset] = useState<RunnerItem[] | null>(null);
  const items = subset ?? allItems;
  const questions = useMemo(() => items.map((i) => i.question), [items]);
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [checked, setChecked] = useState(false);
  const [grading, setGrading] = useState(false);
  const [grade, setGrade] = useState<GradeResult | null>(null);
  /** The objective's display percent before the answer was recorded (Figma: Your mastery, 60% → 52%). */
  const [before, setBefore] = useState(0);
  /** The result banner's outcome; the nonce restarts its timer for each answer. */
  const [banner, setBanner] = useState<{ outcome: Outcome; line: string | null; nonce: number }>({ outcome: "correct", line: null, nonce: 0 });
  const [correct, setCorrect] = useState(0);
  /** Answers that couldn't be graded (a grading outage): no evidence, and not in the score either. */
  const [ungraded, setUngraded] = useState(0);
  const [missed, setMissed] = useState<RunnerItem[]>([]);
  const [finished, setFinished] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const startedAt = useRef<number | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const recorded = useRef(false);
  const sessionId = useRef<string | null>(null);

  // Tick the clock while the quiz is live.
  useEffect(() => {
    if (finished) return;
    if (startedAt.current === null) startedAt.current = Date.now();
    const id = window.setInterval(() => setSeconds(Math.floor((Date.now() - (startedAt.current ?? Date.now())) / 1000)), 500);
    return () => window.clearInterval(id);
  }, [finished]);

  // Persist the result exactly once when the set completes. Ungraded answers are left out of the
  // score (a grading outage would otherwise make every quiz look poor and queue re-quizzes); a set
  // with nothing graded records no session at all.
  useEffect(() => {
    if (!finished || recorded.current) return;
    recorded.current = true;
    sessionId.current ??= crypto.randomUUID();
    const total = questions.length - ungraded;
    if (total > 0) recordQuiz({ courseId: course.id, topicId: mode === "topic" ? (allItems[0]?.topicId ?? null) : null, mode, sessionId: sessionId.current, correct, total, seconds });
  }, [finished, course, mode, allItems, correct, ungraded, questions.length, seconds, recordQuiz]);

  // Then top up the stock for the objectives this run asked about (waits for the server-model check).
  const { start: startTopUp } = topUp;
  useEffect(() => {
    if (!finished) return;
    const ids = allItems.flatMap((i) => {
      const o = liveObjectiveOf(i.question, i.topicId, catalogue ?? {});
      return o ? [o.id] : [];
    });
    // The session id was set when the result was recorded (the effect above).
    if (sessionId.current) startTopUp(course.id, sessionId.current, ids);
  }, [finished, allItems, catalogue, course.id, startTopUp]);

  const item = items[index];
  const q = item?.question;
  const total = questions.length;
  const objective = q ? liveObjectiveOf(q, item.topicId, catalogue ?? {}) : null;
  const objectiveState = objective ? masteryByCourse[course.id]?.objectives.get(objective.id) : undefined;
  const showResult = useCallback(
    (outcome: Outcome, line: string | null) => {
      setBefore(masteryPercent(objectiveState));
      setBanner((b) => ({ outcome, line, nonce: b.nonce + 1 }));
    },
    [objectiveState],
  );

  /** One graded answer → one evidence event. Called only after grading has finished. */
  const logAnswer = useCallback(
    (at: RunnerItem, outcome: Outcome, grader: Grader) => {
      // One id per run; the "review missed" restart stays in the same session.
      sessionId.current ??= crypto.randomUUID();
      const objective = liveObjectiveOf(at.question, at.topicId, catalogue ?? {});
      if (!objective) throw new Error(`Question ${at.question.id} belongs to an archived objective and should not have been asked`);
      recordEvidence({
        sessionId: sessionId.current,
        courseId: course.id,
        topicId: at.topicId,
        objectiveId: objective.id,
        questionId: at.question.id,
        tier: at.question.tier ?? null,
        outcome,
        grader,
        source: SOURCE[mode],
      });
    },
    [course.id, mode, catalogue, recordEvidence],
  );

  const check = useCallback(() => {
    if (!item || selected === null || checked) return;
    setChecked(true);
    const ok = selected === item.question.answer;
    if (ok) setCorrect((c) => c + 1);
    else setMissed((m) => [...m, item]);
    showResult(ok ? "correct" : "incorrect", ok ? null : `The answer is ${item.question.options[item.question.answer]}.`);
    logAnswer(item, ok ? "correct" : "incorrect", "choice");
  }, [selected, checked, item, logAnswer, showResult]);

  // Prose answers are graded by Orca's server (Task 8); with no model there, or model grading turned
  // off for this student (decision 13), the student self-marks. The server can also say so on a grade
  // request itself (403/503 with graded: "self"), e.g. when the status hadn't loaded yet.
  const [gradingOff, setGradingOff] = useState<string | null>(null);
  const noModel: string | null =
    gradingOff ?? (serverStatus === undefined ? null : serverStatus.serverModel === null ? "no AI connected" : serverStatus.grading === "self" ? "model grading is off for your account" : null);

  const settle = useCallback(
    (result: GradeResult, grader: Grader | null) => {
      if (!item || checked) return;
      setGrade(result);
      setChecked(true);
      if (result.outcome === "correct") setCorrect((c) => c + 1);
      else setMissed((m) => [...m, item]);
      showResult(result.outcome, grader === null ? "Not counted." : grader === "self" ? result.feedback : null);
      if (grader) logAnswer(item, result.outcome, grader);
    },
    [item, checked, logAnswer, showResult],
  );

  const submitShort = useCallback(
    async (response: string) => {
      if (!q || checked || grading) return;
      if (q.exact?.length) {
        settle(gradeExact(response, q.exact), "exact");
        return;
      }
      if (!q.rubric) return;
      setGrading(true);
      try {
        // The server loads the question and its rubric by id; the request never carries them.
        const res = await fetch("/api/grade", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ questionId: q.id, response }),
        });
        const data = (await res.json()) as GradeResult & { error?: string; graded?: "self" };
        if (data.graded === "self") {
          // Not graded, not counted: the key is shown and the student marks it (ShortAnswer's self-report panel).
          setGradingOff(res.status === 403 ? "model grading is off for your account" : "no AI connected");
          return;
        }
        if (!res.ok || data.error) throw new Error(data.error ?? "Grading failed.");
        settle(data, "rubric");
      } catch (error) {
        setUngraded((n) => n + 1);
        settle(
          {
            outcome: "incorrect",
            feedback: `Couldn't grade this one (${error instanceof Error ? error.message : "error"}), so it wasn't counted. Compare with the key below.`,
          },
          null,
        );
      } finally {
        setGrading(false);
      }
    },
    [q, checked, grading, settle],
  );

  const advance = useCallback(() => {
    if (!item) return;
    if (!checked) setMissed((m) => [...m, item]); // skipped counts as a miss
    if (index + 1 >= total) {
      setFinished(true);
      window.scrollTo(0, 0);
      return;
    }
    setIndex((i) => i + 1);
    setSelected(null);
    setChecked(false);
    setGrade(null);
    bodyRef.current?.scrollTo({ top: 0 });
  }, [checked, index, total, item]);

  // Keyboard: 1–4 / A–D pick an answer, Enter checks then continues.
  useEffect(() => {
    if (finished || !q) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      if (e.key === "Enter") {
        if (q.kind === "Short answer" && !checked) return; // the input owns Enter until graded
        e.preventDefault();
        if (checked) advance();
        else if (selected !== null) check();
        return;
      }
      if (q.kind === "Short answer") return;
      if (checked) return;
      const k = e.key.toLowerCase();
      const idx = /^[1-9]$/.test(k) ? Number(k) - 1 : /^[a-h]$/.test(k) ? k.charCodeAt(0) - 97 : -1;
      if (idx >= 0 && idx < q.options.length) setSelected(idx);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [finished, checked, selected, q, check, advance]);

  const restart = (set: RunnerItem[]) => {
    setSubset(set);
    setIndex(0);
    setSelected(null);
    setChecked(false);
    setGrade(null);
    setCorrect(0);
    setUngraded(0);
    setMissed([]);
    setFinished(false);
    setSeconds(0);
    startedAt.current = Date.now();
    recorded.current = false;
  };

  if (finished) {
    return (
      <QuizEnd
        topicName={title}
        extra={<TopUpNote status={topUp.status} />}
        correct={correct}
        total={total - ungraded}
        seconds={seconds}
        streak={streak}
        onContinue={() => router.push(backHref)}
        onReview={missed.length ? () => restart(missed) : undefined}
        again={again}
        onClose={() => router.push(backHref)}
      />
    );
  }

  const stateFor = (i: number): AnswerState => {
    if (!checked) return selected === i ? "selected" : "idle";
    if (i === q.answer) return "correct";
    if (i === selected) return "wrong";
    return "dimmed";
  };
  // Figma: Option tag. The right answer is tagged "Correct answer" unless it was the student's.
  const tagFor = (i: number): string | undefined => {
    if (!checked) return undefined;
    if (i === selected) return "Your answer";
    if (i === q.answer) return "Correct answer";
    return undefined;
  };
  const outcomeShown: Outcome = q.kind === "Short answer" ? (grade?.outcome ?? "incorrect") : selected === q.answer ? "correct" : "incorrect";
  const suggestedCard = todos.find((t) => t.courseId === course.id && t.when === "today");
  const suggested = suggestedCard ? { course: course.short, title: suggestedCard.title, detail: suggestedCard.detail, href: todoHref(suggestedCard, course), kind: suggestedCard.kind } : null;

  return (
    <Screen bg="parchment" className="h-screen-below-bar max-h-screen-below-bar">
      <ResultBanner outcome={checked ? banner.outcome : null} line={banner.line} nonce={banner.nonce} />
      <header className="flex shrink-0 items-center gap-[24px] px-[40px] pt-[28px]">
        <RoundButton size={48} label="Exit quiz" onClick={() => router.push(backHref)}>
          <IconClose size={20} />
        </RoundButton>
        <div className="max-w-[880px] flex-1">
          <ProgressBar value={(index + (checked ? 1 : 0)) / total} label="Quiz progress" />
        </div>
        <span className="w-[64px] text-right text-[17px] font-bold text-wisteria-deep">
          {index + 1} / {total}
        </span>
      </header>

      <div ref={bodyRef} className="flex min-h-0 flex-1 flex-col overflow-y-auto px-[100px] pb-[24px] pt-[32px]">
        <AnimatePresence mode="wait">
          <motion.div key={q.id} variants={stagger(0.05, 0.07)} initial="hidden" animate="show" exit="exit" className="flex max-w-[800px] flex-col">
            <motion.div variants={fadeUp} className="flex items-center gap-[10px]">
              <span className="eyebrow">
                {q.kind}{q.tier ? ` · ${q.tier}` : ""} · {q.topic}
              </span>
              {liveObjectiveOf(q, item.topicId, catalogue ?? {})?.review === "proposed" && (
                <Pill tone="strong" className="normal-case">
                  Unreviewed
                </Pill>
              )}
            </motion.div>
            {item.notes.length > 0 && (
              <motion.p variants={fadeUp} data-part="question-notes" className="mt-[6px] text-[14px] font-medium text-wisteria-deep">
                {item.notes.join(" · ")}
              </motion.p>
            )}
            <motion.h1 variants={fadeUp} className="mt-[10px] text-[34px] font-bold leading-tight text-prussian">
              {q.prompt}
            </motion.h1>

            {q.figure && (
              <motion.div variants={fadeUp} className="mt-[18px] inline-flex max-w-full self-start overflow-hidden rounded-[18px] border-2 border-alice-deep bg-white p-[10px] lip-3 lip-alice">
                {/* eslint-disable-next-line @next/next/no-img-element -- figures may be data URLs rendered on-device */}
                <img src={q.figure.src} alt={q.figure.alt} className="max-h-[260px] w-auto max-w-full object-contain" />
              </motion.div>
            )}

            {q.table && (
              <div className="mt-[20px] flex justify-center">
                <TruthTable table={q.table} />
              </div>
            )}

            {q.kind === "Short answer" ? (
              <div className="mt-[24px]">
                <ShortAnswer
                  question={q}
                  grading={grading}
                  result={grade}
                  noModel={noModel}
                  selfMarkNow={gradingOff !== null}
                  onSubmit={(r) => void submitShort(r)}
                  onSelfReport={(ok) =>
                    settle({ outcome: ok ? "correct" : "incorrect", feedback: ok ? "Marked as known." : "Marked as missed; it'll come back." }, "self")
                  }
                />
              </div>
            ) : (
              <div className="mt-[24px] flex flex-col gap-[12px]">
                {q.options.map((opt, i) => (
                  <AnswerOption key={opt} letter={LETTERS[i]} state={stateFor(i)} tag={tagFor(i)} disabled={checked} onClick={() => setSelected(i)}>
                    {opt}
                  </AnswerOption>
                ))}
              </div>
            )}

            <AnimatePresence>
              {checked && (
                <Feedback
                  key="feedback"
                  question={q}
                  outcome={outcomeShown}
                  grade={grade}
                  objectiveName={objective?.name ?? q.topic}
                  before={before}
                  after={masteryPercent(objectiveState)}
                  reviewLine={reviewPhrase(objectiveState, new Date(nowMs), dayKey)}
                  suggested={suggested}
                />
              )}
            </AnimatePresence>
          </motion.div>
        </AnimatePresence>
      </div>

      <footer className="flex shrink-0 items-center justify-between border-t-2 border-alice bg-parchment px-[100px] py-[16px]">
        {checked ? (
          <span className="text-[15px] font-medium text-wisteria-deep">
            {correct} correct so far · <span className="text-periwinkle-deep">Enter to continue</span>
          </span>
        ) : (
          <Button variant="ghost" size="sm" onClick={advance}>
            Skip
          </Button>
        )}
        {checked ? (
          <Button size="sm" onClick={advance}>
            {index + 1 >= total ? "Finish" : "Continue"}
          </Button>
        ) : q.kind === "Short answer" ? (
          <span className="text-[15px] font-medium text-periwinkle-deep">Enter to check</span>
        ) : (
          <Button size="sm" onClick={check} disabled={selected === null}>
            Check
          </Button>
        )}
      </footer>
    </Screen>
  );
}

function TopUpNote({ status }: { status: TopUpStatus }) {
  const text =
    status.state === "running"
      ? "Writing new questions for next time…"
      : status.state === "done"
        ? status.added > 0
          ? `${status.added} new question${status.added === 1 ? "" : "s"} written and checked for next time.`
          : status.skipped.length > 0
            ? `Couldn't write new questions: ${status.skipped[0]}.`
            : status.dropped > 0
              ? "No new questions passed the checks this time."
              : null
        : status.state === "unavailable"
          ? status.reason
          : status.state === "error"
            ? `Couldn't write new questions: ${status.message.replace(/^Orca couldn't write new questions: /, "")}`
            : null;
  if (!text) return null;
  return (
    <p data-part="top-up" className="mt-[14px] text-[14px] text-wisteria-deep">
      {text}
    </p>
  );
}
