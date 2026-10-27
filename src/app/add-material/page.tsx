"use client";

import Link from "next/link";
import { use, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { MATERIAL_TYPES, MATERIAL_TYPE_LABELS, type MaterialType, formatUSDate, toISODate } from "@/lib/data";
import { useOrca } from "@/lib/store";
import { browserSupabase } from "@/lib/supabase/browser";
import { type UploadStage, filesFromDataTransfer, importAIChat, importWebsite, uploadMaterial, uploadProblem } from "@/lib/uploads";
import { type BatchItem, BatchList } from "@/components/upload/BatchList";
import type { MaterialPages } from "@/lib/data";
import type { ReflectOutput } from "@/lib/pipeline/schemas";
import { IconCalendar, IconUpload } from "@/components/icons";
import { Screen } from "@/components/layout/Screen";
import { BackButton } from "@/components/layout/BackButton";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Chip, ContextPill } from "@/components/ui/Chip";
import { Select } from "@/components/ui/Select";
import { uploadKind } from "@/lib/material/kind";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { cn } from "@/lib/cn";
import { fadeUp, stagger } from "@/lib/motion";

const SKELETON = [92, 100, 78, 96, 60, 0, 100, 88, 94, 70, 0, 90, 84];

/** From this many files an upload counts as bulk (owner, 2026-10-27): dates hidden, "how far has the class got?" asked instead. */
const BULK_FROM = 3;

const STAGE_MESSAGE: Record<UploadStage, string> = {
  hashing: "Checking whether the course already has this file…",
  uploading: "Uploading the file…",
  reading: "Reading the slides…",
};

type Phase =
  | { kind: "idle" }
  | { kind: "sending"; stage: UploadStage }
  | { kind: "working"; message: string }
  /** Stored and read, but nothing will be generated (said why). */
  | { kind: "saved"; message: string }
  | { kind: "duplicate"; filename: string }
  | { kind: "error"; message: string };


/** The date rows and the Add button share one width, so the button lines up with the rows above it. */
const DATE_ROW = "w-[320px] max-w-full";

function DateField({ label, value, onChange, noneLabel }: { label: string; value: string | null; onChange: (v: string | null) => void; noneLabel: string }) {
  const [last, setLast] = useState(value ?? toISODate(new Date()));
  const none = value === null;
  return (
    <div className={cn("grid grid-cols-[1fr_auto] items-center gap-[12px]", DATE_ROW)}>
      <label
        className={cn(
          "pressable relative inline-flex h-[44px] items-center gap-[10px] rounded-[14px] border-[2.5px] px-[14px] text-[15px] font-bold lip-4",
          none ? "border-alice-deep bg-alice text-periwinkle-deep lip-alice" : "border-periwinkle-deep bg-parchment text-prussian lip-periwinkle",
        )}
      >
        <IconCalendar size={20} />
        <span>{formatUSDate(none ? last : value)}</span>
        <input
          type="date"
          aria-label={label}
          value={none ? last : value}
          onChange={(e) => {
            if (!e.target.value) return;
            setLast(e.target.value);
            onChange(e.target.value);
          }}
          className="absolute inset-0 cursor-pointer opacity-0"
        />
      </label>
      <Chip tone="outline" size="sm" selected={none} onClick={() => onChange(none ? last : null)}>
        {noneLabel}
      </Chip>
    </div>
  );
}

