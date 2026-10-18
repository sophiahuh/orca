"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { FEEDBACK_REASONS, type FeedbackReason, type QuestionRating } from "@/lib/data";
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

/**
 * The thumbs-down popup: why (optional reason chips) and what was wrong (an optional note, which
 * Orca's question writing reads for this course). Save applies it; Cancel or Esc changes nothing.
 */
export function FlagDialog({ open, saveLabel, initial, onSave, onClose }: { open: boolean; saveLabel: string; initial?: QuestionRating; onSave: (reason: FeedbackReason | null, note: string | null) => void; onClose: () => void }) {
  const [reason, setReason] = useState<FeedbackReason | null>(initial?.reason ?? null);
  const [note, setNote] = useState(initial?.note ?? "");
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
              <Button size="sm" onClick={() => onSave(reason, note.trim() || null)} data-part="flag-save">
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
export function RateAnswered({ rating, onRate }: { rating: QuestionRating | undefined; onRate: (rating: "up" | "down" | null, reason?: FeedbackReason | null, note?: string | null) => void }) {
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
        onClose={() => setFlagging(false)}
        onSave={(reason, note) => {
          setFlagging(false);
          onRate("down", reason, note);
        }}
      />
    </div>
  );
}

/**
 * Before answering: a thumbs down opens the popup; saving it skips the question (nothing is
 * recorded), and the quiz brings in another question for the same objective when there is one.
 */
export function RateUnanswered({ onDown }: { onDown: (reason: FeedbackReason | null, note: string | null) => void }) {
  const [flagging, setFlagging] = useState(false);
  return (
    <>
      <Thumb up={false} active={false} label="Flag as a bad question" onClick={() => setFlagging(true)} />
      <FlagDialog
        open={flagging}
        saveLabel="Save and skip"
        onClose={() => setFlagging(false)}
        onSave={(reason, note) => {
          setFlagging(false);
          onDown(reason, note);
        }}
      />
    </>
  );
}
