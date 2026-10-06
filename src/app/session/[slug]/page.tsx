"use client";

import { use, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { type Course, DEFAULT_CONFIG, type QuizQuestion, trailTopics } from "@/lib/data";
import { DEEP_MAX_MINUTES } from "@/lib/deep-review";
import { liveObjectiveOf } from "@/lib/mastery/catalogue";
import { reasonsOf } from "@/lib/mastery/priority";
import {
  type AssembledSession,
  assembleQuickReview,
  assembleRequiz,
  durationSeconds,
  lastSeenOf,
  sessionCandidates,
} from "@/lib/mastery/session";
import { useAgenda, useCourse, useDayKey, useMasteryByCourse, useOrca } from "@/lib/store";
import { Screen } from "@/components/layout/Screen";
import { BackButton } from "@/components/layout/BackButton";
import { Button } from "@/components/ui/Button";
import { QuizRunner, type RunnerItem } from "@/components/quiz/QuizRunner";
import { DeepReviewSetup } from "@/components/quiz/DeepReviewSetup";

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

/** Mounted once the store is loaded. A deep review asks for its length first and can be run again from its end card. */
function SessionBody({ course, kind }: { course: Course; kind: Kind }) {
  const [round, setRound] = useState(0);
  if (kind === "deep") return <DeepReview key={round} course={course} onAgain={() => setRound((r) => r + 1)} />;
  return <ScheduledSession course={course} kind={kind} />;
}

/** What every session draws on, read from the store once at mount so the session doesn't change under the student. */
function useSessionSources(course: Course) {
  const { questionBank, objectives } = useOrca();
  const dayKey = useDayKey();
  const agenda = useAgenda()[course.id];
  const mastery = useMasteryByCourse()[course.id];
  if (!agenda || !mastery) throw new Error(`No agenda computed for course ${course.id}`);
  const [sources] = useState(() => {
    const catalogue = objectives[course.id] ?? {};
    const byId = new Map<string, QuizQuestion>();
    const byObjective = new Map<string, QuizQuestion[]>();
    for (const t of trailTopics(course)) {
      for (const q of questionBank[course.id]?.[t.id] ?? []) {
        const o = liveObjectiveOf(q, t.id, catalogue);
        // Deep-review questions are written for, and asked in, deep reviews only.
        if (!o || q.deep) continue;
        byId.set(q.id, q);
        byObjective.set(o.id, [...(byObjective.get(o.id) ?? []), q]);
      }
    }
    const ctx = { lastSeen: lastSeenOf(mastery.events), now: new Date(), dayKey };
    const reasons = new Map(agenda.ranked.map((r) => [r.objectiveId, reasonsOf(r.priority)[0]]));
    const toItems = (assembled: AssembledSession): RunnerItem[] =>
      assembled.items.map((i) => {
        const question = byId.get(i.questionId);
        if (!question) throw new Error(`Session picked question ${i.questionId}, which isn't in the course`);
        const why = reasons.get(i.objectiveId);
        const notes = [...(why ? [why] : []), ...(i.seenBefore ? ["Seen before: no new questions left for this one yet"] : [])];
        return { question, topicId: i.topicId, notes };
      });
    return { agenda, ctx, toItems, candidates: (ranked: typeof agenda.ranked) => sessionCandidates(ranked, mastery.objectives, byObjective) };
  });
  return sources;
}

function ScheduledSession({ course, kind }: { course: Course; kind: "quick" | "requiz" }) {
  const router = useRouter();
  const { configs } = useOrca();
  const { agenda, ctx, toItems, candidates } = useSessionSources(course);
  const backHref = `/course/${course.slug}`;

  const [items] = useState(() => {
    const budgetSeconds = durationSeconds((configs[course.id] ?? DEFAULT_CONFIG).quick.duration);
    if (kind === "quick") return toItems(assembleQuickReview(candidates(agenda.dueToday), { ...ctx, budgetSeconds }));
    const ids = agenda.study.filter((s) => s.requiz === "today").map((s) => s.objectiveId);
    return toItems(assembleRequiz(candidates(agenda.ranked), ids, { ...ctx, budgetSeconds }));
  });

  if (items.length === 0) {
    const tomorrow = kind === "requiz" && agenda.study.some((s) => s.requiz === "tomorrow");
    const message =
      kind === "quick"
        ? `Nothing to review in ${course.name} right now.`
        : tomorrow
          ? "Your re-quiz opens tomorrow. Same-day retries only measure short-term memory."
          : "No re-quiz due.";
    return <NothingToDo course={course} message={message} onBack={() => router.push(backHref)} />;
  }
  return <QuizRunner course={course} items={items} mode={kind} title={course.name} backHref={backHref} />;
}

function DeepReview({ course, onAgain }: { course: Course; onAgain: () => void }) {
  const router = useRouter();
  const { configs, questionBank, refresh } = useOrca();
  const agenda = useAgenda()[course.id];
  if (!agenda) throw new Error(`No agenda computed for course ${course.id}`);
  const backHref = `/course/${course.slug}`;
  // The course's deep-review length is the starting suggestion; the student picks the length here.
  const [minutes, setMinutes] = useState(() => Math.min(DEEP_MAX_MINUTES, durationSeconds((configs[course.id] ?? DEFAULT_CONFIG).deep.duration) / 60));
  const [phase, setPhase] = useState<{ kind: "setup" | "writing" } | { kind: "error"; message: string } | { kind: "ready"; picked: Array<{ id: string; topicId: string }> }>({ kind: "setup" });
  // What it covers: objectives the student has answered (not retired), most urgent first.
  const [objectiveIds] = useState(() => agenda.ranked.filter((r) => r.status !== "unseen" && r.status !== "retired").map((r) => r.objectiveId));

  const items = useMemo((): RunnerItem[] | null => {
    if (phase.kind !== "ready") return null;
    return phase.picked.map((p) => {
      const question = questionBank[course.id]?.[p.topicId]?.find((q) => q.id === p.id);
      if (!question) throw new Error(`Deep review question ${p.id} isn't in the course`);
      return { question, topicId: p.topicId, notes: [] };
    });
  }, [phase, questionBank, course.id]);

  const start = async () => {
    setPhase({ kind: "writing" });
    try {
      // Written now, on the server, from the material each objective is taught in (POST /api/deep-review).
      const res = await fetch("/api/deep-review", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ courseId: course.id, minutes, objectiveIds }) });
      const out = (await res.json().catch(() => null)) as { questions?: Array<{ id: string; topicId: string }>; error?: string } | null;
      if (!res.ok || !out?.questions) throw new Error(out?.error ?? "Orca couldn't write the deep review. Try again in a moment.");
      await refresh();
      setPhase({ kind: "ready", picked: out.questions });
    } catch (error) {
      setPhase({ kind: "error", message: error instanceof Error ? error.message : "Orca couldn't write the deep review." });
    }
  };

  if (objectiveIds.length === 0) {
    return <NothingToDo course={course} message="Nothing to deep review yet: answer some questions first." onBack={() => router.push(backHref)} />;
  }
  if (items) {
    return <QuizRunner course={course} items={items} mode="deep" title={course.name} backHref={backHref} again={{ label: "Start another deep review", onStart: onAgain }} />;
  }
  return <DeepReviewSetup courseName={course.name} backHref={backHref} minutes={minutes} onMinutes={setMinutes} onStart={start} writing={phase.kind === "writing"} error={phase.kind === "error" ? phase.message : null} />;
}

function NothingToDo({ course, message, onBack }: { course: Course; message: string; onBack: () => void }) {
  return (
    <Screen bg="parchment" className="items-start gap-4 p-[32px]">
      <BackButton href={`/course/${course.slug}`} />
      <p className="text-[22px] font-bold text-prussian">{message}</p>
      <Button size="sm" onClick={onBack}>
        Back to {course.short}
      </Button>
    </Screen>
  );
}
