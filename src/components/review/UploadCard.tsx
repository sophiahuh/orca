"use client";

import { useState } from "react";
import type { Material, PipelineRun } from "@/lib/data";
import { hiddenNote, pauseUploads } from "@/lib/uploads";
import { progressMessage } from "@/lib/pipeline/progress-text";
import { isFinished, useRun } from "@/hooks/useRun";
import { jobAhead } from "@/lib/course/review";
import { useOrca } from "@/lib/store";
import { Card } from "@/components/ui/Card";
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
export function UploadCard({ run: stored, material, focused = false }: { run: PipelineRun; material: Material | undefined; focused?: boolean }) {
  // Only an unfinished run is followed (a finished one won't change), and never twice.
  const { run: live } = useRun(focused || isFinished(stored) ? null : stored.id);
  const run = live ?? stored;
  const { runs, setMaterialUpcoming, refresh } = useOrca();
  const name = material?.filename ?? "An upload";
  // Pause a queued upload (it leaves the queue) or put a paused one back in line.
  const [pausing, setPausing] = useState<string | null>(null);
  const setPaused = async (paused: boolean) => {
    setPausing(null);
    try {
      await pauseUploads({ runId: run.id }, paused);
      await refresh();
    } catch (e) {
      setPausing(e instanceof Error ? e.message : "Couldn't change the upload.");
    }
  };
  // "The class hasn't reached this yet": its objectives wait until it's marked covered.
  const coverage = material && (
    <span className="flex flex-wrap items-center gap-[8px] text-[13px] font-semibold text-wisteria-deep" data-part="upload-coverage" data-upcoming={material.upcoming ? "1" : "0"}>
      {material.upcoming ? "Not covered in class yet: its objectives wait until it is." : "Covered in class."}
      <button type="button" onClick={() => setMaterialUpcoming(material.id, !material.upcoming)} className="font-bold text-prussian underline underline-offset-2">
        {material.upcoming ? "Mark covered" : "Mark as not covered yet"}
      </button>
    </span>
  );
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
    return (
      <Card radius={20} lip={4} className="flex flex-col gap-[10px] px-[22px] py-[18px]" data-part={part("run-waiting")} data-status={run.status} role="status">
        {head}
        <span className="text-[14px] font-semibold text-wisteria-deep">{progressMessage(run.progress)} Nothing to do: Orca builds the topics and questions when the limit resets, and they appear here.</span>
      </Card>
    );
  }
  if (run.status === "paused") {
    return (
      <Card radius={20} lip={4} className="flex flex-col gap-[10px] px-[22px] py-[18px]" data-part={part("run-paused")} data-status={run.status} role="status">
        {head}
        <span className="flex flex-wrap items-center gap-[10px] text-[14px] font-semibold text-wisteria-deep">
          Paused: Orca won&apos;t build from it until you resume it. Later uploads go ahead of it meanwhile.
          <button type="button" onClick={() => void setPaused(false)} className="font-bold text-prussian underline underline-offset-2" data-part="resume-upload">
            Resume
          </button>
        </span>
        {pausing && <span className="text-[13px] font-semibold text-prussian">{pausing}</span>}
      </Card>
    );
  }
  if (run.status === "queued" || run.status === "running") {
    return (
      <Card radius={20} lip={4} className="flex flex-col gap-[10px] px-[22px] py-[18px]" data-part={part("run-progress")} data-status={run.status} role="status">
        {head}
        <ProgressBar value={run.status === "running" ? stageShare(run.progress?.stage) : 0.05} height={10} label="Building" />
        <span className="flex flex-wrap items-center gap-[10px] text-[14px] font-semibold text-wisteria-deep">
          <span>
            {run.status === "running" ? progressMessage(run.progress) : jobAhead(runs, run) ? "Waiting for your other upload to finish; this one starts next." : "Starting…"} This takes a few minutes. You can leave this page; it keeps going.
          </span>
          {run.status === "queued" && (
            <button type="button" onClick={() => void setPaused(true)} className="font-bold text-prussian underline underline-offset-2" data-part="pause-upload">
              Pause
            </button>
          )}
        </span>
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
        <span className="text-[14px] text-prussian/70">The file is saved. Upload it again to try again.</span>
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
        {run.objectivesAttached.length === 1 ? "" : "s"} covered again, {plural(run.questionsAdded, "question")} added.
      </span>
      {coverage}
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
