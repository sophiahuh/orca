"use client";

import { useSyncExternalStore } from "react";

/**
 * Which onboarding tip is showing, for the few components that behave differently while they're
 * pointed at (the upload toast stays up). OnboardingTips sets it; nothing else does.
 */
let current: string | null = null;
const listeners = new Set<() => void>();

export function setActiveTip(id: string | null) {
  if (id === current) return;
  current = id;
  listeners.forEach((listener) => listener());
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export function useActiveTip(): string | null {
  return useSyncExternalStore(subscribe, () => current, () => null);
}
