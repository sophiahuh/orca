"use client";

import { motion } from "motion/react";
import { driftWave } from "@/lib/motion";

/**
 * Ambient decorations: wave squiggles and bubbles.
 * Wave stroke is parchment on alice backgrounds and alice-deep on parchment.
 */

export interface WaveProps {
  width?: 60 | 70 | 80 | 90 | 100;
  tone?: "light" | "deep";
  x: number;
  y: number;
  seed?: number;
  drift?: boolean;
}

export function Wave({ width = 60, tone = "light", x, y, seed = 0, drift = true }: WaveProps) {
  // One 20px period per hump; path spans `width`.
  const humps = width / 20;
  let d = "M0 8";
  for (let i = 0; i < humps; i++) {
    const x0 = i * 20;
    const up = i % 2 === 0;
    d += ` C${x0 + 6.67} ${up ? 1.33 : 14.67} ${x0 + 13.33} ${up ? 1.33 : 14.67} ${x0 + 20} 8`;
  }
  const stroke = tone === "light" ? "var(--color-parchment)" : "var(--color-alice-deep)";

  return (
    <motion.svg
      viewBox={`0 0 ${width} 16`}
      width={width}
      height={16}
      style={{ position: "absolute", left: x, top: y, overflow: "visible" }}
      animate={drift ? driftWave(seed) : undefined}
      aria-hidden
    >
      <path d={d} stroke={stroke} strokeWidth={4} strokeLinecap="round" fill="none" opacity={0.9} />
    </motion.svg>
  );
}

export interface BubbleProps {
  size: number;
  x: number;
  y: number;
  seed?: number;
}

export function Bubble({ size, x, y, seed = 0 }: BubbleProps) {
  return (
    <motion.div
      aria-hidden
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: size,
        height: size,
        borderRadius: 999,
        background: "var(--color-periwinkle)",
      }}
      animate={{ y: [0, -10, 0], opacity: [0.9, 0.6, 0.9] }}
      transition={{ duration: 4 + (seed % 3), repeat: Infinity, ease: "easeInOut", delay: (seed * 0.4) % 2 }}
    />
  );
}
