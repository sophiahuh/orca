"use client";

import Link from "next/link";
import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import { useCourse, useOrca } from "@/lib/store";
import type { ReflectOutput } from "@/lib/pipeline/schemas";
import { formatUSDate } from "@/lib/data";
import { Screen } from "@/components/layout/Screen";
import { BackButton } from "@/components/layout/BackButton";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Pill } from "@/components/review/parts";
import { fadeUp, stagger } from "@/lib/motion";

type Phase = { kind: "writing" } | { kind: "matching" } | { kind: "choosing"; matches: ReflectOutput["matches"] } | { kind: "error"; message: string };

/**
 * After homework marked "Reflect": the student says what tripped them up, Orca matches it to
 * objectives, the student confirms, and each confirmed objective goes back to learning.
 */
export default function ReflectPage({ params, searchParams }: PageProps<"/course/[slug]/reflect">) {
  const { slug } = use(params);
  const sp = use(searchParams);
  const materialId = typeof sp.material === "string" ? sp.material : undefined;
  const router = useRouter();
  const { hydrated, materials, objectives, recordReflection } = useOrca();
  const course = useCourse(slug);
  const material = materials.find((m) => m.id === materialId && m.courseId === course?.id);
  const [note, setNote] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "writing" });
  const [chosen, setChosen] = useState<Set<string>>(new Set());

  if (!course || !material) {
    return (
      <Screen bg="alice">
        <div className="flex flex-col items-start gap-4 p-[32px]">
          <BackButton />
          {hydrated && <p className="text-[22px] font-bold text-prussian">We couldn&apos;t find that material.</p>}
        </div>
      </Screen>
    );
  }

  const catalogue = objectives[course.id] ?? {};
  const live = Object.values(catalogue).filter((o) => o.review !== "archived");
  
  const match = async () => {
    setPhase({ kind: "matching" });
    try {
      // Matched on the server with Orca's model (POST /api/reflect).
      const res = await fetch("/api/reflect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ materialId: material.id, note: note.trim() }),
      });
      const out = (await res.json().catch(() => null)) as (ReflectOutput & { error?: string }) | null;
      if (!res.ok || !out?.matches) throw new Error(out?.error ?? `the server answered ${res.status}`);
      const matches = out.matches.filter((m) => catalogue[m.objectiveId] && catalogue[m.objectiveId].review !== "archived");
      setChosen(new Set(matches.filter((m) => m.sure).map((m) => m.objectiveId)));
      setPhase({ kind: "choosing", matches });
    } catch (error) {
      setPhase({ kind: "error", message: error instanceof Error ? error.message : "Couldn't match the reflection." });
    }
  };

  const save = () => {
    recordReflection(
      material.id,
      note.trim(),
      [...chosen].map((id) => ({ courseId: course.id, topicId: catalogue[id].topicId, objectiveId: id })),
    );
    router.push(`/course/${course.slug}`);
  };

  const toggle = (id: string) => setChosen((s) => (s.has(id) ? new Set([...s].filter((x) => x !== id)) : new Set([...s, id])));

  return (
    <Screen bg="alice" className="overflow-y-auto">
      <header className="flex items-center gap-[16px] px-[28px] pt-[28px]">
        <BackButton />
        <div className="flex flex-col gap-[4px]">
          <h1 className="text-[40px] font-bold leading-none text-prussian">Reflect on {material.filename.replace(/\.[a-z0-9]+$/i, "")}</h1>
          <p className="text-[15px] font-medium text-wisteria-deep">What tripped you up? Anything you say you don&apos;t get goes back to practice.</p>
        </div>
      </header>

      <motion.div variants={stagger(0.06)} initial="hidden" animate="show" className="flex w-[760px] max-w-full flex-col gap-[20px] px-[28px] py-[28px]">
        {material.reflection ? (
          <motion.div variants={fadeUp}>
            <Card radius={18} lip={4} className="flex flex-col gap-[8px] px-[20px] py-[16px]">
              <span className="text-[15px] font-bold text-prussian">You reflected on {formatUSDate(material.reflection.at.slice(0, 10))}.</span>
              <span className="text-[15px] text-prussian/80">“{material.reflection.note}”</span>
              <span className="text-[14px] text-prussian/70">
                {material.reflection.objectiveIds.length
                  ? `Back to practice: ${material.reflection.objectiveIds.map((id) => catalogue[id]?.name ?? "an objective").join("; ")}.`
                  : "Nothing was sent back to practice."}
              </span>
            </Card>
          </motion.div>
        ) : (
          <>
            <motion.label variants={fadeUp} className="flex flex-col gap-[8px]">
              <span className="text-[17px] font-bold text-prussian">Your reflection</span>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                disabled={phase.kind === "matching" || phase.kind === "choosing"}
                maxLength={2000}
                rows={5}
                placeholder="e.g. I kept getting the K-map groups wrong when they wrapped around the edges."
                className="rounded-[16px] border-2 border-alice-deep bg-parchment px-[16px] py-[12px] text-[16px] text-prussian outline-none focus:border-wisteria"
              />
            </motion.label>

            {phase.kind !== "choosing" && (
              <motion.div variants={fadeUp} className="flex flex-col gap-[10px]">
                <Button onClick={match} disabled={!note.trim() || phase.kind === "matching" || live.length === 0}>
                  {phase.kind === "matching" ? "Finding what this is about…" : "Find what this is about"}
                </Button>
                {live.length === 0 && <span className="text-[14px] text-prussian/70">This course has no objectives yet, so there is nothing to match.</span>}
                {phase.kind === "error" && <span className="text-[14px] font-semibold text-prussian">{phase.message}</span>}
              </motion.div>
            )}

            {phase.kind === "choosing" && (
              <motion.section variants={fadeUp} className="flex flex-col gap-[12px]">
                {phase.matches.length === 0 ? (
                  <p className="text-[16px] text-prussian">Orca didn&apos;t find anything in this that you said you don&apos;t understand.</p>
                ) : (
                  <>
                    <h2 className="text-[20px] font-bold text-prussian">Send these back to practice?</h2>
                    {phase.matches.map((m) => (
                      <label key={m.objectiveId} className="flex cursor-pointer items-start gap-[12px] rounded-[14px] bg-parchment px-[16px] py-[12px]" data-match={catalogue[m.objectiveId].name}>
                        <input type="checkbox" checked={chosen.has(m.objectiveId)} onChange={() => toggle(m.objectiveId)} className="mt-[4px] size-[18px] accent-wisteria" />
                        <span className="flex flex-col gap-[4px]">
                          <span className="flex items-center gap-[8px] text-[15px] font-semibold text-prussian">
                            {catalogue[m.objectiveId].name}
                            {!m.sure && <Pill tone="muted">Not sure: check if this is right</Pill>}
                          </span>
                          <span className="text-[13px] text-prussian/70">{m.reasoning}</span>
                        </span>
                      </label>
                    ))}
                  </>
                )}
                <div className="flex gap-[10px]">
                  <Button onClick={save}>{chosen.size ? `Save and practise ${chosen.size} again` : "Save reflection"}</Button>
                  <Button variant="secondary" onClick={() => setPhase({ kind: "writing" })}>
                    Edit
                  </Button>
                </div>
              </motion.section>
            )}
          </>
        )}

        <motion.div variants={fadeUp}>
          <Link href={`/course/${course.slug}`} className="text-[15px] font-bold text-wisteria-deep hover:underline">
            Back to the island
          </Link>
        </motion.div>
      </motion.div>
    </Screen>
  );
}
