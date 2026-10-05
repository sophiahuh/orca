"use client";

import { use } from "react";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import { useAgenda, useCourse, useMasteryByCourse, useOrca } from "@/lib/store";
import { AppShell } from "@/components/layout/AppShell";
import { BackButton } from "@/components/layout/BackButton";
import { Button } from "@/components/ui/Button";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { KnowledgePath } from "@/components/path/KnowledgePath";
import { fadeUp, stagger } from "@/lib/motion";
import { trailTopics } from "@/lib/data";
import { pendingReview } from "@/lib/course/review";
import Link from "next/link";

export default function CoursePage({ params }: PageProps<"/course/[slug]">) {
  const { slug } = use(params);
  const router = useRouter();
  const { hydrated, objectives, materials } = useOrca();
  const course = useCourse(slug);
  const mastery = useMasteryByCourse();
  const agendas = useAgenda();

  if (!course) {
    return (
      <AppShell bg="alice">
        <div className="flex h-full flex-col items-start gap-4 p-[32px]">
          <BackButton />
          {hydrated && <p className="text-[22px] font-bold text-prussian">We couldn&apos;t find that island.</p>}
        </div>
      </AppShell>
    );
  }

  const m = mastery[course.id];
  if (!m) throw new Error(`No mastery computed for course ${course.id}`);
  const topics = trailTopics(course);
  const total = topics.length;
  const done = topics.filter((t) => m.topics.get(t.id)?.status === "done").length;
  const pct = total ? done / total : 0;
  const toReview = pendingReview(course.topics, objectives[course.id] ?? {}).count;
  const agenda = agendas[course.id];
  if (!agenda) throw new Error(`No agenda computed for course ${course.id}`);
  const toReflect = materials.filter((x) => x.courseId === course.id && x.reflect && !x.reflection);

  return (
    <AppShell bg="alice">
      {topics.length === 0 ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-[12px] text-center">
          <p className="text-[22px] font-bold text-prussian">This island is uncharted.</p>
          <p className="text-[16px] text-wisteria-deep">Add lecture slides or homework and Orca will map its topics.</p>
          <Button size="sm" onClick={() => router.push("/add-material")}>
            Add material
          </Button>
        </div>
      ) : (
        <KnowledgePath course={course} progress={m.topics} needingQuestions={m.objectivesNeedingQuestions} onStart={(t) => router.push(`/quiz/${course.slug}/${t.id}`)} />
      )}

      <motion.header variants={stagger()} initial="hidden" animate="show" className="absolute left-[28px] top-[28px] flex items-start gap-[16px]">
        <motion.div variants={fadeUp}>
          <BackButton />
        </motion.div>
        <div className="flex flex-col gap-[6px] pt-[2px]">
          <motion.h1 variants={fadeUp} className="text-[34px] font-bold leading-none text-prussian">
            {course.name}
          </motion.h1>
          <motion.p variants={fadeUp} className="text-[15px] font-medium text-wisteria-deep">
            {done} of {total} topics complete
          </motion.p>
          <motion.div variants={fadeUp} className="mt-[6px] w-[240px]">
            <ProgressBar value={pct} height={12} label="Course progress" />
          </motion.div>
          <motion.nav variants={fadeUp} aria-label="Course structure" className="mt-[4px] flex items-center gap-[10px]">
            {toReview > 0 && (
              <Link href={`/course/${course.slug}/review`} className="pressable rounded-pill bg-wisteria px-[12px] py-[6px] text-[13px] font-bold text-parchment lip-2 lip-wisteria">
                {toReview} to review
              </Link>
            )}
            <Link href={`/course/${course.slug}/objectives`} className="text-[13px] font-bold text-wisteria-deep hover:underline">
              Objectives
            </Link>
            {toReflect.map((x) => (
              <Link key={x.id} href={`/course/${course.slug}/reflect?material=${x.id}`} className="text-[13px] font-bold text-wisteria-deep hover:underline">
                Reflect on {x.filename.replace(/\.[a-z0-9]+$/i, "")}
              </Link>
            ))}
          </motion.nav>
        </div>
      </motion.header>

      <motion.div variants={fadeUp} initial="hidden" animate="show" role="group" aria-label="Practice" className="absolute right-[28px] top-[32px] flex items-center gap-[10px]">
        {agenda.dueToday.length > 0 && (
          <Link href={`/session/${course.slug}?kind=quick`} data-part="start-quick" className="pressable rounded-pill bg-prussian px-[14px] py-[7px] text-[13px] font-bold text-parchment lip-2 lip-ink">
            Quick review · {agenda.dueToday.length} due
          </Link>
        )}
        {agenda.deepReview.candidates > 0 && (
          <Link href={`/session/${course.slug}?kind=deep`} data-part="start-deep" className="pressable rounded-pill bg-parchment px-[14px] py-[7px] text-[13px] font-bold text-prussian ring-2 ring-inset ring-alice-deep lip-2 lip-alice">
            Deep review{agenda.deepReview.due ? " · due" : ""}
          </Link>
        )}
      </motion.div>
    </AppShell>
  );
}
