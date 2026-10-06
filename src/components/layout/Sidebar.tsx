"use client";

import { motion } from "motion/react";
import { DueCard } from "@/components/ui/DueCard";
import { useOrca, useTodos } from "@/lib/store";
import { fadeUp, stagger } from "@/lib/motion";
import type { Course } from "@/lib/data";
import type { TodoCard } from "@/lib/mastery/todo";
import { NavBar } from "./NavBar";

export const SIDEBAR_W = 340;

/** Where a to-do card leads. */
export function todoHref(card: TodoCard, course: Course): string {
  switch (card.kind) {
    case "quick":
    case "deep":
    case "requiz":
      return `/session/${course.slug}?kind=${card.kind}`;
    case "study":
      return `/course/${course.slug}/study?objective=${encodeURIComponent(card.ref ?? "")}`;
    case "checks":
      return `/course/${course.slug}`;
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
            <motion.p variants={fadeUp} className="text-[15px] text-wisteria-deep">
              Nothing due. Nice.
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

/** 340px right rail: Due today / Due tomorrow + bottom nav. */
export function Sidebar() {
  const { courses, hydrated } = useOrca();
  const todos = useTodos();
  const byId = new Map(courses.map((c) => [c.id, c]));

  return (
    <aside
      className="flex h-full shrink-0 flex-col justify-between border-l-2 border-alice-deep bg-parchment px-[24px] pb-[24px] pt-[28px]"
      style={{ width: SIDEBAR_W }}
    >
      <div className="flex flex-col gap-[28px] overflow-y-auto">
        <Section title="Due today" hydrated={hydrated} items={todos.filter((d) => d.when === "today")} courses={byId} />
        <Section title="Due tomorrow" hydrated={hydrated} items={todos.filter((d) => d.when === "tomorrow")} courses={byId} />
      </div>
      <NavBar className="pt-[20px]" />
    </aside>
  );
}
