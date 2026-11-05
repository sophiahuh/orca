"use client";

import { LIMITS } from "@/lib/limits";
import { Card } from "@/components/ui/Card";

/**
 * How the student marks confusion in their handwritten notes (weak points first, Plan B). When Orca
 * reads handwritten or scanned pages it looks for these marks, and what's marked becomes a weak point
 * to practise. Per account only; the save route screens it like Notes for Orca.
 */
export function MarkerNotes({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <Card className="flex flex-col gap-[12px] px-[24px] pb-[20px] pt-[20px]" data-part="marker-notes">
      <div className="flex flex-col gap-[4px]">
        <h2 className="text-[22px] font-bold text-prussian">How do you mark confusion in your notes?</h2>
        <p className="text-[14px] font-medium text-wisteria-deep">Orca looks for these marks when it reads your handwritten notes, and practises what you marked.</p>
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={LIMITS.markerChars}
        rows={2}
        aria-label="How you mark confusion in your notes"
        placeholder="e.g. ★ = lost, ? in the margin, red ink = ask in office hours"
        className="min-h-[64px] w-full resize-y rounded-[16px] border-2 border-alice-deep bg-parchment px-[16px] py-[12px] text-[16px] text-prussian outline-none focus:border-wisteria"
      />
      <p className="self-end text-[13px] font-semibold text-wisteria-deep">
        {value.length.toLocaleString()} / {LIMITS.markerChars.toLocaleString()}
      </p>
    </Card>
  );
}
