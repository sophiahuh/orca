"use client";

import { use, useMemo } from "react";
import { motion } from "motion/react";
import { DEFAULT_WEIGHTS, type Objective, type Topic } from "@/lib/data";
import { useCourse, useMasteryByCourse, useOrca } from "@/lib/store";
import { courseObjectiveWeights, topicWeight } from "@/lib/course/weights";
import { confirmObjective, mergeObjectives, rejectObjective, restoreObjective, restoreTopic } from "@/lib/course/ops";
import { Screen } from "@/components/layout/Screen";
import { BackButton } from "@/components/layout/BackButton";
import { Card } from "@/components/ui/Card";
import { MASTERY_LABEL, OriginPill, Pill, ReviewPill, TextAction } from "@/components/review/parts";
import { fadeUp, stagger } from "@/lib/motion";

const weightText = (w: number | null | undefined) => (w === null || w === undefined ? "no objectives yet" : w === 0 ? "0 (not examined)" : w.toFixed(2));

/** Every objective in a course: where it came from, its review status, weight and mastery, with reject, restore and merge. */
export default function ObjectivesPage({ params }: PageProps<"/course/[slug]/objectives">) {
  const { slug } = use(params);
  const { hydrated, objectives, relations, weights, editStructure } = useOrca();
  const course = useCourse(slug);
  const mastery = useMasteryByCourse();
  const catalogue = useMemo(() => (course ? (objectives[course.id] ?? {}) : {}), [course, objectives]);
  const objectiveWeights = useMemo(
    () => (course ? courseObjectiveWeights(catalogue, relations[course.id] ?? [], weights[course.id] ?? DEFAULT_WEIGHTS) : new Map<string, number>()),
    [course, catalogue, relations, weights],
  );

  if (!course) {
    return (
      <Screen bg="ocean">
        <div className="flex flex-col items-start gap-4 p-[32px]">
          <BackButton />
          {hydrated && <p className="text-[22px] font-bold text-prussian">We couldn&apos;t find that island.</p>}
        </div>
      </Screen>
    );
  }

  const m = mastery[course.id];
  const edit = editStructure.bind(null, course.id);
  const all = Object.values(catalogue);
  const live = all.filter((o) => o.review !== "archived");
  const visibleTopics = course.topics.filter((t) => t.review !== "archived");
  const rejectedTopics = course.topics.filter((t) => t.review === "archived" && !t.mergedInto);

  return (
    <Screen bg="ocean" className="overflow-y-auto">
      <header className="flex items-center gap-[16px] px-[28px] pt-[28px]">
        <BackButton />
        <div className="flex flex-col gap-[4px]">
          <h1 className="text-[40px] font-bold leading-none text-prussian">{course.short} objectives</h1>
          <p className="text-[15px] font-medium text-wisteria-deep">
            {live.length} objective{live.length === 1 ? "" : "s"}. Weight sets what gets practised first; it never changes what counts as mastered.
          </p>
        </div>
      </header>

      <motion.div variants={stagger(0.05)} initial="hidden" animate="show" className="flex w-[900px] max-w-full flex-col gap-[20px] px-[28px] py-[28px]">
        {visibleTopics.length === 0 && <p className="text-[18px] font-bold text-prussian">No objectives yet. Upload material to map this course.</p>}
        {visibleTopics.map((t) => (
          <TopicSection
            key={t.id}
            topic={t}
            objectives={all.filter((o) => o.topicId === t.id)}
            allLive={live}
            weightOf={(id) => objectiveWeights.get(id)}
            topicWeight={topicWeight(t.id, catalogue, objectiveWeights)}
            statusOf={(id) => m?.objectives.get(id)?.status}
            onConfirm={(id) => edit((s) => confirmObjective(s, id))}
            onReject={(id) => edit((s) => rejectObjective(s, id))}
            onRestore={(id) => edit((s) => restoreObjective(s, id))}
            onMerge={(id, into) => edit((s) => mergeObjectives(s, id, into))}
          />
        ))}
        {rejectedTopics.length > 0 && (
          <motion.section variants={fadeUp} className="flex flex-col gap-[10px]">
            <h2 className="text-[20px] font-bold text-prussian">Rejected topics</h2>
            {rejectedTopics.map((t) => (
              <div key={t.id} className="flex items-center justify-between rounded-[14px] bg-parchment px-[16px] py-[10px]">
                <span className="text-[15px] text-prussian/70">{t.name}</span>
                <TextAction onClick={() => edit((s) => restoreTopic(s, t.id))}>Restore</TextAction>
              </div>
            ))}
          </motion.section>
        )}
      </motion.div>
    </Screen>
  );
}

