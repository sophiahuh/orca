"use client";

import Link from "next/link";
import { use } from "react";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import { useAgenda, useCourse, useOrca } from "@/lib/store";
import { whereTaught } from "@/lib/course/study";
import { Screen } from "@/components/layout/Screen";
import { BackButton } from "@/components/layout/BackButton";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { fadeUp, stagger } from "@/lib/motion";

/**
 * After a poor session: where the objective is taught (as text; slide images wait for stored files)
 * and the explanations of the questions missed, then a re-quiz from the next day.
 */
export default function StudyPage({ params, searchParams }: PageProps<"/course/[slug]/study">) {
  const { slug } = use(params);
  const sp = use(searchParams);
  const objectiveId = typeof sp.objective === "string" ? sp.objective : undefined;
  const router = useRouter();
  const { hydrated, objectives, questionBank, materials } = useOrca();
  const course = useCourse(slug);
  const agenda = useAgenda();
  const objective = course && objectiveId ? objectives[course.id]?.[objectiveId] : undefined;

  if (!course || !objective) {
    return (
      <Screen bg="ocean">
        <div className="flex flex-col items-start gap-4 p-[32px]">
          <BackButton />
          {hydrated && <p className="text-[22px] font-bold text-prussian">We couldn&apos;t find that objective.</p>}
        </div>
      </Screen>
    );
  }

  const backHref = `/course/${course.slug}`;
  const item = agenda[course.id]?.study.find((s) => s.objectiveId === objective.id);
  const topic = course.topics.find((t) => t.id === objective.topicId);
  const taught = whereTaught(objective, topic, materials.filter((m) => m.courseId === course.id));
  const allQuestions = Object.values(questionBank[course.id] ?? {}).flat();
  const missed = (item?.missedQuestionIds ?? []).map((id) => {
    const q = allQuestions.find((x) => x.id === id);
    if (!q) throw new Error(`Missed question ${id} isn't in the course`);
    return q;
  });

  return (
    <Screen bg="ocean" className="overflow-y-auto">
      <header className="flex items-center gap-[16px] px-[28px] pt-[28px]">
        <BackButton href={backHref} />
        <div className="flex flex-col gap-[4px]">
          <span className="eyebrow">Review · {topic?.name ?? course.name}</span>
          <h1 className="text-[40px] font-bold leading-none text-prussian">{objective.name}</h1>
        </div>
      </header>

      <motion.div variants={stagger(0.06)} initial="hidden" animate="show" className="flex w-[760px] max-w-full flex-col gap-[20px] px-[28px] py-[28px]">
        {!item ? (
          <motion.p variants={fadeUp} className="text-[17px] text-prussian">
            Nothing to review here right now: you&apos;ve practised this since.
          </motion.p>
        ) : (
          <>
            <motion.section variants={fadeUp} className="flex flex-col gap-[10px]" data-part="where-taught">
              <h2 className="text-[22px] font-bold text-prussian">Re-read</h2>
              {taught.length === 0 ? (
                <p className="text-[15px] text-prussian/80">Orca doesn&apos;t know where this is taught in your uploads.</p>
              ) : (
                taught.map((t) => (
                  <Card key={t.filename} radius={18} lip={4} className="px-[20px] py-[14px] text-[16px] text-prussian">
                    <span className="font-bold">{t.filename}</span>
                    {t.where && <span>, {t.where}</span>}
                  </Card>
                ))
              )}
            </motion.section>

            <motion.section variants={fadeUp} className="flex flex-col gap-[10px]" data-part="missed">
              <h2 className="text-[22px] font-bold text-prussian">What you missed</h2>
              {missed.map((q) => (
                <Card key={q.id} radius={18} lip={4} className="flex flex-col gap-[6px] px-[20px] py-[14px]">
                  <span className="text-[16px] font-bold text-prussian">{q.prompt}</span>
                  <span className="text-[15px] leading-relaxed text-prussian/85">{q.explanation}</span>
                  {q.anchor && <span className="text-[14px] text-wisteria-deep">From {q.anchor.locator}: “{q.anchor.excerpt}”</span>}
                </Card>
              ))}
            </motion.section>

            <motion.div variants={fadeUp} className="flex flex-col gap-[8px]">
              {item.requiz === "today" ? (
                <Button onClick={() => router.push(`/session/${course.slug}?kind=requiz`)}>Start the re-quiz</Button>
              ) : (
                <p className="text-[15px] font-medium text-wisteria-deep">Your re-quiz opens tomorrow. Same-day retries only measure short-term memory.</p>
              )}
            </motion.div>
          </>
        )}

        <motion.div variants={fadeUp}>
          <Link href={backHref} className="text-[15px] font-bold text-wisteria-deep hover:underline">
            Back to the island
          </Link>
        </motion.div>
      </motion.div>
    </Screen>
  );
}
