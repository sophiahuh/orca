"use client";

import { use, useState } from "react";
import { motion } from "motion/react";
import { type ReviewConfig } from "@/lib/data";
import { useOrca } from "@/lib/store";
import { BackButton } from "@/components/layout/BackButton";
import { Screen } from "@/components/layout/Screen";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { ConfigRow, REVIEW_LABELS } from "@/components/config/ConfigRow";
import { NotesForOrca } from "@/components/config/NotesForOrca";
import { fadeUp, stagger } from "@/lib/motion";

type Draft = { config: ReviewConfig | null; notes: string };

async function saveCourseSettings(body: { courseId: string; reviewConfig: ReviewConfig | null; notes: string | null }) {
  const response = await fetch("/api/course-settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const result = (await response.json().catch(() => null)) as { error?: string } | null;
  if (!response.ok) throw new Error(result?.error ?? "Orca couldn't save this course's settings.");
}

/** Course-only overrides. Saving never changes account defaults and deliberately stays on this page. */
export default function CourseSettingsPage({ params }: PageProps<"/course/[slug]/settings">) {
  const { slug } = use(params);
  const { courses, configs, configOverrides, courseNotes, defaultConfig, hydrated, refresh } = useOrca();
  const course = courses.find((item) => item.slug === slug);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  if (!course) {
    return (
      <Screen bg="ocean">
        <header className="px-[24px] pt-[20px]"><BackButton /></header>
        {hydrated && <p className="p-[32px] text-[22px] font-bold text-prussian">We couldn&apos;t find that course.</p>}
      </Screen>
    );
  }

  const storedConfig = configOverrides[course.id] ?? null;
  const storedNotes = courseNotes[course.id] ?? "";
  const notes = draft ? draft.notes : storedNotes;
  const config = draft ? draft.config ?? defaultConfig : configs[course.id] ?? defaultConfig;
  const inheritsConfig = draft ? draft.config === null : storedConfig === null;

  const changeConfig = (next: ReviewConfig) => {
    setDraft({ config: next, notes });
    setSaved(false);
  };
  const save = async () => {
    const next = draft ?? { config: storedConfig, notes: storedNotes };
    setSaving(true);
    setSaved(false);
    setProblem(null);
    try {
      await saveCourseSettings({ courseId: course.id, reviewConfig: next.config, notes: next.notes.trim() || null });
      await refresh();
      setDraft(null);
      setSaved(true);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "Orca couldn't save this course's settings.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen bg="ocean" className="overflow-auto">
      <header className="flex items-center gap-[12px] px-[24px] pt-[20px]">
        <BackButton href={`/course/${course.slug}`} />
        <div>
          <h1 className="text-[40px] font-bold leading-none text-prussian">{course.name} settings</h1>
          <p className="mt-[5px] text-[14px] font-medium text-wisteria-deep">Overrides for this course only. They take priority over your master settings.</p>
        </div>
      </header>

      <motion.div variants={stagger(0.05, 0.08)} initial="hidden" animate="show" className="flex min-w-[940px] items-start gap-[12px] px-[24px] pb-[28px] pt-[20px]">
        <div className="flex w-[600px] flex-col gap-[12px]">
          <motion.div variants={fadeUp}>
            <Card className="flex flex-col gap-[12px] px-[24px] pb-[22px] pt-[20px]">
              <div className="flex flex-col gap-[4px]">
                <h2 className="text-[22px] font-bold text-prussian">Course review settings</h2>
                <p className="text-[14px] font-medium text-wisteria-deep">{inheritsConfig ? "Using master review settings until you edit a row." : "This course has its own review override."}</p>
              </div>
              <motion.div variants={stagger(0, 0.05)} className="flex flex-col gap-[10px]">
                {(["quick", "deep", "exam"] as const).map((key) => <ConfigRow key={key} label={REVIEW_LABELS[key]} row={config[key]} onChange={(row) => changeConfig({ ...config, [key]: row })} />)}
              </motion.div>
              {!inheritsConfig && <Button size="sm" variant="ghost" className="self-start" onClick={() => { setDraft({ config: null, notes }); setSaved(false); }}>Use master review settings</Button>}
            </Card>
          </motion.div>
          <motion.div variants={fadeUp}>
            <NotesForOrca scope="course" value={notes} onChange={(v) => { setDraft({ config: draft ? draft.config : storedConfig, notes: v }); setSaved(false); }} />
          </motion.div>
          <motion.div variants={fadeUp} className="flex items-center justify-end gap-[12px]">
            {problem && <span role="alert" className="text-[14px] font-semibold text-bad-text">{problem}</span>}
            {saved && <span role="status" aria-label="Saved" className="text-[14px] font-semibold text-good-deep">Saved</span>}
            <Button size="sm" onClick={() => void save()} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
          </motion.div>
        </div>
        <motion.aside variants={fadeUp} className="w-[328px]">
          <Card className="flex flex-col gap-[8px] px-[20px] py-[20px]" tone="alice" lip={4}>
            <p className="text-[13px] font-bold uppercase tracking-[0.08em] text-wisteria-deep">Course override</p>
            <h2 className="text-[22px] font-bold leading-tight text-prussian">{course.name}</h2>
            <p className="pt-[4px] text-[14px] font-medium leading-relaxed text-wisteria-deep">Review settings: {inheritsConfig ? "inheriting master settings" : "course override"}. Notes for Orca: {notes.trim() ? "set for this class" : "none for this class"}; your notes for all classes apply too.</p>
          </Card>
        </motion.aside>
      </motion.div>
    </Screen>
  );
}