function TopicSection({
  topic,
  objectives,
  allLive,
  weightOf,
  topicWeight,
  statusOf,
  onConfirm,
  onReject,
  onRestore,
  onMerge,
}: {
  topic: Topic;
  objectives: Objective[];
  allLive: Objective[];
  weightOf: (id: string) => number | undefined;
  topicWeight: number | null;
  statusOf: (id: string) => keyof typeof MASTERY_LABEL | undefined;
  onConfirm: (id: string) => void;
  onReject: (id: string) => void;
  onRestore: (id: string) => void;
  onMerge: (id: string, into: string) => void;
}) {
  const live = objectives.filter((o) => o.review !== "archived");
  const rejected = objectives.filter((o) => o.review === "archived" && !o.mergedInto);
  const mergedInto = (id: string) => objectives.filter((o) => o.mergedInto === id);
  return (
    <motion.div variants={fadeUp}>
      <Card radius={20} lip={4} className="flex flex-col gap-[12px] px-[22px] py-[18px]" data-part="topic-objectives">
        <div className="flex items-center justify-between gap-[12px]">
          <span className="flex items-center gap-[10px]">
            <span className="text-[20px] font-bold text-prussian">{topic.name}</span>
            <ReviewPill review={topic.review} />
          </span>
          <span className="text-[13px] font-semibold text-wisteria-deep">weight {weightText(topicWeight)}</span>
        </div>
        {live.length === 0 && <p className="text-[14px] text-prussian/60">No objectives yet.</p>}
        <ul className="flex flex-col gap-[8px]">
          {live.map((o) => {
            const status = statusOf(o.id);
            return (
              <li key={o.id} className="flex flex-col gap-[6px] rounded-[14px] bg-alice px-[14px] py-[10px]" data-objective={o.name}>
                <div className="flex items-start justify-between gap-[12px]">
                  <span className="flex min-w-0 flex-wrap items-center gap-[8px]">
                    <span className="text-[15px] font-semibold text-prussian">{o.name}</span>
                    <ReviewPill review={o.review} />
                    <OriginPill origin={o.origin} />
                  </span>
                  <span className="shrink-0 text-right text-[13px] text-prussian/70">
                    {status ? MASTERY_LABEL[status] : "No questions yet"} · weight {weightText(weightOf(o.id))}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-[14px]">
                  {o.review === "proposed" && <TextAction onClick={() => onConfirm(o.id)}>Confirm</TextAction>}
                  <TextAction tone="quiet" onClick={() => onReject(o.id)}>
                    Reject
                  </TextAction>
                  <label className="flex items-center gap-[6px] text-[13px] font-bold text-prussian/60">
                    Merge into
                    <select
                      aria-label={`Merge ${o.name} into`}
                      value=""
                      onChange={(e) => e.target.value && onMerge(o.id, e.target.value)}
                      className="max-w-[260px] rounded-[10px] border-2 border-alice-deep bg-parchment px-[8px] py-[3px] text-[13px] font-semibold text-prussian"
                    >
                      <option value="">choose…</option>
                      {allLive
                        .filter((x) => x.id !== o.id)
                        .map((x) => (
                          <option key={x.id} value={x.id}>
                            {x.name}
                          </option>
                        ))}
                    </select>
                  </label>
                </div>
                {mergedInto(o.id).map((x) => (
                  <span key={x.id} className="flex items-center gap-[8px] text-[13px] text-prussian/70">
                    <Pill tone="muted">Merged</Pill> {x.name}
                    <TextAction onClick={() => onRestore(x.id)}>Undo</TextAction>
                  </span>
                ))}
              </li>
            );
          })}
        </ul>
        {rejected.length > 0 && (
          <div className="flex flex-col gap-[6px]">
            <span className="text-[13px] font-bold uppercase tracking-[1.2px] text-prussian/50">Rejected</span>
            {rejected.map((o) => (
              <span key={o.id} className="flex items-center justify-between gap-[12px] text-[14px] text-prussian/60">
                {o.name}
                <TextAction onClick={() => onRestore(o.id)}>Restore</TextAction>
              </span>
            ))}
          </div>
        )}
      </Card>
    </motion.div>
  );
}
