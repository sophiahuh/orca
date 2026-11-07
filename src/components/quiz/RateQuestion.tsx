"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { FEEDBACK_REASONS, type FeedbackReason, type NotRelevantScope, type QuestionRating } from "@/lib/data";
import { IconClose } from "@/components/icons";
import { Button } from "@/components/ui/Button";
import { RoundButton } from "@/components/ui/RoundButton";
import { cn } from "@/lib/cn";
import { overlayFade, popIn } from "@/lib/motion";

const REASONS = Object.entries(FEEDBACK_REASONS) as Array<[FeedbackReason, string]>;
/** Longest note (the database holds the same). */
export const NOTE_MAX = 300;

function Thumb({ up, active, onClick, label }: { up: boolean; active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "pressable flex h-[34px] w-[38px] items-center justify-center rounded-pill text-[16px] lip-2",
        active ? "bg-wisteria text-parchment lip-wisteria" : "bg-parchment text-prussian ring-2 ring-inset ring-alice-deep lip-alice",
      )}
    >
      <span aria-hidden>{up ? "👍" : "👎"}</span>
    </button>
  );
}

/** What a thumbs down reports back: the reason, the note and, for "Not relevant", what it covers. */
export type OnFlag = (reason: FeedbackReason | null, note: string | null, scope: NotRelevantScope) => void;

/**
 * The thumbs-down popup: why (optional reason chips) and what was wrong (an optional note, which
 * Orca's question writing reads for this course). "Not relevant" asks whether it's just this
 * question or everything on its objective (`objectiveName`; without one, just the question). Save
 * applies it; Cancel or Esc changes nothing.
 */
export function FlagDialog({ open, saveLabel, initial, objectiveName, onSave, onClose }: { open: boolean; saveLabel: string; initial?: QuestionRating; objectiveName?: string; onSave: OnFlag; onClose: () => void }) {
  const [reason, setReason] = useState<FeedbackReason | null>(initial?.reason ?? null);
  const [note, setNote] = useState(initial?.note ?? "");
  const [scope, setScope] = useState<NotRelevantScope>("question");
  const asksScope = reason === "not-relevant" && !!objectiveName;
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div key="overlay" className="fixed inset-0 z-50 flex items-center justify-center bg-prussian/70 p-6" variants={overlayFade} initial="hidden" animate="show" exit="exit" onClick={onClose}>
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="flag-title"
            variants={popIn}
            initial="hidden"
            animate="show"
            exit="exit"
            onClick={(e) => e.stopPropagation()}
            className="relative flex w-[520px] max-w-full flex-col gap-[16px] rounded-[28px] bg-parchment px-[32px] pb-[28px] pt-[32px] lip-8 lip-alice"
            data-part="flag-dialog"
          >
            <RoundButton size={44} label="Close" onClick={onClose} className="absolute right-[20px] top-[20px]">
              <IconClose size={18} />
            </RoundButton>
            <div className="flex flex-col gap-[4px] pr-[48px]">
              <h2 id="flag-title" className="text-[24px] font-bold leading-tight text-prussian">
                What was wrong with this question?
              </h2>
              <p className="text-[14px] font-medium text-wisteria-deep">Orca won&apos;t ask it again, and uses what you say when it writes your next questions. Both are optional.</p>
            </div>
            <div className="flex flex-wrap gap-[8px]" data-part="feedback-reasons">
              {REASONS.map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setReason(reason === key ? null : key)}
                  aria-pressed={reason === key}
                  className={cn(
                    "pressable rounded-pill px-[12px] py-[6px] text-[13px] font-bold lip-2",
                    reason === key ? "bg-wisteria text-parchment lip-wisteria" : "bg-parchment text-prussian ring-2 ring-inset ring-alice-deep lip-alice",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            {asksScope && (
              <div className="flex flex-col gap-[8px] rounded-[16px] bg-alice px-[14px] py-[12px]" data-part="not-relevant-scope">
                <span className="text-[14px] font-bold text-prussian">What isn&apos;t relevant?</span>
                {(
                  [
                    ["question", "Just this question"],
                    ["objective", `Everything on "${objectiveName}"`],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key} className="flex cursor-pointer items-center gap-[8px] text-[14px] font-semibold text-prussian">
                    <input type="radio" name="not-relevant-scope" value={key} checked={scope === key} onChange={() => setScope(key)} className="accent-wisteria-deep" data-part={`scope-${key}`} />
                    {label}
                  </label>
                ))}
                {scope === "objective" && <span className="text-[13px] font-medium text-prussian/70">Orca will stop asking about it. You can bring it back from the course&apos;s Objectives page.</span>}
              </div>
            )}
            <label className="flex flex-col gap-[6px]">
              <span className="text-[14px] font-bold text-prussian">Tell us more</span>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value.slice(0, NOTE_MAX))}
                maxLength={NOTE_MAX}
                rows={3}
                placeholder="e.g. The key says 1011, but inverting and adding one gives 1010."
                className="rounded-[16px] border-2 border-alice-deep bg-parchment px-[14px] py-[10px] text-[15px] text-prussian outline-none focus:border-wisteria"
              />
              <span className="self-end text-[12px] font-medium text-prussian/50">
                {note.length}/{NOTE_MAX}
              </span>
            </label>
            <div className="flex justify-end gap-[10px]">
              <Button variant="ghost" size="sm" onClick={onClose}>
                Cancel
              </Button>
              <Button size="sm" onClick={() => onSave(reason, note.trim() || null, asksScope ? scope : "question")} data-part="flag-save">
                {saveLabel}
              </Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * After an answer: thumbs up or down on the question. A thumbs down opens the popup; tapping a lit
 * thumb clears the rating. A thumbs-down question isn't asked again.
 */
