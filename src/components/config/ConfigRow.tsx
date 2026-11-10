"use client";

import { motion } from "motion/react";
import type { Cadence, Duration, ReviewRow } from "@/lib/data";
import { IconBell } from "@/components/icons";
import { Select } from "@/components/ui/Select";
import { fadeUp } from "@/lib/motion";

export const DURATIONS: readonly Duration[] = ["5 min", "10 min", "15 min", "30 min", "1 hour", "3 hours", "10 hours"];
export const CADENCES: readonly Cadence[] = ["Daily", "Twice a week", "Weekly", "1 wk before exam"];

export const REVIEW_LABELS = { quick: "Quick review", deep: "Dive in", exam: "Exam review" } as const;

/**
 * Figma: Config Row — bell, label, duration select, cadence select. `stacked` puts the two selects
 * under the label, for a narrow column (account Settings' Preferences, beside the notes).
 */
export function ConfigRow({ label, row, onChange, stacked = false }: { label: string; row: ReviewRow; onChange: (r: ReviewRow) => void; stacked?: boolean }) {
  const bell = (
    <span className="flex h-[32px] w-[32px] shrink-0 items-center justify-center rounded-[10px] bg-alice text-wisteria-deep">
      <IconBell size={18} />
    </span>
  );
  const selects = (
    <>
      <Select label={`${label} duration`} value={row.duration} options={DURATIONS} onChange={(duration) => onChange({ ...row, duration })} />
      <Select label={`${label} cadence`} value={row.cadence} options={CADENCES} onChange={(cadence) => onChange({ ...row, cadence })} />
    </>
  );
  if (stacked)
    return (
      <motion.div variants={fadeUp} className="flex flex-col gap-[8px]">
        <div className="flex items-center gap-[10px]">
          {bell}
          <span className="text-[16px] font-bold text-prussian">{label}</span>
        </div>
        <div className="flex flex-wrap gap-[8px]">{selects}</div>
      </motion.div>
    );
  return (
    <motion.div variants={fadeUp} className="flex items-center gap-[14px]">
      {bell}
      <span className="w-[120px] shrink-0 text-[16px] font-bold text-prussian">{label}</span>
      {selects}
    </motion.div>
  );
}
