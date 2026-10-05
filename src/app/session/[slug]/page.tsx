"use client";

import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { type Course, DEFAULT_CONFIG, DEFAULT_WEIGHTS, type QuizQuestion, trailTopics } from "@/lib/data";
import { liveObjectiveOf } from "@/lib/mastery/catalogue";
import { reasonsOf } from "@/lib/mastery/priority";
import {
  type AssembledSession,
  assembleDeepReview,
  assembleQuickReview,
  assembleRequiz,
  durationSeconds,
  lastSeenOf,
  sessionCandidates,
} from "@/lib/mastery/session";
import { localDayKey } from "@/lib/mastery/objective-state";
import { useAgenda, useCourse, useMasteryByCourse, useOrca } from "@/lib/store";
import { Screen } from "@/components/layout/Screen";
import { BackButton } from "@/components/layout/BackButton";
import { Button } from "@/components/ui/Button";
import { QuizRunner, type RunnerItem } from "@/components/quiz/QuizRunner";

const KINDS = ["quick", "deep", "requiz"] as const;
type Kind = (typeof KINDS)[number];

export default function SessionPage({ params, searchParams }: PageProps<"/session/[slug]">) {
  const { slug } = use(params);
  const sp = use(searchParams);
  const { hydrated } = useOrca();
  const course = useCourse(slug);
  const kind = KINDS.find((k) => k === sp.kind);

  if (!hydrated) return <Screen bg="parchment" />;
  if (!course || !kind) {
    return (
      <Screen bg="parchment" className="items-start gap-4 p-[32px]">
        <BackButton />
        <p className="text-[22px] font-bold text-prussian">{course ? "That isn't a kind of session Orca runs." : "We couldn't find that island."}</p>
      </Screen>
    );
  }
  return <SessionBody key={`${course.id}:${kind}`} course={course} kind={kind} />;
}

/** Mounted once the store is loaded, so the session is assembled exactly once, at start. */
function SessionBody({ course, kind }: { course: Course; kind: Kind }) {
  const router = useRouter();
  const { questionBank, objectives, configs, weights, materials } = useOrca();
  const agenda = useAgenda()[course.id];
  const mastery = useMasteryByCourse()[course.id];
  if (!agenda || !mastery) throw new Error(`No agenda computed for course ${course.id}`);
  const backHref = `/course/${course.slug}`;

  const [session] = useState(() => {
    const catalogue = objectives[course.id] ?? {};
    const byId = new Map<string, QuizQuestion>();
    const byObjective = new Map<string, QuizQuestion[]>();
    for (const t of trailTopics(course)) {
      for (const q of questionBank[course.id]?.[t.id] ?? []) {
        const o = liveObjectiveOf(q, t.id, catalogue);
        if (!o) continue;
        byId.set(q.id, q);
        byObjective.set(o.id, [...(byObjective.get(o.id) ?? []), q]);
      }
    }
    const config = configs[course.id] ?? DEFAULT_CONFIG;
    const ctx = { lastSeen: lastSeenOf(mastery.events), now: new Date(), dayKey: localDayKey };
    let assembled: AssembledSession;
    if (kind === "quick") {
      assembled = assembleQuickReview(sessionCandidates(agenda.dueToday, mastery.objectives, byObjective), { ...ctx, budgetSeconds: durationSeconds(config.quick.duration) });
    } else if (kind === "requiz") {
      const ids = agenda.study.filter((s) => s.requiz === "today").map((s) => s.objectiveId);
      assembled = assembleRequiz(sessionCandidates(agenda.ranked, mastery.objectives, byObjective), ids, { ...ctx, budgetSeconds: durationSeconds(config.quick.duration) });
    } else {
      assembled = assembleDeepReview(sessionCandidates(agenda.ranked, mastery.objectives, byObjective), {
        ...ctx,
        budgetSeconds: durationSeconds(config.deep.duration),
        sliders: weights[course.id] ?? DEFAULT_WEIGHTS,
        materialTypeOf: (id) => materials.find((m) => m.id === id)?.type ?? null,
      });
    }
    const reasons = new Map(agenda.ranked.map((r) => [r.objectiveId, reasonsOf(r.priority)[0]]));
    const items: RunnerItem[] = assembled.items.map((i) => {
      const question = byId.get(i.questionId);
      if (!question) throw new Error(`Session picked question ${i.questionId}, which isn't in the course`);
      const why = reasons.get(i.objectiveId);
      const notes = [...(why ? [why] : []), ...(i.seenBefore ? ["Seen before: no new questions left for this one yet"] : [])];
      return { question, topicId: i.topicId, notes };
    });
    return { items };
  });

  if (session.items.length === 0) {
    const tomorrow = kind === "requiz" && agenda.study.some((s) => s.requiz === "tomorrow");
    const message =
      kind === "quick"
        ? `Nothing to review in ${course.name} right now.`
        : kind === "deep"
          ? "Nothing to deep review yet: answer some questions first."
          : tomorrow
            ? "Your re-quiz opens tomorrow. Same-day retries only measure short-term memory."
            : "No re-quiz due.";
    return (
      <Screen bg="parchment" className="items-start gap-4 p-[32px]">
        <BackButton href={backHref} />
        <p className="text-[22px] font-bold text-prussian">{message}</p>
        <Button size="sm" onClick={() => router.push(backHref)}>
          Back to {course.short}
        </Button>
      </Screen>
    );
  }

  return <QuizRunner course={course} items={session.items} mode={kind} title={course.name} backHref={backHref} />;
}
