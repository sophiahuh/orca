/**
 * Review operations on one course's structure. Pure: each takes the structure and returns a new
 * one. Nothing is deleted: rejecting archives, merging points the loser at the survivor, and
 * both can be undone (except a topic merge). Questions follow their objectives (`refiled`).
 */
import type { Objective, QuizQuestion, Topic } from "../data.ts";
import { currentTopicOf, fileQuestions } from "../mastery/catalogue.ts";
import { unionPlaces } from "./places.ts";

export interface CourseStructure {
  topics: Topic[];
  objectives: Record<string, Objective>;
  /** topicId → questions. */
  bank: Record<string, QuizQuestion[]>;
}

function topicOf(s: CourseStructure, id: string): Topic {
  const t = s.topics.find((x) => x.id === id);
  if (!t) throw new Error(`No topic ${id}`);
  return t;
}

function objectiveOf(s: CourseStructure, id: string): Objective {
  const o = s.objectives[id];
  if (!o) throw new Error(`No objective ${id}`);
  return o;
}

function withTopic(s: CourseStructure, id: string, patch: (t: Topic) => Topic): CourseStructure {
  topicOf(s, id);
  return { ...s, topics: s.topics.map((t) => (t.id === id ? patch(t) : t)) };
}

function withObjectives(s: CourseStructure, ids: string[], patch: (o: Objective) => Objective): CourseStructure {
  const objectives = { ...s.objectives };
  for (const id of ids) objectives[id] = patch(objectiveOf(s, id));
  return { ...s, objectives };
}

/** A copy of `o` without `keys`. */
function without<T extends object, K extends keyof T>(o: T, ...keys: K[]): Omit<T, K> {
  const copy = { ...o };
  for (const k of keys) delete copy[k];
  return copy;
}

/** Objectives that live in a topic (by their own topicId, merged or not). */
function objectiveIdsIn(s: CourseStructure, topicId: string) {
  return Object.values(s.objectives).filter((o) => o.topicId === topicId).map((o) => o.id);
}

/** `id` and every objective whose merge chain ends at it. */
function mergedFamily(s: CourseStructure, id: string): Set<string> {
  const family = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const o of Object.values(s.objectives)) {
      if (o.mergedInto && family.has(o.mergedInto) && !family.has(o.id)) {
        family.add(o.id);
        grew = true;
      }
    }
  }
  return family;
}

/**
 * File every question under its objective's current topic (`fileQuestions`), including ones the
 * browser holds under a stale topic. Questions already in place keep their positions and moved
 * ones follow them, so a save sends only the moved rows; a topic left empty keeps an empty list.
 */
function refiled(s: CourseStructure): CourseStructure {
  const topicMergedInto = new Map(s.topics.flatMap((t) => (t.mergedInto ? [[t.id, t.mergedInto] as const] : [])));
  const held = Object.entries(s.bank).flatMap(([topicId, questions]) => questions.map((question) => ({ topicId, question })));
  const staysPut = (x: { topicId: string; question: QuizQuestion }) => currentTopicOf(x.question.objectiveId, s.objectives, topicMergedInto) === x.topicId;
  const filed = fileQuestions([...held.filter(staysPut), ...held.filter((x) => !staysPut(x))].map((x) => x.question), s.objectives, topicMergedInto);
  return { ...s, bank: { ...Object.fromEntries(Object.keys(s.bank).map((t) => [t, []])), ...filed } };
}

/** Confirm a topic. Its proposed objectives are confirmed too, except ones reconciliation was unsure about. */
export function confirmTopic(s: CourseStructure, topicId: string): CourseStructure {
  const next = withTopic(s, topicId, (t) => ({ ...t, review: "confirmed" }));
  const ids = objectiveIdsIn(next, topicId).filter((id) => next.objectives[id].review === "proposed" && !next.objectives[id].uncertain);
  return withObjectives(next, ids, (o) => ({ ...o, review: "confirmed" }));
}

/** Reject a topic: it and its live objectives are archived. Restoring the topic brings those back. */
export function rejectTopic(s: CourseStructure, topicId: string): CourseStructure {
  const next = withTopic(s, topicId, (t) => ({ ...t, review: "archived" }));
  const ids = objectiveIdsIn(next, topicId).filter((id) => next.objectives[id].review !== "archived");
  return withObjectives(next, ids, (o) => ({ ...o, review: "archived", archivedWithTopic: true }));
}

