import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * A key cap, for showing which key does what (the onboarding tips' ← and →). `onColor` is for a
 * cap sitting on a filled (wisteria or prussian) button.
 */
export function Kbd({ children, onColor = false, className }: { children: ReactNode; onColor?: boolean; className?: string }) {
  return (
    <kbd
      className={cn(
        "inline-flex min-w-[20px] items-center justify-center rounded-[6px] border-2 px-[4px] font-[inherit] text-[12px] font-bold leading-[16px]",
        onColor ? "border-parchment/60 text-parchment" : "border-alice-deep bg-alice text-prussian",
        className,
      )}
    >
      {children}
    </kbd>
  );
}
