"use client";

import { Suspense } from "react";
import { MotionConfig } from "motion/react";
import { usePathname } from "next/navigation";
import { AvatarPreviewProvider } from "@/components/brand/avatar-preview";
import { LoadingScreen } from "@/components/layout/LoadingScreen";
import { TopBar } from "@/components/layout/TopBar";
import { LoadFailed, SaveStatus } from "@/components/store/SaveStatus";
import { isPublicPath } from "@/lib/auth/paths";
import { OrcaProvider, useOrca } from "@/lib/store";
import { useNavHistory } from "@/lib/nav-history";

/** Records the pages visited, for the back buttons (search params need a Suspense boundary). */
function NavHistory() {
  useNavHistory();
  return null;
}

/**
 * The app once the student's data is in, or why it couldn't be loaded. While their courses load
 * (sign-in, or opening the app) every signed-in screen shows the loading screen instead of a
 * half-empty page; the account screens (sign-in and the rest) never wait on it.
 */
function Loaded({ children }: { children: React.ReactNode }) {
  const { status } = useOrca();
  const pathname = usePathname();
  if (status === "failed") return <LoadFailed />;
  if (status === "loading" && !isPublicPath(pathname)) return <LoadingScreen title="Loading your courses…" message="Gathering your islands, topics and what's due." />;
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
          <Suspense fallback={null}>
            <NavHistory />
          </Suspense>
          <TopBar />
          <Loaded>{children}</Loaded>
        </AvatarPreviewProvider>
      </OrcaProvider>
    </MotionConfig>
  );
}
