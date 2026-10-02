"use client";

import { motion } from "motion/react";
import type { Cadence, Duration, ReviewRow } from "@/lib/data";
import { IconBell } from "@/components/icons";
import { Select } from "@/components/ui/Select";
import { fadeUp } from "@/lib/motion";

export const DURATIONS: readonly Duration[] = ["5 min", "15 min", "30 min", "1 hour", "3 hours", "10 hours"];
export const CADENCES: readonly Cadence[] = ["Daily", "Weekly", "1 wk before exam"];

export const REVIEW_LABELS = { quick: "Quick review", deep: "Deep review", exam: "Exam review" } as const;

/** Figma: Config Row — bell, label, duration select, cadence select. */
export function ConfigRow({ label, row, onChange }: { label: string; row: ReviewRow; onChange: (r: ReviewRow) => void }) {
  return (
    <motion.div variants={fadeUp} className="flex items-center gap-[14px]">
      <span className="flex h-[32px] w-[32px] shrink-0 items-center justify-center rounded-[10px] bg-alice text-wisteria-deep">
        <IconBell size={18} />
      </span>
      <span className="w-[120px] shrink-0 text-[16px] font-bold text-prussian">{label}</span>
      <Select label={`${label} duration`} value={row.duration} options={DURATIONS} onChange={(duration) => onChange({ ...row, duration })} />
      <Select label={`${label} cadence`} value={row.cadence} options={CADENCES} onChange={(cadence) => onChange({ ...row, cadence })} />
    </motion.div>
  );
}
