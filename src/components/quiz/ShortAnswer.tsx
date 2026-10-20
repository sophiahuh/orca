"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { QuizQuestion } from "@/lib/data";
import type { GradeResult } from "@/lib/grading";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { fadeUp } from "@/lib/motion";

/**
 * Typed answer for a short-answer question. Exact answers are checked on-device;
 * rubric answers are graded by the model. When no model is reachable, the student
 * compares with the key and self-reports, so the quiz never dead-ends.
 */
export interface ShortAnswerProps {
  question: QuizQuestion;
  grading: boolean;
  result: GradeResult | null;
  /** null = a model is available; otherwise the reason it isn't. */
  noModel: string | null;
  /** The server refused to grade the submitted answer (grading turned off): show the key and the self-report at once. */
  selfMarkNow?: boolean;
  /** A parent may control the response when its Check action lives outside this component. */
  value?: string;
  onValueChange?: (value: string) => void;
  /** Hide the local Check button when the quiz footer supplies it. */
  hideCheck?: boolean;
  onSubmit: (response: string) => void;
  onSelfReport: (correct: boolean) => void;
  /** "Don't know", beside Check: the quiz counts it as a miss. */
  onDontKnow?: () => void;
}

export function ShortAnswer({ question, grading, result, noModel, selfMarkNow = false, value: controlledValue, onValueChange, hideCheck = false, onSubmit, onSelfReport, onDontKnow }: ShortAnswerProps) {
  const [localValue, setLocalValue] = useState("");
  const value = controlledValue ?? localValue;
  const setValue = (next: string) => {
    setLocalValue(next);
    onValueChange?.(next);
  };
  const exact = Boolean(question.exact?.length);
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const answered = result !== null;
  const needsSelfReport = !exact && noModel !== null && !answered;
  const [submittedLocally, setSubmitted] = useState(false);
  const submittedForSelfReport = submittedLocally || (selfMarkNow && needsSelfReport);

  useEffect(() => {
    ref.current?.focus();
  }, [question.id]);

  const submit = () => {
    if (!value.trim() || grading || answered) return;
    if (needsSelfReport) {
      setSubmitted(true);
      return;
    }
    onSubmit(value);
  };

  const tone =
    result?.outcome === "correct"
      ? "border-wisteria-deep bg-wisteria/15"
      : result?.outcome === "partial"
        ? "border-periwinkle-deep bg-periwinkle/20"
        : result
          ? "border-prussian bg-alice"
          : "border-periwinkle-deep bg-parchment";

  return (
    <div className="flex flex-col gap-[12px]">
      {exact ? (
        <input
          ref={ref}
          value={value}
          disabled={answered}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="Type your answer"
          spellCheck={false}
          autoComplete="off"
          className={cn("h-[56px] w-full max-w-[420px] rounded-[16px] border-[2.5px] px-[18px] font-mono text-[20px] font-semibold text-prussian lip-4 lip-periwinkle placeholder:font-sans placeholder:text-[16px] placeholder:font-medium placeholder:text-periwinkle-deep focus:outline-none", tone)}
        />
      ) : (
        <textarea
          ref={ref}
          value={value}
          disabled={answered}
          rows={3}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="One or two sentences. Enter to check, Shift+Enter for a new line."
          className={cn("w-full max-w-[720px] resize-none rounded-[16px] border-[2.5px] px-[18px] py-[14px] text-[17px] leading-relaxed text-prussian lip-4 lip-periwinkle placeholder:text-periwinkle-deep focus:outline-none", tone)}
        />
      )}

      {!hideCheck && !answered && !submittedForSelfReport && (
        <div className="flex items-center gap-[12px]">
          <Button size="sm" onClick={submit} disabled={!value.trim() || grading}>
            {grading ? "Checking…" : "Check"}
          </Button>
          {onDontKnow && (
            <button type="button" onClick={onDontKnow} disabled={grading} data-part="dont-know" className="text-[15px] font-bold text-wisteria-deep hover:underline disabled:opacity-50">
              Don&apos;t know
            </button>
          )}
        </div>
      )}

      <AnimatePresence>
        {submittedForSelfReport && !answered && (
          <motion.div key="self" variants={fadeUp} initial="hidden" animate="show" exit="exit" className="flex flex-col gap-[10px] rounded-[18px] bg-alice px-[20px] py-[16px]">
            <span className="text-[13px] font-semibold uppercase tracking-[1.2px] text-wisteria-deep">Compare with the key · {noModel}</span>
            <ul className="list-disc pl-5 text-[16px] leading-relaxed text-prussian">
              {question.rubric?.requiredIdeas.map((idea) => (
                <li key={idea}>{idea}</li>
              ))}
            </ul>
            <div className="flex gap-[10px]">
              <Button size="sm" onClick={() => onSelfReport(true)}>
                I had it
              </Button>
              <Button size="sm" variant="ghost" onClick={() => onSelfReport(false)}>
                I missed it
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
