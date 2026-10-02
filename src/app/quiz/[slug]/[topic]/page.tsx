"use client";

import { use, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { type QuizQuestion, quizFor } from "@/lib/data";
import { useCourse, useOrca } from "@/lib/store";
import { IconClose } from "@/components/icons";
import { Screen } from "@/components/layout/Screen";
import { BackButton } from "@/components/layout/BackButton";
import { AnswerOption, type AnswerState } from "@/components/ui/AnswerOption";
import { Button } from "@/components/ui/Button";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { RoundButton } from "@/components/ui/RoundButton";
import { TruthTable } from "@/components/quiz/TruthTable";
import { QuizEnd } from "@/components/quiz/QuizEnd";
import { fadeUp, stagger } from "@/lib/motion";

const LETTERS = "ABCDEFGH";

export default function QuizPage({ params }: PageProps<"/quiz/[slug]/[topic]">) {
  const { slug, topic: topicId } = use(params);
  const router = useRouter();
  const { hydrated, streak, recordQuiz } = useOrca();
  const course = useCourse(slug);
  const topic = course?.topics.find((t) => t.id === topicId);

  const fullSet = useMemo(() => quizFor(topicId, topic?.name ?? "this topic"), [topicId, topic?.name]);
  const [questions, setQuestions] = useState<QuizQuestion[]>(fullSet);
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [checked, setChecked] = useState(false);
  const [correct, setCorrect] = useState(0);
  const [missed, setMissed] = useState<QuizQuestion[]>([]);
  const [finished, setFinished] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const startedAt = useRef<number | null>(null);
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

  if (!course || !topic) {
    return (
      <Screen bg="parchment" className="items-start gap-4 p-[32px]">
        <BackButton />
        {hydrated && <p className="text-[22px] font-bold text-prussian">That topic isn&apos;t on the map yet.</p>}
      </Screen>
    );
  }

  const q = questions[index];
  const total = questions.length;
  const backHref = `/course/${course.slug}`;

  const check = () => {
    if (selected === null) return;
    setChecked(true);
    if (selected === q.answer) setCorrect((c) => c + 1);
    else setMissed((m) => [...m, q]);
  };

  const advance = () => {
    if (!checked) setMissed((m) => [...m, q]); // skipped counts as a miss
    if (index + 1 >= total) {
      setFinished(true);
      return;
    }
    setIndex((i) => i + 1);
    setSelected(null);
    setChecked(false);
  };

  const restart = (set: QuizQuestion[]) => {
    setQuestions(set);
    setIndex(0);
    setSelected(null);
    setChecked(false);
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
    <Screen bg="parchment">
      <header className="flex items-center gap-[24px] px-[40px] pt-[36px]">
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

      <div className="flex flex-1 flex-col px-[120px] pb-[32px] pt-[56px]">
        <AnimatePresence mode="wait">
          <motion.div key={q.id} variants={stagger(0.05, 0.07)} initial="hidden" animate="show" exit="exit" className="flex max-w-[800px] flex-col">
            <motion.span variants={fadeUp} className="eyebrow">
              {q.kind} · {q.topic}
            </motion.span>
            <motion.h1 variants={fadeUp} className="mt-[12px] text-[40px] font-bold leading-tight text-prussian">
              {q.prompt}
            </motion.h1>

            {q.table && (
              <div className="mt-[28px] flex justify-center">
                <TruthTable table={q.table} />
              </div>
            )}

            <div className="mt-[32px] flex flex-col gap-[14px]">
              {q.options.map((opt, i) => (
                <AnswerOption key={opt} letter={LETTERS[i]} state={stateFor(i)} disabled={checked} onClick={() => setSelected(i)}>
                  {opt}
                </AnswerOption>
              ))}
            </div>

            <AnimatePresence>
              {checked && (
                <motion.div
                  key="explain"
                  variants={fadeUp}
                  initial="hidden"
                  animate="show"
                  exit="exit"
                  className="mt-[24px] rounded-[18px] bg-alice px-[20px] py-[16px] text-[16px] leading-relaxed text-prussian"
                >
                  <span className="font-bold text-wisteria-deep">{selected === q.answer ? "Correct. " : "Not quite. "}</span>
                  {q.explanation}
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        </AnimatePresence>
      </div>

      <footer className="flex items-center justify-between border-t-2 border-alice px-[100px] py-[22px]">
        {checked ? (
          <span className="text-[15px] font-medium text-wisteria-deep">
            {correct} correct so far
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
        ) : (
          <Button size="sm" onClick={check} disabled={selected === null}>
            Check
          </Button>
        )}
      </footer>
    </Screen>
  );
}
