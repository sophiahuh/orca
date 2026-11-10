"use client";

import { useEffect, useRef } from "react";

import { motion } from "motion/react";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { DueCard } from "@/components/ui/DueCard";
import { useAgenda, useOrca, useTodos } from "@/lib/store";
import { fadeUp, stagger } from "@/lib/motion";
import type { Course } from "@/lib/data";
import type { TodoCard } from "@/lib/mastery/todo";
import { CaughtUp, useCaughtUp } from "./CaughtUp";
import { NavBar } from "./NavBar";

export const SIDEBAR_W = 340;

/** Where a to-do card leads. */
export function todoHref(card: TodoCard, course: Course): string {
  switch (card.kind) {
    case "quick":
      // Tomorrow's quick review, started early: it covers what's waiting for it.
      return `/session/${course.slug}?kind=quick${card.when === "tomorrow" ? "&early=1" : ""}`;
    case "deep":
      return `/session/${course.slug}?kind=${card.kind}`;
    case "checks":
      return `/course/${course.slug}`;
    case "warmup":
      return `/session/${course.slug}?kind=quick&warmup=1`;
  }
}

function Section({ title, items, hydrated, courses }: { title: string; hydrated: boolean; items: TodoCard[]; courses: Map<string, Course> }) {
  return (
    <motion.section variants={stagger()} initial="hidden" animate="show" className="flex flex-col gap-[12px]">
      <motion.h2 variants={fadeUp} className="text-[22px] font-bold text-prussian">
        {title}
      </motion.h2>
      {items.length === 0
        ? hydrated && (
            // Nothing in it: just that (owner, 2026-11-08).
            <motion.p variants={fadeUp} className="text-[15px] text-wisteria-deep" data-part="nothing-due">
              Nothing. All caught up
            </motion.p>
          )
        : items.map((d) => {
            const course = courses.get(d.courseId);
            if (!course) throw new Error(`To-do for unknown course ${d.courseId}`);
            return <DueCard key={d.id} kind={d.kind} course={course.name} title={d.title} detail={d.detail} href={todoHref(d, course)} />;
          })}
    </motion.section>
  );
}

/** On a course page, Due today becomes the caught-up card when nothing in the course is due. */
function CourseToday({ course, hydrated, items, courses }: { course: Course; hydrated: boolean; items: TodoCard[]; courses: Map<string, Course> }) {
  const caughtUp = useCaughtUp(course);
  const agenda = useAgenda()[course.id];
  const { runs, materials, requestQuestions, flagTopUpRun } = useOrca();
  // Weak points are due but none has a question a quick review can ask yet (written after a flag;
  // thumbed-down ones don't count): say what's happening instead of "Nothing due" (owner,
  // 2026-11-08). "Writing" only while a top-up is live; otherwise ask for one (once per visit, and
  // only when the course has material to write from), and say so (owner, 2026-11-10: the sidebar
  // said "writing" for two days with no job behind it).
  const due = hydrated && items.length === 0 && agenda ? agenda.dueToday : [];
  // A top-up of this course in flight, or the one just asked for (the store follows it before the runs list catches up).
  const writing = flagTopUpRun !== null || runs.some((r) => r.courseId === course.id && r.kind === "top-up" && (r.status === "queued" || r.status === "waiting" || r.status === "running"));
  const hasMaterial = materials.some((m) => m.courseId === course.id);
  const dueIds = due.map((d) => d.objectiveId).join(",");
  const asked = useRef<string | null>(null);
  useEffect(() => {
    // Once per course visit (a top-up that finds nothing to write would otherwise be asked for again and again).
    if (!dueIds || writing || !hasMaterial || asked.current === course.id) return;
    asked.current = course.id;
    requestQuestions(course.id, dueIds.split(","));
  }, [course.id, dueIds, writing, hasMaterial, requestQuestions]);
  if (due.length > 0) {
    const n = due.length;
    return (
      <motion.section variants={stagger()} initial="hidden" animate="show" className="flex flex-col gap-[12px]">
        <motion.h2 variants={fadeUp} className="text-[22px] font-bold text-prussian">
          Due today
        </motion.h2>
        {writing ? (
          <motion.p variants={fadeUp} className="text-[15px] text-wisteria-deep" data-part="writing-questions">
            Writing questions for {n} weak {n === 1 ? "spot" : "spots"}… Your quick review starts once they&apos;re ready.
          </motion.p>
        ) : hasMaterial ? (
          <motion.div variants={fadeUp} className="flex flex-col gap-[8px]" data-part="no-questions">
            <p className="text-[15px] text-wisteria-deep">
              No questions yet for {n} weak {n === 1 ? "spot" : "spots"}. Orca writes them from the material that teaches them.
            </p>
            <Button size="sm" onClick={() => requestQuestions(course.id, dueIds.split(","))} data-part="write-questions">
              Write them now
            </Button>
          </motion.div>
        ) : (
          <motion.p variants={fadeUp} className="text-[15px] text-wisteria-deep" data-part="no-questions" data-reason="no-material">
            No questions yet for {n} weak {n === 1 ? "spot" : "spots"}: this course has no material to write them from. Add the file that teaches them.
          </motion.p>
        )}
      </motion.section>
    );
  }
  if (hydrated && items.length === 0 && caughtUp) {
    return (
      <motion.section variants={stagger()} initial="hidden" animate="show" className="flex flex-col gap-[12px]">
        <motion.h2 variants={fadeUp} className="text-[22px] font-bold text-prussian">
          Due today
        </motion.h2>
        <CaughtUp course={course} {...caughtUp} />
      </motion.section>
    );
  }
  return <Section title="Due today" hydrated={hydrated} items={items} courses={courses} />;
}

/** 340px right rail: Due today / Due tomorrow + bottom nav. */
export function Sidebar() {
  const { courses, hydrated } = useOrca();
  const todos = useTodos();
  const pathname = usePathname();
  const byId = new Map(courses.map((c) => [c.id, c]));
  const slug = /^\/course\/([^/?#]+)/.exec(pathname)?.[1];
  const course = slug ? courses.find((item) => item.slug === slug) : undefined;
  const visibleTodos = course ? todos.filter((todo) => todo.courseId === course.id) : todos;

  return (
    <aside
      className="flex h-full shrink-0 flex-col justify-between border-l-2 border-alice-deep bg-parchment px-[24px] pb-[24px] pt-[28px]"
      style={{ width: SIDEBAR_W }}
    >
      <div className="flex flex-col gap-[28px] overflow-y-auto">
        {course ? (
          <CourseToday course={course} hydrated={hydrated} items={visibleTodos.filter((d) => d.when === "today")} courses={byId} />
        ) : (
          <Section title="Due today" hydrated={hydrated} items={visibleTodos.filter((d) => d.when === "today")} courses={byId} />
        )}
        <Section title="Due tomorrow" hydrated={hydrated} items={visibleTodos.filter((d) => d.when === "tomorrow")} courses={byId} />
      </div>
      <NavBar className="pt-[20px]" />
    </aside>
  );
}