export default function AddMaterialPage({ searchParams }: PageProps<"/add-material">) {
  const sp = use(searchParams);
  const router = useRouter();
  const { courses, addMaterial, hydrated, objectives, recordReflection } = useOrca();
  const courseSlug = typeof sp.course === "string" ? sp.course : undefined;
  const resumeId = typeof sp.material === "string" ? sp.material : undefined;
  const [pickedId, setPickedId] = useState<string | null>(null);
  const course = courses.find((c) => c.id === pickedId) ?? courses.find((c) => c.slug === courseSlug) ?? courses[0];

  /** The file's pages as the server read them. */
  const [doc, setDoc] = useState<MaterialPages | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [aiChatUrl, setAiChatUrl] = useState("");
  const [aiChatText, setAiChatText] = useState("");
  const [chosenName, setChosenName] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [type, setType] = useState<MaterialType>("Lecture");
  const [assigned, setAssigned] = useState<string | null>(null);
  const [due, setDue] = useState<string | null>(null);
  const [note, setNote] = useState("");
  /** Several files at once (a folder): one row each; null when a single file is picked. */
  const [batch, setBatch] = useState<BatchItem[] | null>(null);
  /** Bulk upload: id of the last file the class has covered (`"none"`: none yet); null means every file. */
  const [coveredUpTo, setCoveredUpTo] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);

  if (!course) {
    if (!hydrated) return null;
    return (
      <Screen>
        <header className="px-[28px] pt-[28px]">
          <BackButton />
        </header>
        <div className="flex flex-1 flex-col items-center justify-center gap-[12px] text-center">
          <p className="text-[22px] font-bold text-prussian">No course to add material to.</p>
          <p className="text-[16px] text-wisteria-deep">Create a course first; its uploads go on its island.</p>
          <Link href="/new-course" className="pressable rounded-[16px] bg-prussian px-[18px] py-[12px] text-[15px] font-bold text-parchment lip-4 lip-ink">
            Add Course
          </Link>
        </div>
      </Screen>
    );
  }
  if (resumeId && phase.kind === "idle" && !file) {
    return <ResumeUpload materialId={resumeId} course={course} onAnother={() => router.replace(`/add-material?course=${course.slug}`)} />;
  }
  const filename = aiChatUrl || (aiChatText.trim() ? "AI chat transcript" : websiteUrl || chosenName || "Choose a PDF or .pptx…");
  const busy = phase.kind === "sending" || phase.kind === "working";
  const sendable = batch?.filter((it) => it.problem === null) ?? [];
  const batchFailed = sendable.filter((it) => it.status.kind === "failed");
  const batchPending = sendable.filter((it) => it.status.kind === "waiting" || it.status.kind === "failed");
  // Bulk (three files or more) is usually old content: dates stay out of the way, and instead of
  // dates Orca asks how far the class has got, so the rest can wait. With any assigned date given,
  // nothing is asked: a date in the future already says "not yet".
  const bulk = sendable.length >= BULK_FROM;
  const dated = sendable.some((it) => it.assigned !== null);
  const inOrder = [...sendable].sort((a, b) => a.file.name.localeCompare(b.file.name, undefined, { numeric: true, sensitivity: "base" }));
  const askCoverage = bulk && !dated && phase.kind === "idle";
  const coveredIndex = coveredUpTo === null ? inOrder.length - 1 : coveredUpTo === "none" ? -1 : inOrder.findIndex((it) => it.id === coveredUpTo);
  /** Whether a row's material is still ahead of the class, from its date when there is one, else from the student's tap. */
  const isUpcoming = (it: BatchItem) => (dated ? it.assigned !== null && it.assigned > toISODate(new Date()) : bulk && inOrder.indexOf(it) > coveredIndex);
  const unreadable = file ? uploadProblem(file) : null;
  // Only a PDF can be read as page images (a .pptx has no renderer here).
  const isPdf = file ? uploadKind(file.name, file.type) === "pdf" : false;

  /** Several files at once: a list, each with its own details prefilled from the shared defaults. */
  const onFiles = (list: File[]) => {
    const files = list.filter((f) => !f.name.startsWith("."));
    if (files.length === 0) return;
    if (files.length === 1) return onFile(files[0]);
    setFile(null);
    setDoc(null);
    setWebsiteUrl("");
    setAiChatUrl("");
    setAiChatText("");
    setChosenName(`${files.length} files`);
    setPhase({ kind: "idle" });
    setBatch(files.map((f) => ({ id: crypto.randomUUID(), file: f, type, assigned, due, edited: false, problem: uploadProblem(f), status: { kind: "waiting" } })));
  };
  /** A shared default changed: every row that wasn't edited by hand follows it. */
  const setDefault = (patch: Partial<Pick<BatchItem, "type" | "assigned" | "due">>) => {
    if ("type" in patch && patch.type) setType(patch.type);
    if ("assigned" in patch) setAssigned(patch.assigned ?? null);
    if ("due" in patch) setDue(patch.due ?? null);
    setBatch((b) => b && b.map((it) => (it.edited || it.status.kind !== "waiting" ? it : { ...it, ...patch })));
  };

  const onFile = (f: File) => {
    setBatch(null);
    setChosenName(f.name);
    setDoc(null);
    setFile(f);
    setWebsiteUrl("");
    setAiChatUrl("");
    setAiChatText("");
    const problem = uploadProblem(f);
    // A file Orca can't take (too big, empty, a kind it can't read) is refused: nothing is added.
    setPhase(problem ? { kind: "error", message: `${problem} Choose another file.` } : { kind: "idle" });
  };

  /**
   * The files of a folder, one after another (the server builds one job at a time anyway), each row
   * showing where it is. Then the review, which lists every upload; a failed row stays on the list
   * with why, and the button offers to send the failed ones again.
   */
  const submitBatch = async () => {
    if (!batch || batchPending.length === 0) return;
    setPhase({ kind: "sending", stage: "uploading" });
    const patch = (id: string, p: Partial<BatchItem>) => setBatch((b) => b && b.map((it) => (it.id === id ? { ...it, ...p } : it)));
    let firstRun: string | null = null;
    let failed = 0;
    for (const it of batchPending) {
      const meta = { courseId: course.id, type: it.type, assigned: it.assigned, due: it.due, reflect: false, handwritten: it.type === "Handwritten notes" && uploadKind(it.file.name, it.file.type) === "pdf", upcoming: isUpcoming(it) };
      try {
        const outcome = await uploadMaterial(it.file, meta, (stage) => patch(it.id, { status: { kind: "sending", message: STAGE_MESSAGE[stage] } }));
        if (outcome.kind === "read") addMaterial(outcome.material, { saved: true });
        const g = outcome.generation;
        if ("runId" in g && firstRun === null) firstRun = g.runId;
        patch(it.id, { status: { kind: outcome.kind === "duplicate" ? "duplicate" : "done" } });
      } catch (error) {
        failed++;
        patch(it.id, { status: { kind: "failed", message: error instanceof Error ? error.message : "The upload failed." } });
      }
    }
    if (failed > 0) {
      setPhase({ kind: "error", message: `${failed} of ${batchPending.length} files didn't go through. Fix what each one says and send them again, or go on to the review.` });
      return;
    }
    setPhase({ kind: "working", message: firstRun ? "Orca is building topics and questions from them." : `Saved to ${course.name}.` });
    window.setTimeout(() => router.replace(firstRun ? `/course/${course.slug}/review?run=${firstRun}` : `/course/${course.slug}`), 1200);
  };

  const submit = async () => {
    if (batch) return submitBatch();
    if (!file && !websiteUrl.trim() && !aiChatUrl.trim() && !aiChatText.trim()) return;
    const reflection = type === "Homework" ? note.trim() : "";
    const meta = { courseId: course.id, type, assigned, due, reflect: reflection.length > 0, handwritten: type === "Handwritten notes" && isPdf };
    // The form is done with: it gives way to where the student goes next, so Back from there skips it.
    const leave = () => router.replace(due ? "/calendar" : `/course/${course.slug}`);
    if (aiChatUrl.trim() || aiChatText.trim()) {
      try {
        setPhase({ kind: "sending", stage: "reading" });
        const outcome = await importAIChat({ ...(aiChatUrl.trim() ? { url: aiChatUrl.trim() } : {}), ...(aiChatText.trim() ? { text: aiChatText.trim() } : {}) }, meta);
        addMaterial(outcome.material, { saved: true });
        if (outcome.generation.state === "started" || outcome.generation.state === "running" || outcome.generation.state === "queued" || outcome.generation.state === "waiting" || outcome.generation.state === "built") router.replace(`/course/${course.slug}/review?run=${outcome.generation.runId}`);
        else leave();
      } catch (error) { setPhase({ kind: "error", message: error instanceof Error ? error.message : "The AI chat import failed." }); }
      return;
    }
    if (websiteUrl.trim()) {
      try {
        setPhase({ kind: "sending", stage: "reading" });
        const outcome = await importWebsite(websiteUrl.trim(), meta);
        addMaterial(outcome.material, { saved: true });
        if (outcome.generation.state === "started" || outcome.generation.state === "running" || outcome.generation.state === "queued" || outcome.generation.state === "waiting" || outcome.generation.state === "built") router.replace(`/course/${course.slug}/review?run=${outcome.generation.runId}`);
        else leave();
      } catch (error) { setPhase({ kind: "error", message: error instanceof Error ? error.message : "The website import failed." }); }
      return;
    }
    if (!file || unreadable) return;
    try {
      const outcome = await uploadMaterial(
        file,
        meta,
        (stage) => setPhase({ kind: "sending", stage }),
        // In the URL from here on (without re-rendering this page mid-upload): a reload follows this
        // upload instead of showing an empty form.
        (materialId) => window.history.replaceState(null, "", `/add-material?course=${course.slug}&material=${materialId}`),
      );
      if (outcome.kind === "read") {
        addMaterial(outcome.material, { saved: true });
        setDoc(outcome.pages);
      }
      // The homework reflection: Orca matches it to the course's objectives and the ones it's sure
      // of go back to learning. A failed match still saves the note, and says why.
      const matchProblem = reflection ? await reflect(outcome.kind === "read" ? outcome.material.id : outcome.id, reflection) : null;
      const go = (to: () => void) => {
        if (!matchProblem) return to();
        setPhase({ kind: "error", message: `Saved your reflection, but Orca couldn't match it to objectives: ${matchProblem}` });
        window.setTimeout(to, 2500);
      };
      const g = outcome.generation;
      if (g.state === "started" || g.state === "running" || g.state === "queued" || g.state === "waiting") {
        // The server builds it (a job); the review screen follows its progress. Queued: it starts
        // when the student's other job finishes (one at a time). Waiting: when the daily limit resets.
        const message =
          g.state === "queued" ? "Orca will build topics and questions from it after your other job finishes." : g.state === "waiting" ? "Orca will build topics and questions from it when today's limit resets." : "Orca is building topics and questions from it.";
        if (!matchProblem) setPhase({ kind: "working", message });
        go(() => router.replace(`/course/${course.slug}/review?run=${g.runId}`));
        return;
      }
      if (outcome.kind === "duplicate") {
        if (matchProblem) go(() => undefined);
        else setPhase({ kind: "duplicate", filename: outcome.filename });
        return;
      }
      if (g.state === "built") {
        // Read again after its questions were built (a repeated request): show what was built.
        go(() => router.replace(`/course/${course.slug}/review?run=${g.runId}`));
        return;
      }
      setPhase({
        kind: "saved",
        message:
          g.state === "no-text"
            ? `Saved to ${course.name}, but Orca found no text in this file, so there's nothing to build questions from.`
            : `Saved to ${course.name}. No AI is connected, so no topics or questions were generated.`,
      });
      window.setTimeout(leave, 2500);
    } catch (error) {
      setPhase({ kind: "error", message: error instanceof Error ? error.message : "The upload failed." });
    }
  };

  /** Match a homework reflection (POST /api/reflect) and record it; the problem, or null. */
  const reflect = async (materialId: string, text: string): Promise<string | null> => {
    const catalogue = objectives[course.id] ?? {};
    let problem: string | null = null;
    let matches: ReflectOutput["matches"] = [];
    try {
      const res = await fetch("/api/reflect", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ materialId, note: text }) });
      const out = (await res.json().catch(() => null)) as (ReflectOutput & { error?: string }) | null;
      if (!res.ok || !out?.matches) problem = out?.error ?? "the match didn't go through.";
      else matches = out.matches;
    } catch (error) {
      problem = error instanceof Error ? error.message : "the match didn't go through.";
    }
    const sure = matches.filter((m) => m.sure && catalogue[m.objectiveId] && catalogue[m.objectiveId].review !== "archived");
    recordReflection(materialId, text, sure.map((m) => ({ courseId: course.id, topicId: catalogue[m.objectiveId].topicId, objectiveId: m.objectiveId })));
    return problem;
  };

  const previewLines = doc ? doc.slice(0, 6).flatMap((p) => p.text.split("\n").filter((l) => l.trim().length > 3).slice(0, 4)).slice(0, 18) : [];

  return (
    <Screen bg="ocean" className="overflow-y-auto">
      <header className="flex items-center gap-[16px] px-[28px] pt-[28px]">
        <BackButton href={`/course/${course.slug}`} />
        <h1 className="text-[44px] font-bold leading-none text-prussian">Add material</h1>
        {courses.length > 1 ? (
          <Select
            label="Course"
            value={course.id}
            options={courses.map((c) => c.id)}
            labels={Object.fromEntries(courses.map((c) => [c.id, c.name]))}
            onChange={setPickedId}
            className="ml-[8px]"
          />
        ) : (
          <ContextPill className="ml-[8px]">{course.name}</ContextPill>
        )}
      </header>

      <motion.div variants={stagger(0.05, 0.08)} initial="hidden" animate="show" className="flex flex-wrap items-start gap-[40px] px-[40px] pb-[48px] pt-[32px]">
        {/* Document preview / drop target */}
        {/* A letter page: 520 wide at 8.5 × 11, the inputs and preview spanning its width. */}
        <motion.div variants={fadeUp} className="w-[520px] max-w-full">
          <input
            ref={fileRef}
            type="file"
            multiple
            data-part="file-input"
            accept=".pdf,application/pdf,.pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation"
            className="hidden"
            onChange={(e) => {
              onFiles(Array.from(e.target.files ?? []));
              e.target.value = "";
            }}
          />
          {/* A whole folder (every PDF and .pptx in it, subfolders included). */}
          <input
            ref={folderRef}
            type="file"
            multiple
            aria-label="Choose a folder"
            className="hidden"
            {...{ webkitdirectory: "" }}
            onChange={(e) => {
              onFiles(Array.from(e.target.files ?? []));
              e.target.value = "";
            }}
          />
          <Card
            radius={20}
            lip={6}
            role="button"
            tabIndex={0}
            aria-label="Choose a file"
            onClick={() => !busy && fileRef.current?.click()}
            onKeyDown={(e) => e.target === e.currentTarget && (e.key === "Enter" || e.key === " ") && fileRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (busy) return;
              void filesFromDataTransfer(e.dataTransfer).then(onFiles);
            }}
            className="pressable flex aspect-[8.5/11] cursor-pointer flex-col gap-[14px] overflow-hidden px-[28px] pb-[28px] pt-[22px]"
          >
            <div className="flex items-center justify-between gap-3">
              <span className={cn("truncate text-[15px] font-bold", chosenName ? "text-prussian" : "text-periwinkle-deep")}>{filename}</span>
              <span className="flex shrink-0 items-center gap-1 text-[13px] font-semibold text-wisteria-deep">
                <IconUpload size={16} /> {chosenName ? "Replace" : "Upload"}
              </span>
            </div>
            <label className="flex flex-col gap-[6px] text-[13px] font-semibold text-wisteria-deep" onClick={(e) => e.stopPropagation()}>
              Or import a public course website
              <input value={websiteUrl} onChange={(e) => { setWebsiteUrl(e.target.value); setFile(null); setChosenName(null); setAiChatUrl(""); setAiChatText(""); setPhase({ kind: "idle" }); }} placeholder="https://example.edu/course" className="h-[40px] rounded-[12px] border-2 border-alice-deep bg-parchment px-[12px] text-[14px] font-medium text-prussian outline-none focus:border-wisteria" />
            </label>
            <div className="flex flex-col gap-[6px]" onClick={(e) => e.stopPropagation()}>
              <span className="text-[13px] font-semibold text-wisteria-deep">Or add an AI chat</span>
              <input value={aiChatUrl} onChange={(e) => { setAiChatUrl(e.target.value); setAiChatText(""); setWebsiteUrl(""); setFile(null); setChosenName(null); setPhase({ kind: "idle" }); }} placeholder="Public ChatGPT, Claude, or Gemini share link" className="h-[40px] rounded-[12px] border-2 border-alice-deep bg-parchment px-[12px] text-[14px] font-medium text-prussian outline-none focus:border-wisteria" />
              <textarea value={aiChatText} onChange={(e) => { setAiChatText(e.target.value); setAiChatUrl(""); setWebsiteUrl(""); setFile(null); setChosenName(null); setPhase({ kind: "idle" }); }} rows={4} placeholder="Or paste an exported chat / Markdown log. Label turns User: and Assistant: when possible." className="resize-y rounded-[12px] border-2 border-alice-deep bg-parchment px-[12px] py-[9px] text-[13px] font-medium text-prussian outline-none focus:border-wisteria" />
              <span className="text-[11px] leading-snug text-wisteria-deep">Your questions tell Orca what to prioritize. AI answers are treated as context, not course authority.</span>
            </div>

            {phase.kind === "sending" && !batch && (
              <div className="flex flex-col gap-[8px]" role="status">
                <ProgressBar value={phase.stage === "hashing" ? 0.1 : phase.stage === "uploading" ? 0.4 : 0.8} height={10} label="Uploading" />
                <span className="text-[13px] font-semibold text-wisteria-deep">{STAGE_MESSAGE[phase.stage]}</span>
              </div>
            )}

            {file && !doc && phase.kind !== "sending" && !unreadable && (
              <span className="text-[13px] font-semibold text-wisteria-deep" data-part="file-size">
                {(file.size / 1024 / 1024).toFixed(1)} MB · Orca reads it when you add it
              </span>
            )}

            {batch ? (
              <div className="mt-[4px] flex min-h-0 flex-1 flex-col gap-[8px] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
                <span className="text-[12px] font-semibold uppercase tracking-[1.2px] text-wisteria-deep">
                  {sendable.length} file{sendable.length === 1 ? "" : "s"} to add{batch.length > sendable.length ? ` · ${batch.length - sendable.length} skipped` : ""}
                </span>
                <BatchList
                  items={batch}
                  busy={busy}
                  compact={bulk}
                  onChange={(id, p) => setBatch((b) => b && b.map((it) => (it.id === id ? { ...it, ...p, edited: true } : it)))}
                  onRemove={(id) => setBatch((b) => (b && b.length > 1 ? b.filter((it) => it.id !== id) : null))}
                />
              </div>
            ) : doc ? (
              <div className="mt-[4px] flex flex-col gap-[6px]">
                <span className="text-[12px] font-semibold uppercase tracking-[1.2px] text-wisteria-deep">
                  {doc.length} slides · read by Orca
                </span>
                {previewLines.map((l, i) => (
                  <span key={i} className="truncate text-[13px] leading-snug text-prussian/80">
                    {l}
                  </span>
                ))}
              </div>
            ) : (
              <div className="mt-[6px] flex flex-col gap-[9px]" aria-hidden>
                {SKELETON.slice(0, 5).map((w, i) => (
                  <span key={i} className="block h-[8px] rounded-pill bg-alice-deep" style={{ width: `${w}%`, opacity: w ? 1 : 0 }} />
                ))}
                <span className="my-[6px] flex h-[120px] flex-col items-center justify-center gap-[6px] rounded-[12px] bg-alice px-[16px] text-center text-[14px] font-semibold text-wisteria-deep">
                  Drop PDFs, .pptx decks or a whole folder, choose files, paste a course URL, or add an AI chat
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!busy) folderRef.current?.click();
                    }}
                    className="pointer-events-auto text-[13px] font-bold text-wisteria-deep underline underline-offset-2"
                  >
                    Choose a folder
                  </button>
                </span>
                {SKELETON.slice(6).map((w, i) => (
                  <span key={i} className="block h-[8px] rounded-pill bg-alice-deep" style={{ width: `${w}%`, opacity: w ? 1 : 0 }} />
                ))}
              </div>
            )}
          </Card>
        </motion.div>

        {/* Form */}
        <div className="flex w-[520px] max-w-full flex-col gap-[28px]">
          <motion.section variants={fadeUp} className="flex flex-col gap-[14px]">
            <h2 className="text-[17px] font-bold text-prussian">What kind of material is this?</h2>
            <Select label="What kind of material is this?" value={type} options={MATERIAL_TYPES} labels={MATERIAL_TYPE_LABELS} onChange={(t) => setDefault({ type: t })} className="self-start" />
            {batch && <span className="text-[13px] font-medium text-wisteria-deep">Applies to every file on the list; change any one of them on its row.</span>}
          </motion.section>

          {askCoverage && (
            <motion.section variants={fadeUp} initial="hidden" animate="show" className="flex flex-col gap-[12px]" data-part="coverage">
              <h2 className="text-[17px] font-bold text-prussian">How far has the class got?</h2>
              <span className="text-[13px] font-medium text-wisteria-deep">Tap the last file the class has covered. The ones after it wait: Orca won&apos;t put them in your reviews until you mark them covered (on the Uploads tab). Nothing is assumed known either way.</span>
              <ol className="flex flex-col gap-[6px]">
                <li>
                  <button type="button" onClick={() => setCoveredUpTo("none")} aria-pressed={coveredIndex === -1} className={cn("w-full rounded-[12px] border-2 px-[12px] py-[8px] text-left text-[14px] font-semibold", coveredIndex === -1 ? "border-wisteria bg-parchment text-prussian" : "border-alice-deep bg-alice text-wisteria-deep")}>
                    None yet
                  </button>
                </li>
                {inOrder.map((it, i) => (
                  <li key={it.id}>
                    <button type="button" onClick={() => setCoveredUpTo(it.id)} aria-pressed={i === coveredIndex} data-part="covered-up-to" data-covered={i <= coveredIndex ? "1" : "0"} className={cn("flex w-full items-center justify-between gap-[10px] rounded-[12px] border-2 px-[12px] py-[8px] text-left text-[14px] font-semibold", i <= coveredIndex ? "border-wisteria bg-parchment text-prussian" : "border-alice-deep bg-alice text-wisteria-deep")}>
                      <span className="truncate">{it.file.name}</span>
                      <span className="shrink-0 text-[12px] font-bold">{i <= coveredIndex ? (i === coveredIndex ? "Covered up to here" : "Covered") : "Not yet"}</span>
                    </button>
                  </li>
                ))}
              </ol>
            </motion.section>
          )}

          <motion.section variants={fadeUp} className="flex flex-col gap-[12px]">
            <h2 className="text-[17px] font-bold text-prussian">When was it assigned?</h2>
            <DateField label="Assigned date" value={assigned} onChange={(v) => setDefault({ assigned: v })} noneLabel="Not assigned" />
          </motion.section>

          <motion.section variants={fadeUp} className="flex flex-col gap-[12px]">
            <h2 className="text-[17px] font-bold text-prussian">When is it due?</h2>
            <DateField label="Due date" value={due} onChange={(v) => setDefault({ due: v })} noneLabel="No due date" />
          </motion.section>


          {type === "Homework" && !batch && (
            <motion.label variants={fadeUp} initial="hidden" animate="show" className="flex flex-col gap-[8px]">
              <span className="text-[17px] font-bold text-prussian">Reflection</span>
              <span className="text-[13px] font-medium text-wisteria-deep">What tripped you up? Give us your honest thoughts so we can best tailor your studying.</span>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                disabled={busy}
                maxLength={2000}
                rows={4}
                placeholder="e.g. I kept getting the K-map groups wrong when they wrapped around the edges."
                className="rounded-[16px] border-2 border-alice-deep bg-parchment px-[16px] py-[12px] text-[16px] text-prussian outline-none focus:border-wisteria"
              />
            </motion.label>
          )}

          <motion.div variants={fadeUp} className="flex flex-col gap-[10px]">
            <Button onClick={submit} className={DATE_ROW} disabled={busy || Boolean(file && unreadable) || (batch ? batchPending.length === 0 : !chosenName && !websiteUrl.trim() && !aiChatUrl.trim() && !aiChatText.trim())}>
              {phase.kind === "working"
                ? `Building ${course.name}…`
                : batch
                  ? batchFailed.length > 0 && batchFailed.length === batchPending.length
                    ? `Send ${batchFailed.length} failed file${batchFailed.length === 1 ? "" : "s"} again`
                    : `Add ${batchPending.length} file${batchPending.length === 1 ? "" : "s"} to course`
                  : "Add to course"}
            </Button>
            {batch && phase.kind === "error" && batchFailed.length > 0 && (
              <Link href={`/course/${course.slug}/review`} className="text-center text-[14px] font-bold text-wisteria-deep hover:underline">
                Go on to the review
              </Link>
            )}

            <AnimatePresence mode="wait">
              {phase.kind === "working" && (
                <motion.span key="x" variants={fadeUp} initial="hidden" animate="show" exit="exit" className="text-[13px] font-semibold text-wisteria-deep" role="status">
                  {phase.message} Opening the review…
                </motion.span>
              )}
              {phase.kind === "saved" && (
                <motion.span key="s" variants={fadeUp} initial="hidden" animate="show" exit="exit" className="text-[14px] font-bold text-prussian" role="status" data-part="saved">
                  {phase.message}
                </motion.span>
              )}
              {phase.kind === "duplicate" && (
                <motion.span key="dup" variants={fadeUp} initial="hidden" animate="show" exit="exit" className="text-[14px] font-bold text-prussian" role="status">
                  {course.name} already has this file ({phase.filename}), so there&apos;s nothing new to add.
                </motion.span>
              )}
              {phase.kind === "error" && (
                <motion.span key="e" variants={fadeUp} initial="hidden" animate="show" exit="exit" className="text-[14px] font-semibold text-prussian">
                  {phase.message}
                </motion.span>
              )}
            </AnimatePresence>
          </motion.div>
        </div>
      </motion.div>
    </Screen>
  );
}

