"use client";

import Link from "next/link";
import { cn } from "@/lib/cn";

/**
 * Path | List | Atlas (Concept Atlas · Design spec, §1: "The Atlas is a tab of a course (Path | Atlas)
 * inside the existing shell"; List added by the owner, 2026-11-10). The current pill is filled.
 */
export function AtlasSwitch({ slug, current }: { slug: string; current: "path" | "list" | "atlas" }) {
  const item = (key: "path" | "list" | "atlas", label: string, href: string) => (
    <Link
      href={href}
      aria-current={current === key ? "page" : undefined}
      className={cn(
        "pressable rounded-pill px-[14px] py-[7px] text-[13px] font-bold lip-2",
        current === key ? "bg-wisteria text-parchment lip-wisteria" : "bg-parchment text-prussian ring-2 ring-inset ring-alice-deep lip-alice",
      )}
    >
      {label}
    </Link>
  );
  return (
    <nav aria-label="Course view" data-part="atlas-switch" className="flex items-center gap-[6px]">
      {item("path", "Path", `/course/${slug}`)}
      {item("list", "List", `/course/${slug}/list`)}
      {item("atlas", "Atlas", `/course/${slug}/atlas`)}
    </nav>
  );
}
