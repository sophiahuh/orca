"use client";

import { MotionConfig } from "motion/react";
import { OrcaProvider } from "@/lib/store";

/** Client-side providers: app state + global motion config (honours prefers-reduced-motion). */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <MotionConfig reducedMotion="user">
      <OrcaProvider>{children}</OrcaProvider>
    </MotionConfig>
  );
}
