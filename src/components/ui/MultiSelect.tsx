"use client";

import { useEffect, useId, useRef, useState } from "react";
import { IconDown } from "@/components/icons";
import { cn } from "@/lib/cn";

/**
 * A dropdown of checkboxes: closed it says what's chosen ("3 topics", one name, or the placeholder);
 * open it lists every option in place, pushing what's below down (so a scrolling dialog can't clip
 * it). Closes on a click outside or Escape. Matches Select's look.
 */
export interface MultiSelectProps {
  options: ReadonlyArray<{ id: string; name: string }>;
  chosen: readonly string[];
  onToggle: (id: string) => void;
  /** Shown when nothing is chosen, and the control's accessible name. */
  label: string;
  /** "topic" → "3 topics". */
  noun: string;
  className?: string;
}

export function MultiSelect({ options, chosen, onToggle, label, noun, className }: MultiSelectProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    // On the click, not the press: closing shrinks what's around it, and a press that closed it would
    // move the button being clicked out from under the pointer (the click would then miss).
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation(); // close the dropdown, not the dialog it sits in
      setOpen(false);
    };
    document.addEventListener("click", onDown);
    window.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("click", onDown);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  const picked = options.filter((o) => chosen.includes(o.id));
  const summary = picked.length === 0 ? label : picked.length === 1 ? picked[0].name : `${picked.length} ${noun}s`;

  return (
    <div ref={ref} className={cn("relative", className)}>
      <button
        type="button"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((o) => !o)}
        className="pressable inline-flex h-[40px] w-full items-center justify-between gap-2 rounded-[12px] border-2 border-periwinkle-deep bg-parchment px-[12px] text-[14px] font-bold text-prussian lip-3 lip-periwinkle"
        data-part="multi-select"
      >
        <span className={cn("truncate", picked.length === 0 && "font-semibold text-periwinkle-deep")}>{summary}</span>
        <IconDown size={16} className="shrink-0 text-prussian" />
      </button>
      {open && (
        <ul id={listId} role="listbox" aria-multiselectable="true" aria-label={label} className="mt-[6px] max-h-[220px] overflow-y-auto rounded-[12px] border-2 border-alice-deep bg-parchment py-[6px] lip-3 lip-alice">
          {options.map((o) => {
            const on = chosen.includes(o.id);
            return (
              <li key={o.id} role="option" aria-selected={on}>
                <label className="flex cursor-pointer items-center gap-[10px] px-[12px] py-[7px] text-[14px] font-semibold text-prussian hover:bg-alice">
                  <input type="checkbox" checked={on} onChange={() => onToggle(o.id)} className="size-[16px] accent-wisteria" />
                  <span className="min-w-0 truncate">{o.name}</span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
