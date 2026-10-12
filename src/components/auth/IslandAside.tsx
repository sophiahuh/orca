"use client";

import { motion } from "motion/react";
import { Wave } from "@/components/brand/Decor";
import { Island } from "@/components/brand/Island";
import { LabelPill } from "@/components/map/LabelPill";
import { popIn } from "@/lib/motion";

/** Figma: the island preview beside the log-in form (12 · Log in, 153:674). */
export function IslandAside({ label }: { label: string }) {
  return (
    <div className="relative hidden h-[483px] w-[588px] md:block" aria-hidden>
      <Wave tone="light" x={20} y={60} width={70} seed={1} />
      <Wave tone="light" x={470} y={400} width={60} seed={2} />
      <motion.div variants={popIn} initial="hidden" animate="show" className="absolute" style={{ left: 0, top: 0 }}>
        <Island variant="ald" level="growing" scale={2.1} float seed={2} />
        <div className="absolute left-[294px] -translate-x-1/2" style={{ top: 420 }}>
          <LabelPill interactive={false} className="text-[16px]">
            {label}
          </LabelPill>
        </div>
      </motion.div>
    </div>
  );
}
