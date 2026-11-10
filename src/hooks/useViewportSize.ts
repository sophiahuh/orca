"use client";

import { useSyncExternalStore } from "react";
import type { Size } from "@/lib/anchor-geometry";

const subscribe = (onChange: () => void) => {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
};
// One object per size, so React sees no change until the window really resizes.
let last: Size = { width: 0, height: 0 };
const read = (): Size => {
  if (last.width !== window.innerWidth || last.height !== window.innerHeight) last = { width: window.innerWidth, height: window.innerHeight };
  return last;
};
const none: Size = { width: 0, height: 0 };

/** The window's inner size, updated as it resizes (0 × 0 on the server). */
export function useViewportSize(): Size {
  return useSyncExternalStore(subscribe, read, () => none);
}
