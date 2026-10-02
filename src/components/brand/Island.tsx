"use client";

import { motion, type HTMLMotionProps } from "motion/react";
import type { IslandVariant } from "@/lib/data";
import { floatIsland } from "@/lib/motion";

/**
 * Island blobs (Figma: Island/ALD, Island/Circuit Analysis, Island/Signals,
 * Island/Linear Algebra, Island/Statistics).
 *
 * Each variant is a 280×230 frame. "Active" islands (ALD, Circuit) have a
 * periwinkle interior, a wisteria outline, and two little trees. Dormant
 * islands are pale with an alice interior and no trees.
 *
 * Every path is a <motion.path>, so grow/shrink, colour shifts, and tree
 * sprouting animations are all available later with no restructuring.
 */

interface Blob {
  /** Natural SVG size of the traced group. */
  w: number;
  h: number;
  /** Where the group sits inside the 280×230 frame. */
  x: number;
  y: number;
  base: string;
  top: string;
  inner: string;
  trees?: boolean;
  treeOffset?: { x: number; y: number };
}

const BLOBS: Record<IslandVariant, Blob> = {
  ald: {
    w: 205.665, h: 171.487, x: 43, y: 34,
    base: "M6.98 97.98C-13.02 47.98 36.98 7.98 96.98 17.98C156.98 2.98 206.98 37.98 201.98 92.98C211.98 142.98 156.98 172.98 96.98 167.98C46.98 182.98 16.98 147.98 6.98 97.98Z",
    top: "M6.98 85.98C-13.02 35.98 36.98 -4.02 96.98 5.98C156.98 -9.02 206.98 25.98 201.98 80.98C211.98 130.98 156.98 160.98 96.98 155.98C46.98 170.98 16.98 135.98 6.98 85.98Z",
    inner: "M37.38 84.38C23.78 50.38 57.78 23.18 98.58 29.98C139.38 19.78 173.38 43.58 169.98 80.98C176.78 114.98 139.38 135.38 98.58 131.98C64.58 142.18 44.18 118.38 37.38 84.38Z",
    trees: true,
    treeOffset: { x: 0, y: 0 },
  },
  circuit: {
    w: 212.6, h: 170.637, x: 36, y: 31,
    base: "M4.415 80.765C14.415 30.765 84.415 0.765 134.415 20.765C189.415 10.765 224.415 60.765 204.415 110.765C189.415 160.765 124.415 180.765 74.415 165.765C24.415 160.765 -5.585 130.765 4.415 80.765Z",
    top: "M4.415 68.765C14.415 18.765 84.415 -11.235 134.415 8.765C189.415 -1.235 224.415 48.765 204.415 98.765C189.415 148.765 124.415 168.765 74.415 153.765C24.415 148.765 -5.585 118.765 4.415 68.765Z",
    inner: "M38.015 73.565C44.815 39.565 92.415 19.165 126.415 32.765C163.815 25.965 187.615 59.965 174.015 93.965C163.815 127.965 119.615 141.565 85.615 131.365C51.615 127.965 31.215 107.565 38.015 73.565Z",
    trees: true,
    treeOffset: { x: 7.4, y: 2.8 },
  },
  signals: {
    w: 213.943, h: 173.916, x: 30, y: 32,
    base: "M5.198 109.69C-9.802 59.69 40.198 14.69 95.198 29.69C130.198 -0.31 195.198 14.69 205.198 69.69C225.198 109.69 195.198 159.69 140.198 164.69C100.198 184.69 40.198 174.69 5.198 109.69Z",
    top: "M5.198 97.69C-9.802 47.69 40.198 2.69 95.198 17.69C130.198 -12.31 195.198 2.69 205.198 57.69C225.198 97.69 195.198 147.69 140.198 152.69C100.198 172.69 40.198 162.69 5.198 97.69Z",
    inner: "M40.398 92.89C30.198 58.89 64.198 28.29 101.598 38.49C125.398 18.09 169.598 28.29 176.398 65.69C189.998 92.89 169.598 126.89 132.198 130.29C104.998 143.89 64.198 137.09 40.398 92.89Z",
  },
  linear: {
    w: 192.004, h: 157.346, x: 53, y: 39,
    base: "M6.997 83.023C-13.003 38.023 36.997 3.023 91.997 18.023C146.997 3.023 201.997 43.023 186.997 93.023C176.997 143.023 121.997 168.023 71.997 153.023C26.997 163.023 11.997 128.023 6.997 83.023Z",
    top: "M6.997 71.023C-13.003 26.023 36.997 -8.977 91.997 6.023C146.997 -8.977 201.997 31.023 186.997 81.023C176.997 131.023 121.997 156.023 71.997 141.023C26.997 151.023 11.997 116.023 6.997 71.023Z",
    inner: "M34.197 72.623C20.597 42.023 54.597 18.223 91.997 28.423C129.397 18.223 166.797 45.423 156.597 79.423C149.797 113.423 112.397 130.423 78.397 120.223C47.797 127.023 37.597 103.223 34.197 72.623Z",
  },
  stats: {
    w: 205.665, h: 171.487, x: 43, y: 34,
    base: "M6.98 97.98C-13.02 47.98 36.98 7.98 96.98 17.98C156.98 2.98 206.98 37.98 201.98 92.98C211.98 142.98 156.98 172.98 96.98 167.98C46.98 182.98 16.98 147.98 6.98 97.98Z",
    top: "M6.98 85.98C-13.02 35.98 36.98 -4.02 96.98 5.98C156.98 -9.02 206.98 25.98 201.98 80.98C211.98 130.98 156.98 160.98 96.98 155.98C46.98 170.98 16.98 135.98 6.98 85.98Z",
    inner: "M37.38 84.38C23.78 50.38 57.78 23.18 98.58 29.98C139.38 19.78 173.38 43.58 169.98 80.98C176.78 114.98 139.38 135.38 98.58 131.98C64.58 142.18 44.18 118.38 37.38 84.38Z",
  },
};

