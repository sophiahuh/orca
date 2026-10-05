"use client";

import { AnimatePresence, motion } from "motion/react";
import { OrcaLogo } from "@/components/brand/OrcaLogo";
import { Screen } from "@/components/layout/Screen";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { popIn } from "@/lib/motion";
import { useOrca } from "@/lib/store";

/**
 * Whether changes are saving, and the last save that failed ("Couldn't save: …"; its change was
 * undone). Fixed at the bottom of every screen.
 */
export function SaveStatus() {
  const { saving, saveError, dismissSaveError } = useOrca();
  return (
    <div
      data-part="save-status"
      data-state={saveError ? "error" : saving > 0 ? "saving" : "idle"}
      aria-live="polite"
      className="pointer-events-none fixed bottom-[20px] left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-2 px-[16px]"
    >
      <AnimatePresence>
        {saveError && (
          <motion.div key="error" variants={popIn} initial="hidden" animate="show" exit="hidden" className="pointer-events-auto">
            <Card radius={16} lip={4} className="flex max-w-[560px] items-center gap-[14px] px-[18px] py-[12px]">
              <p role="alert" data-part="save-error" className="text-[15px] font-semibold text-prussian">
                {saveError}
              </p>
              <Button size="sm" variant="secondary" onClick={dismissSaveError}>
                Dismiss
              </Button>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>
      {!saveError && saving > 0 && <span className="rounded-pill bg-parchment px-[12px] py-[4px] text-[13px] font-semibold text-wisteria-deep">Saving…</span>}
    </div>
  );
}

/** Shown instead of the app when the student's data couldn't be loaded. Nothing falls back to something else. */
export function LoadFailed() {
  const { loadError, reload } = useOrca();
  return (
    <Screen bg="alice" className="items-center justify-center px-[16px]">
      <OrcaLogo width={72} shadow={false} />
      <Card className="mt-[24px] flex w-[520px] max-w-full flex-col items-start gap-[12px] px-[32px] py-[28px]">
        <h1 className="text-[28px] font-semibold text-prussian">Orca couldn&apos;t load your courses</h1>
        <p role="alert" className="text-[15px] text-prussian">
          {loadError}
        </p>
        <Button size="sm" onClick={reload}>
          Try again
        </Button>
      </Card>
    </Screen>
  );
}
