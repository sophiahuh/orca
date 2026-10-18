"use client";

import { use, useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import { DiveModal } from "@/components/quiz/DiveModal";
import { DEEP_MAX_MINUTES } from "@/lib/deep-review";
import { durationSeconds } from "@/lib/mastery/session";
import { useAgenda, useCourse, useMasteryByCourse, useOrca } from "@/lib/store";
import { AppShell } from "@/components/layout/AppShell";
import { BackButton } from "@/components/layout/BackButton";
import { Button } from "@/components/ui/Button";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { KnowledgePath } from "@/components/path/KnowledgePath";
import { AtlasSwitch } from "@/components/atlas/AtlasSwitch";
import { ExamsModal } from "@/components/config/ExamsModal";
import { fadeUp, stagger } from "@/lib/motion";
import { COURSE_NAME_MAX, DEFAULT_CONFIG, trailTopics } from "@/lib/data";
import { courseUploads, pendingReview, uploadsInProgress } from "@/lib/course/review";
import { isFinished, useRun } from "@/hooks/useRun";
import Link from "next/link";

export default function CoursePage({ params }: PageProps<"/course/[slug]">) {
  const { slug } = use(params);
  // A topic's dive: its popup ("Dive into [topic]") picks the length, then the session starts.
  const [diving, setDiving] = useState<{ id: string; name: string } | null>(null);
  const closeDive = useCallback(() => setDiving(null), []);
  const [editingExams, setEditingExams] = useState(false);
  const closeExams = useCallback(() => setEditingExams(false), []);
  const router = useRouter();
  const { hydrated, objectives, renameCourse, configs, runs } = useOrca();
  const course = useCourse(slug);
  const mastery = useMasteryByCourse();
  const agendas = useAgenda();

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
  const topics = trailTopics(course);
  const total = topics.length;
  const done = topics.filter((t) => m.topics.get(t.id)?.status === "done").length;
  const pct = total ? done / total : 0;
  const toReview = pendingReview(course.topics, objectives[course.id] ?? {}).count;
  const uploading = uploadsInProgress(runs, course.id);
  const agenda = agendas[course.id];
  if (!agenda) throw new Error(`No agenda computed for course ${course.id}`);

  return (
    <AppShell bg="ocean">
      {topics.length === 0 ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-[12px] text-center">
          <p className="text-[22px] font-bold text-prussian">This island is uncharted.</p>
          <p className="text-[16px] text-wisteria-deep">Add lecture slides or homework and Orca will map its topics.</p>
          <Button size="sm" onClick={() => router.push(`/add-material?course=${course.slug}`)}>
            Add material
          </Button>
        </div>
      ) : (
        <KnowledgePath course={course} progress={m.topics} needingQuestions={m.objectivesNeedingQuestions} onStart={(t) => setDiving({ id: t.id, name: t.name })} />
      )}

      <motion.header variants={stagger()} initial="hidden" animate="show" className="absolute left-[28px] top-[28px] flex items-start gap-[16px]">
        <motion.div variants={fadeUp}>
          <BackButton />
        </motion.div>
        <div className="flex flex-col gap-[6px] pt-[2px]">
          <motion.h1
            variants={fadeUp}
            contentEditable
            suppressContentEditableWarning
            role="textbox"
            aria-label="Course name"
            spellCheck={false}
            onBlur={(e) => {
              // At most COURSE_NAME_MAX characters: a longer name is cut there, and the heading shows what was kept.
              const name = (e.currentTarget.textContent?.trim() ?? "").slice(0, COURSE_NAME_MAX).trim();
              e.currentTarget.textContent = name || course.name;
              if (name && name !== course.name) renameCourse(course.id, name);
              else e.currentTarget.textContent = course.name;
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                e.currentTarget.blur();
              }
              if (e.key === "Escape") {
                e.currentTarget.textContent = course.name;
                e.currentTarget.blur();
              }
            }}
            className="text-[34px] font-bold leading-none text-prussian outline-none"
          >
            {course.name}
          </motion.h1>
          <motion.p variants={fadeUp} className="text-[15px] font-medium text-wisteria-deep">
            {done} of {total} topics complete
          </motion.p>
          <motion.div variants={fadeUp} className="mt-[6px] w-[240px]">
            <ProgressBar value={pct} height={12} label="Course progress" track="parchment" />
          </motion.div>
          <motion.nav variants={fadeUp} aria-label="Course structure" className="mt-[4px] flex items-center gap-[10px]">
            <AtlasSwitch slug={course.slug} current="path" />
            {/* Building uploads are followed here too, so the count drops when one finishes. */}
            {courseUploads(runs, course.id)
              .filter((u) => !isFinished(u))
              .map((u) => (
                <FollowRun key={u.id} runId={u.id} />
              ))}
            {/* Always there: the course's uploads and what they need reviewed, each with a count when there's something in it. */}
            <CountLink href={`/course/${course.slug}/review?tab=uploads`} label="Uploads" count={uploading} countLabel="building" part="uploads-link" />
            <CountLink href={`/course/${course.slug}/review?tab=review`} label="Review" count={toReview} countLabel="to review" part="review-link" />
          </motion.nav>
        </div>
      </motion.header>

      <motion.div variants={fadeUp} initial="hidden" animate="show" role="group" aria-label="Practice" className="absolute right-[28px] top-[32px] flex items-center gap-[10px]">
        <button type="button" onClick={() => setEditingExams(true)} data-part="edit-exams" className="pressable rounded-pill bg-prussian px-[14px] py-[7px] text-[13px] font-bold text-parchment lip-2 lip-ink">
          Edit Exams
        </button>
        {agenda.deepReview.candidates > 0 && (
          <div className="group relative">
            <Link href={`/session/${course.slug}?kind=deep`} data-part="start-deep" aria-describedby="dive-in-info" className="pressable rounded-pill bg-parchment px-[14px] py-[7px] text-[13px] font-bold text-prussian ring-2 ring-inset ring-alice-deep lip-2 lip-alice">
              Dive in{agenda.deepReview.due ? " · due" : ""}
            </Link>
            <div id="dive-in-info" role="tooltip" className="pointer-events-none absolute right-0 top-full z-10 mt-[10px] w-[248px] rounded-[14px] border-2 border-alice-deep bg-parchment px-[14px] py-[11px] text-left text-[13px] font-semibold leading-[1.35] text-prussian opacity-0 shadow-[0_5px_0_var(--color-alice-deep)] transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
              <span className="block font-bold">Deep review.</span>
              Solidify your understanding with harder questions
            </div>
          </div>
        )}
      </motion.div>
      <ExamsModal course={editingExams ? course : null} onClose={closeExams} />
      <DiveModal
        topic={diving}
        initialMinutes={Math.min(DEEP_MAX_MINUTES, durationSeconds((configs[course.id] ?? DEFAULT_CONFIG).deep.duration) / 60)}
        onStart={(topicId, minutes) => router.push(`/session/${course.slug}?kind=deep&topic=${topicId}&minutes=${minutes}`)}
        onClose={closeDive}
      />
    </AppShell>
  );
}

/** Follows one building upload (the store reloads when it finishes); draws nothing. */
function FollowRun({ runId }: { runId: string }) {
  useRun(runId);
  return null;
}

/** A pill to one tab of the course's uploads and review page, with a count badge when something's in it. */
function CountLink({ href, label, count, countLabel, part }: { href: string; label: string; count: number; countLabel: string; part: string }) {
  return (
    <Link
      href={href}
      aria-label={count > 0 ? `${label}, ${count} ${countLabel}` : label}
      className="pressable flex items-center gap-[6px] rounded-pill bg-parchment px-[14px] py-[7px] text-[13px] font-bold text-prussian ring-2 ring-inset ring-alice-deep lip-2 lip-alice"
      data-part={part}
    >
      {label}
      {count > 0 && <span className="flex h-[20px] min-w-[20px] items-center justify-center rounded-pill bg-wisteria px-[6px] text-[11px] font-bold text-parchment">{count}</span>}
    </Link>
  );
}
