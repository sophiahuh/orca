"use client";

import { useCallback, useRef, useState } from "react";
import { llmReady } from "@/lib/llm";
import { pipelineCaller } from "@/lib/pipeline/client";
import { type TopUpSkip, runTopUp } from "@/lib/pipeline/topup";
import { useOrca } from "@/lib/store";
import { loadMaterialPages } from "@/lib/uploads";

export type TopUpStatus =
  | { state: "idle" }
  | { state: "running" }
  | { state: "done"; added: number; dropped: number; skipped: TopUpSkip[] }
  | { state: "unavailable"; reason: string }
  | { state: "error"; message: string };

/** Courses with a top-up in flight, so two finished sessions can't write the same questions twice. */
const inFlight = new Set<string>();

/**
 * Top up a session's objectives in the background (docs/MASTERY-PLAN.md §4). `serverModel` is
 * `useServerModel()`'s value: the hook waits while it is still loading (undefined).
 */
export function useTopUp(serverModel: string | null | undefined) {
  const orca = useOrca();
  const [status, setStatus] = useState<TopUpStatus>({ state: "idle" });
  const started = useRef(false);

  const start = useCallback(
    (courseId: string, objectiveIds: readonly string[]) => {
      if (started.current || serverModel === undefined) return;
      started.current = true;
      const ownModel = llmReady(orca.llm) ? orca.llm : null;
      if (!ownModel && !serverModel) {
        setStatus({ state: "unavailable", reason: "No AI is connected, so Orca can't write new questions." });
        return;
      }
      if (inFlight.has(courseId)) {
        setStatus({ state: "unavailable", reason: "New questions for this course are already being written." });
        return;
      }
      const course = orca.courses.find((c) => c.id === courseId);
      if (!course) throw new Error(`No course ${courseId}`);
      inFlight.add(courseId);
      setStatus({ state: "running" });
      const materials = orca.materials.filter((m) => m.courseId === courseId);
      // The course's stored pages (read on the server at upload); top-ups pick the ones each objective is taught on.
      loadMaterialPages(materials.map((m) => m.id))
        .then((materialPages) =>
          runTopUp(
            {
              course: { id: course.id, name: course.name, short: course.short, topics: course.topics },
              objectives: orca.objectives[courseId] ?? {},
              bank: orca.questionBank[courseId] ?? {},
              materials,
              materialPages,
              objectiveIds,
              answered: new Set(orca.evidence.flatMap((e) => (e.kind === "answer" && e.courseId === courseId ? [e.questionId] : []))),
              runId: crypto.randomUUID(),
              model: ownModel ? ownModel.model : (serverModel ?? "unknown"),
              now: new Date().toISOString(),
            },
            { call: pipelineCaller(orca.llm), newId: () => crypto.randomUUID() },
          ),
        )
        .then((plan) => {
          orca.addQuestions(courseId, plan);
          setStatus({
            state: "done",
            added: Object.values(plan.questions).flat().length,
            dropped: plan.runs.reduce((n, r) => n + r.dropped.length, 0),
            skipped: plan.skipped,
          });
        })
        .catch((e: unknown) => setStatus({ state: "error", message: e instanceof Error ? e.message : String(e) }))
        .finally(() => inFlight.delete(courseId));
    },
    [orca, serverModel],
  );

  return { status, start };
}
