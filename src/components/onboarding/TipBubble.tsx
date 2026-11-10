"use client";

import { useState } from "react";
import { OrcaLogo } from "@/components/brand/OrcaLogo";
import { AnchoredBubble } from "@/components/ui/AnchoredBubble";
import { Button } from "@/components/ui/Button";
import { InlineConfirm } from "@/components/ui/InlineConfirm";
import { Kbd } from "@/components/ui/Kbd";
import type { Box } from "@/lib/anchor-geometry";
import type { Tip } from "@/lib/onboarding/tips";

/**
 * One onboarding tip, spoken by the orca, beside what it points at: a title and a line or two, an X
 * to dismiss it, Back and Next showing their arrow keys, and "Skip all tips", which asks first
 * because skipped tips never come back.
 */
export function TipBubble({
  tip,
  target,
  index,
  total,
  onBack,
  onNext,
  onSkip,
}: {
  tip: Tip;
  target: Box;
  /** Its place in the run of tips on this page. */
  index: number;
  total: number;
  onBack: () => void;
  /** Next, and the X: this tip is done with. */
  onNext: () => void;
  onSkip: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const last = index === total - 1;
  return (
    <AnchoredBubble target={target} label={tip.title} onClose={onNext} closeLabel="Dismiss tip" closePart="tip-dismiss" data-part="orca-tip" data-tip={tip.id}>
      <div className="flex items-start gap-[12px] pr-[22px]">
        <OrcaLogo width={46} shadow={false} className="mt-[2px] shrink-0" />
        <div className="flex min-w-0 flex-col gap-[4px]" aria-live="polite">
          <p className="text-[16px] font-bold leading-tight text-prussian">{tip.title}</p>
          <p className="text-[14px] leading-[1.4] text-prussian">{tip.body}</p>
        </div>
      </div>
      <div className="mt-[12px] flex min-h-[32px] flex-wrap items-center justify-between gap-[10px] text-[13px] font-semibold">
        {confirming ? (
          <span className="flex flex-wrap items-center gap-[10px]" data-part="tip-skip-confirm">
            <InlineConfirm question="Skip all tips? They won't come back." confirm="Skip" cancel="Keep going" onConfirm={onSkip} onCancel={() => setConfirming(false)} confirmPart="tip-skip-yes" cancelPart="tip-skip-no" />
          </span>
        ) : (
          <>
            <button type="button" onClick={() => setConfirming(true)} className="cursor-pointer text-wisteria-deep underline underline-offset-2" data-part="tip-skip">
              Skip all tips
            </button>
            <span className="flex items-center gap-[8px]">
              {total > 1 && (
                <span className="text-[12px] text-wisteria-deep" data-part="tip-count">
                  {index + 1} of {total}
                </span>
              )}
              {index > 0 && (
                <Button size="xs" variant="ghost" onClick={onBack} aria-keyshortcuts="ArrowLeft" data-part="tip-back">
                  <Kbd>←</Kbd>
                  Back
                </Button>
              )}
              <Button size="xs" onClick={onNext} aria-keyshortcuts="ArrowRight" data-part="tip-next">
                {last ? "Got it" : "Next"}
                <Kbd onColor>→</Kbd>
              </Button>
            </span>
          </>
        )}
      </div>
    </AnchoredBubble>
  );
}
