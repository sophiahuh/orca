"use client";

import { use } from "react";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import { useCourse, useMasteryByCourse, useOrca } from "@/lib/store";
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
  const { hydrated, objectives } = useOrca();
  const course = useCourse(slug);
  const mastery = useMasteryByCourse();

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
          </motion.nav>
        </div>
      </motion.header>
    </AppShell>
  );
}
