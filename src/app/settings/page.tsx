"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { type Weights, weightLabel, weightPercents } from "@/lib/data";
import { useOrca } from "@/lib/store";
import { IconPlus } from "@/components/icons";
import { Screen } from "@/components/layout/Screen";
import { BackButton } from "@/components/layout/BackButton";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Select } from "@/components/ui/Select";
import { Slider } from "@/components/ui/Slider";
import { ConfigRow, REVIEW_LABELS } from "@/components/config/ConfigRow";
import { AccountCard } from "@/components/settings/Account";
import { fadeUp, stagger } from "@/lib/motion";

export default function SettingsPage() {
  const { courses, configs, weights, setConfig, setWeights } = useOrca();
  const [weightsFor, setWeightsFor] = useState<string | undefined>(courses[0]?.id);
  const [adding, setAdding] = useState(false);
  const [newType, setNewType] = useState("");

  const target = courses.find((c) => c.id === weightsFor) ?? courses[0];
  // While a slider is being dragged the screen follows this draft; the store (and the database) get
  // the value once, when the student lets go.
  const [draft, setDraft] = useState<{ courseId: string; weights: Weights } | null>(null);
  const w: Weights = target ? (draft?.courseId === target.id ? draft.weights : weights[target.id] ?? {}) : {};
  const pct = weightPercents(w);
  const dragWeight = (key: string, v: number) => target && setDraft({ courseId: target.id, weights: { ...w, [key]: v } });
  const commitWeight = (key: string, v: number) => {
    if (!target) return;
    setDraft(null);
    const saved = weights[target.id] ?? {};
    if (saved[key] !== v) setWeights(target.id, { ...saved, [key]: v });
  };

  const addType = () => {
    const name = newType.trim();
    if (!target || !name) return;
    setWeights(target.id, { ...w, [name]: 10 });
    setNewType("");
    setAdding(false);
  };

  return (
    <Screen bg="alice" className="overflow-y-auto">
      <header className="flex items-center gap-[16px] px-[28px] pt-[28px]">
        <BackButton />
        <h1 className="text-[46px] font-bold leading-none text-prussian">Configurations</h1>
      </header>

      <div className="flex flex-wrap items-start gap-[24px] px-[40px] pb-[48px] pt-[36px]">
        <motion.div variants={stagger(0.05, 0.08)} initial="hidden" animate="show" className="flex w-[640px] max-w-full flex-col gap-[24px]">
          {courses.map((c) => {
            const config = configs[c.id];
            if (!config) return null;
            return (
              <motion.div key={c.id} variants={fadeUp}>
                <Card className="flex flex-col gap-[18px] px-[28px] pb-[28px] pt-[24px]">
                  <h2 className="text-[22px] font-bold text-prussian">{c.short}</h2>
                  <motion.div variants={stagger(0, 0.05)} className="flex flex-col gap-[14px]">
                    {(["quick", "deep", "exam"] as const).map((k) => (
                      <ConfigRow key={k} label={REVIEW_LABELS[k]} row={config[k]} onChange={(row) => setConfig(c.id, { ...config, [k]: row })} />
                    ))}
                  </motion.div>
                </Card>
              </motion.div>
            );
          })}
        </motion.div>

        <motion.div variants={stagger(0.1, 0.08)} initial="hidden" animate="show" className="flex w-[418px] max-w-full flex-col gap-[24px]">
          <motion.div variants={fadeUp}>
            <AccountCard />
          </motion.div>
          {/* "Your AI" (src/components/settings/YourAI.tsx) is hidden: model calls run on the server with
              Orca's key only (Phase 4, decision 9). Its code stays until "Bring-your-own model" is decided. */}
        {target && (
          <motion.div variants={fadeUp}>
            <Card className="flex flex-col gap-[16px] px-[28px] pb-[24px] pt-[24px]">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-[22px] font-bold text-prussian">Weights · {target.short}</h2>
                {courses.length > 1 && (
                  <Select
                    size="sm"
                    label="Course for weights"
                    value={target.id}
                    options={courses.map((c) => c.id)}
                    labels={Object.fromEntries(courses.map((c) => [c.id, c.short]))}
                    onChange={setWeightsFor}
                  />
                )}
              </div>
              <p className="-mt-[6px] text-[14px] font-medium text-wisteria-deep">What Orca prioritizes when it builds your reviews.</p>

              <div className="flex flex-col gap-[14px]">
                {Object.entries(w).map(([key, value]) => (
                  <div key={key} className="flex items-center gap-[14px]">
                    <span className="w-[128px] shrink-0 truncate text-[14px] font-bold text-prussian">{weightLabel(key)}</span>
                    <Slider label={`${weightLabel(key)} weight`} value={value} onChange={(v) => dragWeight(key, v)} onCommit={(v) => commitWeight(key, v)} className="flex-1" />
                    <span className="w-[40px] text-right text-[14px] font-semibold text-wisteria-deep">{pct[key]}%</span>
                  </div>
                ))}
              </div>

              {adding ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    addType();
                  }}
                  className="flex items-center gap-[10px]"
                >
                  <input
                    autoFocus
                    value={newType}
                    onChange={(e) => setNewType(e.target.value)}
                    placeholder="e.g. Lab reports"
                    aria-label="New material type"
                    className="h-[40px] min-w-0 flex-1 rounded-[12px] border-2 border-periwinkle-deep bg-parchment px-[12px] text-[15px] font-bold text-prussian placeholder:font-medium placeholder:text-periwinkle-deep focus:outline-none"
                  />
                  <Button size="sm" type="submit" disabled={!newType.trim()}>
                    Add
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>
                    Cancel
                  </Button>
                </form>
              ) : (
                <Button variant="ghost" size="sm" icon={<IconPlus size={18} />} className="self-start" onClick={() => setAdding(true)}>
                  Add material type
                </Button>
              )}
            </Card>
          </motion.div>
        )}
        </motion.div>
      </div>
    </Screen>
  );
}
