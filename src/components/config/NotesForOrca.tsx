"use client";

import { LIMITS } from "@/lib/limits";
import { Card } from "@/components/ui/Card";

/**
 * Notes for Orca (owner, 2026-10-25): what the student knows about a class, in their own words.
 * The writing steps follow them within fixed rules (src/lib/pipeline/prompts.ts); the save routes
 * screen them. One for all classes (Settings) and one per class (the course's settings).
 * Settings calls its box "Your question preferences" (owner, 2026-11-08): what holds in every class
 * is mostly how the student likes to be quizzed. Same data and prompts either way.
 */
const COPY = {
  account: {
    title: "Your question preferences",
    eyebrow: "For all your classes",
    body: "Any general preferences for how Orca determines topics, objectives and questions. Applies to what it writes from now on.",
    placeholder: "e.g. Only conceptual questions, no plain calculations.",
  },
  course: {
    title: "Notes for Orca",
    eyebrow: "For this class",
    body: "Tell Orca what your professor cares about. Shapes the topics and questions it writes.",
    placeholder: "e.g. The exam will be very similar to past exams. The professor doesn't care about proofs, only applications.",
  },
} as const;

export function NotesForOrca({ scope, value, onChange }: { scope: "account" | "course"; value: string; onChange: (value: string) => void }) {
  const copy = COPY[scope];
  return (
    <Card className="flex flex-col gap-[12px] px-[24px] pb-[20px] pt-[20px]" data-part="notes-for-orca">
      <div className="flex flex-col gap-[4px]">
        <h2 className="text-[22px] font-bold text-prussian">{copy.title}</h2>
        <p className="eyebrow text-wisteria-deep">{copy.eyebrow}</p>
        <p className="text-[14px] font-medium text-wisteria-deep">{copy.body}</p>
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={LIMITS.notesChars}
        rows={5}
        aria-label={copy.title}
        placeholder={copy.placeholder}
        className="min-h-[120px] w-full resize-y rounded-[16px] border-2 border-alice-deep bg-parchment px-[16px] py-[12px] text-[16px] text-prussian outline-none focus:border-wisteria"
      />
      <p className="self-end text-[13px] font-semibold text-wisteria-deep">
        {value.length.toLocaleString()} / {LIMITS.notesChars.toLocaleString()}
      </p>
    </Card>
  );
}
