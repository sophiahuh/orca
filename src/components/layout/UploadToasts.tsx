"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { isFinished } from "@/hooks/useRun";
import { IconClose } from "@/components/icons";
import { Card } from "@/components/ui/Card";
import type { PipelineRun } from "@/lib/data";
import { popIn } from "@/lib/motion";
import { useOrca } from "@/lib/store";
import { browserSupabase } from "@/lib/supabase/browser";
import { useActiveTip } from "@/components/onboarding/active-tip";

/** How long a toast stays when the pointer isn't on it. */
const TOAST_MS = 5_000;
/** How often unfinished uploads are read again, in case a Realtime message was missed. */
const POLL_MS = 20_000;

type Finished = { runId: string; ok: boolean; name: string | null };
type Toast = { courseId: string; items: Finished[]; version: number };

const isUpload = (r: PipelineRun) => (r.kind ?? "upload") === "upload";
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * A toast when an upload finishes (owner, 2026-11-08): any of the student's uploads that finishes
 * while Orca is open (bulk uploads, Canvas imports and other devices too), done or failed. Uploads of
 * one course that finish while its toast is up share it ("3 uploads finished in DS"). Tapping it opens
 * the course's Uploads tab: one upload's card pinned, with "Which slides were hard?" open when it
 * was built (`?run=…&slides=1`); several, the tab itself. Nothing shows while the student is already
 * on that course's uploads. A finish is noticed from Realtime (as `FlagTopUpWatcher` does for
 * top-ups) or when an upload this tab saw unfinished turns up finished in the store; finished runs
 * the store loaded as finished are history and never toast.
 */
export function UploadToasts() {
  const { runs, courses, materials, refresh } = useOrca();
  const pathname = usePathname();
  const params = useSearchParams();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seenUnfinished = useRef(new Set<string>());
  const toldFinished = useRef(new Set<string>());
  const announced = useRef(new Set<string>());
  const runsRef = useRef(runs);
  useEffect(() => {
    runsRef.current = runs;
  }, [runs]);

  /** Whether the student is already looking at this course's uploads. */
  const watching = useCallback(
    (courseId: string) => {
      const slug = courses.find((c) => c.id === courseId)?.slug;
      return !!slug && pathname === `/course/${slug}/review` && params.get("tab") !== "review";
    },
    [courses, pathname, params],
  );

  const announce = useCallback(
    async (run: PipelineRun) => {
      announced.current.add(run.id);
      if (watching(run.courseId) || !courses.some((c) => c.id === run.courseId)) return;
      // A failed upload's material isn't in the store (it holds only read ones): its name is read here.
      let name = materials.find((m) => m.id === run.materialId)?.filename ?? null;
      if (!name && run.materialId) {
        const { data } = await browserSupabase().from("materials").select("filename").eq("id", run.materialId).maybeSingle();
        name = data?.filename ?? null;
      }
      const item: Finished = { runId: run.id, ok: run.status === "done", name };
      setToasts((ts) => {
        const same = ts.find((t) => t.courseId === run.courseId);
        if (!same) return [...ts, { courseId: run.courseId, items: [item], version: 0 }];
        return ts.map((t) => (t === same ? { ...t, items: [...t.items, item], version: t.version + 1 } : t));
      });
    },
    [watching, courses, materials],
  );

  // The store's uploads: note the unfinished ones; toast the ones that finished since.
  useEffect(() => {
    for (const r of runs) {
      if (!isUpload(r) || announced.current.has(r.id)) continue;
      if (!isFinished(r)) seenUnfinished.current.add(r.id);
      else if (seenUnfinished.current.has(r.id) || toldFinished.current.has(r.id)) void announce(r);
    }
  }, [runs, announce]);

  // Realtime: an upload finished (the store then reads what it built, and the effect above toasts it).
  // Once subscribed, the building uploads are read once: one that finished between the store's load
  // and the subscription sent its message before anyone listened (as `useRun` does for one run).
  useEffect(() => {
    const db = browserSupabase();
    const catchUp = async () => {
      const ids = runsRef.current.filter((r) => isUpload(r) && !isFinished(r) && r.status !== "paused").map((r) => r.id);
      if (!ids.length) return;
      const { data } = await db.from("pipeline_runs").select("id, status, structure_committed_at").in("id", ids);
      if (data?.some((r) => r.status === "done" || r.status === "failed" || (r.structure_committed_at && !runsRef.current.find((stored) => stored.id === r.id)?.structureCommittedAt))) void refresh();
    };
    const channel = db
      .channel("uploads-finished")
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "pipeline_runs", filter: "kind=eq.upload" }, (payload) => {
        const row = payload.new as { id?: string; status?: string; structure_committed_at?: string | null };
        if (row.structure_committed_at && !runsRef.current.find((r) => r.id === row.id)?.structureCommittedAt) void refresh();
        if (!row.id || (row.status !== "done" && row.status !== "failed") || toldFinished.current.has(row.id)) return;
        if (isFinished(runsRef.current.find((r) => r.id === row.id))) return;
        toldFinished.current.add(row.id);
        void refresh();
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") void catchUp();
      });
    return () => void db.removeChannel(channel);
  }, [refresh]);

  // Backstop: while uploads are building, read their status now and then.
  const building = runs.filter((r) => isUpload(r) && (r.status === "queued" || r.status === "running" || r.status === "waiting")).map((r) => r.id);
  const buildingKey = building.join(",");
  useEffect(() => {
    if (!buildingKey) return;
    const ids = buildingKey.split(",");
    const poll = window.setInterval(async () => {
      const { data } = await browserSupabase().from("pipeline_runs").select("id, status, structure_committed_at").in("id", ids);
      if (data?.some((r) => r.status === "done" || r.status === "failed" || (r.structure_committed_at && !runsRef.current.find((stored) => stored.id === r.id)?.structureCommittedAt))) void refresh();
    }, POLL_MS);
    return () => window.clearInterval(poll);
  }, [buildingKey, refresh]);

  const dismiss = useCallback((courseId: string) => setToasts((ts) => ts.filter((t) => t.courseId !== courseId)), []);

  return (
    <div className="pointer-events-none fixed right-[20px] top-[calc(var(--topbar-h)+16px)] z-50 flex w-[380px] max-w-[calc(100vw-40px)] flex-col gap-[10px]" aria-live="polite" data-part="upload-toasts">
      <AnimatePresence>
        {toasts.map((t) => {
          const course = courses.find((c) => c.id === t.courseId);
          return course ? <UploadToast key={t.courseId} toast={t} course={course} onDismiss={dismiss} /> : null;
        })}
      </AnimatePresence>
    </div>
  );
}

