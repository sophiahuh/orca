"use client";

import { LIMITS } from "@/lib/limits";
import { Card } from "@/components/ui/Card";

/**
 * Notes for Orca (owner, 2026-10-25): what the student knows about a class, in their own words.
 * The writing steps follow them within fixed rules (src/lib/pipeline/prompts.ts); the save routes
 * screen them. One for all classes (Settings) and one per class (the course's settings).
 */
export function NotesForOrca({ scope, value, onChange }: { scope: "account" | "course"; value: string; onChange: (value: string) => void }) {
  return (
    <Card className="flex flex-col gap-[12px] px-[24px] pb-[20px] pt-[20px]" data-part="notes-for-orca">
      <div className="flex flex-col gap-[4px]">
        <h2 className="text-[22px] font-bold text-prussian">Notes for Orca</h2>
        <p className="eyebrow text-wisteria-deep">{scope === "account" ? "For all your classes" : "For this class"}</p>
        <p className="text-[14px] font-medium text-wisteria-deep">Tell Orca what your professor cares about. Shapes the topics and questions it writes.</p>
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={LIMITS.notesChars}
        rows={5}
        aria-label="Notes for Orca"
        placeholder="e.g. The exam will be very similar to past exams. The professor doesn't care about proofs, only applications."
        className="min-h-[120px] w-full resize-y rounded-[16px] border-2 border-alice-deep bg-parchment px-[16px] py-[12px] text-[16px] text-prussian outline-none focus:border-wisteria"
      />
      <p className="self-end text-[13px] font-semibold text-wisteria-deep">
        {value.length.toLocaleString()} / {LIMITS.notesChars.toLocaleString()}
      </p>
    </Card>
  );
}
