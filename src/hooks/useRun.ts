"use client";

import { useEffect, useRef, useState } from "react";
import type { PipelineRun } from "@/lib/data";
import { runFromRow } from "@/lib/supabase/app-rows";
import { browserSupabase } from "@/lib/supabase/browser";
import { useOrca } from "@/lib/store";
import { DEAD_RUN_MS, HANDOFF_MS } from "@/lib/jobs/start";

/** A finished job: its run won't change again. */
export const isFinished = (run: Pick<PipelineRun, "status"> | null | undefined) => run?.status === "done" || run?.status === "failed";

/** How often the run is read again in case a Realtime message was missed (it normally arrives first). */
const POLL_MS = 5000;

/**
 * Follow one pipeline run as its job works on the server (Phase 4 plan, decision 8): the row through
 * Supabase Realtime (under row-level security, so only the student's own), read once when the
 * subscription is up and every few seconds as a backstop. When the run finishes, the store reads
 * everything again, so the job's topics, objectives and questions are on screen. Null while it's
 * unknown; `missing` when there is no such run (or it isn't the student's). A run still running past
 * its job's limit has died (e.g. the server restarted): the server is asked once to check it
 * (POST /api/runs/check, which judges by its own clock), so it shows as failed instead of building
 * forever.
 */
export function useRun(runId: string | null | undefined): { run: PipelineRun | null; missing: boolean } {
  const { refresh, runs } = useOrca();
  const [live, setLive] = useState<PipelineRun | null>(null);
  const [missing, setMissing] = useState(false);
  const refreshed = useRef<string | null>(null);

  useEffect(() => {
    if (!runId) return;
    let alive = true;
    let checked = false;
    const db = browserSupabase();
    const read = async () => {
      const { data, error } = await db.from("pipeline_runs").select().eq("id", runId).maybeSingle();
      if (!alive || error) return;
      if (!data) return setMissing(true);
      const run = runFromRow(data);
      setLive(run);
      if (!checked && pastLimit(run)) {
        checked = true;
        const res = await fetch("/api/runs/check", { method: "POST" }).catch(() => null);
        if (alive && res?.ok) void read();
      }
    };
    const channel = db
      .channel(`run-${runId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "pipeline_runs", filter: `id=eq.${runId}` }, (payload) => {
        if (alive && payload.new && "id" in payload.new) setLive(runFromRow(payload.new as Parameters<typeof runFromRow>[0]));
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") void read();
      });
    void read();
    const poll = window.setInterval(() => void read(), POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(poll);
      void db.removeChannel(channel);
    };
  }, [runId]);

  // Once it finished, load what the job saved (once per run).
  const stored = runId ? runs.find((r) => r.id === runId) : undefined;
  useEffect(() => {
    if (!runId || !isFinished(live) || isFinished(stored) || refreshed.current === runId) return;
    refreshed.current = runId;
    void refresh();
  }, [runId, live, stored, refresh]);

  // The store's copy once it has the finished run (with everything it built); the live row until then.
  return { run: isFinished(stored) ? stored! : (live ?? stored ?? null), missing: missing && !stored };
}

/**
 * A run still running past its job's limit, or handed off and still not claimed past `HANDOFF_MS`,
 * by this browser's clock, plus a minute of slack (the server decides).
 */
function pastLimit(run: PipelineRun): boolean {
  if (!run.startedAt) return false;
  const elapsed = Date.now() - Date.parse(run.startedAt);
  if (run.status === "running") return elapsed > DEAD_RUN_MS[run.kind ?? "upload"] + 60_000;
  return run.status === "queued" && elapsed > HANDOFF_MS + 60_000;
}
