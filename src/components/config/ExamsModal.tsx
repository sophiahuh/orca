"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { type Course, type Exam, toISODate, trailTopics } from "@/lib/data";
import { cn } from "@/lib/cn";
import { IconClose, IconPlus } from "@/components/icons";
import { Button } from "@/components/ui/Button";
import { RoundButton } from "@/components/ui/RoundButton";
import { useOrca } from "@/lib/store";
import { overlayFade, popIn } from "@/lib/motion";

const FIELD = "h-[40px] rounded-[12px] border-2 border-alice-deep bg-parchment px-[12px] text-[15px] font-semibold text-prussian focus:border-wisteria focus:outline-none";

/** Topic chips: which of the course's topics an exam covers (none chosen = not said). */
function TopicPicker({ topics, chosen, onToggle }: { topics: ReadonlyArray<{ id: string; name: string }>; chosen: readonly string[]; onToggle: (id: string) => void }) {
  if (topics.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-[6px]" role="group" aria-label="Topics covered">
      {topics.map((t) => {
        const on = chosen.includes(t.id);
        return (
          <button
            key={t.id}
            type="button"
            aria-pressed={on}
            onClick={() => onToggle(t.id)}
            className={cn("rounded-pill border-2 px-[10px] py-[4px] text-[12px] font-bold", on ? "border-wisteria-deep bg-wisteria text-parchment" : "border-alice-deep bg-parchment text-prussian")}
          >
            {t.name}
          </button>
        );
      })}
    </div>
  );
}

const toggled = (ids: readonly string[], id: string) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);

/**
 * A course's exams (the exams table): add one, rename it, move its date, choose the topics it
 * covers (optional) or delete it. The calendar and the exam-driven cadences follow every change.
 */
export function ExamsModal({ course, onClose }: { course: Course | null; onClose: () => void }) {
  const { exams: all, addExam, updateExam, removeExam } = useOrca();
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [topicIds, setTopicIds] = useState<string[]>([]);

  useEffect(() => {
    if (!course) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [course, onClose]);

  const exams: Exam[] = course ? all.filter((e) => e.courseId === course.id).sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title)) : [];
  const topics = course ? trailTopics(course) : [];
  const live = new Set(topics.map((t) => t.id));
  const add = () => {
    if (!course || !title.trim() || !date) return;
    addExam(course.id, title.trim(), date, topicIds);
    setTitle("");
    setDate("");
    setTopicIds([]);
  };

  return (
    <AnimatePresence>
      {course && (
        <motion.div key="overlay" className="fixed inset-0 z-50 flex items-center justify-center bg-prussian/70 p-6" variants={overlayFade} initial="hidden" animate="show" exit="exit" onClick={onClose}>
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="exams-title"
            variants={popIn}
            initial="hidden"
            animate="show"
            exit="exit"
            onClick={(e) => e.stopPropagation()}
            className="relative flex max-h-full w-[620px] max-w-full flex-col overflow-y-auto rounded-[32px] bg-parchment px-[36px] pb-[32px] pt-[36px] lip-8 lip-alice"
            data-part="exams-modal"
          >
            <RoundButton size={44} label="Close" onClick={onClose} className="absolute right-[24px] top-[24px]">
              <IconClose size={20} />
            </RoundButton>
            <h2 id="exams-title" className="pr-[56px] text-[28px] font-semibold text-prussian">
              {course.name} exams
            </h2>
            <p className="mt-[8px] text-[15px] font-medium text-wisteria-deep">Exams show on your calendar, and Orca steps up review before each one. Pick the topics an exam covers if you know them.</p>

            <ul className="mt-[24px] flex flex-col gap-[10px]" aria-label="Exams">
              {exams.length === 0 && <li className="text-[15px] font-medium text-prussian">No exams yet.</li>}
              {exams.map((e) => (
                <li key={e.id} className="flex flex-col gap-[8px] rounded-[16px] bg-alice px-[14px] py-[10px]" data-part="exam">
                  <div className="flex items-center gap-[10px]">
                  <input
                    defaultValue={e.title}
                    aria-label="Exam name"
                    className={`${FIELD} min-w-0 flex-1`}
                    onBlur={(ev) => {
                      const next = ev.target.value.trim();
                      if (!next) ev.target.value = e.title;
                      else if (next !== e.title) updateExam(e.id, { title: next });
                    }}
                    onKeyDown={(ev) => ev.key === "Enter" && ev.currentTarget.blur()}
                  />
                  <input type="date" value={e.date} aria-label="Exam date" className={`${FIELD} w-[160px]`} onChange={(ev) => ev.target.value && updateExam(e.id, { date: ev.target.value })} />
                  <Button size="sm" variant="danger" onClick={() => removeExam(e.id)} aria-label={`Delete ${e.title}`}>
                    Delete
                  </Button>
                  </div>
                  <TopicPicker topics={topics} chosen={e.topicIds.filter((id) => live.has(id))} onToggle={(id) => updateExam(e.id, { topicIds: toggled(e.topicIds.filter((x) => live.has(x)), id) })} />
                </li>
              ))}
            </ul>

            <form
              className="mt-[22px] flex flex-wrap items-center gap-[10px] border-t-2 border-alice-deep pt-[20px]"
              onSubmit={(ev) => {
                ev.preventDefault();
                add();
              }}
            >
              <input value={title} onChange={(ev) => setTitle(ev.target.value)} placeholder="e.g. Midterm 2" aria-label="New exam name" className={`${FIELD} min-w-0 flex-1`} />
              <input type="date" value={date} min={toISODate(new Date())} onChange={(ev) => setDate(ev.target.value)} aria-label="New exam date" className={`${FIELD} w-[160px]`} />
              <Button size="sm" type="submit" disabled={!title.trim() || !date} icon={<IconPlus size={16} />}>
                Add New Exam
              </Button>
              {topics.length > 0 && (
                <div className="flex w-full flex-col gap-[6px]">
                  <span className="text-[13px] font-semibold text-wisteria-deep">Topics it covers (optional)</span>
                  <TopicPicker topics={topics} chosen={topicIds} onToggle={(id) => setTopicIds((ids) => toggled(ids, id))} />
                </div>
              )}
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
