import type { HTMLAttributes } from "react";
import type { EventKind } from "@/lib/data";
import { cn } from "@/lib/cn";

/**
 * Figma: calendar event tags. Four kinds, each its own fill.
 */
export const TAG_LABELS: Record<EventKind, string> = {
  hw: "HW due",
  lab: "Lab",
  rev: "Review",
  exam: "Exam",
};

const looks: Record<EventKind, string> = {
  hw: "bg-periwinkle text-prussian",
  lab: "bg-alice text-prussian ring-2 ring-inset ring-alice-deep",
  rev: "bg-wisteria text-parchment",
  exam: "bg-prussian text-parchment",
};

export interface TagProps extends HTMLAttributes<HTMLSpanElement> {
  kind: EventKind;
  size?: "sm" | "md";
}

export function Tag({ kind, size = "sm", className, children, ...rest }: TagProps) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center truncate rounded-pill font-bold leading-none",
        size === "sm" ? "px-[9px] py-[5px] text-[11px]" : "px-[14px] py-[8px] text-[13px]",
        looks[kind],
        className,
      )}
      {...rest}
    >
      {children ?? TAG_LABELS[kind]}
    </span>
  );
}
