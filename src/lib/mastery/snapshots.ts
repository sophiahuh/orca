/**
 * Stored snapshots of the fold (Phase 4, plan decision 3). A snapshot is one objective's
 * ObjectiveAccumulator after every event that counts for it (attribution.ts), cached so reads don't
 * replay the log. It is never the record: the log is, and every path here either extends a fresh
 * snapshot by exactly the new event or rebuilds it from the log.
 *
 * Pure: the database sits behind SnapshotStore (src/lib/server/snapshot-store.ts implements it
 * with Supabase; the tests with an in-memory double).
 */
import { type Attribution, eventsCountingFor } from "./attribution.ts";
import { type ObjectiveAccumulator, type ObjectiveStateOptions, RULES_VERSION, applyEvidence, replayObjective } from "./objective-state.ts";
import type { EvidenceEvent } from "./types.ts";

export interface Snapshot {
  objectiveId: string;
  /** Null only on a placeholder a structure change created (always stale). */
  accumulator: ObjectiveAccumulator | null;
  rulesVersion: number | null;
  stale: boolean;
  /** Optimistic-concurrency counter: a write names the version it read. */
  version: number;
}

/** One course as the fold sees it: which events count for which objective, and the student's day key. */
export interface CourseView {
  attribution: Attribution;
  dayKey: (iso: string) => string;
}

/** The snapshot rows of one student's course. Every method is scoped to that student and course. */
export interface SnapshotStore {
  /** The course's current structure and the student's timezone, read fresh. */
  view(): Promise<CourseView>;
  snapshot(objectiveId: string): Promise<Snapshot | null>;
  snapshots(): Promise<Snapshot[]>;
  /** The course's whole evidence log. */
  log(): Promise<EvidenceEvent[]>;
  /**
   * Append the event and, with `write`, replace that objective's snapshot, in one transaction and
   * only if the snapshot is still at `expectedVersion` (0: none yet). False when it moved on, in
   * which case nothing was written.
   */
  record(event: EvidenceEvent, write: { objectiveId: string; accumulator: ObjectiveAccumulator; expectedVersion: number } | null): Promise<boolean>;
  /** Save a rebuilt snapshot if it is still at `expectedVersion`. */
  save(objectiveId: string, accumulator: ObjectiveAccumulator, expectedVersion: number): Promise<boolean>;
}

/** Two writers kept changing the snapshot under this one; the event was not recorded. */
export class VersionConflictError extends Error {
  constructor(objectiveId: string) {
    super(`Objective ${objectiveId} kept changing while this answer was saved; it was not recorded`);
    this.name = "VersionConflictError";
  }
}

/** A snapshot that can be extended as it is: fresh, folded under the current rules. */
export function isUsable(s: Snapshot): s is Snapshot & { accumulator: ObjectiveAccumulator } {
  return !s.stale && s.accumulator !== null && s.rulesVersion === RULES_VERSION;
}

function optionsFor(objectiveId: string, view: CourseView): ObjectiveStateOptions {
  const o = view.attribution.objectives.get(objectiveId);
  if (!o) throw new Error(`Objective ${objectiveId} holds no state in this course`);
  return { hasMechanismQuestions: o.hasMechanismQuestions, dayKey: view.dayKey };
}

/** Fold every event that counts for the objective, from nothing. */
export function rebuild(objectiveId: string, events: readonly EvidenceEvent[], view: CourseView): ObjectiveAccumulator {
  return replayObjective(objectiveId, eventsCountingFor(objectiveId, events, view.attribution), optionsFor(objectiveId, view));
}

export interface Recorded {
  /** The objective the event counts for now; null when it counts for nothing (still recorded). */
  objectiveId: string | null;
  accumulator: ObjectiveAccumulator | null;
  /** The snapshot's version after the write. */
  version: number | null;
  /** Folded from the log rather than by extending the stored snapshot. */
  rebuilt: boolean;
  /** The first write lost to another writer and was retried from the log. */
  retried: boolean;
}

/**
 * Record one event (its `at` already stamped by the server) and keep its objective's snapshot in
 * step. A fresh snapshot is extended by the event; a missing, stale or old-rules one, or one
 * already past the event's time, is rebuilt from the log. If another writer moves the snapshot
 * between the read and the write, everything is read again and rebuilt from the log, once.
 */
export async function recordEvent(store: SnapshotStore, event: EvidenceEvent): Promise<Recorded> {
  let target = "";
  for (const attempt of [1, 2]) {
    const countsFor = (await store.view()).attribution.countsFor(event);
    if (countsFor === null) {
      if (!(await store.record(event, null))) throw new Error(`Event ${event.id} was not recorded`);
      return { objectiveId: null, accumulator: null, version: null, rebuilt: false, retried: attempt > 1 };
    }
    target = countsFor;
    const snap = await store.snapshot(target);
    // Read the structure again after the snapshot: a change before this read is in `view`, and a
    // change after it marks the snapshot stale, moving its version, so the write below loses.
    const view = await store.view();
    if (view.attribution.countsFor(event) !== target) continue;
    const extendable =
      attempt === 1 && snap !== null && isUsable(snap) && (snap.accumulator.lastAt === null || Date.parse(event.at) >= Date.parse(snap.accumulator.lastAt));
    const accumulator = extendable
      ? applyEvidence(snap.accumulator, { ...event, objectiveId: target }, optionsFor(target, view))
      : rebuild(target, [...(await store.log()), event], view);
    const expectedVersion = snap?.version ?? 0;
    if (await store.record(event, { objectiveId: target, accumulator, expectedVersion })) {
      return { objectiveId: target, accumulator, version: expectedVersion + 1, rebuilt: !extendable, retried: attempt > 1 };
    }
  }
  throw new VersionConflictError(target);
}

export interface ObjectiveSnapshot {
  objectiveId: string;
  accumulator: ObjectiveAccumulator;
  version: number;
  /** False when a rebuild lost a race and wasn't stored (the value is still right for the log it read). */
  saved: boolean;
}

/**
 * Every snapshot of a course that holds state now. Fresh ones are returned as stored; stale,
 * old-rules and placeholder ones are rebuilt from the log (read once, only if needed) and saved.
 * Objectives with no snapshot have no events counting for them: they are unseen.
 */
export async function readCourseState(store: SnapshotStore): Promise<{ objectives: ObjectiveSnapshot[]; rebuilt: string[] }> {
  // Rows first: a structure change before the view is read is in it, and one after marks the
  // snapshots it touches, moving their versions, so saving a rebuild from the old view fails.
  const rows = await store.snapshots();
  const view = await store.view();
  let log: EvidenceEvent[] | null = null;
  const objectives: ObjectiveSnapshot[] = [];
  const rebuilt: string[] = [];
  for (const row of rows) {
    if (!view.attribution.objectives.has(row.objectiveId)) continue;
    if (isUsable(row)) {
      objectives.push({ objectiveId: row.objectiveId, accumulator: row.accumulator, version: row.version, saved: true });
      continue;
    }
    log ??= await store.log();
    const accumulator = rebuild(row.objectiveId, log, view);
    const saved = await store.save(row.objectiveId, accumulator, row.version);
    rebuilt.push(row.objectiveId);
    objectives.push({ objectiveId: row.objectiveId, accumulator, version: saved ? row.version + 1 : row.version, saved });
  }
  return { objectives, rebuilt };
}
