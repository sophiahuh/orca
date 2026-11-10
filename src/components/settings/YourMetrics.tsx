"use client";

import { useEffect, useState } from "react";
import type { UserMetrics } from "@/lib/user-metrics";

export function duration(seconds: number) {
  if (seconds < 60) return `${seconds}s`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}

/** GET /api/metrics once per mount: the home page's stats strip and a course's header read it. */
export function useUserMetrics(): { metrics: UserMetrics | null; problem: string | null } {
  const [metrics, setMetrics] = useState<UserMetrics | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    fetch("/api/metrics", { cache: "no-store" })
      .then(async (response) => ({ response, body: (await response.json()) as UserMetrics & { error?: string } }))
      .then(({ response, body }) => {
        if (!live) return;
        if (!response.ok) return setProblem(body.error ?? "Couldn't load your metrics.");
        setMetrics(body);
      })
      .catch(() => live && setProblem("Couldn't load your metrics."));
    return () => {
      live = false;
    };
  }, []);
  return { metrics, problem };
}

/** The full breakdown (time, solved, longest streak, then each course's top topics); shown in the home page's stats popover. */
export function YourMetrics({ metrics, problem }: { metrics: UserMetrics | null; problem: string | null }) {
  return (
    <div className="flex flex-col gap-[14px]" data-part="your-metrics">
      {metrics && (
        <>
          <div className="grid grid-cols-3 gap-[8px]">
            <Metric value={duration(metrics.seconds)} label="Time spent" />
            <Metric value={String(metrics.solved)} label="Solved" />
            <Metric value={`${metrics.longestStreak}d`} label="Longest streak" />
          </div>
          {metrics.courses.length > 0 ? (
            <div className="flex flex-col gap-[12px]">
              {metrics.courses.map((course) => (
                <div key={course.courseId} className="border-t border-alice-deep pt-[10px]">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-[14px] font-bold text-prussian">{course.name}</span>
                    <span className="shrink-0 text-[12px] font-semibold text-wisteria-deep">{duration(course.seconds)} · {course.solved} solved</span>
                  </div>
                  {course.topics.map((topic) => (
                    <div key={topic.topicId} className="mt-[5px] flex items-baseline justify-between gap-2 text-[12px]">
                      <span className="truncate text-prussian">{topic.name}</span>
                      <span className="shrink-0 text-wisteria-deep">{duration(topic.seconds)} · {topic.solved}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[14px] font-medium text-wisteria-deep">Finish a quiz to start building your metrics.</p>
          )}
        </>
      )}
      {!metrics && !problem && <p className="text-[14px] font-medium text-wisteria-deep">Loading your study activity…</p>}
      {problem && <p role="alert" className="text-[13px] font-semibold text-prussian">{problem}</p>}
    </div>
  );
}

function Metric({ value, label }: { value: string; label: string }) {
  return <div className="rounded-[12px] bg-alice px-[8px] py-[10px] text-center"><div className="text-[16px] font-bold text-prussian">{value}</div><div className="mt-[2px] text-[11px] font-semibold text-wisteria-deep">{label}</div></div>;
}
