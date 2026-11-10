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
 * One onboarding tip: the orca's speech bubble, beside what it points at (outlined by the Spotlight): a title and a line or two, an X
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
    <AnchoredBubble target={target} preferredSide={tip.preferredSide} arrow={false} speaker={<OrcaLogo width={66} shadow={false} />} label={tip.title} onClose={onNext} closeLabel="Dismiss tip" closePart="tip-dismiss" data-part="orca-tip" data-tip={tip.id}>
      <div className="flex flex-col gap-[6px] pr-[26px]" aria-live="polite">
        <p className="text-[18px] font-bold leading-tight text-prussian">{tip.title}</p>
        <p className="text-[15px] leading-[1.45] text-prussian">{tip.body}</p>
      </div>
      {confirming ? (
        <div className="mt-[16px] flex flex-wrap items-center gap-x-[14px] gap-y-[6px] text-[14px] font-semibold [&>span:first-child]:basis-full" data-part="tip-skip-confirm">
          <InlineConfirm question="Skip all tips? They won't come back." confirm="Skip" cancel="Keep going" onConfirm={onSkip} onCancel={() => setConfirming(false)} confirmPart="tip-skip-yes" cancelPart="tip-skip-no" />
        </div>
      ) : (
        <div className="mt-[18px] flex items-end justify-between gap-[12px]">
          <div className="flex flex-col gap-[2px]">
            {total > 1 && (
              <span className="text-[12px] font-semibold text-wisteria-deep" data-part="tip-count">
                {index + 1} of {total}
              </span>
            )}
            <button type="button" onClick={() => setConfirming(true)} className="cursor-pointer text-left text-[13px] font-semibold text-wisteria-deep underline underline-offset-2" data-part="tip-skip">
              Skip all tips
            </button>
          </div>
          <div className="flex items-center gap-[8px]">
            {index > 0 && (
              <Button size="xs" variant="ghost" onClick={onBack} aria-keyshortcuts="ArrowLeft" data-part="tip-back">
                <Kbd>←</Kbd>
                Back
              </Button>
            )}
            <Button size="sm" onClick={onNext} aria-keyshortcuts="ArrowRight" data-part="tip-next">
              {last ? "Got it" : "Next"}
              <Kbd onColor>→</Kbd>
            </Button>
          </div>
        </div>
      )}
    </AnchoredBubble>
  );
}