/** Undo a topic rejection. Objectives rejected on their own stay rejected. */
export function restoreTopic(s: CourseStructure, topicId: string): CourseStructure {
  if (topicOf(s, topicId).mergedInto) throw new Error(`Topic ${topicId} was merged; a topic merge can't be undone`);
  // A topic archived because its material was removed comes back the same way, with the objectives that went with it.
  const next = withTopic(s, topicId, (t) => ({ ...without(t, "archivedWithMaterial"), review: "proposed" }));
  const ids = objectiveIdsIn(next, topicId).filter((id) => next.objectives[id].archivedWithTopic || next.objectives[id].archivedWithMaterial);
  return withObjectives(next, ids, (o) => ({ ...without(o, "archivedWithTopic", "archivedWithMaterial"), review: "proposed" }));
}

/** Rename a topic. */
export function renameTopic(s: CourseStructure, topicId: string, name: string): CourseStructure {
  const clean = name.trim();
  if (!clean) throw new Error("A topic needs a name");
  return withTopic(s, topicId, (t) => ({ ...t, name: clean }));
}

/**
 * Merge one topic into another: the survivor takes the loser's objectives and questions;
 * the loser is archived with `mergedInto` set.
 */
export function mergeTopics(s: CourseStructure, loserId: string, survivorId: string): CourseStructure {
  if (loserId === survivorId) throw new Error("Can't merge a topic into itself");
  const loser = topicOf(s, loserId);
  const survivor = topicOf(s, survivorId);
  if (survivor.review === "archived") throw new Error(`Topic ${survivorId} is archived`);
  // The survivor is taught everywhere either was.
  let next = withTopic(s, survivorId, (t) => ({ ...t, source: unionPlaces(t.source ?? [], loser.source ?? []) }));
  next = withTopic(next, loserId, (t) => ({ ...t, review: "archived", mergedInto: survivorId }));
  next = withObjectives(next, objectiveIdsIn(next, loserId), (o) => ({ ...o, topicId: survivorId }));
  return refiled(next);
}

export function confirmObjective(s: CourseStructure, id: string): CourseStructure {
  return withObjectives(s, [id], (o) => ({ ...without(o, "uncertain", "archivedWithMaterial"), review: "confirmed" }));
}

/** Reject an objective: archived, kept so later uploads don't propose it again. */
export function rejectObjective(s: CourseStructure, id: string): CourseStructure {
  return withObjectives(s, [id], (o) => ({ ...without(o, "archivedWithTopic", "archivedWithMaterial"), review: "archived" }));
}

/** Undo a rejection or a merge. The student chose to keep it, so it comes back confirmed. */
export function restoreObjective(s: CourseStructure, id: string): CourseStructure {
  const o = objectiveOf(s, id);
  if (topicOf(s, o.topicId).review === "archived") throw new Error(`Restore topic ${o.topicId} first`);
  return refiled(withObjectives(s, [id], (x) => ({ ...without(x, "mergedInto", "archivedWithTopic", "archivedWithMaterial", "uncertain"), review: "confirmed" })));
}

/**
 * Merge one objective into another. The loser points at the survivor, so its questions and past
 * answers count for the survivor. Across topics, the loser's questions move to the survivor's
 * topic (and move back if the merge is undone).
 */
export function mergeObjectives(s: CourseStructure, loserId: string, survivorId: string): CourseStructure {
  if (loserId === survivorId) throw new Error("Can't merge an objective into itself");
  objectiveOf(s, loserId);
  const survivor = objectiveOf(s, survivorId);
  if (survivor.review === "archived") throw new Error(`Objective ${survivorId} is archived`);
  if (mergedFamily(s, loserId).has(survivorId)) throw new Error("That merge would make a cycle");
  return refiled(withObjectives(s, [loserId], (o) => ({ ...without(o, "uncertain"), review: "archived", mergedInto: survivorId })));
}

/** Answer reconciliation's "uncertain": the same as its candidate (merge) or a separate objective. */
export function resolveUncertain(s: CourseStructure, id: string, verdict: "same" | "separate"): CourseStructure {
  const o = objectiveOf(s, id);
  if (!o.uncertain) throw new Error(`Objective ${id} has no open duplicate question`);
  if (verdict === "same") return mergeObjectives(s, id, o.uncertain.candidateId);
  const confirmed = topicOf(s, o.topicId).review === "confirmed";
  return withObjectives(s, [id], (x) => ({ ...without(x, "uncertain"), review: confirmed ? "confirmed" : x.review }));
}

/** Answer reconciliation's "uncertain" for a topic: the same as its candidate (merge into it) or a separate topic. */
export function resolveUncertainTopic(s: CourseStructure, id: string, verdict: "same" | "separate"): CourseStructure {
  const t = topicOf(s, id);
  if (!t.uncertain) throw new Error(`Topic ${id} has no open duplicate question`);
  if (verdict === "same") return mergeTopics(withTopic(s, id, (x) => without(x, "uncertain")), id, t.uncertain.candidateId);
  return withTopic(s, id, (x) => without(x, "uncertain"));
}
