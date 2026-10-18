"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { IconBack } from "@/components/icons";
import { goBack } from "@/lib/nav-history";
import { cn } from "@/lib/cn";

/**
 * Round back button: to the page the student came from inside the app, or, when there's none (the
 * page was opened directly or reloaded), to `href` in this page's place: the page this one sits under
 * (default: the courses map). A Link underneath, so opening it in a new tab still works.
 */
export function BackButton({ href = "/", size = 52, className }: { href?: string; size?: number; className?: string }) {
  const router = useRouter();
  return (
    <Link
      href={href}
      aria-label="Back"
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        // No earlier app page: the parent takes this page's place, so Back from there doesn't return here.
        goBack(router, href);
      }}
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
