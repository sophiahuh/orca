"use client";

import Link from "next/link";
import { AppShell } from "@/components/layout/AppShell";
import { KnowledgeMap } from "@/components/map/KnowledgeMap";
import { OrcaLogo } from "@/components/brand/OrcaLogo";
import { StudyStats } from "@/components/map/StudyStats";
import { IconPlus } from "@/components/icons";
import { useOrca, useTodos } from "@/lib/store";

export default function HomePage() {
  const { courses, hydrated, isAdmin } = useOrca();
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

      <div className="absolute right-[28px] top-[28px] flex items-center gap-[12px]">
        {/* The owner's door to the admin view (profiles.is_admin, set only in the database); nobody else sees it. */}
        {isAdmin && (
          <Link href="/admin" data-part="admin-link" className="pressable inline-flex items-center gap-2 rounded-[16px] bg-parchment px-[16px] py-[12px] text-[15px] font-bold text-prussian lip-4 lip-alice">
            <span className="rounded-pill bg-wisteria px-[8px] py-[2px] text-[11px] font-bold uppercase tracking-[1.2px] text-parchment">Admin</span>
            Dashboard
          </Link>
        )}
        <Link href="/new-course" data-part="add-course" className="pressable inline-flex items-center gap-2 rounded-[16px] bg-prussian px-[18px] py-[12px] text-[15px] font-bold text-parchment lip-4 lip-ink">
          <IconPlus size={18} />
          Add Course
        </Link>
      </div>

      {hydrated && <StudyStats usage={courses.length > 0} />}
    </AppShell>
  );
}
