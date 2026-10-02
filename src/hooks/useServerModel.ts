"use client";

import { useEffect, useState } from "react";

/** The model the server will use when a student has no key of their own (null = demo mode). */
export function useServerModel() {
  const [model, setModel] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    fetch("/api/llm/status")
      .then((r) => r.json())
      .then((d: { serverModel?: string | null }) => alive && setModel(d.serverModel ?? null))
      .catch(() => alive && setModel(null));
    return () => {
      alive = false;
    };
  }, []);
  return model;
}
