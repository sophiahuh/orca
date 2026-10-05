"use client";

import { motion } from "motion/react";
import type { Course, Topic } from "@/lib/data";
import { pathCanvasHeight, trailFromPoints } from "@/lib/data";
import { Wave } from "@/components/brand/Decor";
import type { TopicProgress } from "@/lib/mastery/progress";
import { type NodeVisual, PathNode } from "@/components/ui/PathNode";
import { useFitScale } from "@/hooks/useFitScale";
import { revealDown } from "@/lib/motion";

export const PATH_W = 854;

const WAVES: Array<{ x: number; y: number; w: 60 | 70 | 80 | 90 }> = [
  { x: 60, y: 300, w: 70 },
  { x: 700, y: 480, w: 80 },
  { x: 70, y: 720, w: 60 },
  { x: 640, y: 150, w: 60 },
];

function statusLine(p: TopicProgress) {
  if (p.total === 0) return "No questions yet";
  if (p.status === "done") return "Complete";
  if (p.status === "not-started") return `${p.total} ${p.total === 1 ? "objective" : "objectives"}`;
  return `${p.mastered} of ${p.total} objectives mastered`;
}

/** Dotted trail + nodes, in a fixed 854×834 canvas scaled to fit. */
export function KnowledgePath({ course, progress, onStart }: {
  course: Course;
  progress: ReadonlyMap<string, TopicProgress>;
  onStart: (topic: Topic) => void;
}) {
  const progressOf = (t: Topic) => {
    const p = progress.get(t.id);
    if (!p) throw new Error(`No progress computed for topic ${t.id}`);
    return p;
  };
  const firstOpen = course.topics.findIndex((t) => progressOf(t).status !== "done");
  const visualOf = (t: Topic, i: number): NodeVisual =>
    progressOf(t).status === "done" ? "done" : i === firstOpen ? "current" : "upcoming";
  const PATH_H = pathCanvasHeight(course.topics.length);
  // Fit the 854×834 design frame as before; longer trails keep that scale and scroll.
  const { ref, scale, x } = useFitScale(PATH_W, 834, "contain");
  const d = course.trail ?? trailFromPoints(course.topics.map((t) => t.pos));

  return (
    <div ref={ref} className="absolute inset-0 overflow-y-auto overflow-x-hidden">
      <div style={{ width: PATH_W * scale, height: PATH_H * scale, marginLeft: x }}>
      <div className="origin-top-left" style={{ width: PATH_W, height: PATH_H, transform: `scale(${scale})` }}>
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
            visual={visualOf(t, i)}
            x={t.pos.x}
            y={t.pos.y}
            name={t.name}
            sub={statusLine(progressOf(t))}
            onClick={() => onStart(t)}
          />
        ))}
      </div>
      </div>
    </div>
  );
}
