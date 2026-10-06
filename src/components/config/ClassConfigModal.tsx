"use client";

import { useEffect } from "react";
import { AnimatePresence, motion } from "motion/react";
import { type Course, DEFAULT_WEIGHTS, type ReviewConfig } from "@/lib/data";
import { IconClose } from "@/components/icons";
import { Button } from "@/components/ui/Button";
import { RoundButton } from "@/components/ui/RoundButton";
import { useOrca } from "@/lib/store";
import { overlayFade, popIn, stagger } from "@/lib/motion";
import { ConfigRow, REVIEW_LABELS } from "./ConfigRow";
import { WeightsEditor } from "./WeightsEditor";

/**
 * Figma: Config Modal. 680×440 parchment card over a dimmed screen: one course's review cadence
 * and material weights (Settings only holds the defaults new courses start with).
 * Edits write straight to the store (no local draft), so Done just closes.
 */
export function ClassConfigModal({ course, onClose }: { course: Course | null; onClose: () => void }) {
  const { configs, setConfig, weights, setWeights } = useOrca();

  useEffect(() => {
    if (!course) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [course, onClose]);

  const config: ReviewConfig | undefined = course ? configs[course.id] : undefined;

  return (
    <AnimatePresence>
      {course && config && (
        <motion.div
          key="overlay"
          className="fixed inset-0 z-50 flex items-center justify-center bg-prussian/70 p-6"
          variants={overlayFade}
          initial="hidden"
          animate="show"
          exit="exit"
          onClick={onClose}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="config-title"
            variants={popIn}
            initial="hidden"
            animate="show"
            exit="exit"
            onClick={(e) => e.stopPropagation()}
            className="relative flex max-h-full w-[680px] max-w-full flex-col overflow-y-auto rounded-[32px] bg-parchment px-[36px] pb-[32px] pt-[36px] lip-8 lip-alice"
            style={{ minHeight: 440 }}
          >
            <RoundButton size={44} label="Close" onClick={onClose} className="absolute right-[24px] top-[24px]">
              <IconClose size={20} />
            </RoundButton>

            <h2 id="config-title" className="text-[28px] font-semibold text-prussian">
              {course.short} Configurations
            </h2>
            <p className="mt-[10px] text-[15px] font-medium text-wisteria-deep">How often should Orca nudge you, and for how long?</p>

            <motion.div variants={stagger(0.1)} initial="hidden" animate="show" className="mt-[28px] flex flex-col gap-[18px]">
              {(["quick", "deep", "exam"] as const).map((k) => (
                <ConfigRow key={k} label={REVIEW_LABELS[k]} row={config[k]} onChange={(row) => setConfig(course.id, { ...config, [k]: row })} />
              ))}
            </motion.div>

            <h3 className="mt-[32px] text-[20px] font-semibold text-prussian">Weights</h3>
            <p className="mb-[16px] mt-[6px] text-[15px] font-medium text-wisteria-deep">What Orca prioritizes when it builds your reviews.</p>
            <WeightsEditor weights={weights[course.id] ?? DEFAULT_WEIGHTS} onChange={(w) => setWeights(course.id, w)} />

            <div className="mt-auto flex items-center justify-end pt-[32px]">
              <Button size="sm" onClick={onClose}>
                Done
              </Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
