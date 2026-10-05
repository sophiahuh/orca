"use client";

import { useSyncExternalStore } from "react";

const subscribe = (cb: () => void) => {
  const id = window.setInterval(cb, 60_000);
  return () => window.clearInterval(id);
};

/** Current time in ms, floored to the minute so the snapshot is stable; 0 during server render. */
const minute = () => Math.floor(Date.now() / 60_000) * 60_000;

export function useNow() {
  return useSyncExternalStore(subscribe, minute, () => 0);
}
