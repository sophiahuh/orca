"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import type { Course } from "@/lib/data";
import { Island, ISLAND_H, ISLAND_W } from "@/components/brand/Island";
import { OrcaLogo } from "@/components/brand/OrcaLogo";
import { Wave } from "@/components/brand/Decor";
import { ZoomControls } from "@/components/ui/ZoomControls";
import { useFitScale } from "@/hooks/useFitScale";
import { ISLAND_LAYOUT, islandMapSize, islandSpot } from "@/lib/course/islands";
import { stagger } from "@/lib/motion";
import { useMasteryByCourse } from "@/lib/store";
import { LabelPill } from "./LabelPill";

const WAVES: Array<{ x: number; y: number; w: 60 | 70 | 80 | 90 }> = [
  { x: 60, y: 330, w: 70 },
  { x: 370, y: 90, w: 60 },
  { x: 700, y: 300, w: 80 },
  { x: 180, y: 780, w: 90 },
  { x: 560, y: 640, w: 60 },
  { x: 760, y: 760, w: 70 },
];

/** How far the map zooms: out to see a long list of courses, in a little past life size. */
const MIN_SCALE = 0.45;
const MAX_SCALE = 1.4;
const clampScale = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

type View = { scale: number; x: number; y: number };

/**
 * The island map. Islands sit on a grid in course order (`src/lib/course/islands.ts`), so they never
 * overlap; the map grows a row at a time. It opens fitted to show every island (no smaller than
 * MIN_SCALE); drag or scroll to move around, and zoom with − + or fit it again. Clicking an island
 * or its name opens its path.
 */
export function KnowledgeMap({ courses, dueCount }: { courses: Course[]; dueCount: (courseId: string) => number }) {
  const router = useRouter();
  const mastery = useMasteryByCourse();
  const levelOf = (courseId: string) => {
    const m = mastery[courseId];
    if (!m) throw new Error(`No mastery computed for course ${courseId}`);
    return m.island;
  };
  const size = islandMapSize(courses.length);
  const { ref, width, height } = useFitScale(size.w, size.h, "contain");

  // Fitted: everything visible and centred, unless that would be too small; then the top of the map
  // at its smallest, centred across, and the rest reached by moving around.
  const fitScale = clampScale(Math.min(width / size.w, height / size.h));
  const fit: View = { scale: fitScale, x: (width - size.w * fitScale) / 2, y: Math.max(0, (height - size.h * fitScale) / 2) };
  // A moved or zoomed view holds until the map changes size (a course added) or "Fit" is pressed.
  const sizeKey = `${size.w}x${size.h}`;
  const [manual, setManual] = useState<{ key: string; view: View } | null>(null);
  const view = manual?.key === sizeKey ? manual.view : fit;
  const setView = (v: View) => setManual({ key: sizeKey, view: v });

  const zoom = (factor: number) => {
    const scale = clampScale(view.scale * factor);
    const cx = width / 2;
    const cy = height / 2;
    setView({ scale, x: cx - ((cx - view.x) * scale) / view.scale, y: cy - ((cy - view.y) * scale) / view.scale });
  };

  // Dragging the sea (not an island) moves the map.
  const drag = useRef<{ x: number; y: number; view: View } | null>(null);
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("button")) return;
    drag.current = { x: e.clientX, y: e.clientY, view };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (d) setView({ ...d.view, x: d.view.x + (e.clientX - d.x), y: d.view.y + (e.clientY - d.y) });
  };
  const endDrag = () => (drag.current = null);

  const orca = { x: ISLAND_LAYOUT.firstCentreX + ISLAND_LAYOUT.columnStep / 2 - 55, y: ISLAND_LAYOUT.top + 80 };

  return (
    <div
      ref={ref}
      className="absolute inset-0 cursor-grab touch-none overflow-hidden active:cursor-grabbing"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onWheel={(e) => setView({ ...view, x: view.x - e.deltaX, y: view.y - e.deltaY })}
      data-part="island-map"
    >
      <motion.div
        className="absolute origin-top-left"
        style={{ width: size.w, height: size.h, left: view.x, top: view.y, transform: `scale(${view.scale})` }}
        variants={stagger(0.15, 0.08)}
        initial="hidden"
        animate="show"
      >
        {WAVES.map((w, i) => (
          <Wave key={i} tone="light" x={w.x} y={w.y} width={w.w} seed={i} />
        ))}

        {courses.map((c, i) => {
          const spot = islandSpot(i);
          return (
            <div key={c.id} className="absolute" style={{ left: spot.x, top: spot.y, width: ISLAND_W, height: ISLAND_H }} data-part="island-spot">
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
                <LabelPill count={dueCount(c.id)} onClick={() => router.push(`/course/${c.slug}`)} aria-label={`Open ${c.name}, ${dueCount(c.id)} due today`} title={c.name} style={{ maxWidth: ISLAND_LAYOUT.pillMax }}>
                  <span className="min-w-0 truncate">{c.name}</span>
                </LabelPill>
              </div>
            </div>
          );
        })}

        <div className="pointer-events-none absolute" style={{ left: orca.x, top: orca.y }}>
          <OrcaLogo width={110} swim />
        </div>
      </motion.div>

      <ZoomControls className="absolute bottom-5 right-5 flex gap-2" onZoomOut={() => zoom(0.8)} onZoomIn={() => zoom(1.25)} onFit={() => setManual(null)} />
    </div>
  );
}
