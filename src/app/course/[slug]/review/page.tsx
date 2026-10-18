"use client";

import Link from "next/link";
import { use, useEffect, useRef } from "react";
import { motion } from "motion/react";
import type { Objective, Topic } from "@/lib/data";
import { useCourse, useOrca } from "@/lib/store";
import { courseUploads, pendingReview, uploadsInProgress } from "@/lib/course/review";
import { isFinished, useRun } from "@/hooks/useRun";
import { ReviewTabs, type ReviewTab } from "@/components/review/ReviewTabs";
import { UploadCard } from "@/components/review/UploadCard";
import { confirmTopic, rejectObjective, rejectTopic, renameTopic, resolveUncertain, resolveUncertainTopic } from "@/lib/course/ops";
import { Screen } from "@/components/layout/Screen";
import { BackButton } from "@/components/layout/BackButton";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { OriginPill, RenameField, TextAction } from "@/components/review/parts";
import { fadeUp, stagger } from "@/lib/motion";

/**
 * A course's uploads and what they need reviewed, as two tabs. Uploads: every upload, newest first,
 * building ones with live progress. Review: confirm, rename or reject new topics, and settle possible
 * duplicates. Opened for one upload (`?run=`, after uploading), that upload is pinned on top.
 */
export default function ReviewPage({ params, searchParams }: PageProps<"/course/[slug]/review">) {
  const { slug } = use(params);
  const sp = use(searchParams);
  const runId = typeof sp.run === "string" ? sp.run : undefined;
  const { hydrated, objectives, materials, runs, editStructure, refresh } = useOrca();
  const course = useCourse(slug);
  // The upload's job runs on the server; this follows it until it's done.
  const { run, missing } = useRun(runId);
  // An upload started a moment ago isn't in the store's runs yet: read the store again once, so the
  // course's uploads list and the course page's "uploading" count include it.
  const reloadedFor = useRef<string | null>(null);
  const known = !run || runs.some((r) => r.id === run.id);
  useEffect(() => {
    if (known || !run || reloadedFor.current === run.id) return;
    reloadedFor.current = run.id;
    void refresh();
  }, [known, run, refresh]);

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

  const catalogue = objectives[course.id] ?? {};
  const pending = pendingReview(course.topics, catalogue);
  // Every upload of the course, newest first; the page opens on them while one is building.
  const uploads = courseUploads(runs, course.id);
  const tab: ReviewTab = sp.tab === "uploads" || sp.tab === "review" ? sp.tab : uploads.some((u) => !isFinished(u)) && !runId ? "uploads" : "review";
  const material = run ? materials.find((m) => m.id === run.materialId) : undefined;
  const working = run && !isFinished(run);
  const topicName = (id: string) => course.topics.find((t) => t.id === id)?.name ?? "a topic";
  const objectivesIn = (topicId: string) => Object.values(catalogue).filter((o) => o.topicId === topicId && o.review !== "archived");
  const edit = editStructure.bind(null, course.id);

  return (
    <Screen bg="ocean" className="overflow-y-auto">
      <header className="flex items-center gap-[16px] px-[28px] pt-[28px]">
        <BackButton href={`/course/${course.slug}`} />
        <div className="flex flex-col gap-[4px]">
          <h1 className="text-[40px] font-bold leading-none text-prussian">{course.short}: uploads &amp; review</h1>
          <p className="text-[15px] font-medium text-wisteria-deep">
            {tab === "uploads" ? "Every file you've added and what it built." : "New topics are quizzable now, marked Unreviewed until you confirm them."}
          </p>
        </div>
      </header>

      <motion.div variants={stagger(0.06)} initial="hidden" animate="show" className="flex w-[820px] max-w-full flex-col gap-[24px] px-[28px] py-[28px]">
        {runId && missing && (
          <motion.div variants={fadeUp}>
            <Card radius={20} lip={4} className="px-[22px] py-[18px] text-[16px] font-semibold text-prussian" data-part="run-missing">
              Orca can&apos;t find that upload&apos;s run.
            </Card>
          </motion.div>
        )}

        {run && (
          <motion.div variants={fadeUp}>
            <UploadCard run={run} material={material} focused />
          </motion.div>
        )}

        <motion.div variants={fadeUp}>
          <ReviewTabs slug={course.slug} current={tab} runId={runId} uploads={uploadsInProgress(runs, course.id)} toReview={pending.count} />
        </motion.div>

        {tab === "uploads" ? (
          <motion.section variants={fadeUp} className="flex flex-col gap-[14px]" data-part="uploads-list">
            {uploads.length === 0 ? (
              <p className="text-[17px] font-semibold text-prussian">
                No uploads yet.{" "}
                <Link href={`/add-material?course=${course.slug}`} className="text-wisteria-deep hover:underline">
                  Add material
                </Link>
              </p>
            ) : (
              uploads.filter((u) => u.id !== runId).map((u) => <UploadCard key={u.id} run={u} material={materials.find((m) => m.id === u.materialId)} />)
            )}
          </motion.section>
        ) : (
          <>
        {pending.count === 0 && !working && (
          <motion.div variants={fadeUp} className="flex flex-col items-start gap-[12px]">
            <p className="text-[20px] font-bold text-prussian">Nothing to review.</p>
            <Link href={`/course/${course.slug}`} className="text-[15px] font-bold text-wisteria-deep hover:underline">
              Back to the island
            </Link>
          </motion.div>
        )}

        {(pending.uncertainTopics.length > 0 || pending.uncertainObjectives.length > 0) && (
          <motion.section variants={fadeUp} className="flex flex-col gap-[12px]">
            <h2 className="text-[22px] font-bold text-prussian">Possible duplicates</h2>
            {pending.uncertainTopics.map((t) => (
              <Duplicate
                key={t.id}
                kind="topic"
                name={t.name}
                other={topicName(t.uncertain!.candidateId)}
                reasoning={t.uncertain!.reasoning}
                onSame={() => edit((s) => resolveUncertainTopic(s, t.id, "same"))}
                onSeparate={() => edit((s) => resolveUncertainTopic(s, t.id, "separate"))}
              />
            ))}
            {pending.uncertainObjectives.map((o) => (
              <Duplicate
                key={o.id}
                kind="objective"
                name={o.name}
                other={catalogue[o.uncertain!.candidateId]?.name ?? "another objective"}
                reasoning={o.uncertain!.reasoning}
                onSame={() => edit((s) => resolveUncertain(s, o.id, "same"))}
                onSeparate={() => edit((s) => resolveUncertain(s, o.id, "separate"))}
              />
            ))}
          </motion.section>
        )}

        {pending.topics.length > 0 && (
          <motion.section variants={fadeUp} className="flex flex-col gap-[12px]">
            <div className="flex items-center justify-between">
              <h2 className="text-[22px] font-bold text-prussian">New topics</h2>
              {pending.topics.length > 1 && (
                <TextAction onClick={() => edit((s) => pending.topics.reduce((acc, t) => confirmTopic(acc, t.id), s))}>Confirm all</TextAction>
              )}
            </div>
            {pending.topics.map((t) => (
              <NewTopic
                key={t.id}
                topic={t}
                objectives={objectivesIn(t.id)}
                onRename={(name) => edit((s) => renameTopic(s, t.id, name))}
                onConfirm={() => edit((s) => confirmTopic(s, t.id))}
                onReject={() => edit((s) => rejectTopic(s, t.id))}
                onRejectObjective={(id) => edit((s) => rejectObjective(s, id))}
              />
            ))}
          </motion.section>
        )}

        <motion.div variants={fadeUp}>
          <Link href={`/course/${course.slug}/objectives`} className="text-[15px] font-bold text-wisteria-deep hover:underline">
            See every objective in {course.short}
          </Link>
        </motion.div>
          </>
        )}
      </motion.div>
    </Screen>
  );
}

