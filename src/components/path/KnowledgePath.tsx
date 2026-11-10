"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { motion } from "motion/react";
import type { Course, Topic } from "@/lib/data";
import { defaultTopicPositions, pathCanvasHeight, trailFromPoints, trailTopics } from "@/lib/data";
import { Button } from "@/components/ui/Button";
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

/** The topic's weak spots (objectives in rotation and open checks): how many are mastered. */
function statusLine(p: TopicProgress) {
  if (p.objectives === 0) return "No objectives yet";
  if (p.weak === 0) return "No weak spots flagged";
  if (p.status === "done") return "Weak spots mastered";
  return `${p.mastered} of ${p.weak} mastered`;
}

/**
 * Dotted trail + nodes, in a fixed 854×834 canvas scaled to fit. Weak points first (owner,
 * 2026-11-07): only topics with weak spots (an objective in rotation, or an open check) are on the
 * trail, laid out again in their order; "Show all N topics" brings back the whole course on its
 * stored layout. With no weak spots anywhere, the trail says so and offers the same.
 */
export function KnowledgePath({ course, progress, onStart, warmUp }: {
  course: Course;
  progress: ReadonlyMap<string, TopicProgress>;
  onStart: (topic: Topic) => void;
  /** Nothing flagged yet, but questions to try: START on that topic (owner, 2026-11-08). */
  warmUp?: { topicName: string; href: string; questions: number } | null;
}) {
  const progressOf = (t: Topic) => {
    const p = progress.get(t.id);
    if (!p) throw new Error(`No progress computed for topic ${t.id}`);
    return p;
  };
  const all = trailTopics(course);
  const [showAll, setShowAll] = useState(false);
  const weak = all.filter((t) => progressOf(t).status !== "not-started");
  const filtered = !showAll && weak.length < all.length;
  // The weak topics take the first spots of the default layout, so the trail has no gaps.
  const spots = filtered ? defaultTopicPositions(weak.length) : null;
  const topics = filtered ? weak.map((t, i) => ({ ...t, pos: spots![i] })) : all;
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
  const d = filtered ? trailFromPoints(topics.map((t) => t.pos)) : (course.trail ?? trailFromPoints(topics.map((t) => t.pos)));

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

  const toggle =
    weak.length < all.length ? (
      <Button size="sm" variant="ghost" onClick={() => setShowAll((v) => !v)} data-part="path-show-all">
        {showAll ? "Show weak spots only" : `Show all ${all.length} topics`}
      </Button>
    ) : null;

  if (filtered && weak.length === 0) {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-[12px] px-[80px] text-center" data-part="path-no-weak-spots">
        <p className="text-[22px] font-bold text-prussian">No weak spots flagged yet.</p>
        {warmUp ? (
          <>
            <p className="max-w-[460px] text-[16px] text-wisteria-deep">Start with {warmUp.topicName}: a few questions find what to work on. A miss becomes a weak spot.</p>
            <Link href={warmUp.href} data-part="warmup-start" className="pressable inline-flex items-center rounded-[20px] bg-wisteria px-5 py-3 text-[17px] font-bold text-parchment lip-5 lip-wisteria">
              Try {warmUp.questions} {warmUp.questions === 1 ? "question" : "questions"}
            </Link>
          </>
        ) : (
          <p className="max-w-[460px] text-[16px] text-wisteria-deep">Topics show up here once something is flagged as hard: tap the slides that were hard on the Uploads tab, or show all topics and pick one.</p>
        )}
        {toggle}
      </div>
    );
  }

  return (
    <>
    {toggle && <div className="absolute bottom-[24px] left-1/2 z-10 -translate-x-1/2">{toggle}</div>}
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
            sub={statusLine(progressOf(t))}
            ring={progressOf(t).weak > 0 ? { mastered: progressOf(t).mastered, of: progressOf(t).weak } : undefined}
            onClick={() => onStart(t)}
          />
        ))}
      </div>
      </div>
    </div>
    </>
  );
}
