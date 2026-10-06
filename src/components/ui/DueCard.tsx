"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { IconPlay } from "@/components/icons";
import { fadeUp } from "@/lib/motion";

/**
 * Figma: Sidebar due card. Course eyebrow, title, optional detail line, wisteria play button.
 */
export interface DueCardProps {
  course: string;
  title: string;
  detail?: string | null;
  href: string;
  /** Stable hook for tests (`data-todo`). */
  kind?: string;
}

export function DueCard({ course, title, detail, href, kind }: DueCardProps) {
  return (
    <motion.div variants={fadeUp}>
      <Link
        href={href}
        data-todo={kind}
        className="pressable flex items-center gap-3 rounded-[18px] border-2 border-alice-deep bg-parchment py-[12px] pl-[16px] pr-[12px] lip-4 lip-alice"
      >
        <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
          <span className="break-words text-[11px] font-semibold uppercase tracking-[1.2px] text-wisteria-deep">{course}</span>
          <span className="truncate text-[15px] font-bold text-prussian">{title}</span>
          {detail && <span className="line-clamp-2 text-[13px] leading-snug text-wisteria-deep">{detail}</span>}
        </span>
        <span className="flex h-[36px] w-[36px] shrink-0 items-center justify-center rounded-pill bg-wisteria text-parchment lip-2 lip-wisteria">
          <IconPlay size={16} />
        </span>
      </Link>
    </motion.div>
  );
}