function UploadToast({ toast, course, onDismiss }: { toast: Toast; course: { slug: string; short: string }; onDismiss: (courseId: string) => void }) {
  const { materials, runs } = useOrca();
  const [hovered, setHovered] = useState(false);
  const { courseId, version } = toast;
  // Up for TOAST_MS from its last new upload, paused while the pointer is on it or an onboarding tip points at it.
  const pointedAt = useActiveTip() === "upload-toast";
  useEffect(() => {
    if (hovered || pointedAt) return;
    const timer = window.setTimeout(() => onDismiss(courseId), TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [hovered, pointedAt, version, courseId, onDismiss]);
  const close = () => onDismiss(courseId);

  const failed = toast.items.filter((i) => !i.ok).length;
  let title: string;
  let body: string;
  let href: string;
  if (toast.items.length === 1) {
    const item = toast.items[0];
    const name = item.name ?? "Your upload";
    const run = runs.find((r) => r.id === item.runId);
    const material = materials.find((m) => m.id === run?.materialId);
    // Only a stored PDF or .pptx has slides to pick (as on the upload card).
    const slides = item.ok && !!material?.storagePath && /\.(pdf|pptx)$/i.test(material.filename);
    title = item.ok ? `${name} is ready` : `${name} couldn't be built`;
    body = item.ok ? (slides ? `${course.short}: tap to flag the slides that were hard.` : `${course.short}: tap to see what it added.`) : `${course.short}: tap to see why and try again.`;
    href = `/course/${course.slug}/review?run=${item.runId}${slides ? "&slides=1" : ""}`;
  } else {
    title = `${plural(toast.items.length, "upload")} finished in ${course.short}${failed ? ` · ${failed} failed` : ""}`;
    body = "Tap to see them and flag the slides that were hard.";
    href = `/course/${course.slug}/review?tab=uploads`;
  }

  return (
    <motion.div layout variants={popIn} initial="hidden" animate="show" exit="exit" className="pointer-events-auto" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <Card radius={16} lip={4} className="relative flex items-start gap-[10px] px-[16px] py-[12px]" data-part="upload-toast" data-failed={failed > 0 ? "1" : "0"}>
        <Link href={href} onClick={close} className="flex min-w-0 flex-1 flex-col gap-[2px] pr-[28px]" data-part="upload-toast-link">
          <span className={failed === toast.items.length ? "truncate text-[15px] font-bold text-bad-text" : "truncate text-[15px] font-bold text-prussian"}>{title}</span>
          <span className="text-[13px] font-medium text-wisteria-deep">{body}</span>
        </Link>
        <button type="button" onClick={close} aria-label="Dismiss" className="absolute right-[10px] top-[10px] rounded-full p-[4px] text-prussian/70 hover:text-prussian">
          <IconClose size={16} />
        </button>
      </Card>
    </motion.div>
  );
}
