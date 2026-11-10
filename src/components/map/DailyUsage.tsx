"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { useOrca } from "@/lib/store";

interface Usage {
  pages: number;
  pagesPerDay: number;
  tokens: number;
  tokensPerDay: number;
  resetsAt: string;
  timeZone: string;
  globalSpent: boolean;
}

/** From this share of the day's allowance, the meter shows on the map itself, not only in the stats popover. */
const WARN_AT = 0.8;

/**
 * Today's model use against the student's daily allowance (owner, 2026-11-08): a held upload, dive
 * or connector request is explained where the student looks, not guessed at. Reads GET /api/usage
 * once, and again whenever the number of held runs changes. `inline` is the stats popover's copy;
 * `floating` sits on the map above the stats strip (its column places it) only when it matters (80% used, spent, or an
 * upload waiting for it).
 */
export function DailyUsage({ placement }: { placement: "floating" | "inline" }) {
  const { runs, hydrated } = useOrca();
  const held = runs.filter((r) => r.status === "waiting").length;
  const [usage, setUsage] = useState<Usage | null>(null);
  useEffect(() => {
    if (!hydrated) return;
    let live = true;
    fetch("/api/usage", { cache: "no-store" })
      .then((res) => (res.ok ? (res.json() as Promise<Usage>) : null))
      .then((u) => {
        if (live && u) setUsage(u);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [hydrated, held]);
  if (!usage) return null;

  const share = Math.min(1, Math.max(usage.pages / usage.pagesPerDay, usage.tokens / usage.tokensPerDay));
  const percent = Math.round(share * 100);
  const spent = share >= 1 || usage.globalSpent;
  const resets = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", timeZone: usage.timeZone }).format(new Date(usage.resetsAt));
  const line = usage.globalSpent
    ? "Orca's budget for today is used up"
    : spent
      ? "Today's limit reached"
      : `Today's reading: ${percent}% used`;
  if (placement === "floating" && !spent && held === 0 && share < WARN_AT) return null;
  return (
    <div
      className={cn(
        "flex flex-col gap-[6px]",
        placement === "floating" && "rounded-[16px] border-2 border-alice-deep bg-parchment px-[14px] py-[8px] lip-3 lip-alice",
      )}
      data-part="daily-usage"
      data-spent={spent ? "1" : "0"}
      title={`${usage.pages} of ${usage.pagesPerDay} pages and ${Math.round(usage.tokens / 1000)}k of ${Math.round(usage.tokensPerDay / 1000)}k tokens today`}
    >
      <div className="flex items-center gap-[10px] text-[13px] font-bold text-prussian">
        <span>{line}</span>
        <span className="font-semibold text-wisteria-deep">· resets at {resets}</span>
      </div>
      <div className="h-[6px] w-[180px] overflow-hidden rounded-pill bg-alice">
        <div className={cn("h-full rounded-pill", spent ? "bg-bad-text" : "bg-wisteria")} style={{ width: `${Math.max(4, percent)}%` }} />
      </div>
      {held > 0 && (
        <span className="text-[12px] font-semibold text-wisteria-deep" data-part="daily-usage-held">
          {held === 1 ? "1 upload is waiting for it" : `${held} uploads are waiting for it`}
        </span>
      )}
    </div>
  );
}
