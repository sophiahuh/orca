"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import type { Course } from "@/lib/data";
import { Island, ISLAND_H, ISLAND_W } from "@/components/brand/Island";
import { OrcaLogo } from "@/components/brand/OrcaLogo";
import { Wave } from "@/components/brand/Decor";
import { useFitScale } from "@/hooks/useFitScale";
import { stagger } from "@/lib/motion";
import { useMasteryByCourse } from "@/lib/store";
import { LabelPill } from "./LabelPill";

export const MAP_W = 854;
export const MAP_H = 834;

const WAVES: Array<{ x: number; y: number; w: 60 | 70 | 80 | 90 }> = [
  { x: 60, y: 330, w: 70 },
  { x: 370, y: 90, w: 60 },
  { x: 700, y: 300, w: 80 },
  { x: 180, y: 780, w: 90 },
  { x: 560, y: 640, w: 60 },
  { x: 760, y: 760, w: 70 },
];

/** Two roomy columns keep the island frames and their full-name pills from colliding. */
const SAFE_SLOTS = [
  { x: 70, y: 40 }, { x: 500, y: 40 },
  { x: 70, y: 300 }, { x: 500, y: 300 },
  { x: 70, y: 560 }, { x: 500, y: 560 },
];
const MAP_GAP = 24;

function footprint(course: Course, pos: { x: number; y: number }) {
  // A label is 14px bold text plus horizontal padding. Cap the estimate to the map's usable width.
  const labelWidth = Math.min(390, Math.max(ISLAND_W, course.name.length * 8.4 + 50));
  return { x: pos.x + (ISLAND_W - labelWidth) / 2, y: pos.y, w: labelWidth, h: 242 };
}

function collides(a: ReturnType<typeof footprint>, b: ReturnType<typeof footprint>) {
  return a.x < b.x + b.w + MAP_GAP && a.x + a.w + MAP_GAP > b.x && a.y < b.y + b.h + MAP_GAP && a.y + a.h + MAP_GAP > b.y;
}

/**
 * The island map: a fixed 854×834 canvas scaled to fit its container.
 * Clicking an island or its label pill opens its path (its configuration is on that page).
 */
export function KnowledgeMap({ courses, dueCount }: { courses: Course[]; dueCount: (courseId: string) => number }) {
  const router = useRouter();
  const mastery = useMasteryByCourse();
  const positions = useMemo(() => {
    const placed: Array<{ course: Course; pos: { x: number; y: number } }> = [];
    for (const course of courses) {
      const candidates = [course.pos, ...SAFE_SLOTS];
      const pos = candidates.find((candidate) => !placed.some((other) => collides(footprint(course, candidate), footprint(other.course, other.pos)))) ?? SAFE_SLOTS[placed.length % SAFE_SLOTS.length];
      placed.push({ course, pos });
    }
    return new Map(placed.map(({ course, pos }) => [course.id, pos]));
  }, [courses]);
  const levelOf = (courseId: string) => {
    const m = mastery[courseId];
    if (!m) throw new Error(`No mastery computed for course ${courseId}`);
    return m.island;
  };
  const { ref, scale, x, y } = useFitScale(MAP_W, MAP_H, "contain");

  return (
    <div ref={ref} className="absolute inset-0">
      <motion.div
        className="absolute origin-top-left"
        style={{ width: MAP_W, height: MAP_H, left: x, top: y, transform: `scale(${scale})` }}
        variants={stagger(0.15, 0.08)}
        initial="hidden"
        animate="show"
      >
        {WAVES.map((w, i) => (
          <Wave key={i} tone="light" x={w.x} y={w.y} width={w.w} seed={i} />
        ))}

        {courses.map((c, i) => (
          <div key={c.id} className="absolute" style={{ left: positions.get(c.id)?.x ?? c.pos.x, top: positions.get(c.id)?.y ?? c.pos.y, width: ISLAND_W, height: ISLAND_H }}>
            <motion.button
              type="button"
              aria-label={`Open ${c.name}`}
              onClick={() => router.push(`/course/${c.slug}`)}
              className="absolute inset-0 cursor-pointer rounded-[40%] focus-visible:outline-4 focus-visible:outline-wisteria"
              whileHover={{ scale: 1.04 }}
              whileTap={{ scale: 0.98 }}
            >
              <Island variant={c.variant} level={levelOf(c.id)} float seed={i} />
            </motion.button>
            <div className="absolute left-1/2 -translate-x-1/2" style={{ top: 196 }}>
              <LabelPill count={dueCount(c.id)} onClick={() => router.push(`/course/${c.slug}`)} aria-label={`Open ${c.name}, ${dueCount(c.id)} due today`}>
                {c.name}
              </LabelPill>
            </div>
          </div>
        ))}

        <div className="absolute" style={{ left: 330, top: 190 }}>
          <OrcaLogo width={110} swim />
        </div>
      </motion.div>
    </div>
  );
}
