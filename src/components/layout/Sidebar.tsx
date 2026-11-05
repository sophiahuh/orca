"use client";

import { motion } from "motion/react";
import { usePathname } from "next/navigation";
import { DueCard } from "@/components/ui/DueCard";
import { useOrca, useTodos } from "@/lib/store";
import { fadeUp, stagger } from "@/lib/motion";
import type { Course } from "@/lib/data";
import type { TodoCard } from "@/lib/mastery/todo";
import { CaughtUp, FOCUS_COPY, useCaughtUp } from "./CaughtUp";
import { NavBar } from "./NavBar";

export const SIDEBAR_W = 340;

/** Where a to-do card leads. */
export function todoHref(card: TodoCard, course: Course): string {
  switch (card.kind) {
    case "quick":
    case "deep":
      return `/session/${course.slug}?kind=${card.kind}`;
    case "checks":
      return `/course/${course.slug}`;
  }
}

function Section({ title, items, hydrated, courses, emptyNote }: { title: string; hydrated: boolean; items: TodoCard[]; courses: Map<string, Course>; emptyNote?: string }) {
  return (
    <motion.section variants={stagger()} initial="hidden" animate="show" className="flex flex-col gap-[12px]">
      <motion.h2 variants={fadeUp} className="text-[22px] font-bold text-prussian">
        {title}
      </motion.h2>
      {items.length === 0
        ? hydrated && (
            <motion.p variants={fadeUp} className="text-[15px] text-wisteria-deep">
              Nothing due. Nice.{emptyNote ? ` ${emptyNote}` : ""}
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
  return <Section title="Due today" hydrated={hydrated} items={items} courses={courses} emptyNote={FOCUS_COPY} />;
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
          <Section title="Due today" hydrated={hydrated} items={visibleTodos.filter((d) => d.when === "today")} courses={byId} emptyNote={FOCUS_COPY} />
        )}
        <Section title="Due tomorrow" hydrated={hydrated} items={visibleTodos.filter((d) => d.when === "tomorrow")} courses={byId} />
      </div>
      <NavBar className="pt-[20px]" />
    </aside>
  );
}
