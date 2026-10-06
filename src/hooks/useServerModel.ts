"use client";

import { useEffect, useState } from "react";

export interface ServerModelStatus {
  /** The model Orca's server uses; null = no key: nothing is generated. */
  serverModel: string | null;
  /** How this student's prose answers are graded right now: by the model, or self-marked (no key, or grading turned off for them). */
  grading: "model" | "self";
}

/** What the server says about its model, from /api/llm/status; undefined while loading. */
export function useServerStatus(): ServerModelStatus | undefined {
  const [status, setStatus] = useState<ServerModelStatus | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    fetch("/api/llm/status")
      .then((r) => r.json())
      .then((d: { serverModel?: string | null; grading?: "model" | "self" }) => alive && setStatus({ serverModel: d.serverModel ?? null, grading: d.grading ?? (d.serverModel ? "model" : "self") }))
      .catch(() => alive && setStatus({ serverModel: null, grading: "self" }));
    return () => {
      alive = false;
    };
  }, []);
  return status;
}

/** The model the server will use (null = no server key: nothing is generated); undefined while loading. */
export function useServerModel() {
  const status = useServerStatus();
  return status === undefined ? undefined : status.serverModel;
}
