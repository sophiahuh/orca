"use client";

import { MATERIAL_TYPES, MATERIAL_TYPE_LABELS, type MaterialType } from "@/lib/data";
import { Select } from "@/components/ui/Select";
import { cn } from "@/lib/cn";

/** One file of a folder or multi-file pick, with its own details and where its upload has got to. */
export interface BatchItem {
  id: string;
  file: File;
  type: MaterialType;
  assigned: string | null;
  due: string | null;
  /** Its details were changed by hand, so a change to the shared defaults leaves it alone. */
  edited: boolean;
  /** Why Orca can't take this file (it's listed, greyed, and never sent), or null. */
  problem: string | null;
  status: BatchStatus;
}

export type BatchStatus =
  | { kind: "waiting" }
  | { kind: "sending"; message: string }
  | { kind: "done" }
  | { kind: "duplicate" }
  | { kind: "failed"; message: string };

const STATUS_TEXT: Record<BatchStatus["kind"], string> = {
  waiting: "Waiting",
  sending: "",
  done: "Added",
  duplicate: "Already in the course",
  failed: "",
};

function statusLine(s: BatchStatus): string {
  if (s.kind === "sending" || s.kind === "failed") return s.message;
  return STATUS_TEXT[s.kind];
}

/**
 * The files of a folder (or several picked at once), one row each: name and size, its material
 * type and dates (prefilled from the shared defaults on the right, editable here), and once the
 * upload starts, where each one has got to. A file Orca can't read stays on the list, greyed, with
 * why, so the student sees it wasn't added.
 */
export function BatchList({ items, busy, onChange, onRemove }: { items: BatchItem[]; busy: boolean; onChange: (id: string, patch: Partial<Pick<BatchItem, "type" | "assigned" | "due">>) => void; onRemove: (id: string) => void }) {
  return (
    <ul className="flex flex-col gap-[10px]" data-part="batch-list">
      {items.map((it) => {
        const dim = it.problem !== null;
        const settled = it.status.kind === "done" || it.status.kind === "duplicate";
        return (
          <li key={it.id} data-part="batch-item" data-status={dim ? "skipped" : it.status.kind} className={cn("flex flex-col gap-[8px] rounded-[14px] border-2 border-alice-deep bg-parchment px-[14px] py-[10px]", dim && "opacity-60")}>
            <div className="flex items-center justify-between gap-[10px]">
              <span className="min-w-0 flex-1 truncate text-[14px] font-bold text-prussian" title={it.file.name}>
                {it.file.name}
              </span>
              <span className="shrink-0 text-[12px] font-semibold text-wisteria-deep">{(it.file.size / 1024 / 1024).toFixed(1)} MB</span>
              {!busy && !settled && (
                <button type="button" onClick={() => onRemove(it.id)} aria-label={`Remove ${it.file.name}`} className="shrink-0 text-[13px] font-bold text-wisteria-deep hover:underline">
                  Remove
                </button>
              )}
            </div>
            {dim ? (
              <span className="text-[12px] font-semibold text-prussian" role="note">
                Skipped: {it.problem}
              </span>
            ) : (
              <div className="flex flex-wrap items-center gap-x-[12px] gap-y-[6px]">
                <Select label={`Type for ${it.file.name}`} size="sm" value={it.type} options={MATERIAL_TYPES} labels={MATERIAL_TYPE_LABELS} onChange={(type) => onChange(it.id, { type })} disabled={busy || settled} />
                <label className="flex items-center gap-[6px] text-[12px] font-semibold text-wisteria-deep">
                  Assigned
                  <input type="date" aria-label={`Assigned date for ${it.file.name}`} value={it.assigned ?? ""} disabled={busy || settled} onChange={(e) => onChange(it.id, { assigned: e.target.value || null })} className="h-[30px] rounded-[8px] border-2 border-alice-deep bg-parchment px-[6px] text-[12px] font-semibold text-prussian outline-none focus:border-wisteria" />
                </label>
                <label className="flex items-center gap-[6px] text-[12px] font-semibold text-wisteria-deep">
                  Due
                  <input type="date" aria-label={`Due date for ${it.file.name}`} value={it.due ?? ""} disabled={busy || settled} onChange={(e) => onChange(it.id, { due: e.target.value || null })} className="h-[30px] rounded-[8px] border-2 border-alice-deep bg-parchment px-[6px] text-[12px] font-semibold text-prussian outline-none focus:border-wisteria" />
                </label>
                {it.status.kind !== "waiting" && (
                  <span className={cn("ml-auto text-[12px] font-bold", it.status.kind === "failed" ? "text-prussian" : "text-wisteria-deep")} role="status">
                    {statusLine(it.status)}
                  </span>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
