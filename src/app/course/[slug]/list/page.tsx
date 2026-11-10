"use client";

import { use, useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import { DiveModal } from "@/components/quiz/DiveModal";
import { durationSeconds } from "@/lib/mastery/session";
import { weakSpotStatus, type WeakSpotStatus } from "@/lib/mastery/progress";
import { AtlasSwitch } from "@/components/atlas/AtlasSwitch";
import { AppShell } from "@/components/layout/AppShell";
import { BackButton } from "@/components/layout/BackButton";
import { DEFAULT_CONFIG, trailTopics } from "@/lib/data";
import { useCourse, useMasteryByCourse, useOrca } from "@/lib/store";
import { fadeUp, stagger } from "@/lib/motion";

/**
 * List (owner, 2026-11-10): every topic with weak spots, in course order, with its status (needs
 * review, in progress, mastered; colours from the Atlas) and a play button that opens its dive.
 */
export default function ListPage({ params }: PageProps<"/course/[slug]/list">) {
  const { slug } = use(params);
  const [diving, setDiving] = useState<{ id: string; name: string } | null>(null);
  const closeDive = useCallback(() => setDiving(null), []);
  const router = useRouter();
  const { hydrated, configs } = useOrca();
  const course = useCourse(slug);
  const mastery = useMasteryByCourse();

  if (!course) {
    return (
      <AppShell bg="ocean">
        <div className="flex h-full flex-col items-start gap-4 p-[32px]">
          <BackButton />
          {hydrated && <p className="text-[22px] font-bold text-prussian">We couldn&apos;t find that island.</p>}
        </div>
      </AppShell>
    );
  }
  const m = mastery[course.id];
  if (!m) throw new Error(`No mastery computed for course ${course.id}`);

  const rows = trailTopics(course).flatMap((topic) => {
    const status = weakSpotStatus(m.topicObjectives.get(topic.id) ?? [], m.objectives);
    const progress = m.topics.get(topic.id);
    if (!progress) throw new Error(`No progress computed for topic ${topic.id}`);
    return status ? [{ topic, status, progress }] : [];
  });

  return (
    <AppShell bg="ocean">
      <div className="absolute inset-0 overflow-auto px-[28px] pb-[28px] pt-[28px]">
        <motion.header variants={stagger()} initial="hidden" animate="show" className="flex items-start gap-[16px]">
          <motion.div variants={fadeUp}>
            <BackButton href={`/course/${course.slug}`} />
          </motion.div>
          <div className="flex flex-col gap-[6px] pt-[2px]">
            <motion.h1 variants={fadeUp} className="text-[34px] font-bold leading-none text-prussian">
              {course.name}
            </motion.h1>
            <motion.p variants={fadeUp} className="text-[15px] font-medium text-wisteria-deep" data-part="list-summary">
              {rows.length ? `${rows.length} topic${rows.length === 1 ? "" : "s"} with weak spots` : "No weak spots flagged yet"}
            </motion.p>
            <motion.div variants={fadeUp} className="mt-[4px]">
              <AtlasSwitch slug={course.slug} current="list" />
            </motion.div>
          </div>
        </motion.header>

        {rows.length === 0 ? (
          <p className="mt-[40px] text-center text-[16px] text-wisteria-deep" data-part="list-empty">
            Flag what&apos;s hard, or miss a question, and its topic shows up here.
          </p>
        ) : (
          <motion.ul variants={stagger()} initial="hidden" animate="show" className="mt-[24px] flex max-w-[860px] flex-col gap-[12px]" data-part="weak-list">
            {rows.map(({ topic, status, progress }) => (
              <motion.li
                key={topic.id}
                variants={fadeUp}
                data-part="weak-row"
                data-status={status}
                className="flex items-center gap-[16px] rounded-[20px] bg-parchment px-[22px] py-[14px] lip-4 lip-alice"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[19px] font-bold text-prussian">{topic.name}</p>
                  <p className="text-[14px] text-wisteria-deep">
                    {progress.mastered} of {progress.weak} weak spot{progress.weak === 1 ? "" : "s"} mastered
                  </p>
                </div>
                <StatusPill status={status} />
                <button
                  type="button"
                  onClick={() => setDiving({ id: topic.id, name: topic.name })}
                  aria-label={`Dive into ${topic.name}`}
                  data-part="weak-row-play"
                  className="pressable flex h-[40px] w-[40px] shrink-0 items-center justify-center rounded-full bg-wisteria text-parchment lip-3 lip-wisteria"
                >
                  <svg width="14" height="16" viewBox="0 0 14 16" aria-hidden="true">
                    <path d="M2 1.5v13l11-6.5z" fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
                  </svg>
                </button>
              </motion.li>
            ))}
          </motion.ul>
        )}
      </div>
      <DiveModal
        topic={diving}
        initialMinutes={durationSeconds((configs[course.id] ?? DEFAULT_CONFIG).deep.duration) / 60}
        onStart={(topicId, minutes) => router.push(`/session/${course.slug}?kind=deep&topic=${topicId}&minutes=${minutes}`)}
        onClose={closeDive}
      />
    </AppShell>
  );
}

/** Needs review in the Atlas's red, in progress in its amber, mastered as a green check. */
function StatusPill({ status }: { status: WeakSpotStatus }) {
  if (status === "mastered") {
    return (
      <span role="img" aria-label="Mastered" data-part="status-pill" className="flex h-[36px] w-[36px] shrink-0 items-center justify-center rounded-full bg-good-tint text-good-deep">
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
          <path d="M3.5 9.5l3.5 3.5 7.5-8" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    );
  }
  const style = status === "needs-review" ? "bg-bad-tint text-bad-text" : "bg-warn-tint text-warn-text";
  return (
    <span data-part="status-pill" className={`shrink-0 rounded-pill px-[14px] py-[6px] text-[14px] font-bold ${style}`}>
      {status === "needs-review" ? "Needs review" : "In progress"}
    </span>
  );
}
