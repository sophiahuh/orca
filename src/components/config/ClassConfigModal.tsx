"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { type Course, DEFAULT_CONFIG, DEFAULT_WEIGHTS, type ReviewConfig, type Weights } from "@/lib/data";
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
  const { configs, setConfig, weights, setWeights, configOverrides, weightOverrides, clearConfigOverride, clearWeightOverride, defaultConfig, defaultWeights } = useOrca();
  const [draftConfig, setDraftConfig] = useState<ReviewConfig>(DEFAULT_CONFIG);
  const [draftWeights, setDraftWeights] = useState<Weights>(DEFAULT_WEIGHTS);
  const [inheritConfig, setInheritConfig] = useState(true);
  const [inheritWeights, setInheritWeights] = useState(true);
  const [draftCourseId, setDraftCourseId] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const dismiss = () => {
    setDraftCourseId(null);
    setSaved(false);
    onClose();
  };

  useEffect(() => {
    if (!course) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && dismiss();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [course, onClose]);

  const isDraftForCourse = course !== null && draftCourseId === course.id;
  const config = course && isDraftForCourse ? draftConfig : (course ? configs[course.id] ?? defaultConfig : draftConfig);
  const courseWeights = course && isDraftForCourse ? draftWeights : (course ? weights[course.id] ?? defaultWeights : draftWeights);
  const courseInheritsConfig = course && isDraftForCourse ? inheritConfig : course ? configOverrides[course.id] === null : inheritConfig;
  const courseInheritsWeights = course && isDraftForCourse ? inheritWeights : course ? weightOverrides[course.id] === null : inheritWeights;

  const changeConfig = (next: ReviewConfig) => {
    setDraftConfig(next);
    setDraftCourseId(course?.id ?? null);
    setInheritConfig(false);
    if (course && !isDraftForCourse) setInheritWeights(weightOverrides[course.id] === null);
    setSaved(false);
  };
  const changeWeights = (next: Weights) => {
    setDraftWeights(next);
    setDraftCourseId(course?.id ?? null);
    setInheritWeights(false);
    if (course && !isDraftForCourse) setInheritConfig(configOverrides[course.id] === null);
    setSaved(false);
  };

  const save = () => {
    if (!course) return;
    if (courseInheritsConfig) clearConfigOverride(course.id);
    else setConfig(course.id, config);
    if (courseInheritsWeights) clearWeightOverride(course.id);
    else setWeights(course.id, courseWeights);
    setDraftCourseId(null);
    setSaved(true);
  };

  return (
    <AnimatePresence>
      {course && (
        <motion.div
          key="overlay"
          className="fixed inset-0 z-50 flex items-center justify-center bg-prussian/70 p-4"
          variants={overlayFade}
          initial="hidden"
          animate="show"
          exit="exit"
          onClick={dismiss}
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
            className="relative flex max-h-full w-[920px] max-w-full flex-col overflow-auto rounded-[28px] bg-parchment px-[24px] pb-[20px] pt-[24px] lip-8 lip-alice"
          >
            <RoundButton size={44} label="Close" onClick={dismiss} className="absolute right-[16px] top-[16px]">
              <IconClose size={20} />
            </RoundButton>

            <h2 id="config-title" className="text-[28px] font-semibold text-prussian">
              {course.name} Configurations
            </h2>
            <p className="mt-[6px] text-[15px] font-medium text-wisteria-deep">
              This course inherits your account settings until you make an override here. Course overrides take priority.
            </p>

            <motion.div variants={stagger(0.05, 0.08)} initial="hidden" animate="show" className="mt-[16px] flex min-w-[848px] flex-nowrap items-start gap-[12px]">
              <motion.div variants={popIn} className="flex w-[560px] flex-col gap-[12px]">
                <Card className="flex flex-col gap-[12px] px-[24px] pb-[22px] pt-[20px]">
                  <div className="flex flex-col gap-[4px]">
                    <h3 className="text-[22px] font-bold text-prussian">Review preferences</h3>
                    <p className="text-[14px] font-medium text-wisteria-deep">How often Orca should nudge you, and for how long. Editing creates a course override.</p>
                  </div>
                  <motion.div variants={stagger(0, 0.05)} className="flex flex-col gap-[10px]">
                    {(["quick", "deep", "exam"] as const).map((k) => (
                      <ConfigRow key={k} label={REVIEW_LABELS[k]} row={config[k]} onChange={(row) => changeConfig({ ...config, [k]: row })} />
                    ))}
                  </motion.div>
                  {!courseInheritsConfig && (
                    <Button size="sm" variant="ghost" className="self-start" onClick={() => { setDraftConfig(defaultConfig); setDraftCourseId(course.id); setInheritConfig(true); if (!isDraftForCourse) setInheritWeights(weightOverrides[course.id] === null); setSaved(false); }}>
                      Use account review settings
                    </Button>
                  )}
                </Card>

                <Card className="flex flex-col gap-[12px] px-[24px] pb-[20px] pt-[20px]">
                  <div className="flex flex-col gap-[4px]">
                    <h3 className="text-[22px] font-bold text-prussian">Course weights</h3>
                    <p className="text-[14px] font-medium text-wisteria-deep">What Orca prioritizes when it builds reviews for this course.</p>
                  </div>
                  <WeightsEditor weights={courseWeights} onChange={changeWeights} />
                  {!courseInheritsWeights && (
                    <Button size="sm" variant="ghost" className="self-start" onClick={() => { setDraftWeights(defaultWeights); setDraftCourseId(course.id); setInheritWeights(true); if (!isDraftForCourse) setInheritConfig(configOverrides[course.id] === null); setSaved(false); }}>
                      Use account weights
                    </Button>
                  )}
                </Card>
              </motion.div>

              <motion.div variants={popIn} className="w-[276px]">
                <Card className="flex flex-col gap-[8px] px-[20px] py-[20px]" tone="alice" lip={4}>
                  <p className="text-[13px] font-bold uppercase tracking-[0.08em] text-wisteria-deep">Course overrides</p>
                  <h3 className="text-[22px] font-bold leading-tight text-prussian">{course.name}</h3>
                  <p className="pt-[4px] text-[14px] font-medium leading-relaxed text-wisteria-deep">
                    Review settings: {courseInheritsConfig ? "inheriting account default" : "course override ready"}. Weights: {courseInheritsWeights ? "inheriting account default" : "course override ready"}.
                  </p>
                </Card>
              </motion.div>
            </motion.div>

            <div className="mt-auto flex items-center justify-end gap-[12px] pt-[20px]">
              {saved && <span className="text-[14px] font-semibold text-good-deep">Saved</span>}
              <Button size="sm" onClick={save}>
                Save
              </Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
