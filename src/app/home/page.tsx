"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import type { Course } from "@/lib/data";
import { AppShell } from "@/components/layout/AppShell";
import { KnowledgeMap } from "@/components/map/KnowledgeMap";
import { ClassConfigModal } from "@/components/config/ClassConfigModal";
import { OrcaLogo } from "@/components/brand/OrcaLogo";
import { IconPlus } from "@/components/icons";
import { useOrca, useStreak, useTodos } from "@/lib/store";

export default function HomePage() {
  const { courses, hydrated } = useOrca();
  const todos = useTodos();
  const streak = useStreak();
  const [configuring, setConfiguring] = useState<Course | null>(null);
  const close = useCallback(() => setConfiguring(null), []);
  const dueCount = (courseId: string) => todos.filter((d) => d.courseId === courseId && d.when === "today").length;

  return (
    <AppShell bg="ocean">
      <KnowledgeMap courses={courses} dueCount={dueCount} onConfigure={setConfiguring} />

      {hydrated && courses.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-[8px] text-center">
          <p className="text-[22px] font-bold text-prussian">No islands yet.</p>
          <p className="text-[16px] text-wisteria-deep">Add a course, then upload its slides to map its topics.</p>
        </div>
      )}

      <Link
        href="/new-course"
        className="pressable absolute left-[28px] top-[28px] inline-flex items-center gap-2 rounded-[16px] bg-prussian px-[18px] py-[12px] text-[15px] font-bold text-parchment lip-4 lip-ink"
      >
        <IconPlus size={18} />
        Add Course
      </Link>

      <div className="absolute bottom-[28px] left-[28px] inline-flex items-center gap-[10px] rounded-pill border-2 border-alice-deep bg-parchment py-[8px] pl-[12px] pr-[18px] lip-3 lip-alice">
        <OrcaLogo width={38} shadow={false} />
        {hydrated && <span className="text-[15px] font-bold text-prussian">{streak} day streak</span>}
      </div>

      <ClassConfigModal course={configuring} onClose={close} />
    </AppShell>
  );
}
