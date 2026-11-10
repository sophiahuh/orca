"use client";

import { useState } from "react";
import type { Material, PipelineRun } from "@/lib/data";
import { hiddenNote, pauseUploads, removeMaterial, retryUpload, stopUpload } from "@/lib/uploads";
import { progressMessage } from "@/lib/pipeline/progress-text";
import { isFinished, useRun } from "@/hooks/useRun";
import { useOrca } from "@/lib/store";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { IconPause, IconPlay, IconTrash } from "@/components/icons";
import { HardSlides } from "@/components/review/HardSlides";
import { ProgressBar } from "@/components/ui/ProgressBar";

/** How far along a running upload is, from its stage (a rough share for the bar). */
function stageShare(stage: string | undefined): number {
  return ({ mapping: 0.15, matching: 0.3, writing: 0.6, figures: 0.9 } as Record<string, number>)[stage ?? ""] ?? 0.1;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** When an upload started, as "Oct 17, 3:04 PM". */
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/**
 * One upload's job: building (live progress), waiting (why), queued, failed (why), or done (what it
 * added and what was left out). An unfinished one follows its run on the server. `focused` is the
 * upload the page was opened for (`?run=`): the page already follows it (one Realtime channel per
 * run), and its parts keep the names the browser tests use.
 */
export function UploadCard({ run: stored, material, focused = false, openSlides = false }: { run: PipelineRun; material: Material | undefined; focused?: boolean; openSlides?: boolean }) {
  // Only an unfinished run is followed (a finished one won't change), and never twice.
  const { run: live } = useRun(focused || isFinished(stored) ? null : stored.id);
  // A finished stored row wins: useRun keeps its last live row when it stops following, which would show a stopped run as still building.
  const run = isFinished(stored) ? stored : (live ?? stored);
  const { courses, refresh } = useOrca();
  const [pickingSlides, setPickingSlides] = useState(openSlides);
  const name = material?.filename ?? "An upload";
  const course = material ? courses.find((c) => c.id === material.courseId) : undefined;
  // Pause a queued upload (it leaves the queue), put a paused one back in line, stop a running one,
  // or remove the material. Stop and Remove ask once more before acting.
  const [pausing, setPausing] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<"stop" | "remove" | null>(null);
  const act = async (what: "stop" | "remove" | "retry") => {
    setConfirming(null);
    setPausing(null);
    try {
      if (what === "stop") await stopUpload(run.id);
      else if (what === "retry" && material) await retryUpload(material.id);
      else if (material) await removeMaterial(material.id);
      await refresh();
    } catch (e) {
      setPausing(e instanceof Error ? e.message : "Couldn't change the upload.");
    }
  };
  // A queued or paused upload hasn't been built: deleting it takes it out of the queue (its job is
  // cancelled) and removes the file, the same soft delete as removing built material.
  const unbuilt = run.status === "queued" || run.status === "paused";
  const removeOffer = material && (
    <span className="flex flex-wrap items-center gap-[10px] text-[13px] font-semibold text-wisteria-deep" data-part="remove-offer">
      {confirming === "remove" ? (
        <>
          <span className="text-prussian">
            {unbuilt
              ? `Delete ${material.filename}? Orca hasn't built from it yet: it leaves the queue and its file goes.`
              : `Remove ${material.filename} from the course? Its file and pages go; the objectives only it taught are archived.`}
          </span>
          <button type="button" onClick={() => void act("remove")} className="font-bold text-bad-text underline underline-offset-2" data-part="remove-confirm">
            {unbuilt ? "Delete" : "Remove"}
          </button>
          <button type="button" onClick={() => setConfirming(null)} className="font-bold text-prussian underline underline-offset-2">
            Keep
          </button>
        </>
      ) : (
        unbuilt ? (
          <Button size="sm" variant="danger" icon={<IconTrash size={18} />} onClick={() => setConfirming("remove")} data-part="remove-material">
            Delete upload
          </Button>
        ) : (
          <button type="button" onClick={() => setConfirming("remove")} className="font-bold text-wisteria-deep underline underline-offset-2" data-part="remove-material">
            Remove from course
          </button>
        )
      )}
    </span>
  );
  const setPaused = async (paused: boolean) => {
    setPausing(null);
    try {
      await pauseUploads({ runId: run.id }, paused);
      await refresh();
    } catch (e) {
      setPausing(e instanceof Error ? e.message : "Couldn't change the upload.");
    }
  };
  const part = (legacy: string) => (focused ? legacy : "upload-card");
  const head = (
    <span className="flex flex-wrap items-center gap-[8px]">
      <span className="text-[17px] font-bold text-prussian">{name}</span>
      <span className={`rounded-pill px-[9px] py-[4px] text-[11px] font-bold ${STATUS[run.status].look}`} data-part="upload-status">
        {STATUS[run.status].label}
      </span>
      <span className="text-[13px] font-medium text-prussian/60">{when(run.at)}</span>
    </span>
  );

  if (run.status === "waiting") {
    // Held by the daily limit: it resumes by itself, but the student can stop it or remove the file
    // meanwhile (2026-11-08; before, a waiting card offered nothing).
    return (
      <Card radius={20} lip={4} className="flex flex-col gap-[10px] px-[22px] py-[18px]" data-part={part("run-waiting")} data-status={run.status} role="status">
        {head}
        <span className="text-[14px] font-semibold text-wisteria-deep">{progressMessage(run.progress)} Nothing to do: Orca builds the topics and questions when the limit resets, and they appear here.</span>
        <span className="flex flex-wrap items-center gap-[10px] text-[13px] font-semibold text-wisteria-deep">
          {confirming === "stop" ? (
            <>
              <span className="text-prussian">Stop waiting? The file stays, so uploading it again retries.</span>
              <button type="button" onClick={() => void act("stop")} className="font-bold text-bad-text underline underline-offset-2" data-part="stop-confirm">
                Stop
              </button>
              <button type="button" onClick={() => setConfirming(null)} className="font-bold text-prussian underline underline-offset-2">
                Keep waiting
              </button>
            </>
          ) : (
            <button type="button" onClick={() => setConfirming("stop")} className="font-bold text-prussian underline underline-offset-2" data-part="stop-upload">
              Stop
            </button>
          )}
        </span>
        {removeOffer}
        {pausing && <span className="text-[13px] font-semibold text-prussian">{pausing}</span>}
      </Card>
    );
  }
  if (run.status === "paused") {
    return (
      <Card radius={20} lip={4} className="flex flex-col gap-[10px] px-[22px] py-[18px]" data-part={part("run-paused")} data-status={run.status} role="status">
        {head}
        <span className="text-[14px] font-semibold text-wisteria-deep">Paused: Orca won&apos;t build from it until you resume it. Later uploads go ahead of it meanwhile.</span>
        <div className="flex flex-wrap items-center gap-[10px]">
          <Button size="sm" variant="secondary" icon={<IconPlay size={18} />} onClick={() => void setPaused(false)} data-part="resume-upload">
            Resume
          </Button>
          {removeOffer}
        </div>
        {pausing && <span className="text-[13px] font-semibold text-prussian">{pausing}</span>}
      </Card>
    );
  }
  if (run.status === "queued" || run.status === "running") {
    return (
      <Card radius={20} lip={4} className="flex flex-col gap-[10px] px-[22px] py-[18px]" data-part={part("run-progress")} data-status={run.status} role="status">
        {head}
        <ProgressBar value={run.status === "running" ? stageShare(run.progress?.stage) : 0.05} height={10} label="Building" />
        {run.status === "queued" && (
          <div className="flex flex-wrap items-center gap-[10px]">
            <Button size="sm" variant="secondary" icon={<IconPause size={18} />} onClick={() => void setPaused(true)} data-part="pause-upload">
              Pause
            </Button>
            {removeOffer}
          </div>
        )}
        {run.status === "running" && (
          <span className="flex flex-wrap items-center gap-[10px] text-[14px] font-semibold text-wisteria-deep">
            <span>{progressMessage(run.progress)}</span>
            {confirming === "stop" ? (
              <>
                <span className="text-prussian">Stop it? What it has built so far is dropped; the file stays, so uploading it again retries.</span>
                <button type="button" onClick={() => void act("stop")} className="font-bold text-bad-text underline underline-offset-2" data-part="stop-confirm">
                  Stop
                </button>
                <button type="button" onClick={() => setConfirming(null)} className="font-bold text-prussian underline underline-offset-2">
                  Keep going
                </button>
              </>
            ) : (
              <button type="button" onClick={() => setConfirming("stop")} className="font-bold text-prussian underline underline-offset-2" data-part="stop-upload">
                Stop
              </button>
            )}
          </span>
        )}
        {pausing && <span className="text-[13px] font-semibold text-prussian">{pausing}</span>}
      </Card>
    );
  }
  if (run.status === "failed") {
    return (
      <Card radius={20} lip={4} className="flex flex-col gap-[8px] px-[22px] py-[18px]" data-part={part("run-failed")} data-status={run.status} role="alert">
        {head}
        <span className="text-[15px] font-semibold text-prussian">Nothing was added from {material?.filename ?? "this upload"}.</span>
        <span className="text-[15px] text-prussian/80">{run.error}</span>
        <span className="flex flex-wrap items-center gap-[10px] text-[14px] text-prussian/70">
          The file is saved.
          {material && (
            <button type="button" onClick={() => void act("retry")} className="font-bold text-prussian underline underline-offset-2" data-part="retry-upload">
              Try again
            </button>
          )}
        </span>
        {removeOffer}
        {pausing && <span className="text-[13px] font-semibold text-prussian">{pausing}</span>}
      </Card>
    );
  }

  const hidden = hiddenNote(run.hiddenText ?? material?.hiddenText);
  const aimed = run.security && (run.security.screen.some((h) => h.severity !== "weak") || run.security.instructionsFound.length > 0);
  return (
    <Card radius={20} lip={4} className="flex flex-col gap-[8px] px-[22px] py-[18px]" data-part={part("run-summary")} data-status={run.status}>
      {head}
      <span className="text-[15px] text-prussian/80">
        {plural(run.topicsCreated.length, "new topic")}, {plural(run.objectivesCreated.length, "new objective")}, {run.objectivesAttached.length} existing objective
        {run.objectivesAttached.length === 1 ? "" : "s"} covered again
        {run.questionsAdded > 0 ? `, ${plural(run.questionsAdded, "question")} added.` : "."}
      </span>
      {/* Weak points first: an upload writes questions only for what's marked in it. */}
      {run.questionsAdded === 0 && (run.kind ?? "upload") === "upload" && (
        <span className="text-[14px] font-medium text-wisteria-deep" data-part="questions-later">
          Questions are written when you flag something or start a dive.
        </span>
      )}
      {/* Weak points first (Plan C): tap the slides that were hard. Only a stored PDF or .pptx has pages to show. */}
      {material?.storagePath && /\.(pdf|pptx)$/i.test(material.filename) && course && (
        <>
          <button type="button" onClick={() => setPickingSlides(true)} className="self-start text-[14px] font-bold text-prussian underline underline-offset-2" data-part="hard-slides">
            Which slides were hard?
          </button>
          <HardSlides course={course} material={material} open={pickingSlides} onClose={() => setPickingSlides(false)} />
        </>
      )}
      {removeOffer}
      {pausing && <span className="text-[13px] font-semibold text-prussian">{pausing}</span>}
      {hidden && (
        <span className="text-[14px] font-semibold text-prussian" data-part="hidden-text">
          {hidden} Check what this upload added.
        </span>
      )}
      {aimed && (
        <span className="text-[14px] font-semibold text-prussian" role="alert" data-part="security-warning">
          This file contains text aimed at an AI; check what it added.
          {run.security!.refused > 0 ? ` ${run.security!.refused} item${run.security!.refused === 1 ? " was" : "s were"} left out by Orca's checks (listed below).` : ""}
        </span>
      )}
      {run.dropped.length > 0 && (
        <details className="text-[14px] text-prussian/80">
          <summary className="cursor-pointer font-semibold text-wisteria-deep">{plural(run.dropped.length, "item")} left out</summary>
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
  );
}

const STATUS: Record<PipelineRun["status"], { label: string; look: string }> = {
  queued: { label: "Queued", look: "bg-alice text-prussian" },
  paused: { label: "Paused", look: "bg-alice text-prussian" },
  running: { label: "Building", look: "bg-wisteria text-parchment" },
  waiting: { label: "Waiting", look: "bg-warn-tint text-warn-text" },
  done: { label: "Added", look: "bg-good-tint text-good-text" },
  failed: { label: "Failed", look: "bg-bad-tint text-bad-text" },
};
