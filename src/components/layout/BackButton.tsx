"use client";

import Link from "next/link";
import { IconBack } from "@/components/icons";
import { cn } from "@/lib/cn";

/** Round back button that links to `href` (default: the knowledge map). */
export function BackButton({ href = "/home", size = 52, className }: { href?: string; size?: number; className?: string }) {
  return (
    <Link
      href={href}
      aria-label="Back"
      className={cn(
        "pressable inline-flex shrink-0 items-center justify-center border-2 border-alice-deep bg-parchment text-prussian lip-4 lip-alice",
        className,
      )}
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.385) }}
    >
      <IconBack size={24} />
    </Link>
  );
}
