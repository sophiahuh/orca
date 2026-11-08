"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { BackButton } from "@/components/layout/BackButton";
import { Screen } from "@/components/layout/Screen";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/cn";
import { fadeUp, stagger } from "@/lib/motion";
import { useOrca } from "@/lib/store";

interface CanvasCourseLine {
  id: string;
  name: string;
  code: string | null;
  term: string | null;
  linkedCourseId: string | null;
}

interface ImportSummary {
  course: { id: string; slug: string; name: string; created: boolean };
  exams: number;
  events: number;
  syllabus: boolean;
  files: { added: number; duplicates: number; failed: number; skipped: number; remaining: number; skippedNames: string[]; total: number; items: Array<{ materialId: string; name: string; upcoming: boolean }>; askCoverage: boolean };
}

type Progress = { kind: "idle" } | { kind: "running"; pulled: number } | { kind: "done"; summary: ImportSummary } | { kind: "failed"; message: string };

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

/**
 * After an import: tap the last file the class has covered; the ones after it wait as `upcoming`
 * (the same question the upload page asks for a bulk upload). Saved through the store, file by file.
 */
function Coverage({ items, onChange }: { items: ImportSummary["files"]["items"]; onChange: (materialId: string, upcoming: boolean) => void }) {
  const [covered, setCovered] = useState(() => items.map((it) => !it.upcoming).lastIndexOf(true));
  const choose = (index: number) => {
    setCovered(index);
    items.forEach((it, i) => onChange(it.materialId, i > index));
  };
  return (
    <section className="flex flex-col gap-[8px]" data-part="coverage">
      <h3 className="text-[15px] font-bold text-prussian">How far has the class got?</h3>
      <span className="text-[13px] font-medium text-wisteria-deep">Tap the last file the class has covered. The ones after it wait: Orca won&apos;t put them in your reviews until you mark them covered. Nothing is assumed known either way.</span>
      <ol className="flex flex-col gap-[6px]">
        <li>
          <button type="button" onClick={() => choose(-1)} aria-pressed={covered === -1} className={cn("w-full rounded-[12px] border-2 px-[12px] py-[8px] text-left text-[14px] font-semibold", covered === -1 ? "border-wisteria bg-parchment text-prussian" : "border-alice-deep bg-alice text-wisteria-deep")}>
            None yet
          </button>
        </li>
        {items.map((it, i) => (
          <li key={it.materialId}>
            <button type="button" onClick={() => choose(i)} aria-pressed={i === covered} data-part="covered-up-to" data-covered={i <= covered ? "1" : "0"} className={cn("flex w-full items-center justify-between gap-[10px] rounded-[12px] border-2 px-[12px] py-[8px] text-left text-[14px] font-semibold", i <= covered ? "border-wisteria bg-parchment text-prussian" : "border-alice-deep bg-alice text-wisteria-deep")}>
              <span className="truncate">{it.name}</span>
              <span className="shrink-0 text-[12px] font-bold">{i <= covered ? (i === covered ? "Covered up to here" : "Covered") : "Not yet"}</span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Import a course from Canvas: its slides, assignments, exam dates and syllabus, no uploading. */
export default function ImportCanvasPage() {
  const { refresh, setMaterialUpcoming } = useOrca();
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

  const importCourse = async (c: CanvasCourseLine) => {
    setProgress((p) => ({ ...p, [c.id]: { kind: "running", pulled: 0 } }));
    let last: ImportSummary | null = null;
    // Each request pulls files until its time budget is used; keep going while Canvas has more.
    for (let round = 0; round < 10; round++) {
      const res = await fetch("/api/canvas/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ canvasCourseId: c.id }) });
      const body = (await res.json().catch(() => null)) as (ImportSummary & { error?: string }) | null;
      if (!res.ok || !body || !("course" in body)) {
        // A later round failing (a 429, a Canvas hiccup) keeps what the earlier rounds pulled: those files
        // are linked and queued already, so the summary shows and Import again continues (2026-11-08).
        if (last) break;
        setProgress((p) => ({ ...p, [c.id]: { kind: "failed", message: body?.error ?? "Orca couldn't import that course." } }));
        return;
      }
      last = last ? { ...body, exams: last.exams + body.exams, events: last.events + body.events, syllabus: last.syllabus || body.syllabus, files: { ...body.files, added: last.files.added + body.files.added, duplicates: last.files.duplicates + body.files.duplicates, failed: last.files.failed + body.files.failed, skipped: last.files.skipped + body.files.skipped, skippedNames: [...last.files.skippedNames, ...body.files.skippedNames], total: last.files.total, items: [...last.files.items, ...body.files.items], askCoverage: last.files.askCoverage || body.files.askCoverage } } : body;
      if (body.files.remaining === 0) break;
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
          Orca pulls the slides, the assignments and the exam dates itself. Import again any time to pick up what the professor posted since.
        </motion.p>

        {notConnected && (
          <motion.div variants={fadeUp}>
            <Card className="flex flex-col gap-[10px] px-[24px] py-[20px]" data-part="canvas-not-connected">
              <p className="text-[15px] font-semibold text-prussian">Canvas isn&apos;t connected yet.</p>
              <Link href="/settings" className="text-[15px] font-bold text-wisteria-deep underline underline-offset-2">
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
                      <Button size="sm" variant={c.linkedCourseId ? "secondary" : "primary"} disabled={p.kind === "running"} onClick={() => void importCourse(c)} data-part="canvas-import">
                        {p.kind === "running" ? "Importing…" : c.linkedCourseId ? "Update" : "Import"}
                      </Button>
                    </div>
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
                        {p.summary.files.items.length >= 2 && (
                          <>
                            {p.summary.files.askCoverage && (
                              <p className="text-[13px] font-semibold text-prussian" data-part="posted-at-once">
                                These were posted all at once, so Orca can&apos;t tell which the class has reached. They wait until you say.
                              </p>
                            )}
                            <Coverage items={p.summary.files.items} onChange={setMaterialUpcoming} />
                          </>
                        )}
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
