"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { IconCheck, IconClose } from "@/components/icons";
import type { Outcome } from "@/lib/mastery/types";
import { cn } from "@/lib/cn";
import { popIn } from "@/lib/motion";

/**
 * Figma: Result banner (04a/04b, 141:497): a badge and two lines over the progress bar right after
 * checking, gone after about three seconds ("Temporary · slides away after ~3 s").
 */
const SHOW_MS = 3000;

const TITLE: Record<Outcome, string> = { correct: "Correct.", partial: "Partly.", incorrect: "Not quite." };

export function ResultBanner({ outcome, line, nonce }: { outcome: Outcome | null; line: string | null; nonce: number }) {
  // Shown for each new answer (nonce) until its timer ends.
  const [expired, setExpired] = useState(-1);
  useEffect(() => {
    if (outcome === null) return;
    const id = window.setTimeout(() => setExpired(nonce), SHOW_MS);
    return () => window.clearTimeout(id);
  }, [outcome, nonce]);
  const visible = outcome !== null && expired !== nonce;
  const good = outcome === "correct";
  return (
    <AnimatePresence>
      {visible && outcome && (
        <motion.div
          key={nonce}
          role="status"
          data-part="result-banner"
          variants={popIn}
          initial="hidden"
          animate="show"
          exit="hidden"
          className={cn(
            "pointer-events-none absolute left-1/2 top-[12px] z-10 flex -translate-x-1/2 items-center gap-[14px] rounded-[20px] border-2 px-[16px] py-[14px] lip-4",
            good ? "border-good bg-good-tint lip-good" : outcome === "partial" ? "border-warn bg-warn-tint lip-alice" : "border-bad bg-bad-tint lip-bad",
          )}
        >
          <span className={cn("flex h-[40px] w-[40px] shrink-0 items-center justify-center rounded-pill text-white", good ? "bg-good" : outcome === "partial" ? "bg-warn" : "bg-bad")}>
            {good ? <IconCheck size={18} strokeWidth={3.5} /> : <IconClose size={16} strokeWidth={3} />}
          </span>
          <span className="flex flex-col">
            <span className={cn("text-[22px] font-bold leading-tight", good ? "text-good-text" : outcome === "partial" ? "text-warn-text" : "text-bad-text")}>{TITLE[outcome]}</span>
            {line && <span className="text-[15px] font-semibold text-prussian">{line}</span>}
          </span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
