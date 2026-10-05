"use client";

import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import type { QuizQuestion } from "@/lib/data";
import { objectiveIdOf } from "@/lib/mastery/catalogue";
import type { Grader, Outcome } from "@/lib/mastery/types";
import { useCourse, useOrca, useStreak } from "@/lib/store";
import { IconClose } from "@/components/icons";
import { Screen } from "@/components/layout/Screen";
import { BackButton } from "@/components/layout/BackButton";
import { AnswerOption, type AnswerState } from "@/components/ui/AnswerOption";
import { Button } from "@/components/ui/Button";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { RoundButton } from "@/components/ui/RoundButton";
import { TruthTable } from "@/components/quiz/TruthTable";
import { ShortAnswer } from "@/components/quiz/ShortAnswer";
import { GRADE_SYSTEM, type GradeResult, gradeExact, gradePrompt, parseGradeLoose } from "@/lib/grading";
import { PROVIDERS, compatChat, llmReady } from "@/lib/llm";
import { useServerModel } from "@/hooks/useServerModel";
import { QuizEnd } from "@/components/quiz/QuizEnd";
import { fadeUp, stagger } from "@/lib/motion";

const LETTERS = "ABCDEFGH";

export default function QuizPage({ params }: PageProps<"/quiz/[slug]/[topic]">) {
  const { slug, topic: topicId } = use(params);
  const router = useRouter();
  const streak = useStreak();
  const { hydrated, recordQuiz, recordEvidence, questionBank, llm } = useOrca();
  const serverModel = useServerModel();
  const course = useCourse(slug);
  const topic = course?.topics.find((t) => t.id === topicId);

  const generated = course ? questionBank[course.id]?.[topicId] : undefined;
  const fullSet = useMemo(() => (generated ?? []).slice(0, 8), [generated]);
  // null = the full set for this topic (derived, so it follows store hydration); a list = a review subset.
  const [subset, setSubset] = useState<QuizQuestion[] | null>(null);
  const questions = subset ?? fullSet;
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [checked, setChecked] = useState(false);
  const [grading, setGrading] = useState(false);
  const [grade, setGrade] = useState<GradeResult | null>(null);
  const [correct, setCorrect] = useState(0);
  const [missed, setMissed] = useState<QuizQuestion[]>([]);
  const [finished, setFinished] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const startedAt = useRef<number | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const recorded = useRef(false);

  // Tick the clock while the quiz is live.
  useEffect(() => {
    if (finished) return;
    if (startedAt.current === null) startedAt.current = Date.now();
    const id = window.setInterval(() => setSeconds(Math.floor((Date.now() - (startedAt.current ?? Date.now())) / 1000)), 500);
    return () => window.clearInterval(id);
  }, [finished]);

  // Persist the result exactly once when the set completes.
  useEffect(() => {
    if (!finished || recorded.current || !course || !topic) return;
    recorded.current = true;
    recordQuiz({ courseId: course.id, topicId: topic.id, correct, total: questions.length, seconds });
  }, [finished, course, topic, correct, questions.length, seconds, recordQuiz]);

  const q = questions[index];
  const total = questions.length;

  /** One graded answer → one evidence event. Called only after grading has finished. */
  const logAnswer = useCallback(
    (question: QuizQuestion, outcome: Outcome, grader: Grader) => {
      if (!course || !topic) return;
      recordEvidence({
        courseId: course.id,
        topicId: topic.id,
        objectiveId: objectiveIdOf(question, topic.id),
        questionId: question.id,
        tier: question.tier ?? null,
        outcome,
        grader,
        source: "quiz",
      });
    },
    [course, topic, recordEvidence],
  );

  const check = useCallback(() => {
    if (!q || selected === null || checked) return;
    setChecked(true);
    const ok = selected === q.answer;
    if (ok) setCorrect((c) => c + 1);
    else setMissed((m) => [...m, q]);
    logAnswer(q, ok ? "correct" : "incorrect", "choice");
  }, [selected, checked, q, logAnswer]);

  const noModel: string | null = llmReady(llm) || serverModel ? null : serverModel === undefined ? null : "no AI connected";

  const settle = useCallback(
    (result: GradeResult, grader: Grader | null) => {
      if (!q) return;
      setGrade(result);
      setChecked(true);
      if (result.outcome === "correct") setCorrect((c) => c + 1);
      else setMissed((m) => [...m, q]);
      if (grader) logAnswer(q, result.outcome, grader);
    },
    [q, logAnswer],
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
        let result: GradeResult;
        if (llmReady(llm) && PROVIDERS[llm.provider].browserOnly) {
          result = parseGradeLoose(await compatChat(llm, GRADE_SYSTEM, [{ role: "user", content: gradePrompt(q.prompt, q.rubric, response) }], { maxTokens: 1024, json: true }));
        } else {
          const res = await fetch("/api/grade", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ llm: llmReady(llm) ? llm : null, question: q.prompt, rubric: q.rubric, response }),
          });
          const data = (await res.json()) as GradeResult & { error?: string };
          if (!res.ok || data.error) throw new Error(data.error ?? "Grading failed.");
          result = data;
        }
        settle(result, "rubric");
      } catch (error) {
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
    [q, checked, grading, llm, settle],
  );

  const advance = useCallback(() => {
    if (!q) return;
    if (!checked) setMissed((m) => [...m, q]); // skipped counts as a miss
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
  }, [checked, index, total, q]);

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

  if (!course || !topic) {
    return (
      <Screen bg="parchment" className="items-start gap-4 p-[32px]">
        <BackButton />
        {hydrated && <p className="text-[22px] font-bold text-prussian">That topic isn&apos;t on the map yet.</p>}
      </Screen>
    );
  }

  const backHref = `/course/${course.slug}`;

  if (questions.length === 0) {
    return (
      <Screen bg="parchment" className="items-start gap-4 p-[32px]">
        <BackButton href={backHref} />
        {hydrated && (
          <>
            <p className="text-[22px] font-bold text-prussian">No questions for {topic.name} yet.</p>
            <p className="text-[16px] text-wisteria-deep">Add course material for this topic and Orca will write some.</p>
            <Button size="sm" onClick={() => router.push("/add-material")}>
              Add material
            </Button>
          </>
        )}
      </Screen>
    );
  }

  const restart = (set: QuizQuestion[]) => {
    setSubset(set);
    setIndex(0);
    setSelected(null);
    setChecked(false);
    setGrade(null);
    setCorrect(0);
    setMissed([]);
    setFinished(false);
    setSeconds(0);
    startedAt.current = Date.now();
    recorded.current = false;
  };

  if (finished) {
    return (
      <QuizEnd
        topicName={topic.name}
        correct={correct}
        total={total}
        seconds={seconds}
        streak={streak}
        onContinue={() => router.push(backHref)}
        onReview={missed.length ? () => restart(missed) : undefined}
        onClose={() => router.push(backHref)}
      />
    );
  }

  const stateFor = (i: number): AnswerState => {
    if (!checked) return selected === i ? "selected" : "idle";
    if (i === q.answer) return "correct";
    if (i === selected) return "wrong";
    return "idle";
  };

  return (
    <Screen bg="parchment" className="h-screen max-h-screen">
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
            <motion.span variants={fadeUp} className="eyebrow">
              {q.kind}{q.tier ? ` · ${q.tier}` : ""} · {q.topic}
            </motion.span>
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
                  onSubmit={(r) => void submitShort(r)}
                  onSelfReport={(ok) =>
                    settle({ outcome: ok ? "correct" : "incorrect", feedback: ok ? "Marked as known." : "Marked as missed; it'll come back." }, "self")
                  }
                />
              </div>
            ) : (
              <div className="mt-[24px] flex flex-col gap-[12px]">
                {q.options.map((opt, i) => (
                  <AnswerOption key={opt} letter={LETTERS[i]} state={stateFor(i)} disabled={checked} onClick={() => setSelected(i)}>
                    {opt}
                  </AnswerOption>
                ))}
              </div>
            )}

            <AnimatePresence>
              {checked && (
                <motion.div
                  key="explain"
                  variants={fadeUp}
                  initial="hidden"
                  animate="show"
                  exit="exit"
                  className="mt-[18px] rounded-[18px] bg-alice px-[20px] py-[14px] text-[16px] leading-relaxed text-prussian"
                >
                  <span className="font-bold text-wisteria-deep">
                    {q.kind === "Short answer"
                      ? grade?.outcome === "correct"
                        ? "Correct. "
                        : grade?.outcome === "partial"
                          ? "Partly. "
                          : "Not quite. "
                      : selected === q.answer
                        ? "Correct. "
                        : "Not quite. "}
                  </span>
                  {q.kind === "Short answer" && grade?.feedback && grade.outcome !== "correct" && <span className="text-prussian">{grade.feedback} </span>}
                  {q.explanation}
                  {q.kind === "Short answer" && q.rubric && grade?.outcome !== "correct" && (
                    <span className="mt-[8px] block text-[15px] text-prussian/80">
                      Key: {q.rubric.requiredIdeas.join(" · ")}
                    </span>
                  )}
                  {q.anchor && (
                    <span className="mt-[8px] block text-[14px] text-wisteria-deep">
                      From {q.anchor.locator}: “{q.anchor.excerpt}”
                    </span>
                  )}
                </motion.div>
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