function Duplicate({ kind, name, other, reasoning, onSame, onSeparate }: { kind: "topic" | "objective"; name: string; other: string; reasoning: string; onSame: () => void; onSeparate: () => void }) {
  return (
    <Card radius={18} lip={4} className="flex flex-col gap-[10px] px-[20px] py-[16px]" data-part="duplicate">
      <span className="text-[16px] text-prussian">
        The new {kind} <strong>“{name}”</strong> might be the same as <strong>“{other}”</strong>.
      </span>
      <span className="text-[14px] text-prussian/70">{reasoning}</span>
      <div className="flex gap-[10px]">
        <Button size="sm" onClick={onSame}>
          Same {kind}: merge
        </Button>
        <Button size="sm" variant="secondary" onClick={onSeparate}>
          Keep separate
        </Button>
      </div>
    </Card>
  );
}

function NewTopic({
  topic,
  objectives,
  onRename,
  onConfirm,
  onReject,
  onRejectObjective,
}: {
  topic: Topic;
  objectives: Objective[];
  onRename: (name: string) => void;
  onConfirm: () => void;
  onReject: () => void;
  onRejectObjective: (id: string) => void;
}) {
  return (
    <Card radius={18} lip={4} className="flex flex-col gap-[12px] px-[20px] py-[16px]" data-part="new-topic">
      <RenameField name={topic.name} onSave={onRename} label={`New name for ${topic.name}`} />
      {topic.summary && <p className="text-[14px] text-prussian/75">{topic.summary}</p>}
      {objectives.length > 0 ? (
        <ul className="flex flex-col gap-[8px]">
          {objectives.map((o) => (
            <li key={o.id} className="flex items-center justify-between gap-[12px] rounded-[12px] bg-alice px-[12px] py-[8px]">
              <span className="flex min-w-0 items-center gap-[8px]">
                <span className="text-[15px] text-prussian">{o.name}</span>
                <OriginPill origin={o.origin} />
              </span>
              <TextAction tone="danger" onClick={() => onRejectObjective(o.id)}>
                Reject
              </TextAction>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[14px] text-prussian/60">No objectives yet.</p>
      )}
      <div className="flex gap-[10px]">
        <Button size="sm" onClick={onConfirm}>
          Confirm topic
        </Button>
        <Button size="sm" variant="danger" onClick={onReject}>
          Reject topic
        </Button>
      </div>
    </Card>
  );
}
