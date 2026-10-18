"use client";

import Link from "next/link";
import { cn } from "@/lib/cn";

export type ReviewTab = "uploads" | "review";

/** Uploads | Review on a course's review page: two pills with their counts, the current one filled (like Path | Atlas). */
export function ReviewTabs({ slug, current, runId, uploads, toReview }: { slug: string; current: ReviewTab; runId?: string; uploads: number; toReview: number }) {
  const href = (tab: ReviewTab) => `/course/${slug}/review?${new URLSearchParams({ ...(runId ? { run: runId } : {}), tab })}`;
  const item = (key: ReviewTab, label: string, count: number) => (
    <Link
      href={href(key)}
      replace
      aria-current={current === key ? "page" : undefined}
      data-tab={key}
      className={cn(
        "pressable rounded-pill px-[14px] py-[7px] text-[13px] font-bold lip-2",
        current === key ? "bg-wisteria text-parchment lip-wisteria" : "bg-parchment text-prussian ring-2 ring-inset ring-alice-deep lip-alice",
      )}
    >
      {label}
      {count > 0 && <span className="ml-[6px] opacity-80">{count}</span>}
    </Link>
  );
  return (
    <nav aria-label="Uploads or review" data-part="review-tabs" className="flex items-center gap-[6px]">
      {item("uploads", "Uploads", uploads)}
      {item("review", "Review", toReview)}
    </nav>
  );
}
