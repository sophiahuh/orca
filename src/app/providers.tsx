"use client";

import { MotionConfig } from "motion/react";
import { AvatarPreviewProvider } from "@/components/brand/avatar-preview";
import { TopBar } from "@/components/layout/TopBar";
import { LoadFailed, SaveStatus } from "@/components/store/SaveStatus";
import { OrcaProvider, useOrca } from "@/lib/store";

/** The app once the student's data is in, or why it couldn't be loaded. */
function Loaded({ children }: { children: React.ReactNode }) {
  const { status } = useOrca();
  if (status === "failed") return <LoadFailed />;
  return (
    <>
      {children}
      <SaveStatus />
    </>
  );
}

/** Client-side providers: app state + global motion config (honours prefers-reduced-motion). */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <MotionConfig reducedMotion="user">
      <OrcaProvider>
        <AvatarPreviewProvider>
          <TopBar />
          <Loaded>{children}</Loaded>
        </AvatarPreviewProvider>
      </OrcaProvider>
    </MotionConfig>
  );
}
