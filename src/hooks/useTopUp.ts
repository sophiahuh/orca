"use client";

import { useCallback, useState } from "react";
import { SKIPPED_PREFIX } from "@/lib/pipeline/topup";
import { useOrca } from "@/lib/store";
import { isFinished, useRun } from "./useRun";

export type TopUpStatus =
  | { state: "idle" }
  | { state: "running" }
  | { state: "done"; added: number; dropped: number; skipped: string[] }
  | { state: "unavailable"; reason: string }
  | { state: "error"; message: string };

/**
 * Top up a finished session's objectives (docs/MASTERY-PLAN.md §4): once the session and its
 * answers are saved, POST /api/top-up starts a job on the server, and this follows its run.
 * `serverModel` is `useServerModel()`'s value: the hook waits while it is still loading (undefined).
 */
export function useTopUp(serverModel: string | null | undefined) {
  const { afterSaves } = useOrca();
  const [start, setStart] = useState<{ state: "idle" | "starting" } | { state: "following"; runId: string } | { state: "unavailable"; reason: string } | { state: "error"; message: string }>({ state: "idle" });
  const { run } = useRun(start.state === "following" ? start.runId : null);

  const begin = useCallback(
    (courseId: string, sessionId: string, objectiveIds: readonly string[]) => {
      if (start.state !== "idle" || serverModel === undefined) return;
      if (!serverModel) {
        setStart({ state: "unavailable", reason: "No AI is connected, so Orca can't write new questions." });
        return;
      }
      setStart({ state: "starting" });
      // The server checks the session exists, so its save (and the answers') must land first.
      afterSaves()
        .then(() =>
          fetch("/api/top-up", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ courseId, sessionId, objectiveIds: [...new Set(objectiveIds)] }),
          }),
        )
        .then(async (res) => {
          const out = (await res.json().catch(() => null)) as { state?: string; runId?: string; error?: string } | null;
          if (!res.ok) throw new Error(out?.error ?? `the server answered ${res.status}`);
          if ((out?.state === "started" || out?.state === "queued") && out.runId) setStart({ state: "following", runId: out.runId });
          else if (out?.state === "busy") setStart({ state: "unavailable", reason: "New questions for this course are already being written." });
          else if (out?.state === "no-model") setStart({ state: "unavailable", reason: "No AI is connected, so Orca can't write new questions." });
          else throw new Error("the server's answer made no sense");
        })
        .catch((e: unknown) => setStart({ state: "error", message: e instanceof Error ? e.message : String(e) }));
    },
    [start.state, serverModel, afterSaves],
  );

  let status: TopUpStatus;
  if (start.state === "idle") status = { state: "idle" };
  else if (start.state === "starting") status = { state: "running" };
  else if (start.state === "unavailable") status = { state: "unavailable", reason: start.reason };
  else if (start.state === "error") status = { state: "error", message: start.message };
  else if (run?.status === "waiting") status = { state: "unavailable", reason: `${(run.progress as { message?: string } | null | undefined)?.message ?? "Daily limit reached: processing resumes tomorrow."} New questions are written then.` };
  else if (!run || !isFinished(run)) status = { state: "running" };
  else if (run.status === "failed") status = { state: "error", message: run.error ?? "the job failed" };
  else {
    const skipped = run.dropped.filter((d) => d.reason.startsWith(SKIPPED_PREFIX)).map((d) => d.reason.slice(SKIPPED_PREFIX.length));
    status = { state: "done", added: run.questionsAdded, dropped: run.dropped.length - skipped.length, skipped };
  }
  return { status, start: begin };
}
