"use client";

import { useState } from "react";
import { FEEDBACK_REASONS, type FeedbackReason, type QuestionRating } from "@/lib/data";
import { cn } from "@/lib/cn";

const REASONS = Object.entries(FEEDBACK_REASONS) as Array<[FeedbackReason, string]>;

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

function Reasons({ onPick, chosen, extra }: { onPick: (r: FeedbackReason | null) => void; chosen?: FeedbackReason | null; extra?: string }) {
  return (
    <div className="flex flex-wrap items-center gap-[6px]" data-part="feedback-reasons">
      <span className="text-[13px] font-semibold text-wisteria-deep">Why?</span>
      {REASONS.map(([key, label]) => (
        <button
          key={key}
          type="button"
          onClick={() => onPick(key)}
          aria-pressed={chosen === key}
          className={cn(
            "pressable rounded-pill px-[10px] py-[5px] text-[12px] font-bold lip-2",
            chosen === key ? "bg-wisteria text-parchment lip-wisteria" : "bg-parchment text-prussian ring-2 ring-inset ring-alice-deep lip-alice",
          )}
        >
          {label}
        </button>
      ))}
      {extra && (
        <button type="button" onClick={() => onPick(null)} className="px-[6px] text-[12px] font-bold text-wisteria-deep hover:underline">
          {extra}
        </button>
      )}
    </div>
  );
}

/**
 * After an answer: thumbs up or down on the question (a later tap replaces it, tapping the same one
 * clears it), and on a thumbs down an optional reason. A thumbs-down question isn't asked again.
 */
export function RateAnswered({ rating, onRate }: { rating: QuestionRating | undefined; onRate: (rating: "up" | "down" | null, reason?: FeedbackReason | null) => void }) {
  return (
    <div className="mt-[14px] flex flex-col gap-[8px]" data-part="rate-question">
      <div className="flex items-center gap-[8px]">
        <span className="text-[13px] font-semibold text-wisteria-deep">Was this a good question?</span>
        <Thumb up active={rating?.rating === "up"} label="Good question" onClick={() => onRate(rating?.rating === "up" ? null : "up")} />
        <Thumb up={false} active={rating?.rating === "down"} label="Bad question" onClick={() => onRate(rating?.rating === "down" ? null : "down")} />
        {rating?.rating === "down" && <span className="text-[13px] font-medium text-prussian/70">Orca won&apos;t ask it again.</span>}
      </div>
      {rating?.rating === "down" && <Reasons chosen={rating.reason} onPick={(r) => onRate("down", r)} />}
    </div>
  );
}

/**
 * Before answering: a thumbs down skips the question (nothing is recorded) after an optional reason;
 * the quiz brings in another question for the same objective when there is one.
 */
export function RateUnanswered({ onDown }: { onDown: (reason: FeedbackReason | null) => void }) {
  const [asking, setAsking] = useState(false);
  if (!asking) return <Thumb up={false} active={false} label="Flag as a bad question" onClick={() => setAsking(true)} />;
  return <Reasons onPick={(r) => onDown(r)} extra="Skip without a reason" />;
}
