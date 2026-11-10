"use client";

import Link from "next/link";
import { AppShell } from "@/components/layout/AppShell";
import { KnowledgeMap } from "@/components/map/KnowledgeMap";
import { OrcaLogo } from "@/components/brand/OrcaLogo";
import { StudyStats } from "@/components/map/StudyStats";
import { IconPlus } from "@/components/icons";
import { useOrca, useTodos } from "@/lib/store";

export default function HomePage() {
  const { courses, hydrated } = useOrca();
  const todos = useTodos();
  const dueCount = (courseId: string) => todos.filter((d) => d.courseId === courseId && d.when === "today").length;

  return (
    <AppShell bg="ocean">
      <KnowledgeMap courses={courses} dueCount={dueCount} />

      {hydrated && courses.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-[8px] text-center" data-part="no-islands">
          <OrcaLogo width={110} swim />
          <p className="mt-[8px] text-[22px] font-bold text-prussian">No islands yet.</p>
          <p className="text-[16px] text-wisteria-deep">Add a course, then upload its slides to map its topics.</p>
        </div>
      )}

      <Link
        href="/new-course"
        data-part="add-course"
        className="pressable absolute right-[28px] top-[28px] inline-flex items-center gap-2 rounded-[16px] bg-prussian px-[18px] py-[12px] text-[15px] font-bold text-parchment lip-4 lip-ink"
      >
        <IconPlus size={18} />
        Add Course
      </Link>

      {hydrated && <StudyStats usage={courses.length > 0} />}
    </AppShell>
  );
}
