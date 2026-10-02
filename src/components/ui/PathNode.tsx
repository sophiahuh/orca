"use client";

import { motion } from "motion/react";
import type { TopicStatus } from "@/lib/data";
import { IconCheck, IconLock, IconPlay } from "@/components/icons";
import { cn } from "@/lib/cn";
import { popIn, pulseHalo, springBouncy } from "@/lib/motion";

/**
 * Figma: Knowledge Path node. done = periwinkle + check, current = large
 * wisteria + play with a pulsing halo and a START bubble, locked = parchment + lock.
 * Positioned absolutely by its centre inside the 854×834 path canvas.
 */
export const NODE_SIZE: Record<TopicStatus, number> = { done: 72, current: 104, locked: 72 };
const HALO = 150;

export interface PathNodeProps {
  status: TopicStatus;
  x: number;
  y: number;
  name: string;
  sub: string;
  onClick?: () => void;
  index?: number;
}

export function PathNode({ status, x, y, name, sub, onClick, index = 0 }: PathNodeProps) {
  const size = NODE_SIZE[status];
  const clickable = status !== "locked" && Boolean(onClick);

  const face =
    status === "done"
      ? "bg-periwinkle border-periwinkle-deep text-prussian lip-periwinkle"
      : status === "current"
        ? "bg-wisteria border-wisteria-deep text-parchment lip-wisteria"
        : "bg-parchment border-alice-deep text-periwinkle-deep lip-alice";

  return (
    <div className="absolute" style={{ left: x, top: y, width: 0, height: 0 }} data-status={status}>
      {status === "current" && (
        <motion.div
          data-part="halo"
          aria-hidden
          className="absolute rounded-pill bg-periwinkle"
          style={{ width: HALO, height: HALO, left: -HALO / 2, top: -HALO / 2 }}
          animate={pulseHalo}
        />
      )}

      {status === "current" && (
        <motion.span
          data-part="start"
          variants={popIn}
          initial="hidden"
          animate="show"
          transition={{ ...springBouncy, delay: 0.5 + index * 0.08 }}
          className="absolute left-1/2 -translate-x-1/2 rounded-pill border-2 border-alice-deep bg-parchment px-[14px] py-[7px] text-[13px] font-bold tracking-[1px] text-wisteria-deep lip-2 lip-alice"
          style={{ top: -size / 2 - 44 }}
        >
          START
        </motion.span>
      )}

      <motion.button
        type="button"
        data-part="node"
        variants={popIn}
        initial="hidden"
        animate="show"
        transition={{ ...springBouncy, delay: 0.25 + index * 0.08 }}
        whileHover={clickable ? { scale: 1.06 } : undefined}
        onClick={clickable ? onClick : undefined}
        disabled={!clickable}
        aria-label={`${name}: ${sub}`}
        className={cn(
          "pressable absolute flex items-center justify-center rounded-pill border-[3px] lip-5 disabled:opacity-100",
          face,
          !clickable && "cursor-default",
        )}
        style={{ width: size, height: size, left: -size / 2, top: -size / 2 }}
      >
        {status === "done" && <IconCheck size={30} />}
        {status === "current" && <IconPlay size={44} />}
        {status === "locked" && <IconLock size={30} strokeWidth={3} />}
      </motion.button>

      <motion.div
        data-part="label"
        variants={popIn}
        initial="hidden"
        animate="show"
        transition={{ ...springBouncy, delay: 0.35 + index * 0.08 }}
        className="absolute flex flex-col gap-[2px] whitespace-nowrap"
        style={{ left: size / 2 + 18, top: -22 }}
      >
        <span className={cn("text-[22px] font-bold leading-tight", status === "locked" ? "text-periwinkle-deep" : "text-prussian")}>
          {name}
        </span>
        <span className={cn("text-[15px] font-medium", status === "locked" ? "text-periwinkle-deep" : "text-wisteria-deep")}>{sub}</span>
      </motion.div>
    </div>
  );
}