type Resumed = { kind: "checking" } | { kind: "reading"; filename: string } | { kind: "done"; message: string } | { kind: "stopped"; message: string };

/**
 * After a reload during an upload (its material id is in the URL): follow it on the server. A job
 * for it opens the review screen, as the upload would have; otherwise the page says where it got to.
 */
function ResumeUpload({ materialId, course, onAnother }: { materialId: string; course: { slug: string; name: string }; onAnother: () => void }) {
  const router = useRouter();
  const [state, setState] = useState<Resumed>({ kind: "checking" });

  useEffect(() => {
    let stop = false;
    let checks = 0;
    const check = async () => {
      const db = browserSupabase();
      const [material, run] = await Promise.all([
        db.from("materials").select("filename, status, error").eq("id", materialId).maybeSingle(),
        db.from("pipeline_runs").select("id").eq("material_id", materialId).order("at", { ascending: false }).limit(1).maybeSingle(),
      ]);
      if (stop) return;
      checks++;
      if (run.data) return router.replace(`/course/${course.slug}/review?run=${run.data.id}`);
      const m = material.data;
      if (material.error || !m) return setState({ kind: "stopped", message: "Orca couldn't find this upload. Choose the file again." });
      if (m.status === "failed") return setState({ kind: "stopped", message: m.error ?? "Orca couldn't read this file." });
      // The browser was still sending the file when the page reloaded: it never arrived.
      if (m.status === "uploaded" && checks >= 3) return setState({ kind: "stopped", message: `${m.filename} didn't finish uploading before the page reloaded. Choose the file again.` });
      // Read, but no job for it after a while: nothing will be generated (no AI connected, or no text).
      if (m.status === "ready" && checks >= 5) return setState({ kind: "done", message: `${m.filename} is saved to ${course.name}. No topics or questions are being generated for it.` });
      setState({ kind: "reading", filename: m.filename });
      window.setTimeout(check, 2000);
    };
    void check();
    return () => {
      stop = true;
    };
  }, [materialId, course.slug, course.name, router]);

  return (
    <Screen bg="ocean">
      <header className="flex items-center gap-[16px] px-[28px] pt-[28px]">
        <BackButton href={`/course/${course.slug}`} />
        <h1 className="text-[44px] font-bold leading-none text-prussian">Add material</h1>
        <ContextPill className="ml-[8px]">{course.name}</ContextPill>
      </header>
      <div className="flex flex-1 flex-col items-center justify-center gap-[14px] px-[28px] text-center" data-part="resume-upload">
        {state.kind === "checking" || state.kind === "reading" ? (
          <>
            <p className="text-[22px] font-bold text-prussian" role="status">
              {state.kind === "reading" ? `Orca is reading ${state.filename}…` : "Finding your upload…"}
            </p>
            <p className="text-[15px] text-prussian">The review opens as soon as Orca starts building from it.</p>
          </>
        ) : (
          <>
            <p className="text-[18px] font-bold text-prussian" role={state.kind === "stopped" ? "alert" : "status"}>
              {state.message}
            </p>
            <Button size="sm" onClick={onAnother}>
              Add a file
            </Button>
          </>
        )}
      </div>
    </Screen>
  );
}
