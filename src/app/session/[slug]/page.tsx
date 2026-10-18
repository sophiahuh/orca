"use client";

import { use, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { type Course, DEFAULT_CONFIG, type QuizQuestion, trailTopics } from "@/lib/data";
import { DEEP_MAX_MINUTES } from "@/lib/deep-review";
import { liveObjectiveOf } from "@/lib/mastery/catalogue";
import { reasonsOf } from "@/lib/mastery/priority";
import {
  type AssembledSession,
  assembleQuickReview,
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
import { PreparingDive } from "@/components/quiz/PreparingDive";
import { isFinished, useRun } from "@/hooks/useRun";
import { goBack } from "@/lib/nav-history";

const KINDS = ["quick", "deep"] as const;
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
  // A topic's dive ("Dive into [topic]" on the path or the Atlas): that topic only, at the length picked there.
  const topicId = typeof sp.topic === "string" && trailTopics(course).some((t) => t.id === sp.topic) ? sp.topic : undefined;
  const picked = Number(sp.minutes);
  const minutes = Number.isInteger(picked) && picked >= 1 && picked <= DEEP_MAX_MINUTES ? picked : undefined;
  return <SessionBody key={`${course.id}:${kind}:${topicId ?? ""}`} course={course} kind={kind} topicId={topicId} minutes={minutes} />;
}

/** Mounted once the store is loaded. A deep review asks for its length first and can be run again from its end card. */
function SessionBody({ course, kind, topicId, minutes }: { course: Course; kind: Kind; topicId?: string; minutes?: number }) {
  const [round, setRound] = useState(0);
  if (kind === "deep") return <DeepReview key={round} course={course} topicId={topicId} startMinutes={minutes} onAgain={() => setRound((r) => r + 1)} />;
  return <QuickReview course={course} />;
}

/** What every session draws on, read from the store once at mount so the session doesn't change under the student. */
function useSessionSources(course: Course) {
  const { questionBank, objectives, feedback } = useOrca();
  const dayKey = useDayKey();
  const agenda = useAgenda()[course.id];
  const mastery = useMasteryByCourse()[course.id];
  if (!agenda || !mastery) throw new Error(`No agenda computed for course ${course.id}`);
  const [sources] = useState(() => {
    const catalogue = objectives[course.id] ?? {};
    const byId = new Map<string, QuizQuestion>();
    const byObjective = new Map<string, QuizQuestion[]>();
    const placeOf = new Map<string, { objectiveId: string; topicId: string }>();
    for (const t of trailTopics(course)) {
      for (const q of questionBank[course.id]?.[t.id] ?? []) {
        const o = liveObjectiveOf(q, t.id, catalogue);
        // Deep-review questions are written for, and asked in, deep reviews only; a question the
        // student gave a thumbs down is never asked again.
        if (!o || q.deep || feedback[q.id]?.rating === "down") continue;
        byId.set(q.id, q);
        byObjective.set(o.id, [...(byObjective.get(o.id) ?? []), q]);
        placeOf.set(q.id, { objectiveId: o.id, topicId: t.id });
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
    // In place of a thumbs-down question: another for the same objective, unseen first, else the one
    // seen longest ago; none when the objective has no other question (the top-up writes more).
    const replacementFor = (item: RunnerItem, exclude: ReadonlySet<string>): RunnerItem | null => {
      const place = placeOf.get(item.question.id);
      if (!place) return null;
      const others = (byObjective.get(place.objectiveId) ?? []).filter((q) => !exclude.has(q.id));
      const pick = others.find((q) => !ctx.lastSeen.has(q.id)) ?? [...others].sort((a, b) => (ctx.lastSeen.get(a.id) ?? "").localeCompare(ctx.lastSeen.get(b.id) ?? ""))[0];
      if (!pick) return null;
      return { question: pick, topicId: placeOf.get(pick.id)!.topicId, notes: ["In place of the question you flagged"] };
    };
    return { agenda, ctx, toItems, replacementFor, candidates: (ranked: typeof agenda.ranked) => sessionCandidates(ranked, mastery.objectives, byObjective) };
  });
  return sources;
}

function QuickReview({ course }: { course: Course }) {
  const router = useRouter();
  const { configs } = useOrca();
  const { agenda, ctx, toItems, candidates, replacementFor } = useSessionSources(course);
  const backHref = `/course/${course.slug}`;

  const [items] = useState(() => {
    const budgetSeconds = durationSeconds((configs[course.id] ?? DEFAULT_CONFIG).quick.duration);
    return toItems(assembleQuickReview(candidates(agenda.dueToday), { ...ctx, budgetSeconds }));
  });

  if (items.length === 0) {
    // What was practiced or missed today waits for a later day: same-day retries only measure short-term memory.
    const message = agenda.heldForNext.length
      ? `Nothing to review in ${course.name} right now. What you practiced today comes back in your next quick review.`
      : `Nothing to review in ${course.name} right now.`;
    return <NothingToDo course={course} message={message} onBack={() => goBack(router, backHref)} />;
  }
  return <QuizRunner course={course} items={items} mode="quick" title={course.name} backHref={backHref} replacementFor={replacementFor} />;
}

/**
 * A dive: a deep review whose harder questions are written when it starts. Course-wide it asks for
 * its length first and covers the objectives the student has answered; for one topic (topicId) it
 * covers every live objective of that topic and starts at once with the length picked in the popup.
 */
function DeepReview({ course, onAgain, topicId, startMinutes }: { course: Course; onAgain: () => void; topicId?: string; startMinutes?: number }) {
  const router = useRouter();
  const { configs, questionBank, runs } = useOrca();
  const agenda = useAgenda()[course.id];
  if (!agenda) throw new Error(`No agenda computed for course ${course.id}`);
  const backHref = `/course/${course.slug}`;
  // The course's deep-review length is the starting suggestion; the student picks the length here.
  const [minutes, setMinutes] = useState(() => startMinutes ?? Math.min(DEEP_MAX_MINUTES, durationSeconds((configs[course.id] ?? DEFAULT_CONFIG).deep.duration) / 60));
  const autostart = topicId !== undefined && startMinutes !== undefined;
  const [phase, setPhase] = useState<{ kind: "setup" | "starting" } | { kind: "following"; runId: string } | { kind: "error"; message: string }>({ kind: autostart ? "starting" : "setup" });
  // What it covers, most urgent first: one topic's live objectives, or every objective the student has answered (not retired).
  const [objectiveIds] = useState(() =>
    agenda.ranked.filter((r) => (topicId ? r.topicId === topicId && r.status !== "retired" : r.status !== "unseen" && r.status !== "retired")).map((r) => r.objectiveId),
  );
  const topicName = topicId ? trailTopics(course).find((t) => t.id === topicId)?.name : undefined;
  // A refreshed page has no component state, but the stored run is still authoritative. There is
  // only one course-level Dive In in flight, so safely resume following it without another write.
  const resumedRunId = runs.find((r) => r.courseId === course.id && r.kind === "deep-review" && !isFinished(r))?.id;
  const followedRunId = phase.kind === "following" ? phase.runId : resumedRunId;
  const { run } = useRun(followedRunId);

  const items = useMemo((): RunnerItem[] | null => {
    if (run?.status !== "done" || !run.questionIds?.length) return null;
    const byQuestion = new Map<string, { question: QuizQuestion; topicId: string }>();
    for (const [currentTopicId, questions] of Object.entries(questionBank[course.id] ?? {})) for (const question of questions) byQuestion.set(question.id, { question, topicId: currentTopicId });
    const picked = run.questionIds.map((id) => byQuestion.get(id));
    if (picked.some((p) => !p)) return null; // useRun has asked the provider to refresh; wait for its saved questions.
    return picked.map((p) => {
      const question = p!.question;
      return { question, topicId: p!.topicId, notes: [] };
    });
  }, [run, questionBank, course.id]);

  const write = async () => {
    try {
      // The response only gives us a durable run id; it keeps writing after this page is left.
      const res = await fetch("/api/deep-review", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ courseId: course.id, minutes, objectiveIds }) });
      const out = (await res.json().catch(() => null)) as { state?: "started" | "running" | "queued" | "waiting"; runId?: string; error?: string } | null;
      if (!res.ok || !out?.runId || !out.state) throw new Error(out?.error ?? "Orca couldn't prepare your dive in. Try again in a moment.");
      setPhase({ kind: "following", runId: out.runId });
    } catch (error) {
      setPhase({ kind: "error", message: error instanceof Error ? error.message : "Orca couldn't prepare your dive in." });
    }
  };
  const start = () => {
    setPhase({ kind: "starting" });
    void write();
  };
  // From the topic popup: the length is already chosen, so the questions are written right away.
  const started = useRef(false);
  useEffect(() => {
    if (!autostart || started.current || objectiveIds.length === 0) return;
    started.current = true;
    void write();
  });

  if (objectiveIds.length === 0) {
    return <NothingToDo course={course} message={topicName ? `${topicName} has no objectives to dive into yet.` : "Nothing to dive into yet: answer some questions first."} onBack={() => goBack(router, backHref)} />;
  }
  if (items) {
    return <QuizRunner course={course} items={items} mode="deep" title={topicName ?? course.name} backHref={backHref} again={{ label: "Dive in again", onStart: onAgain }} />;
  }
  const writing = phase.kind === "starting" || (!!followedRunId && (!run || !isFinished(run) || (run.status === "done" && !items)));
  const error = phase.kind === "error" ? phase.message : run?.status === "failed" ? run.error ?? "Orca couldn't prepare your dive in." : null;
  // Once it's on its way (a topic dive from the start, a course dive after Start), only a loading
  // screen until the questions are ready, then the quiz. A topic dive's failure is shown there too.
  if (writing || (autostart && error)) {
    // A stuck dive (its job died, e.g. on a server restart) can be cancelled and started again.
    const cancelAndRetry = async () => {
      await fetch("/api/deep-review/cancel", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ courseId: course.id }) }).catch(() => undefined);
      start();
    };
    return <PreparingDive title={topicName ?? course.name} backHref={backHref} error={writing ? null : error} onRetry={start} onCancel={() => void cancelAndRetry()} />;
  }
  return <DeepReviewSetup courseName={topicName ? `${course.name} · ${topicName}` : course.name} backHref={backHref} minutes={minutes} onMinutes={setMinutes} onStart={start} writing={writing} error={error} />;
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
