"use client";

import Link from "next/link";
import { use, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { MATERIAL_TYPES, type MaterialType, formatUSDate, toISODate } from "@/lib/data";
import { useOrca } from "@/lib/store";
import { modelLabel } from "@/lib/llm";
import { type UploadStage, uploadMaterial, uploadProblem } from "@/lib/uploads";
import type { MaterialPages } from "@/lib/data";
import { useServerModel } from "@/hooks/useServerModel";
import { IconCalendar, IconUpload } from "@/components/icons";
import { Screen } from "@/components/layout/Screen";
import { BackButton } from "@/components/layout/BackButton";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Chip, ContextPill } from "@/components/ui/Chip";
import { Select } from "@/components/ui/Select";
import { Toggle } from "@/components/ui/Toggle";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { cn } from "@/lib/cn";
import { fadeUp, stagger } from "@/lib/motion";

const SKELETON = [92, 100, 78, 96, 60, 0, 100, 88, 94, 70, 0, 90, 84];

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


function DateField({ label, value, onChange, noneLabel }: { label: string; value: string | null; onChange: (v: string | null) => void; noneLabel: string }) {
  const [last, setLast] = useState(value ?? toISODate(new Date()));
  const none = value === null;
  return (
    <div className="flex items-center gap-[12px]">
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
  const { courses, addMaterial, hydrated } = useOrca();
  const serverModel = useServerModel();
  const courseSlug = typeof sp.course === "string" ? sp.course : undefined;
  const [pickedId, setPickedId] = useState<string | null>(null);
  const course = courses.find((c) => c.id === pickedId) ?? courses.find((c) => c.slug === courseSlug) ?? courses[0];

  /** The file's pages as the server read them. */
  const [doc, setDoc] = useState<MaterialPages | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [chosenName, setChosenName] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [type, setType] = useState<MaterialType>("Lecture");
  const [assigned, setAssigned] = useState<string | null>(null);
  const [due, setDue] = useState<string | null>(null);
  const [reflect, setReflect] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);

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
  const filename = chosenName ?? "Choose a PDF…";
  const connected = Boolean(serverModel);
  const busy = phase.kind === "sending" || phase.kind === "working";
  const unreadable = file ? uploadProblem(file) : null;

  const onFile = (f: File) => {
    setChosenName(f.name);
    setDoc(null);
    setFile(f);
    const problem = uploadProblem(f);
    setPhase(problem ? { kind: "error", message: `${problem} It will still be added to the course, without its file.` } : { kind: "idle" });
  };

  const submit = async () => {
    if (!file) return;
    const meta = { courseId: course.id, type, assigned, due, reflect };
    const leave = () => router.push(due ? "/calendar" : `/course/${course.slug}`);
    if (unreadable) {
      addMaterial({ id: crypto.randomUUID(), filename: file.name, ...meta });
      leave();
      return;
    }
    try {
      const outcome = await uploadMaterial(file, meta, (stage) => setPhase({ kind: "sending", stage }));
      if (outcome.kind === "read") {
        addMaterial(outcome.material, { saved: true });
        setDoc(outcome.pages);
      }
      const g = outcome.generation;
      if (g.state === "started" || g.state === "running" || g.state === "queued" || g.state === "waiting") {
        // The server builds it (a job); the review screen follows its progress. Queued: it starts
        // when the student's other job finishes (one at a time). Waiting: when the daily limit resets.
        const message =
          g.state === "queued" ? "Orca will build topics and questions from it after your other job finishes." : g.state === "waiting" ? "Orca will build topics and questions from it when today's limit resets." : "Orca is building topics and questions from it.";
        setPhase({ kind: "working", message });
        router.push(`/course/${course.slug}/review?run=${g.runId}`);
        return;
      }
      if (outcome.kind === "duplicate") {
        setPhase({ kind: "duplicate", filename: outcome.filename });
        return;
      }
      if (g.state === "built") {
        // Read again after its questions were built (a repeated request): show what was built.
        router.push(`/course/${course.slug}/review?run=${g.runId}`);
        return;
      }
      setPhase({
        kind: "saved",
        message:
          g.state === "no-text"
            ? `Saved to ${course.short}, but Orca found no text in this file, so there's nothing to build questions from.`
            : `Saved to ${course.short}. No AI is connected, so no topics or questions were generated.`,
      });
      window.setTimeout(leave, 2500);
    } catch (error) {
      setPhase({ kind: "error", message: error instanceof Error ? error.message : "The upload failed." });
    }
  };

  const previewLines = doc ? doc.slice(0, 6).flatMap((p) => p.text.split("\n").filter((l) => l.trim().length > 3).slice(0, 4)).slice(0, 18) : [];

  return (
    <Screen bg="alice" className="overflow-y-auto">
      <header className="flex items-center gap-[16px] px-[28px] pt-[28px]">
        <BackButton />
        <h1 className="text-[44px] font-bold leading-none text-prussian">Add material</h1>
        {courses.length > 1 ? (
          <Select
            label="Course"
            value={course.id}
            options={courses.map((c) => c.id)}
            labels={Object.fromEntries(courses.map((c) => [c.id, c.short]))}
            onChange={setPickedId}
            className="ml-[8px]"
          />
        ) : (
          <ContextPill className="ml-[8px]">{course.short}</ContextPill>
        )}
      </header>

      <motion.div variants={stagger(0.05, 0.08)} initial="hidden" animate="show" className="flex flex-wrap items-start gap-[40px] px-[40px] pb-[48px] pt-[32px]">
        {/* Document preview / drop target */}
        <motion.div variants={fadeUp} className="w-[440px] max-w-full">
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,application/pdf"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onFile(f);
            }}
          />
          <Card
            radius={20}
            lip={6}
            role="button"
            tabIndex={0}
            aria-label="Choose a file"
            onClick={() => !busy && fileRef.current?.click()}
            onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && fileRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const f = e.dataTransfer.files?.[0];
              if (f) onFile(f);
            }}
            className="pressable flex min-h-[560px] cursor-pointer flex-col gap-[14px] px-[24px] pb-[28px] pt-[22px]"
          >
            <div className="flex items-center justify-between gap-3">
              <span className={cn("truncate text-[15px] font-bold", chosenName ? "text-prussian" : "text-periwinkle-deep")}>{filename}</span>
              <span className="flex shrink-0 items-center gap-1 text-[13px] font-semibold text-wisteria-deep">
                <IconUpload size={16} /> {chosenName ? "Replace" : "Upload"}
              </span>
            </div>

            {phase.kind === "sending" && (
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

            {doc ? (
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
                <span className="my-[6px] flex h-[120px] items-center justify-center rounded-[12px] bg-alice text-[14px] font-semibold text-wisteria-deep">
                  Drop a PDF here or click to choose
                </span>
                {SKELETON.slice(6).map((w, i) => (
                  <span key={i} className="block h-[8px] rounded-pill bg-alice-deep" style={{ width: `${w}%`, opacity: w ? 1 : 0 }} />
                ))}
              </div>
            )}
          </Card>
        </motion.div>

        {/* Form */}
        <div className="flex w-[560px] max-w-full flex-col gap-[28px]">
          <motion.section variants={fadeUp} className="flex flex-col gap-[14px]">
            <h2 className="text-[17px] font-bold text-prussian">What kind of material is this?</h2>
            <div className="flex flex-wrap gap-[10px]">
              {MATERIAL_TYPES.map((t) => (
                <Chip key={t} tone="outline" size="sm" selected={type === t} onClick={() => setType(t)}>
                  {t}
                </Chip>
              ))}
            </div>
          </motion.section>

          <motion.section variants={fadeUp} className="flex flex-col gap-[12px]">
            <h2 className="text-[17px] font-bold text-prussian">When was it assigned?</h2>
            <DateField label="Assigned date" value={assigned} onChange={setAssigned} noneLabel="Not assigned" />
          </motion.section>

          <motion.section variants={fadeUp} className="flex flex-col gap-[12px]">
            <h2 className="text-[17px] font-bold text-prussian">When is it due?</h2>
            <DateField label="Due date" value={due} onChange={setDue} noneLabel="No due date" />
          </motion.section>

          <motion.div variants={fadeUp}>
            <Card radius={18} lip={4} className="flex items-center gap-[16px] px-[18px] py-[14px]">
              <Toggle checked={reflect} onChange={setReflect} label="Reflect and annotate when I finish" />
              <div className="flex flex-col">
                <span className="text-[15px] font-bold text-prussian">Reflect and annotate when I finish</span>
                <span className="text-[13px] font-medium text-wisteria-deep">Homework only. Orca will ask what tripped you up.</span>
              </div>
            </Card>
          </motion.div>

          <motion.div variants={fadeUp} className="flex flex-col gap-[10px]">
            <Card radius={18} lip={4} tone="alice" className="flex items-center justify-between gap-[12px] border-transparent px-[18px] py-[12px] lip-0">
              <span className="text-[14px] font-semibold text-prussian" data-part="model-note">
                {serverModel ? (
                  <>Orca ({modelLabel(serverModel)}) will build topics and quizzes from this file.</>
                ) : (
                  <>No AI connected: the file is saved, but no topics or quizzes are generated.</>
                )}
              </span>
            </Card>

            <Button full onClick={submit} disabled={busy || !chosenName}>
              {phase.kind === "working"
                ? `Building ${course.short}…`
                : connected && !unreadable
                  ? `Add to ${course.short} and generate quizzes`
                  : `Add to ${course.short}`}
            </Button>

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
                  {course.short} already has this file ({phase.filename}), so there&apos;s nothing new to add.
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
