"use client";

import { useEffect, useRef, useState } from "react";
import type { PipelineRun } from "@/lib/data";
import { runFromRow } from "@/lib/supabase/app-rows";
import { browserSupabase } from "@/lib/supabase/browser";
import { useOrca } from "@/lib/store";

/** A finished job: its run won't change again. */
export const isFinished = (run: Pick<PipelineRun, "status"> | null | undefined) => run?.status === "done" || run?.status === "failed";

/** How often the run is read again in case a Realtime message was missed (it normally arrives first). */
const POLL_MS = 5000;

/**
 * Follow one pipeline run as its job works on the server (Phase 4 plan, decision 8): the row through
 * Supabase Realtime (under row-level security, so only the student's own), read once when the
 * subscription is up and every few seconds as a backstop. When the run finishes, the store reads
 * everything again, so the job's topics, objectives and questions are on screen. Null while it's
 * unknown; `missing` when there is no such run (or it isn't the student's).
 */
export function useRun(runId: string | null | undefined): { run: PipelineRun | null; missing: boolean } {
  const { refresh, runs } = useOrca();
  const [live, setLive] = useState<PipelineRun | null>(null);
  const [missing, setMissing] = useState(false);
  const refreshed = useRef<string | null>(null);

  useEffect(() => {
    if (!runId) return;
    let alive = true;
    const db = browserSupabase();
    const read = async () => {
      const { data, error } = await db.from("pipeline_runs").select().eq("id", runId).maybeSingle();
      if (!alive || error) return;
      if (!data) setMissing(true);
      else setLive(runFromRow(data));
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