export const ISLAND_W = 280;
export const ISLAND_H = 230;

export interface IslandProps extends Omit<HTMLMotionProps<"div">, "children"> {
  variant: IslandVariant;
  /** Active islands are periwinkle with trees; dormant are pale. Defaults by variant. */
  active?: boolean;
  /** Scale factor applied to the 280×230 frame. */
  scale?: number;
  /** Ambient bobbing. */
  float?: boolean;
  /** Seed to desynchronize floating neighbours. */
  seed?: number;
}

export function Island({ variant, active, scale = 1, float = false, seed = 0, className, style, ...rest }: IslandProps) {
  const b = BLOBS[variant];
  const isActive = active ?? Boolean(b.trees);
  const stroke = isActive ? "var(--color-wisteria)" : "var(--color-alice-deep)";
  const inner = isActive ? "var(--color-periwinkle)" : "var(--color-alice)";
  const t = b.treeOffset ?? { x: 0, y: 0 };

  return (
    <motion.div
      className={className}
      style={{ width: ISLAND_W * scale, height: ISLAND_H * scale, position: "relative", ...style }}
      animate={float ? floatIsland(seed) : undefined}
      {...rest}
    >
      <svg
        viewBox={`0 0 ${b.w} ${b.h}`}
        width={b.w * scale}
        height={b.h * scale}
        style={{ position: "absolute", left: b.x * scale, top: b.y * scale, overflow: "visible" }}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden
      >
        <motion.path data-part="base" d={b.base} fill="var(--color-alice-deep)" />
        <motion.path data-part="top" d={b.top} fill="var(--color-parchment)" stroke={stroke} strokeWidth={5} strokeLinejoin="round" />
        <motion.path data-part="inner" d={b.inner} fill={inner} />
        {isActive && (
          <g data-part="trees" transform={`translate(${t.x} ${t.y})`}>
            <motion.circle cx="71.98" cy="63.98" r="15" fill="var(--color-wisteria)" />
            <motion.rect x="69.98" y="75.98" width="5" height="14" rx="2" fill="var(--color-prussian)" />
            <motion.circle cx="131.98" cy="87.98" r="12" fill="var(--color-wisteria-deep)" />
            <motion.rect x="129.98" y="96.98" width="4" height="12" rx="2" fill="var(--color-prussian)" />
          </g>
        )}
      </svg>
    </motion.div>
  );
}
