import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

/** Full-height page surface (below the top bar) with one of the three background tokens. */
export interface ScreenProps extends HTMLAttributes<HTMLDivElement> {
  bg?: "ocean" | "alice" | "parchment" | "prussian";
}

const bgs = { ocean: "bg-ocean", alice: "bg-alice", parchment: "bg-parchment", prussian: "bg-prussian" } as const;

export function Screen({ bg = "ocean", className, children, ...rest }: ScreenProps) {
  return (
    <div className={cn("relative flex min-h-screen-below-bar w-full flex-1 flex-col overflow-hidden", bgs[bg], className)} {...rest}>
      {children}
    </div>
  );
}
