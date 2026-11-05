"use client";

import { useEffect, useState } from "react";
import { useRun } from "@/hooks/useRun";
import { useOrca } from "@/lib/store";
import { browserSupabase } from "@/lib/supabase/browser";

/**
 * Follows the question writing a batch of struggle flags started (weak points first), so its questions
 * load without a reload: `useRun` refreshes the store once the run finishes. A top-up that finishes
 * while new flags arrived queues one more only after it's done, so the store's runs usually don't have
 * it yet: newly inserted top-up runs are followed too (RLS limits Realtime to the student's own rows).
 * Following a session's own top-up here as well is harmless (one refresh per finished run). Renders nothing.
 */
export function FlagTopUpWatcher() {
  const { flagTopUpRun } = useOrca();
  const [inserted, setInserted] = useState<string | null>(null);
  useEffect(() => {
    const db = browserSupabase();
    const channel = db
      .channel("flag-top-ups")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "pipeline_runs", filter: "kind=eq.top-up" }, (payload) => {
        const id = (payload.new as { id?: string }).id;
        if (id) setInserted(id);
      })
      .subscribe();
    return () => void db.removeChannel(channel);
  }, []);
  // Every top-up a flag starts is inserted, so the subscription sees it too; the run the route named
  // covers the moment before the subscription is up (and a busy answer's in-flight run).
  useRun(inserted ?? flagTopUpRun);
  return null;
}
