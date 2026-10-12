"use client";

import { useState } from "react";
import type { Objective, Review } from "@/lib/data";
import type { ObjectiveStatus } from "@/lib/mastery/types";
import { cn } from "@/lib/cn";

/** Small status pill. Colours are tokens; tone picks one of three looks. */
export function Pill({ tone = "soft", children, className }: { tone?: "soft" | "strong" | "muted"; children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-pill px-[10px] py-[4px] text-[12px] font-bold leading-none",
        tone === "soft" && "bg-alice text-prussian ring-2 ring-inset ring-alice-deep",
        tone === "strong" && "bg-wisteria text-parchment",
        tone === "muted" && "bg-parchment-deep/60 text-prussian/70",
        className,
      )}
    >
      {children}
    </span>
  );
}

export const REVIEW_LABEL: Record<Review, string> = { proposed: "Unreviewed", confirmed: "Confirmed", archived: "Rejected" };

export function ReviewPill({ review }: { review: Review }) {
  return <Pill tone={review === "proposed" ? "strong" : review === "archived" ? "muted" : "soft"}>{REVIEW_LABEL[review]}</Pill>;
}

export function OriginPill({ origin }: { origin: Objective["origin"] }) {
  if (origin === "material") return null;
  return <Pill tone="muted">{origin === "inferred" ? "Inferred, not in the material" : "Written by hand"}</Pill>;
}

export const MASTERY_LABEL: Record<ObjectiveStatus, string> = {
  unseen: "Not started",
  learning: "Learning",
  "mixed-up": "Mixed up",
  mastered: "Mastered",
  fading: "Due for a check",
  retired: "Retired",
};

/** A name that becomes a text field on "Rename". */
export function RenameField({ name, onSave, label }: { name: string; onSave: (name: string) => void; label: string }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  if (!editing) {
    return (
      <span className="flex min-w-0 items-center gap-[10px]">
        <span className="truncate text-[20px] font-bold text-prussian">{name}</span>
        <button type="button" className="shrink-0 text-[13px] font-bold text-wisteria-deep hover:underline" onClick={() => (setDraft(name), setEditing(true))}>
          Rename
        </button>
      </span>
    );
  }
  const save = () => {
    if (draft.trim()) onSave(draft.trim());
    setEditing(false);
  };
  return (
    <form
      className="flex min-w-0 items-center gap-[8px]"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <input
        autoFocus
        aria-label={label}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        className="min-w-0 flex-1 rounded-[12px] border-2 border-alice-deep bg-parchment px-[12px] py-[6px] text-[18px] font-bold text-prussian outline-none focus:border-wisteria"
      />
      <button type="submit" className="text-[13px] font-bold text-wisteria-deep hover:underline">
        Save
      </button>
      <button type="button" className="text-[13px] font-bold text-prussian/60 hover:underline" onClick={() => setEditing(false)}>
        Cancel
      </button>
    </form>
  );
}

/** A plain text button for row actions. */
export function TextAction({ children, onClick, tone = "accent" }: { children: React.ReactNode; onClick: () => void; tone?: "accent" | "quiet" | "danger" }) {
  return (
    <button type="button" onClick={onClick} className={cn("shrink-0 text-[13px] font-bold hover:underline", tone === "accent" ? "text-wisteria-deep" : tone === "danger" ? "text-bad-text" : "text-prussian/60")}>
      {children}
    </button>
  );
}
