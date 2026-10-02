"use client";

import { motion } from "motion/react";
import type { Course, Topic } from "@/lib/data";
import { trailFromPoints } from "@/lib/data";
import { Wave } from "@/components/brand/Decor";
import { PathNode } from "@/components/ui/PathNode";
import { useFitScale } from "@/hooks/useFitScale";
import { revealDown } from "@/lib/motion";

export const PATH_W = 854;
export const PATH_H = 834;

const WAVES: Array<{ x: number; y: number; w: 60 | 70 | 80 | 90 }> = [
  { x: 60, y: 300, w: 70 },
  { x: 700, y: 480, w: 80 },
  { x: 70, y: 720, w: 60 },
  { x: 640, y: 150, w: 60 },
];

function statusLine(t: Topic) {
  if (t.status === "done") return "Complete";
  if (t.status === "locked") return "Locked";
  return `${t.lessonsDone} of ${t.lessons} lessons`;
}

/** Dotted trail + nodes, in a fixed 854×834 canvas scaled to fit. */
export function KnowledgePath({ course, onStart }: { course: Course; onStart: (topic: Topic) => void }) {
  const { ref, scale, x, y } = useFitScale(PATH_W, PATH_H, "contain");
  const d = course.trail ?? trailFromPoints(course.topics.map((t) => t.pos));

  return (
    <div ref={ref} className="absolute inset-0">
      <div className="absolute origin-top-left" style={{ width: PATH_W, height: PATH_H, left: x, top: y, transform: `scale(${scale})` }}>
        {WAVES.map((w, i) => (
          <Wave key={i} tone="light" x={w.x} y={w.y} width={w.w} seed={i + 3} />
        ))}

        <svg className="absolute inset-0 overflow-visible" width={PATH_W} height={PATH_H} viewBox={`0 0 ${PATH_W} ${PATH_H}`} aria-hidden>
          <defs>
            <clipPath id={`trail-clip-${course.id}`}>
              <motion.rect x={0} y={0} width={PATH_W} variants={revealDown(PATH_H)} initial="hidden" animate="show" />
            </clipPath>
          </defs>
          <path
            data-part="trail"
            d={d}
            fill="none"
            stroke="var(--color-wisteria-deep)"
            strokeWidth={8}
            strokeLinecap="round"
            strokeDasharray="1 20"
            clipPath={`url(#trail-clip-${course.id})`}
          />
        </svg>

        {course.topics.map((t, i) => (
          <PathNode
            key={t.id}
            index={i}
            status={t.status}
            x={t.pos.x}
            y={t.pos.y}
            name={t.name}
            sub={statusLine(t)}
            onClick={t.status === "locked" ? undefined : () => onStart(t)}
          />
        ))}
      </div>
    </div>
  );
}
