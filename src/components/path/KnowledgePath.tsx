"use client";

import { useEffect } from "react";
import { motion } from "motion/react";
import type { Course, Topic } from "@/lib/data";
import { pathCanvasHeight, trailFromPoints, trailTopics } from "@/lib/data";
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

function statusLine(p: TopicProgress, needing: number) {
  if (p.total === 0) return "No questions yet";
  const gap = needing > 0 ? ` · ${needing} ${needing === 1 ? "needs" : "need"} more questions` : "";
  if (p.status === "done") return `Complete${gap}`;
  if (p.status === "not-started") return `${p.total} ${p.total === 1 ? "objective" : "objectives"}${gap}`;
  return `${p.mastered} of ${p.total} objectives mastered${gap}`;
}

/** Dotted trail + nodes, in a fixed 854×834 canvas scaled to fit. */
export function KnowledgePath({ course, progress, needingQuestions, onStart }: {
  course: Course;
  progress: ReadonlyMap<string, TopicProgress>;
  needingQuestions: ReadonlyMap<string, number>;
  onStart: (topic: Topic) => void;
}) {
  const progressOf = (t: Topic) => {
    const p = progress.get(t.id);
    if (!p) throw new Error(`No progress computed for topic ${t.id}`);
    return p;
  };
  const needingOf = (t: Topic) => {
    const n = needingQuestions.get(t.id);
    if (n === undefined) throw new Error(`No question-gap count computed for topic ${t.id}`);
    return n;
  };
  const topics = trailTopics(course);
  // START goes to the first topic in progress, else the first not started; none when everything is done.
  const firstInProgress = topics.findIndex((t) => progressOf(t).status === "in-progress");
  const current = firstInProgress >= 0 ? firstInProgress : topics.findIndex((t) => progressOf(t).status === "not-started");
  const currentTopic = current >= 0 ? topics[current] : null;
  const currentTopicId = currentTopic?.id;
  const currentTopicY = currentTopic?.pos.y;
  const visualOf = (t: Topic, i: number): NodeVisual => {
    const status = progressOf(t).status;
    if (status === "done") return "done";
    if (i === current) return "current";
    return status === "in-progress" ? "in-progress" : "upcoming";
  };
  const PATH_H = pathCanvasHeight(topics.length);
  // Fit the 854×834 design frame as before; longer trails keep that scale and scroll.
  const { ref, scale, x } = useFitScale(PATH_W, 834, "contain");
  const d = course.trail ?? trailFromPoints(topics.map((t) => t.pos));

  // Opening a course should put the pulsing START/play node in view, even when a long path has
  // already scrolled far past it. Coordinates inside the fixed canvas need the same fit scale.
  useEffect(() => {
    const container = ref.current;
    if (!container || currentTopicY === undefined) return;
    const top = Math.max(0, currentTopicY * scale - container.clientHeight / 2);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const frame = requestAnimationFrame(() => container.scrollTo({ top, behavior: reduced ? "auto" : "smooth" }));
    return () => cancelAnimationFrame(frame);
  }, [course.id, currentTopicId, currentTopicY, ref, scale]);

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

        {topics.map((t, i) => (
          <PathNode
            key={t.id}
            index={i}
            visual={visualOf(t, i)}
            x={t.pos.x}
            y={t.pos.y}
            name={t.name}
            sub={statusLine(progressOf(t), needingOf(t))}
            onClick={() => onStart(t)}
          />
        ))}
      </div>
      </div>
    </div>
  );
}
