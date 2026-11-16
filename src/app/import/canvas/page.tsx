"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { BackButton } from "@/components/layout/BackButton";
import { Screen } from "@/components/layout/Screen";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { fadeUp, stagger } from "@/lib/motion";
import { useOrca } from "@/lib/store";
import { cn } from "@/lib/cn";

interface CanvasCourseLine {
  id: string;
  name: string;
  code: string | null;
  term: string | null;
  linkedCourseId: string | null;
}

interface ImportSummary {
  importSessionId?: string;
  course: { id: string; slug: string; name: string; created: boolean };
  exams: number;
  events: number;
  syllabus: boolean;
  files: { added: number; duplicates: number; failed: number; skipped: number; remaining: number; skippedNames: string[]; total: number };
}

interface CanvasFileLine {
  id: string;
  name: string;
  module: string | null;
  assigned: string | null;
  type: string;
  size: number | null;
  linked: boolean;
}

type Progress =
  | { kind: "idle" }
  | { kind: "listing" }
  | { kind: "picking"; files: CanvasFileLine[]; chosen: Set<string> }
  | { kind: "running"; pulled: number }
  | { kind: "done"; summary: ImportSummary }
  | { kind: "failed"; message: string };

const NO_MODULE = "Files not in a module";

/**
 * Which files to pull (owner, 2026-11-08): the course's readable files grouped by module, every new
 * one ticked; files already in Orca are shown ticked and fixed. Nothing is pulled until Import.
 */
