"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { type Course, toISODate } from "@/lib/data";
import { IconClose, IconPlus } from "@/components/icons";
import { Button } from "@/components/ui/Button";
import { RoundButton } from "@/components/ui/RoundButton";
import { useOrca } from "@/lib/store";
import { overlayFade, popIn } from "@/lib/motion";

const FIELD = "h-[40px] rounded-[12px] border-2 border-alice-deep bg-parchment px-[12px] text-[15px] font-semibold text-prussian focus:border-wisteria focus:outline-none";

/**
 * A course's exams: add one, rename it, move its date or delete it. Exams are the course's calendar
 * entries of kind "exam", so the calendar and the exam-review cadence follow every change.
 */
export function ExamsModal({ course, onClose }: { course: Course | null; onClose: () => void }) {
  const { events, addExam, updateExam, removeExam } = useOrca();
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");

  useEffect(() => {
    if (!course) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [course, onClose]);

  const exams = course ? events.filter((e) => e.kind === "exam" && e.courseId === course.id).sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title)) : [];
  const add = () => {
    if (!course || !title.trim() || !date) return;
    addExam(course.id, title.trim(), date);
    setTitle("");
    setDate("");
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
            <p className="mt-[8px] text-[15px] font-medium text-wisteria-deep">Exams show on your calendar, and Orca steps up exam review before each one.</p>

            <ul className="mt-[24px] flex flex-col gap-[10px]" aria-label="Exams">
              {exams.length === 0 && <li className="text-[15px] font-medium text-prussian">No exams yet.</li>}
              {exams.map((e) => (
                <li key={e.id} className="flex items-center gap-[10px] rounded-[16px] bg-alice px-[14px] py-[10px]" data-part="exam">
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
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
