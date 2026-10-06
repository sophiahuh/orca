"use client";

import { use, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import { AtlasSwitch } from "@/components/atlas/AtlasSwitch";
import { TopicGraph } from "@/components/atlas/TopicGraph";
import { AppShell } from "@/components/layout/AppShell";
import { BackButton } from "@/components/layout/BackButton";
import { trailTopics } from "@/lib/data";
import { topicGraph, topicStrength } from "@/lib/course/topic-graph";
import { useCourse, useMasteryByCourse, useOrca } from "@/lib/store";
import { fadeUp, stagger } from "@/lib/motion";

/**
 * Figma: E1 · Concept graph v4. The course's topics and how they connect (used in, has a kind,
 * alternative to, related), foundations on top, with the usual right rail. A topic opens its quiz.
 */
export default function AtlasPage({ params }: PageProps<"/course/[slug]/atlas">) {
  const { slug } = use(params);
  const router = useRouter();
  const { hydrated, relations, refresh } = useOrca();
  const [finding, setFinding] = useState<{ kind: "idle" | "busy" } | { kind: "done" | "error"; message: string }>({ kind: "idle" });
  const course = useCourse(slug);
  const mastery = useMasteryByCourse();
  const m = course ? mastery[course.id] : undefined;

  const graph = useMemo(() => {
    if (!course || !m) return null;
    return topicGraph({
      topics: course.topics,
      live: trailTopics(course),
      relations: relations[course.id] ?? [],
      strengthOf: (id) => topicStrength(m.topicObjectives.get(id) ?? [], m.objectives),
    });
  }, [course, m, relations]);

  if (!course) {
    return (
      <AppShell bg="parchment">
        <div className="flex h-full flex-col items-start gap-4 p-[32px]">
          <BackButton />
          {hydrated && <p className="text-[22px] font-bold text-prussian">We couldn&apos;t find that island.</p>}
        </div>
      </AppShell>
    );
  }
  if (!m || !graph) throw new Error(`No mastery computed for course ${course.id}`);

  // "Find connections": the link step over the whole course (POST /api/relink), then a reload.
  const findConnections = async () => {
    setFinding({ kind: "busy" });
    try {
      const res = await fetch("/api/relink", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ courseId: course.id }) });
      const out = (await res.json().catch(() => null)) as { added?: number; error?: string } | null;
      if (!res.ok || out?.added === undefined) throw new Error(out?.error ?? "Orca couldn't look for connections. Try again in a moment.");
      await refresh();
      setFinding({ kind: "done", message: out.added ? `Found ${out.added} new connection${out.added === 1 ? "" : "s"}.` : "No new connections found." });
    } catch (error) {
      setFinding({ kind: "error", message: error instanceof Error ? error.message : "Orca couldn't look for connections." });
    }
  };

  const topics = graph.nodes.length;
  const connections = graph.edges.length;
  return (
    <AppShell bg="parchment">
      {topics === 0 ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-[12px] text-center">
          <p className="text-[22px] font-bold text-prussian">No topics to map yet.</p>
          <p className="text-[16px] text-wisteria-deep">Add lecture slides or homework and Orca will chart this island&apos;s topics.</p>
        </div>
      ) : (
        <TopicGraph key={`${graph.width}x${graph.height}`} graph={graph} onOpen={(id) => router.push(`/quiz/${course.slug}/${id}`)} />
      )}
      <motion.header variants={stagger()} initial="hidden" animate="show" className="pointer-events-none absolute left-[28px] top-[28px] flex items-start gap-[16px]">
        <motion.div variants={fadeUp} className="pointer-events-auto">
          <BackButton href={`/course/${course.slug}`} />
        </motion.div>
        <div className="flex flex-col gap-[4px] pt-[2px]">
          <motion.h1 variants={fadeUp} className="text-[28px] font-bold leading-none text-prussian">
            {course.name}
          </motion.h1>
          <motion.p variants={fadeUp} className="text-[13px] font-semibold text-wisteria-deep" data-part="atlas-summary">
            {topics} topic{topics === 1 ? "" : "s"} · {connections} connection{connections === 1 ? "" : "s"}

          </motion.p>
          <motion.div variants={fadeUp} className="pointer-events-auto mt-[6px] flex items-center gap-[10px]">
            <AtlasSwitch slug={course.slug} current="atlas" />
            {topics > 1 && (
              <button
                type="button"
                onClick={findConnections}
                disabled={finding.kind === "busy"}
                data-part="find-connections"
                className="pressable rounded-pill border-2 border-alice-deep bg-parchment px-[12px] py-[5px] text-[13px] font-bold text-prussian lip-2 lip-alice disabled:opacity-60"
              >
                {finding.kind === "busy" ? "Finding connections…" : "Find connections"}
              </button>
            )}
          </motion.div>
          {(finding.kind === "done" || finding.kind === "error") && (
            <motion.p variants={fadeUp} className="text-[13px] font-semibold text-prussian" role={finding.kind === "error" ? "alert" : "status"} data-part="find-connections-result">
              {finding.message}
            </motion.p>
          )}
        </div>
      </motion.header>
    </AppShell>
  );
}