function Picker({ files, chosen, onChange, onImport, onCancel }: { files: CanvasFileLine[]; chosen: Set<string>; onChange: (next: Set<string>) => void; onImport: () => void; onCancel: () => void }) {
  const groups = new Map<string, CanvasFileLine[]>();
  for (const f of files) {
    const key = f.module ?? NO_MODULE;
    groups.set(key, [...(groups.get(key) ?? []), f]);
  }
  const fresh = files.filter((f) => !f.linked);
  const count = fresh.filter((f) => chosen.has(f.id)).length;
  const toggle = (ids: string[], on: boolean) => {
    const next = new Set(chosen);
    for (const id of ids) if (on) next.add(id);
    else next.delete(id);
    onChange(next);
  };
  return (
    <section className="flex flex-col gap-[10px] rounded-[16px] border-2 border-alice-deep bg-alice px-[16px] py-[14px]" data-part="canvas-files">
      <div className="flex flex-wrap items-center justify-between gap-[8px]">
        <h3 className="text-[15px] font-bold text-prussian">Which files should Orca read?</h3>
        {fresh.length > 0 && (
          <div className="flex gap-[12px] text-[13px] font-bold text-wisteria-deep">
            <button type="button" className="underline underline-offset-2" onClick={() => toggle(fresh.map((f) => f.id), true)} data-part="canvas-files-all">
              All
            </button>
            <button type="button" className="underline underline-offset-2" onClick={() => toggle(fresh.map((f) => f.id), false)} data-part="canvas-files-none">
              None
            </button>
          </div>
        )}
      </div>
      {files.length === 0 && <p className="text-[13px] font-semibold text-prussian">Canvas lists no PDFs or slide decks in this course. Dates and the syllabus are still imported.</p>}
      {[...groups.entries()].map(([module, members]) => {
        const freshHere = members.filter((f) => !f.linked);
        const allOn = freshHere.length > 0 && freshHere.every((f) => chosen.has(f.id));
        return (
          <div key={module} className="flex flex-col gap-[4px]" data-part="canvas-module">
            <label className="flex items-center gap-[8px] text-[13px] font-bold text-prussian">
              <input type="checkbox" checked={allOn} disabled={freshHere.length === 0} onChange={(e) => toggle(freshHere.map((f) => f.id), e.target.checked)} data-part="canvas-module-toggle" />
              <span className="truncate">{module}</span>
            </label>
            <ul className="flex flex-col gap-[2px] pl-[22px]">
              {members.map((f) => (
                <li key={f.id}>
                  <label className={cn("flex items-center gap-[8px] text-[13px] font-medium", f.linked ? "text-wisteria-deep" : "text-prussian")}>
                    <input type="checkbox" checked={f.linked || chosen.has(f.id)} disabled={f.linked} onChange={(e) => toggle([f.id], e.target.checked)} data-part="canvas-file" data-id={f.id} data-linked={f.linked ? "1" : "0"} />
                    <span className="truncate">{f.name}</span>
                    <span className="shrink-0 text-[12px] font-semibold text-wisteria-deep">{f.linked ? "already in Orca" : f.type}</span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
      <div className="flex flex-wrap items-center gap-[10px] pt-[4px]">
        <Button size="sm" onClick={onImport} data-part="canvas-import-chosen">
          {count === 0 ? "Import dates and syllabus only" : `Import ${count} file${count === 1 ? "" : "s"}`}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel} data-part="canvas-files-cancel">
          Cancel
        </Button>
      </div>
    </section>
  );
}

function summaryLine(s: ImportSummary): string {
  const parts = [s.course.created ? `Created ${s.course.name}` : `Updated ${s.course.name}`];
  if (s.exams) parts.push(`${s.exams} exam${s.exams === 1 ? "" : "s"}`);
  if (s.events) parts.push(`${s.events} assignment${s.events === 1 ? "" : "s"} on the calendar`);
  if (s.syllabus) parts.push("syllabus");
  const f = s.files;
  const files: string[] = [];
  if (f.added) files.push(`${f.added} added`);
  if (f.duplicates) files.push(`${f.duplicates} already there`);
  if (f.failed) files.push(`${f.failed} couldn't be read`);
  if (f.skipped) files.push(`${f.skipped} skipped${f.skippedNames.length ? ` (${f.skippedNames.slice(0, 3).join(", ")}${f.skippedNames.length > 3 ? ", …" : ""})` : ""}`);
  parts.push(f.total === 0 ? "no new files" : `files: ${files.join(", ")}`);
  if (f.remaining) parts.push(`${f.remaining} more to pull: press Import again to continue`);
  return parts.join(" · ");
}

/** Import a course from Canvas: its slides, assignments, exam dates and syllabus, no uploading. */
export default function ImportCanvasPage() {
  const { refresh } = useOrca();
  const [courses, setCourses] = useState<CanvasCourseLine[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [notConnected, setNotConnected] = useState(false);
  const [progress, setProgress] = useState<Record<string, Progress>>({});

  useEffect(() => {
    let live = true;
    (async () => {
      const res = await fetch("/api/canvas/courses", { cache: "no-store" });
      if (!live) return;
      const body = (await res.json()) as { courses?: CanvasCourseLine[]; error?: string };
      if (res.status === 409) return setNotConnected(true);
      if (!res.ok || !body.courses) return setProblem(body.error ?? "Couldn't read your Canvas courses.");
      setCourses(body.courses);
    })();
    return () => {
      live = false;
    };
  }, []);

  // Import opens the picker first: the course's files, every new one ticked (owner, 2026-11-08).
  const pickFiles = async (c: CanvasCourseLine) => {
    setProgress((p) => ({ ...p, [c.id]: { kind: "listing" } }));
    const res = await fetch(`/api/canvas/courses/${encodeURIComponent(c.id)}/files`, { cache: "no-store" });
    const body = (await res.json().catch(() => null)) as { files?: CanvasFileLine[]; error?: string } | null;
    if (!res.ok || !body?.files) {
      setProgress((p) => ({ ...p, [c.id]: { kind: "failed", message: body?.error ?? "Orca couldn't list that course's files." } }));
      return;
    }
    setProgress((p) => ({ ...p, [c.id]: { kind: "picking", files: body.files!, chosen: new Set(body.files!.filter((f) => !f.linked).map((f) => f.id)) } }));
  };

  const importCourse = async (c: CanvasCourseLine, fileIds: string[]) => {
    setProgress((p) => ({ ...p, [c.id]: { kind: "running", pulled: 0 } }));
    let last: ImportSummary | null = null;
    const storageKey = `orca-canvas-import:${c.id}:${[...fileIds].sort().join(",")}`;
    const importSessionId = sessionStorage.getItem(storageKey) ?? crypto.randomUUID();
    sessionStorage.setItem(storageKey, importSessionId);
    // Each request pulls files until its time budget is used; keep going while Canvas has more.
    for (let round = 0; round < 10; round++) {
      const res = await fetch("/api/canvas/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ canvasCourseId: c.id, fileIds, importSessionId, resumeExpired: round === 0 }) });
      const body = (await res.json().catch(() => null)) as (ImportSummary & { error?: string }) | null;
      if (!res.ok || !body || !("course" in body)) {
        // A later round failing (a 429, a Canvas hiccup) keeps what the earlier rounds pulled: those files
        // are linked and queued already, so the summary shows and Import again continues (2026-11-08).
        if (last) break;
        setProgress((p) => ({ ...p, [c.id]: { kind: "failed", message: body?.error ?? "Orca couldn't import that course." } }));
        return;
      }
      last = body.importSessionId ? body : last ? { ...body, exams: last.exams + body.exams, events: last.events + body.events, syllabus: last.syllabus || body.syllabus, files: { ...body.files, added: last.files.added + body.files.added, duplicates: last.files.duplicates + body.files.duplicates, failed: last.files.failed + body.files.failed, skipped: last.files.skipped + body.files.skipped, skippedNames: [...last.files.skippedNames, ...body.files.skippedNames], total: last.files.total } } : body;
      if (body.files.remaining === 0) { sessionStorage.removeItem(storageKey); break; }
      const pulled = last.files.added + last.files.duplicates + last.files.failed + last.files.skipped;
      setProgress((p) => ({ ...p, [c.id]: { kind: "running", pulled } }));
    }
    const summary = last;
    if (!summary) return;
    await refresh();
    setCourses((cs) => cs?.map((x) => (x.id === c.id ? { ...x, linkedCourseId: summary.course.id } : x)) ?? null);
    setProgress((p) => ({ ...p, [c.id]: { kind: "done", summary } }));
  };

  return (
    <Screen bg="ocean" className="overflow-y-auto">
      <header className="px-[28px] pt-[28px]">
        <BackButton />
      </header>
      <motion.div variants={stagger(0.05, 0.08)} initial="hidden" animate="show" className="flex w-[720px] max-w-full flex-col gap-[16px] px-[72px] pb-[80px] pt-[32px] lg:px-[100px]">
        <motion.span variants={fadeUp} className="eyebrow">
          From Canvas
        </motion.span>
        <motion.h1 variants={fadeUp} className="text-[46px] font-bold leading-[1.05] text-prussian">
          Pick a course
        </motion.h1>
        <motion.p variants={fadeUp} className="max-w-[520px] text-[16px] leading-[1.45] text-prussian">
          Orca pulls the assignments and exam dates itself, and the files you tick. Import again any time to pick up what the professor posted since.
        </motion.p>

        {notConnected && (
          <motion.div variants={fadeUp}>
            <Card className="flex flex-col gap-[10px] px-[24px] py-[20px]" data-part="canvas-not-connected">
              <p className="text-[15px] font-semibold text-prussian">Canvas isn&apos;t connected yet.</p>
              <Link href="/settings?section=connections" className="text-[15px] font-bold text-wisteria-deep underline underline-offset-2">
                Connect it in Settings
              </Link>
            </Card>
          </motion.div>
        )}
        {problem && <span role="alert" className="text-[14px] font-semibold text-bad-text">{problem}</span>}
        {courses && courses.length === 0 && <p className="text-[15px] text-prussian">Canvas lists no active courses for you.</p>}

        {courses && courses.length > 0 && (
          <ul className="flex flex-col gap-[10px]" data-part="canvas-courses">
            {courses.map((c) => {
              const p = progress[c.id] ?? { kind: "idle" };
              return (
                <motion.li key={c.id} variants={fadeUp}>
                  <Card className="flex flex-col gap-[8px] px-[20px] py-[16px]" radius={20} lip={5} data-part="canvas-course" data-status={p.kind}>
                    <div className="flex flex-wrap items-center justify-between gap-[10px]">
                      <div className="min-w-0">
                        <p className="truncate text-[18px] font-bold text-prussian">{c.name}</p>
                        <p className="text-[13px] font-semibold text-wisteria-deep">{[c.code, c.term].filter(Boolean).join(" · ")}</p>
                      </div>
                      {p.kind !== "picking" && (
                        <Button size="sm" variant={c.linkedCourseId ? "secondary" : "primary"} disabled={p.kind === "running" || p.kind === "listing"} onClick={() => void pickFiles(c)} data-part="canvas-import">
                          {p.kind === "running" ? "Importing…" : p.kind === "listing" ? "Listing files…" : c.linkedCourseId ? "Update" : "Import"}
                        </Button>
                      )}
                    </div>
                    {p.kind === "picking" && (
                      <Picker
                        files={p.files}
                        chosen={p.chosen}
                        onChange={(chosen) => setProgress((x) => ({ ...x, [c.id]: { ...p, chosen } }))}
                        onImport={() => void importCourse(c, [...p.chosen])}
                        onCancel={() => setProgress((x) => ({ ...x, [c.id]: { kind: "idle" } }))}
                      />
                    )}
                    {p.kind === "running" && (
                      <p className="text-[13px] font-semibold text-prussian" role="status">
                        {p.pulled === 0 ? "Reading the course: dates, syllabus, then the files…" : `${p.pulled} files pulled, getting the rest…`}
                      </p>
                    )}
                    {p.kind === "done" && (
                      <>
                        <p className="text-[13px] font-semibold text-prussian" role="status" data-part="canvas-summary">
                          {summaryLine(p.summary)}.{" "}
                          <Link href={`/course/${p.summary.course.slug}/review`} className="font-bold text-wisteria-deep underline underline-offset-2">
                            Open it
                          </Link>
                        </p>
                      </>
                    )}
                    {p.kind === "failed" && (
                      <span role="alert" className="text-[13px] font-semibold text-bad-text">
                        {p.message}
                      </span>
                    )}
                  </Card>
                </motion.li>
              );
            })}
          </ul>
        )}
      </motion.div>
    </Screen>
  );
}
