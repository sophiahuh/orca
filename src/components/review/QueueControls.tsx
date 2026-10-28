"use client";

import { useState } from "react";
import type { PipelineRun } from "@/lib/data";
import { useOrca } from "@/lib/store";
import { pauseUploads } from "@/lib/uploads";

/**
 * Above the uploads list: "Pause all" while any upload is queued (they leave the queue; the one
 * running finishes), "Resume all" while any is paused (back in line by upload time). Nothing when
 * neither applies.
 */
export function QueueControls({ courseId, uploads }: { courseId: string; uploads: readonly PipelineRun[] }) {
  const { refresh } = useOrca();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const queued = uploads.filter((u) => u.status === "queued").length;
  const paused = uploads.filter((u) => u.status === "paused").length;
  if (queued === 0 && paused === 0) return null;
  const set = async (pause: boolean) => {
    setBusy(true);
    setError(null);
    try {
      await pauseUploads({ courseId }, pause);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't change the uploads.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-[12px] text-[14px] font-semibold text-prussian" data-part="queue-controls">
      <span>
        {queued > 0 ? `${queued} queued` : ""}
        {queued > 0 && paused > 0 ? " · " : ""}
        {paused > 0 ? `${paused} paused` : ""}
      </span>
      {queued > 0 && (
        <button type="button" disabled={busy} onClick={() => void set(true)} className="pressable rounded-pill border-2 border-periwinkle-deep bg-parchment px-[14px] py-[6px] text-[13px] font-bold text-prussian lip-3 lip-periwinkle disabled:opacity-60" data-part="pause-all">
          Pause all
        </button>
      )}
      {paused > 0 && (
        <button type="button" disabled={busy} onClick={() => void set(false)} className="pressable rounded-pill border-2 border-periwinkle-deep bg-parchment px-[14px] py-[6px] text-[13px] font-bold text-prussian lip-3 lip-periwinkle disabled:opacity-60" data-part="resume-all">
          Resume all
        </button>
      )}
      {error && <span className="text-[13px]">{error}</span>}
    </div>
  );
}
