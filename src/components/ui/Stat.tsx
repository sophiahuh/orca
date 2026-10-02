"use client";

import { motion } from "motion/react";
import { fadeUp } from "@/lib/motion";

/** Figma: Quiz End stat tile. Alice, 20px radius, value 28 bold, label 13 wisteria-deep. */
export function Stat({ value, label }: { value: string; label: string }) {
  return (
    <motion.div variants={fadeUp} className="flex min-w-0 flex-1 flex-col items-center gap-1 rounded-[20px] bg-alice px-4 py-5">
      <span className="text-[28px] font-bold leading-none text-prussian">{value}</span>
      <span className="text-[13px] font-medium text-wisteria-deep">{label}</span>
    </motion.div>
  );
}
