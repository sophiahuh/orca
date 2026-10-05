"use client";

import { motion } from "motion/react";
import { DueCard } from "@/components/ui/DueCard";
import { useOrca } from "@/lib/store";
import { fadeUp, stagger } from "@/lib/motion";
import type { DueItem } from "@/lib/data";
import { NavBar } from "./NavBar";

export const SIDEBAR_W = 340;

function Section({ title, items, hrefFor, labelFor }: {
  title: string;
  items: DueItem[];
  hrefFor: (d: DueItem) => string;
  labelFor: (d: DueItem) => string;
}) {
  return (
    <motion.section variants={stagger()} initial="hidden" animate="show" className="flex flex-col gap-[12px]">
      <motion.h2 variants={fadeUp} className="text-[22px] font-bold text-prussian">
        {title}
      </motion.h2>
      {items.length === 0 ? (
        <motion.p variants={fadeUp} className="text-[15px] text-wisteria-deep">
          Nothing due. Nice.
        </motion.p>
      ) : (
        items.map((d) => <DueCard key={d.id} course={labelFor(d)} title={d.title} href={hrefFor(d)} />)
      )}
    </motion.section>
  );
}

/** 340px right rail: Due today / Due tomorrow + bottom nav. */
export function Sidebar() {
  const { due, courses } = useOrca();
  const byId = new Map(courses.map((c) => [c.id, c]));
  const hrefFor = (d: DueItem) => {
    const c = byId.get(d.courseId);
    if (!c) return "/home";
    const topic = c.topics.find((t) => t.id === d.topicId);
    return topic ? `/quiz/${c.slug}/${topic.id}` : `/course/${c.slug}`;
  };
  const labelFor = (d: DueItem) => byId.get(d.courseId)?.short ?? "";

  return (
    <aside
      className="flex h-full shrink-0 flex-col justify-between border-l-2 border-alice-deep bg-parchment px-[24px] pb-[24px] pt-[28px]"
      style={{ width: SIDEBAR_W }}
    >
      <div className="flex flex-col gap-[28px] overflow-y-auto">
        <Section title="Due today" items={due.filter((d) => d.when === "today")} hrefFor={hrefFor} labelFor={labelFor} />
        <Section title="Due tomorrow" items={due.filter((d) => d.when === "tomorrow")} hrefFor={hrefFor} labelFor={labelFor} />
      </div>
      <NavBar className="pt-[20px]" />
    </aside>
  );
}
