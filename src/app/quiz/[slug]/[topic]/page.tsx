"use client";

import { use, useMemo } from "react";
import { useRouter } from "next/navigation";
import { trailTopics } from "@/lib/data";
import { liveObjectiveOf } from "@/lib/mastery/catalogue";
import { useCourse, useOrca } from "@/lib/store";
import { Screen } from "@/components/layout/Screen";
import { BackButton } from "@/components/layout/BackButton";
import { Button } from "@/components/ui/Button";
import { QuizRunner, type RunnerItem } from "@/components/quiz/QuizRunner";

export default function QuizPage({ params }: PageProps<"/quiz/[slug]/[topic]">) {
  const { slug, topic: topicId } = use(params);
  const router = useRouter();
  const { hydrated, questionBank, objectives } = useOrca();
  const course = useCourse(slug);
  const topic = course ? trailTopics(course).find((t) => t.id === topicId) : undefined;

  const generated = course ? questionBank[course.id]?.[topicId] : undefined;
  const catalogue = course ? objectives[course.id] : undefined;
  // Rejected (archived) objectives are never quizzed; deep-review questions are only for deep reviews.
  const items = useMemo<RunnerItem[]>(
    () =>
      (generated ?? [])
        .filter((q) => !q.deep && liveObjectiveOf(q, topicId, catalogue ?? {}) !== null)
        .slice(0, 8)
        .map((question) => ({ question, topicId, notes: [] })),
    [generated, topicId, catalogue],
  );

  if (!course || !topic) {
    return (
      <Screen bg="parchment" className="items-start gap-4 p-[32px]">
        <BackButton />
        {hydrated && <p className="text-[22px] font-bold text-prussian">That topic isn&apos;t on the map yet.</p>}
      </Screen>
    );
  }

  const backHref = `/course/${course.slug}`;

  if (items.length === 0) {
    return (
      <Screen bg="parchment" className="items-start gap-4 p-[32px]">
        <BackButton href={backHref} />
        {hydrated && (
          <>
            <p className="text-[22px] font-bold text-prussian">No questions for {topic.name} yet.</p>
            <p className="text-[16px] text-wisteria-deep">Add course material for this topic and Orca will write some.</p>
            <Button size="sm" onClick={() => router.push("/add-material")}>
              Add material
            </Button>
          </>
        )}
      </Screen>
    );
  }

  return <QuizRunner course={course} items={items} mode="topic" title={topic.name} backHref={backHref} />;
}
