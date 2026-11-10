"use client";

import { useEffect, useMemo, useState } from "react";
import type { Course, Exam } from "@/lib/data";
import { planTopics, spentMinutesByDayInOrca, spentMinutesInOrca, touchedObjectives } from "@/lib/course/cram-page";
import { cramPlan, type CramPlan, type CramPlanInput, type SpentMinutes } from "@/lib/mastery/cram-plan";
import type { CourseMastery } from "@/lib/mastery/course-mastery";
import { useDayKey, useOrca } from "@/lib/store";
import { useNow } from "@/hooks/useNow";

/**
 * The exam's cram plan, computed in the browser from the store (cram mode contract, section 6):
 * null until the exam has a time budget (set at the page's setup). Spent minutes are the course's
 * finished sessions since the budget's `since`, split at today and by day: "in Orca", since the
 * connector's estimate lives on the server (`course_state`). The topics' covered state reads the
 * store's evidence since then.
 */
export function useCramPlan(course: Course | undefined, exam: Exam | null, mastery: CourseMastery | undefined): { plan: CramPlan; spentMinutes: SpentMinutes; topics: CramPlanInput["topics"] } | null {
  const { objectives, relations, results, evidence } = useOrca();
  const dayKey = useDayKey();
  const nowMs = useNow();
  const budget = exam?.scope?.budget;
  return useMemo(() => {
    if (!course || !mastery || !exam || !budget) return null;
    const today = dayKey(new Date(nowMs).toISOString());
    const spentMinutes = spentMinutesInOrca(results, course.id, budget.since, today, dayKey);
    const topics = planTopics(exam, course.topics, objectives[course.id] ?? {}, relations[course.id] ?? [], (id) => mastery.objectives.get(id)?.status ?? "unseen");
    const spentByDay = spentMinutesByDayInOrca(results, course.id, budget.since, dayKey);
    const touchedObjectiveIds = touchedObjectives(evidence, course.id, budget.since);
    return { plan: cramPlan({ today, examDate: exam.date, budget, topics, spentMinutes, spentByDay, touchedObjectiveIds }), spentMinutes, topics };
  }, [exam, budget, course, objectives, relations, results, evidence, mastery, dayKey, nowMs]);
}

/**
 * Whether the student's Claude is connected (a connector token exists), read once a cramming state
 * shows: null until known. Study with Claude links to Settings only when it isn't.
 */
export function useConnectorStatus(wanted: boolean): boolean | null {
  const [connected, setConnected] = useState<boolean | null>(null);
  useEffect(() => {
    if (!wanted) return;
    let live = true;
    fetch("/api/connector", { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Couldn't read the connector: ${res.status}`);
        const body = (await res.json()) as { connected: boolean };
        if (live) setConnected(body.connected);
      })
      .catch(() => {
        // Unknown stays null: the link to Settings is shown, which works either way.
        if (live) setConnected(null);
      });
    return () => {
      live = false;
    };
  }, [wanted]);
  return connected;
}
