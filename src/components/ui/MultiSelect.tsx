"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { IconDown } from "@/components/icons";
import { cn } from "@/lib/cn";

/**
 * A dropdown of checkboxes: closed it says what's chosen ("3 topics", one name, or the placeholder);
 * open it floats a list of every option over the page (a portal, so a scrolling dialog neither
 * clips it nor grows to fit it), under the button or above it when there's no room below. Closes on
 * a click outside or Escape. Matches Select's look.
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

/** The list's tallest, and the gap between it and the button. */
const LIST_MAX = 220;
const GAP = 6;

type Place = { left: number; width: number } & ({ top: number } | { bottom: number });

export function MultiSelect({ options, chosen, onToggle, label, noun, className }: MultiSelectProps) {
  const [place, setPlace] = useState<Place | null>(null);
  const open = place !== null;
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();

  /** Where the list goes, from the button's place on screen: below it, or above when below is short. */
  const measure = (): Place | null => {
    const b = buttonRef.current?.getBoundingClientRect();
    if (!b) return null;
    const below = window.innerHeight - b.bottom;
    const flip = below < LIST_MAX + GAP + 8 && b.top > below;
    return flip ? { left: b.left, width: b.width, bottom: window.innerHeight - b.top + GAP } : { left: b.left, width: b.width, top: b.bottom + GAP };
  };

  useEffect(() => {
    if (!open) return;
    // On the click, not the press, and anywhere but the button or the list.
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!buttonRef.current?.contains(t) && !listRef.current?.contains(t)) setPlace(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation(); // close the dropdown, not the dialog it sits in
      setPlace(null);
    };
    // The list is fixed to the screen: it follows the button when anything scrolls or resizes.
    const follow = () => setPlace(measure());
    document.addEventListener("click", onClick);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", follow, true);
    window.addEventListener("resize", follow);
    return () => {
      document.removeEventListener("click", onClick);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", follow, true);
      window.removeEventListener("resize", follow);
    };
  }, [open]);

  const picked = options.filter((o) => chosen.includes(o.id));
  const summary = picked.length === 0 ? label : picked.length === 1 ? picked[0].name : `${picked.length} ${noun}s`;

  return (
    <div className={cn("relative", className)}>
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setPlace(open ? null : measure())}
        className="pressable inline-flex h-[40px] w-full items-center justify-between gap-2 rounded-[12px] border-2 border-periwinkle-deep bg-parchment px-[12px] text-[14px] font-bold text-prussian lip-3 lip-periwinkle"
        data-part="multi-select"
      >
        <span className={cn("truncate", picked.length === 0 && "font-semibold text-periwinkle-deep")}>{summary}</span>
        <IconDown size={16} className="shrink-0 text-prussian" />
      </button>
      {place &&
        createPortal(
          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            aria-multiselectable="true"
            aria-label={label}
            className="fixed z-[60] overflow-y-auto rounded-[12px] border-2 border-alice-deep bg-parchment py-[6px] lip-3 lip-alice"
            style={{ ...place, maxHeight: LIST_MAX }}
            data-part="multi-select-list"
          >
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
          </ul>,
          document.body,
        )}
    </div>
  );
}
