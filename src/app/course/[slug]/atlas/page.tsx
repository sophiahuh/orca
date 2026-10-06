"use client";

import { use, useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import { AtlasSwitch } from "@/components/atlas/AtlasSwitch";
import { ConceptAtlas } from "@/components/atlas/ConceptAtlas";
import { ConceptPanel } from "@/components/atlas/ConceptPanel";
import { BackButton } from "@/components/layout/BackButton";
import { Sidebar } from "@/components/layout/Sidebar";
import { trailTopics } from "@/lib/data";
import { atlasLayout, connectedConcepts } from "@/lib/course/atlas";
import { masteryPercent } from "@/lib/mastery/percent";
import { useCourse, useMasteryByCourse, useOrca } from "@/lib/store";
import { fadeUp, stagger } from "@/lib/motion";

/**
 * Figma: 12 · Concept Atlas. The course's units as rings and its concepts on them (the canvas),
 * with the right rail showing Due today until a concept is selected, then that concept's panel
 * (design spec §1). Esc or the panel's close clears the selection.
 */
export default function AtlasPage({ params }: PageProps<"/course/[slug]/atlas">) {
  const { slug } = use(params);
  const { hydrated, objectives, relations, questionBank } = useOrca();
  const course = useCourse(slug);
  const mastery = useMasteryByCourse();
  const [selected, setSelected] = useState<string | null>(null);

  const m = course ? mastery[course.id] : undefined;
  const layout = useMemo(
    () => (course && m ? atlasLayout({ topics: trailTopics(course), objectives: objectives[course.id] ?? {}, relations: relations[course.id] ?? [], states: m.objectives }) : null),
    [course, m, objectives, relations],
  );

  const clear = useCallback(() => setSelected(null), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && clear();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [clear]);

  if (!course) {
    return (
      <div className="flex h-screen-below-bar w-full overflow-hidden">
        <main className="relative min-w-0 flex-1 bg-ocean">
          <div className="flex h-full flex-col items-start gap-4 p-[32px]">
            <BackButton />
            {hydrated && <p className="text-[22px] font-bold text-prussian">We couldn&apos;t find that island.</p>}
          </div>
        </main>
        <Sidebar />
      </div>
    );
  }
  if (!m || !layout) throw new Error(`No mastery computed for course ${course.id}`);

  const concept = selected ? layout.concepts.find((c) => c.objective.id === selected) ?? null : null;
  const units = layout.units.length;
  const concepts = layout.concepts.length;
  let panel: React.ReactNode = <Sidebar />;
  if (concept) {
    const unit = layout.units[concept.unit - 1];
    const state = m.objectives.get(concept.objective.id);
    const stock = (questionBank[course.id]?.[unit.topic.id] ?? []).filter((q) => q.objectiveId === concept.objective.id);
    const answered = new Set(m.events.flatMap((e) => (e.kind === "answer" && e.objectiveId === concept.objective.id && e.outcome === "correct" ? [e.questionId] : []))).size;
    panel = (
      <ConceptPanel
        unitLabel={`Unit ${unit.index} · ${unit.topic.name}`}
        name={concept.objective.name}
        percent={masteryPercent(state)}
        answered={Math.min(answered, stock.length)}
        total={stock.length}
        mastery={concept.mastery}
        connected={connectedConcepts(concept.objective.id, layout).map((x) => ({ id: x.concept.objective.id, name: x.concept.objective.name, kind: x.kind, mastery: x.concept.mastery }))}
        nextUp={stock.length > 0 ? { title: `Quiz ${unit.topic.name}`, detail: `${stock.length} question${stock.length === 1 ? "" : "s"} on ${concept.objective.name} · about ${Math.max(2, Math.ceil(stock.length * 0.75))} min` } : null}
        reviewHref={stock.length > 0 ? `/quiz/${course.slug}/${unit.topic.id}` : null}
        onPick={setSelected}
        onClose={clear}
      />
    );
  }

  return (
    <div className="flex h-screen-below-bar w-full overflow-hidden">
      <main className="relative min-w-0 flex-1 overflow-hidden bg-ocean">
        {concepts === 0 ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-[12px] text-center">
            <p className="text-[22px] font-bold text-prussian">No concepts to map yet.</p>
            <p className="text-[16px] text-wisteria-deep">Add lecture slides or homework and Orca will chart this island&apos;s concepts.</p>
          </div>
        ) : (
          <ConceptAtlas layout={layout} selected={selected} onSelect={setSelected} />
        )}
        <motion.header variants={stagger()} initial="hidden" animate="show" className="pointer-events-none absolute left-[28px] top-[28px] flex items-start gap-[16px]">
          <motion.div variants={fadeUp} className="pointer-events-auto">
            <BackButton href={`/course/${course.slug}`} size={56} />
          </motion.div>
          <div className="flex flex-col gap-[4px] pt-[2px]">
            <motion.h1 variants={fadeUp} className="text-[40px] font-bold leading-none text-prussian">
              Concept Atlas
            </motion.h1>
            <motion.p variants={fadeUp} className="text-[15px] font-medium text-wisteria-deep" data-part="atlas-summary">
              {course.short} · {concepts} concept{concepts === 1 ? "" : "s"} across {units} unit{units === 1 ? "" : "s"}
            </motion.p>
            <motion.div variants={fadeUp} className="pointer-events-auto mt-[6px]">
              <AtlasSwitch slug={course.slug} current="atlas" />
            </motion.div>
          </div>
        </motion.header>
      </main>
      {panel}
    </div>
  );
}
