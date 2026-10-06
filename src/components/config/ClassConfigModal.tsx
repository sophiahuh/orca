"use client";

import { useEffect } from "react";
import { AnimatePresence, motion } from "motion/react";
import { type Course, DEFAULT_WEIGHTS, type ReviewConfig } from "@/lib/data";
import { IconClose } from "@/components/icons";
import { Button } from "@/components/ui/Button";
import { RoundButton } from "@/components/ui/RoundButton";
import { Card } from "@/components/ui/Card";
import { useOrca } from "@/lib/store";
import { overlayFade, popIn, stagger } from "@/lib/motion";
import { ConfigRow, REVIEW_LABELS } from "./ConfigRow";
import { WeightsEditor } from "./WeightsEditor";

/**
 * A course-specific counterpart to the main Configurations page. It starts by inheriting the
 * account configuration; an edit creates a higher-priority course override.
 */
export function ClassConfigModal({ course, onClose }: { course: Course | null; onClose: () => void }) {
  const { configs, setConfig, weights, setWeights, configOverrides, weightOverrides, clearConfigOverride, clearWeightOverride } = useOrca();

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
            className="relative flex max-h-full w-[980px] max-w-full flex-col overflow-y-auto rounded-[32px] bg-parchment px-[36px] pb-[32px] pt-[36px] lip-8 lip-alice"
          >
            <RoundButton size={44} label="Close" onClick={onClose} className="absolute right-[24px] top-[24px]">
              <IconClose size={20} />
            </RoundButton>

            <h2 id="config-title" className="text-[28px] font-semibold text-prussian">
              {course.name} Configurations
            </h2>
            <p className="mt-[10px] text-[15px] font-medium text-wisteria-deep">
              This course inherits your account settings until you make an override here. Course overrides take priority.
            </p>

            <motion.div variants={stagger(0.05, 0.08)} initial="hidden" animate="show" className="mt-[28px] flex flex-wrap items-start gap-[24px]">
              <motion.div variants={popIn} className="flex w-[580px] max-w-full flex-1 flex-col gap-[24px]">
                <Card className="flex flex-col gap-[18px] px-[28px] pb-[28px] pt-[24px]">
                  <div className="flex flex-col gap-[4px]">
                    <h3 className="text-[22px] font-bold text-prussian">Review preferences</h3>
                    <p className="text-[14px] font-medium text-wisteria-deep">How often Orca should nudge you, and for how long. Editing creates a course override.</p>
                  </div>
                  <motion.div variants={stagger(0, 0.05)} className="flex flex-col gap-[14px]">
                    {(["quick", "deep", "exam"] as const).map((k) => (
                      <ConfigRow key={k} label={REVIEW_LABELS[k]} row={config[k]} onChange={(row) => setConfig(course.id, { ...config, [k]: row })} />
                    ))}
                  </motion.div>
                  {configOverrides[course.id] !== null && (
                    <Button size="sm" variant="ghost" className="self-start" onClick={() => clearConfigOverride(course.id)}>
                      Use account review settings
                    </Button>
                  )}
                </Card>

                <Card className="flex flex-col gap-[16px] px-[28px] pb-[24px] pt-[24px]">
                  <div className="flex flex-col gap-[4px]">
                    <h3 className="text-[22px] font-bold text-prussian">Course weights</h3>
                    <p className="text-[14px] font-medium text-wisteria-deep">What Orca prioritizes when it builds reviews for this course.</p>
                  </div>
                  <WeightsEditor weights={weights[course.id] ?? DEFAULT_WEIGHTS} onChange={(w) => setWeights(course.id, w)} />
                  {weightOverrides[course.id] !== null && (
                    <Button size="sm" variant="ghost" className="self-start" onClick={() => clearWeightOverride(course.id)}>
                      Use account weights
                    </Button>
                  )}
                </Card>
              </motion.div>

              <motion.div variants={popIn} className="w-[280px] max-w-full">
                <Card className="flex flex-col gap-[8px] px-[24px] py-[24px]" tone="alice" lip={4}>
                  <p className="text-[13px] font-bold uppercase tracking-[0.08em] text-wisteria-deep">Course overrides</p>
                  <h3 className="text-[22px] font-bold leading-tight text-prussian">{course.name}</h3>
                  <p className="pt-[4px] text-[14px] font-medium leading-relaxed text-wisteria-deep">
                    Review settings: {configOverrides[course.id] === null ? "inheriting account default" : "course override active"}. Weights: {weightOverrides[course.id] === null ? "inheriting account default" : "course override active"}.
                  </p>
                </Card>
              </motion.div>
            </motion.div>

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
