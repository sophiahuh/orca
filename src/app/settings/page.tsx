"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { useOrca } from "@/lib/store";
import { Screen } from "@/components/layout/Screen";
import { BackButton } from "@/components/layout/BackButton";
import { Card } from "@/components/ui/Card";
import { ConfigRow, REVIEW_LABELS } from "@/components/config/ConfigRow";
import { NotesForOrca } from "@/components/config/NotesForOrca";
import { AccountCard } from "@/components/settings/Account";
import { YourMetricsCard } from "@/components/settings/YourMetrics";
import { fadeUp, stagger } from "@/lib/motion";
import { Button } from "@/components/ui/Button";
import { type ReviewConfig } from "@/lib/data";

async function saveAccountNotes(notes: string | null) {
  const response = await fetch("/api/account-notes", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ notes }) });
  const result = (await response.json().catch(() => null)) as { error?: string } | null;
  if (!response.ok) throw new Error(result?.error ?? "Orca couldn't save your notes.");
}

/**
 * Settings: account-wide fallbacks. A course can inherit these live defaults or set a higher-
 * priority override from its own settings page. Notes for Orca here apply to every class, alongside
 * each class's own.
 */
export default function SettingsPage() {
  const { defaultConfig, setDefaults, accountNotes, refresh, hydrated } = useOrca();
  const [draft, setDraft] = useState<ReviewConfig | null>(null);
  const [notesDraft, setNotesDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const draftConfig = draft ?? defaultConfig;

  const save = async () => {
    setDefaults(draftConfig);
    setSaved(false);
    setProblem(null);
    if (notesDraft !== null) {
      setSaving(true);
      try {
        await saveAccountNotes(notesDraft.trim() || null);
        await refresh();
        setNotesDraft(null);
      } catch (error) {
        setProblem(error instanceof Error ? error.message : "Orca couldn't save your notes.");
        return;
      } finally {
        setSaving(false);
      }
    }
    setSaved(true);
  };

  return (
    <Screen bg="ocean" className="overflow-auto">
      <header className="flex items-center gap-[12px] px-[24px] pt-[20px]">
        <BackButton />
        <h1 className="text-[46px] font-bold leading-none text-prussian">Settings</h1>
      </header>

      <div className="grid min-w-[1384px] grid-cols-[600px_380px_380px] items-start gap-[12px] px-[24px] pb-[28px] pt-[20px]">
        {/* Only once loaded: an edit made before the load lands would be overwritten on screen by it. */}
        {hydrated && (
        <motion.div variants={stagger(0.05, 0.08)} initial="hidden" animate="show" className="flex w-[600px] max-w-full flex-col gap-[12px]">
          <motion.div variants={fadeUp}>
            <Card className="flex flex-col gap-[12px] px-[24px] pb-[22px] pt-[20px]" data-part="default-config">
              <div className="flex flex-col gap-[4px]">
                <h2 className="text-[22px] font-bold text-prussian">Default Review Settings</h2>
                <p className="text-[14px] font-medium text-wisteria-deep">Used by every course unless overridden by that course&apos;s own configurations.</p>
              </div>
              <motion.div variants={stagger(0, 0.05)} className="flex flex-col gap-[10px]">
                {(["quick", "deep", "exam"] as const).map((k) => (
                  <ConfigRow key={k} label={REVIEW_LABELS[k]} row={draftConfig[k]} onChange={(row) => { setDraft({ ...draftConfig, [k]: row }); setSaved(false); }} />
                ))}
              </motion.div>
            </Card>
          </motion.div>
          <motion.div variants={fadeUp}>
            <NotesForOrca scope="account" value={notesDraft ?? accountNotes ?? ""} onChange={(v) => { setNotesDraft(v); setSaved(false); }} />
          </motion.div>
          <motion.div variants={fadeUp} className="flex items-center justify-end gap-[12px]">
            {problem && <span role="alert" className="text-[14px] font-semibold text-bad-text">{problem}</span>}
            {saved && <span role="status" aria-label="Saved" className="text-[14px] font-semibold text-good-deep">Saved</span>}
            <Button size="sm" onClick={() => void save()} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
          </motion.div>
        </motion.div>
        )}

        <motion.div variants={fadeUp} initial="hidden" animate="show" className="w-[380px] max-w-full">
          <AccountCard />
        </motion.div>
        <motion.div variants={fadeUp} initial="hidden" animate="show" className="w-[380px] max-w-full">
          <YourMetricsCard />
        </motion.div>
        {/* "Your AI" (src/components/settings/YourAI.tsx) is hidden: model calls run on the server with
            Orca's key only (Phase 4, decision 9). Its code stays until "Bring-your-own model" is decided. */}
      </div>
    </Screen>
  );
}
