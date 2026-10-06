"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { IconCheck, IconClose } from "@/components/icons";
import { SIDEBAR_W } from "@/components/layout/Sidebar";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { type ConceptMastery, LINK_LABEL, type LinkKind, MASTERY_LABEL } from "@/lib/course/atlas";
import { cn } from "@/lib/cn";
import { fadeUp, stagger } from "@/lib/motion";

/**
 * Figma: Concept panel (105:238), the right rail while a concept is selected: the unit eyebrow,
 * the concept's name, its mastery bar and numbers, the concepts it's connected to (with how),
 * a Next up card, the legend, and the one action, which starts the existing study flow.
 */
export interface ConceptPanelProps {
  unitLabel: string;
  name: string;
  percent: number;
  answered: number;
  total: number;
  mastery: ConceptMastery;
  connected: Array<{ id: string; name: string; kind: LinkKind; mastery: ConceptMastery }>;
  nextUp: { title: string; detail: string } | null;
  reviewHref: string | null;
  onPick: (conceptId: string) => void;
  onClose: () => void;
}

function StateDot({ mastery, size = 16 }: { mastery: ConceptMastery; size?: number }) {
  if (mastery === "mastered")
    return (
      <span className="flex h-[20px] w-[20px] items-center justify-center rounded-pill bg-wisteria text-parchment" aria-hidden>
        <IconCheck size={12} strokeWidth={3.5} />
      </span>
    );
  return (
    <span
      className={cn("block rounded-pill", mastery === "building" ? "bg-wisteria" : mastery === "review" ? "border-[3px] border-wisteria-deep" : "border-2 border-alice-deep")}
      style={{ width: mastery === "not-started" ? size - 2 : size, height: mastery === "not-started" ? size - 2 : size }}
      aria-hidden
    />
  );
}

export function ConceptPanel({ unitLabel, name, percent, answered, total, mastery, connected, nextUp, reviewHref, onPick, onClose }: ConceptPanelProps) {
  return (
    <motion.aside
      variants={stagger()}
      initial="hidden"
      animate="show"
      data-part="concept-panel"
      aria-label={`${name} details`}
      className="flex h-full shrink-0 flex-col gap-[14px] overflow-y-auto border-l-2 border-alice-deep bg-parchment px-[28px] pb-[28px] pt-[36px]"
      style={{ width: SIDEBAR_W }}
    >
      <div className="flex items-start justify-between gap-[10px]">
        <motion.span variants={fadeUp} className="text-[13px] font-semibold uppercase tracking-[1.2px] text-wisteria-deep">
          {unitLabel}
        </motion.span>
        <button type="button" onClick={onClose} aria-label="Close" className="pressable -mr-[8px] -mt-[8px] flex h-[32px] w-[32px] items-center justify-center rounded-pill text-wisteria-deep hover:bg-alice">
          <IconClose size={16} />
        </button>
      </div>
      <motion.h2 variants={fadeUp} className="text-[40px] font-bold leading-[1.05] text-prussian">
        {name}
      </motion.h2>
      <motion.div variants={fadeUp} className="w-[284px] max-w-full">
        <ProgressBar value={percent / 100} height={18} label={`${name} mastery`} />
      </motion.div>
      <motion.p variants={fadeUp} className="text-[15px] text-prussian" data-part="concept-numbers">
        {percent}% mastered · {answered} of {total} question{total === 1 ? "" : "s"}
      </motion.p>

      <motion.h3 variants={fadeUp} className="pt-[8px] text-[22px] font-semibold text-prussian">
        Connected concepts
      </motion.h3>
      {connected.length === 0 ? (
        <motion.p variants={fadeUp} className="text-[15px] text-wisteria-deep">
          No connections recorded for this one yet.
        </motion.p>
      ) : (
        connected.map((c) => (
          <motion.button
            key={c.id}
            variants={fadeUp}
            type="button"
            onClick={() => onPick(c.id)}
            data-part="connection"
            className="flex w-full items-center gap-[10px] text-left"
          >
            <StateDot mastery={c.mastery} size={14} />
            <span className="min-w-0 flex-1 truncate text-[17px] font-semibold text-prussian">{c.name}</span>
            <span className={cn("shrink-0 rounded-pill px-[10px] py-[4px] text-[12px] font-semibold", c.kind === "prerequisite" ? "bg-wisteria text-parchment" : "bg-alice text-prussian")}>{LINK_LABEL[c.kind]}</span>
          </motion.button>
        ))
      )}

      {nextUp && (
        <motion.div variants={fadeUp} className="flex flex-col gap-[4px] rounded-[22px] border-2 border-alice-deep bg-alice px-[18px] pb-[16px] pt-[14px]" data-part="next-up">
          <span className="text-[13px] font-semibold text-wisteria-deep">Next up</span>
          <span className="text-[18px] font-bold text-prussian">{nextUp.title}</span>
          <span className="text-[14px] text-prussian">{nextUp.detail}</span>
        </motion.div>
      )}

      <motion.dl variants={fadeUp} className="flex w-[284px] max-w-full flex-wrap gap-x-[14px] gap-y-[8px] pt-[6px]" aria-label="Legend">
        {(["mastered", "building", "review", "not-started"] as ConceptMastery[]).map((m) => (
          <div key={m} className={cn("flex items-center gap-[6px] text-[14px] font-semibold text-prussian", m === mastery && "underline decoration-wisteria decoration-2 underline-offset-4")}>
            <StateDot mastery={m} />
            {MASTERY_LABEL[m]}
          </div>
        ))}
      </motion.dl>

      {reviewHref && (
        <motion.div variants={fadeUp} className="pt-[4px]">
          <Link href={reviewHref} data-part="review-concept" className="pressable flex w-full items-center justify-center rounded-[20px] bg-wisteria px-8 py-4 text-[17px] font-bold leading-none text-parchment lip-5 lip-wisteria">
            Review {name}
          </Link>
        </motion.div>
      )}
    </motion.aside>
  );
}
