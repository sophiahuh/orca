/** What in a course still needs the student's review. */
import type { Objective, PipelineRun, Topic } from "../data.ts";

export interface PendingReview {
  /** New topics the student hasn't confirmed or rejected. */
  topics: Topic[];
  /** Topics reconciliation couldn't tell apart from an existing one. */
  uncertainTopics: Topic[];
  /** Objectives reconciliation couldn't tell apart from an existing one. */
  uncertainObjectives: Objective[];
  count: number;
}

export function pendingReview(topics: readonly Topic[], objectives: Readonly<Record<string, Objective>>): PendingReview {
  const live = topics.filter((t) => t.review !== "archived");
  const proposed = live.filter((t) => t.review === "proposed");
  const uncertainTopics = live.filter((t) => t.uncertain);
  const liveTopicIds = new Set(live.map((t) => t.id));
  const uncertainObjectives = Object.values(objectives).filter((o) => o.uncertain && o.review !== "archived" && liveTopicIds.has(o.topicId));
  return { topics: proposed, uncertainTopics, uncertainObjectives, count: proposed.length + uncertainTopics.length + uncertainObjectives.length };
}

/** A course's uploads (their pipeline runs; top-ups and dives aren't uploads), newest first. */
export function courseUploads(runs: readonly PipelineRun[], courseId: string): PipelineRun[] {
  return runs.filter((r) => r.courseId === courseId && (r.kind ?? "upload") === "upload").sort((a, b) => b.at.localeCompare(a.at));
}

/** Uploads still being built (queued, running or waiting on a limit). */
export function uploadsInProgress(runs: readonly PipelineRun[], courseId: string): number {
  return courseUploads(runs, courseId).filter((r) => r.status !== "done" && r.status !== "failed").length;
}
