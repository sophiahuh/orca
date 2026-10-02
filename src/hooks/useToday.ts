"use client";

import { useSyncExternalStore } from "react";
import { toISODate } from "@/lib/data";

const subscribe = (cb: () => void) => {
  // Re-read once a minute so the "today" ring rolls over at midnight.
  const id = window.setInterval(cb, 60_000);
  return () => window.clearInterval(id);
};

/** Today's ISO date on the client; "" during server render so markup stays stable. */
export function useToday() {
  return useSyncExternalStore(subscribe, () => toISODate(new Date()), () => "");
}
