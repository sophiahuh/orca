"use client";

import { useEffect } from "react";

/** How often a tab says it's still open (the server allows a few per window; `LIMITS.rate.heartbeat`). */
const EVERY_MS = 5 * 60_000;

/**
 * Tells the server the student is here (POST /api/heartbeat) once when the app has loaded and then
 * every five minutes while the tab is visible. Fire and forget: no state, no retry, nothing waits
 * on it. Mounted once the store is ready (src/app/providers.tsx).
 */
export function Heartbeat() {
  useEffect(() => {
    let last = 0;
    const beat = () => {
      if (document.visibilityState === "hidden" || Date.now() - last < EVERY_MS) return;
      last = Date.now();
      fetch("/api/heartbeat", { method: "POST", keepalive: true }).catch(() => {});
    };
    beat();
    const timer = setInterval(beat, EVERY_MS);
    document.addEventListener("visibilitychange", beat);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", beat);
    };
  }, []);
  return null;
}
