/** Consecutive local days, ending today, with at least one unaided graded answer. */
import { localDayKey } from "./objective-state.ts";
import type { EvidenceEvent } from "./types.ts";

const DAY_MS = 86_400_000;

export function streakDays(evidence: readonly EvidenceEvent[], now: Date, dayKey: (iso: string) => string = localDayKey): number {
  const days = new Set(evidence.filter((e) => e.grader !== "self").map((e) => dayKey(e.at)));
  // Step back a day at a time from noon today, so daylight-saving shifts never skip a date.
  const noon = new Date(now);
  noon.setHours(12, 0, 0, 0);
  let cursor = noon.getTime();
  if (!days.has(dayKey(new Date(cursor).toISOString()))) cursor -= DAY_MS;
  let count = 0;
  while (days.has(dayKey(new Date(cursor).toISOString()))) {
    count += 1;
    cursor -= DAY_MS;
  }
  return count;
}
