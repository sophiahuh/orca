"use client";

import Link from "next/link";
import { use } from "react";
import { motion } from "motion/react";
import type { Objective, Topic } from "@/lib/data";
import { useCourse, useOrca } from "@/lib/store";
import { pendingReview } from "@/lib/course/review";
import { hiddenNote } from "@/lib/uploads";
import { progressMessage } from "@/lib/pipeline/progress-text";
import { isFinished, useRun } from "@/hooks/useRun";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { confirmTopic, rejectObjective, rejectTopic, renameTopic, resolveUncertain, resolveUncertainTopic } from "@/lib/course/ops";
import { Screen } from "@/components/layout/Screen";
import { BackButton } from "@/components/layout/BackButton";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { OriginPill, RenameField, TextAction } from "@/components/review/parts";
import { fadeUp, stagger } from "@/lib/motion";

/** After an upload: confirm, rename or reject new topics, and settle possible duplicates. */
export default function ReviewPage({ params, searchParams }: PageProps<"/course/[slug]/review">) {
  const { slug } = use(params);
  const sp = use(searchParams);
  const runId = typeof sp.run === "string" ? sp.run : undefined;
  const { hydrated, objectives, materials, editStructure } = useOrca();
  const course = useCourse(slug);
  // The upload's job runs on the server; this follows it until it's done.
  const { run, missing } = useRun(runId);

  if (!course) {
    return (
      <Screen bg="alice">
        <div className="flex flex-col items-start gap-4 p-[32px]">
          <BackButton />
          {hydrated && <p className="text-[22px] font-bold text-prussian">We couldn&apos;t find that island.</p>}
        </div>
      </Screen>
    );
  }

  const catalogue = objectives[course.id] ?? {};
  const pending = pendingReview(course.topics, catalogue);
  const material = run ? materials.find((m) => m.id === run.materialId) : undefined;
  const working = run && !isFinished(run);
  const failed = run?.status === "failed";
  const topicName = (id: string) => course.topics.find((t) => t.id === id)?.name ?? "a topic";
  const objectivesIn = (topicId: string) => Object.values(catalogue).filter((o) => o.topicId === topicId && o.review !== "archived");
  const edit = editStructure.bind(null, course.id);

  return (
    <Screen bg="alice" className="overflow-y-auto">
      <header className="flex items-center gap-[16px] px-[28px] pt-[28px]">
        <BackButton />
        <div className="flex flex-col gap-[4px]">
          <h1 className="text-[40px] font-bold leading-none text-prussian">Review {course.short}</h1>
          <p className="text-[15px] font-medium text-wisteria-deep">New topics are quizzable now, marked Unreviewed until you confirm them.</p>
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

        {working && run.status === "waiting" && (
          <motion.div variants={fadeUp}>
            <Card radius={20} lip={4} className="flex flex-col gap-[10px] px-[22px] py-[18px]" data-part="run-waiting" role="status">
              <span className="text-[17px] font-bold text-prussian">{material?.filename ?? "Your upload"} is saved and waiting</span>
              <span className="text-[14px] font-semibold text-wisteria-deep">{progressMessage(run.progress)} Nothing to do: Orca builds the topics and questions when the limit resets, and they appear here.</span>
            </Card>
          </motion.div>
        )}

        {working && run.status !== "waiting" && (
          <motion.div variants={fadeUp}>
            <Card radius={20} lip={4} className="flex flex-col gap-[10px] px-[22px] py-[18px]" data-part="run-progress" role="status">
              <span className="text-[17px] font-bold text-prussian">Building from {material?.filename ?? "your upload"}</span>
              <ProgressBar value={run.status === "running" ? stageShare(run.progress?.stage) : 0.05} height={10} label="Building" />
              <span className="text-[14px] font-semibold text-wisteria-deep">
                {run.status === "running" ? progressMessage(run.progress) : "Waiting for your other upload to finish; this one starts next."} This takes a few minutes: every question is checked before you see it. You can leave this page; it keeps going.
              </span>
            </Card>
          </motion.div>
        )}

        {failed && (
          <motion.div variants={fadeUp}>
            <Card radius={20} lip={4} className="flex flex-col gap-[8px] px-[22px] py-[18px]" data-part="run-failed" role="alert">
              <span className="text-[17px] font-bold text-prussian">Nothing was added from {material?.filename ?? "this upload"}.</span>
              <span className="text-[15px] text-prussian/80">{run.error}</span>
              <span className="text-[14px] text-prussian/70">The file is saved. Upload it again to try again.</span>
            </Card>
          </motion.div>
        )}

        {run && run.status === "done" && (
          <motion.div variants={fadeUp}>
            <Card radius={20} lip={4} className="flex flex-col gap-[8px] px-[22px] py-[18px]" data-part="run-summary">
              <span className="text-[17px] font-bold text-prussian">From {material?.filename ?? "this upload"}</span>
              <span className="text-[15px] text-prussian/80">
                {run.topicsCreated.length} new topic{run.topicsCreated.length === 1 ? "" : "s"}, {run.objectivesCreated.length} new objective
                {run.objectivesCreated.length === 1 ? "" : "s"}, {run.objectivesAttached.length} existing objective{run.objectivesAttached.length === 1 ? "" : "s"} covered again,{" "}
                {run.questionsAdded} question{run.questionsAdded === 1 ? "" : "s"} added.
              </span>
              {hiddenNote(run.hiddenText ?? material?.hiddenText) && (
                <span className="text-[14px] font-semibold text-prussian" data-part="hidden-text">
                  {hiddenNote(run.hiddenText ?? material?.hiddenText)} Check what this upload added.
                </span>
              )}
              {run.security && (run.security.screen.length > 0 || run.security.instructionsFound.length > 0) && (
                <span className="text-[14px] font-semibold text-prussian" role="alert" data-part="security-warning">
                  This file contains text aimed at an AI; check what it added.
                  {run.security.refused > 0 ? ` ${run.security.refused} item${run.security.refused === 1 ? " was" : "s were"} left out by Orca's checks (listed below).` : ""}
                </span>
              )}
              {run.dropped.length > 0 && (
                <details className="text-[14px] text-prussian/80">
                  <summary className="cursor-pointer font-semibold text-wisteria-deep">
                    {run.dropped.length} item{run.dropped.length === 1 ? "" : "s"} left out
                  </summary>
                  <ul className="mt-[8px] flex flex-col gap-[6px]">
                    {run.dropped.map((d, i) => (
                      <li key={i}>
                        <span className="font-semibold text-prussian">{d.prompt}</span> — {d.reason}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </Card>
          </motion.div>
        )}

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
      </motion.div>
    </Screen>
  );
}

/** Roughly how far along a running upload is, by stage. */
function stageShare(stage: string | undefined): number {
  return ({ mapping: 0.15, matching: 0.3, writing: 0.5, checking: 0.75, figures: 0.9 } as Record<string, number>)[stage ?? ""] ?? 0.1;
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
              <TextAction tone="quiet" onClick={() => onRejectObjective(o.id)}>
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
        <Button size="sm" variant="secondary" onClick={onReject}>
          Reject topic
        </Button>
      </div>
    </Card>
  );
}
