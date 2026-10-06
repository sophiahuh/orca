"use client";

import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { BackButton } from "@/components/layout/BackButton";
import { Screen } from "@/components/layout/Screen";
import { Button } from "@/components/ui/Button";
import { fadeUp, spin, stagger } from "@/lib/motion";

/**
 * While a dive's questions are prepared (unanswered ones gathered, new ones written on the server),
 * then straight into the quiz. On failure it says why and offers to try again. A dive normally takes
 * well under a minute; after two, it offers to cancel the stuck one and start again.
 */
const SLOW_MS = 120_000;

export function PreparingDive({ title, backHref, error, onRetry, onCancel }: { title: string; backHref: string; error: string | null; onRetry: () => void; onCancel?: () => void }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (error) return;
    const id = window.setTimeout(() => setSlow(true), SLOW_MS);
    return () => window.clearTimeout(id);
  }, [error]);
  return (
    <Screen bg="ocean">
      <header className="px-[28px] pt-[28px]">
        <BackButton href={backHref} />
      </header>
      <motion.div variants={stagger(0.06)} initial="hidden" animate="show" className="flex flex-1 flex-col items-center justify-center gap-[14px] px-[28px] pb-[80px] text-center" data-part="preparing-dive">
        <motion.span variants={fadeUp} className="eyebrow">
          Dive in · {title}
        </motion.span>
        {error ? (
          <>
            <motion.p variants={fadeUp} className="max-w-[520px] text-[18px] font-bold text-prussian" role="alert">
              {error}
            </motion.p>
            <motion.div variants={fadeUp}>
              <Button
                onClick={() => {
                  setSlow(false);
                  onRetry();
                }}
              >
                Try again
              </Button>
            </motion.div>
          </>
        ) : (
          <>
            <motion.span aria-hidden className="h-[44px] w-[44px] rounded-pill border-[4px] border-alice border-t-wisteria-deep" animate={spin} />
            <motion.h1 variants={fadeUp} className="text-[34px] font-bold leading-tight text-prussian" role="status">
              Preparing your quiz…
            </motion.h1>
            <motion.p variants={fadeUp} className="text-[15px] font-medium text-prussian">
              Harder questions on this, ready in a moment.
            </motion.p>
            {slow && onCancel && (
              <motion.div variants={fadeUp} initial="hidden" animate="show" className="flex flex-col items-center gap-[8px] pt-[8px]" data-part="dive-slow">
                <p className="text-[14px] font-medium text-prussian">This is taking longer than it should.</p>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setSlow(false);
                    onCancel();
                  }}
                >
                  Cancel and try again
                </Button>
              </motion.div>
            )}
          </>
        )}
      </motion.div>
    </Screen>
  );
}
