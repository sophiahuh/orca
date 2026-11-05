"use client";

import { useEffect } from "react";
import { useRun } from "@/hooks/useRun";
import { useOrca } from "@/lib/store";
import { browserSupabase } from "@/lib/supabase/browser";

/**
 * Loads the questions a batch of struggle flags had written, without a reload (weak points first).
 * - The top-up this tab's flags started (`flagTopUpRun`) is followed with `useRun`, which refreshes
 *   the store once it finishes (and polls if Realtime misses it).
 * - A follow-up top-up (queued by a finishing one for flags that arrived meanwhile) is inserted only
 *   after the followed run is done, so it's caught here when it finishes: one Realtime subscription to
 *   the student's top-ups (RLS limits it to their rows), refreshing once per finished run. It never
 *   follows a run with `useRun`, so it can't open a second channel for a run the session's end card
 *   is already following (two channels on one run's topic stop each other's updates).
 * Renders nothing.
 */
export function FlagTopUpWatcher() {
  const { flagTopUpRun, refresh } = useOrca();
  useRun(flagTopUpRun);
  useEffect(() => {
    const db = browserSupabase();
    const finished = new Set<string>();
    const channel = db
      .channel("top-ups-finished")
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "pipeline_runs", filter: "kind=eq.top-up" }, (payload) => {
        const row = payload.new as { id?: string; status?: string };
        if (!row.id || (row.status !== "done" && row.status !== "failed") || finished.has(row.id)) return;
        finished.add(row.id);
        void refresh();
      })
      .subscribe();
    return () => void db.removeChannel(channel);
  }, [refresh]);
  return null;
}