export function RateAnswered({ rating, objectiveName, onRate, onNotRelevant }: { rating: QuestionRating | undefined; objectiveName?: string; onRate: (rating: "up" | "down" | null, reason?: FeedbackReason | null, note?: string | null) => void; onNotRelevant?: () => void }) {
  const [flagging, setFlagging] = useState(false);
  return (
    <div className="mt-[14px] flex flex-col gap-[8px]" data-part="rate-question">
      <div className="flex items-center gap-[8px]">
        <span className="text-[13px] font-semibold text-wisteria-deep">Was this a good question?</span>
        <Thumb up active={rating?.rating === "up"} label="Good question" onClick={() => onRate(rating?.rating === "up" ? null : "up")} />
        <Thumb up={false} active={rating?.rating === "down"} label="Bad question" onClick={() => (rating?.rating === "down" ? onRate(null) : setFlagging(true))} />
        {rating?.rating === "down" && <span className="text-[13px] font-medium text-prussian/70">Thanks. Orca won&apos;t ask it again.</span>}
      </div>
      <FlagDialog
        open={flagging}
        saveLabel="Save"
        initial={rating}
        objectiveName={objectiveName}
        onClose={() => setFlagging(false)}
        onSave={(reason, note, scope) => {
          setFlagging(false);
          onRate("down", reason, note);
          if (scope === "objective") onNotRelevant?.();
        }}
      />
    </div>
  );
}

/**
 * Before answering: a thumbs down opens the popup; saving it skips the question (nothing is
 * recorded), and the quiz brings in another question for the same objective when there is one.
 */
export function RateUnanswered({ objectiveName, onDown }: { objectiveName?: string; onDown: OnFlag }) {
  const [flagging, setFlagging] = useState(false);
  return (
    <>
      <Thumb up={false} active={false} label="Flag as a bad question" onClick={() => setFlagging(true)} />
      <FlagDialog
        open={flagging}
        saveLabel="Save and skip"
        objectiveName={objectiveName}
        onClose={() => setFlagging(false)}
        onSave={(reason, note, scope) => {
          setFlagging(false);
          onDown(reason, note, scope);
        }}
      />
    </>
  );
}
