"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { IconClose } from "@/components/icons";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { RoundButton } from "@/components/ui/RoundButton";
import { overlayFade, popIn } from "@/lib/motion";

async function deleteCourseRequest(courseId: string) {
  const response = await fetch(`/api/courses/${encodeURIComponent(courseId)}`, { method: "DELETE" });
  const result = (await response.json().catch(() => null)) as { error?: string } | null;
  if (!response.ok) throw new Error(result?.error ?? "Orca couldn't delete this course.");
}

/**
 * "Delete this course" on a course's settings page, behind a confirmation. The course is
 * soft-deleted on the server (DELETE /api/courses/:id); `onDeleted` runs after it succeeds.
 */
export function DeleteCourse({ course, onDeleted }: { course: { id: string; name: string }; onDeleted: () => void }) {
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!open || deleting) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, deleting]);

  const close = () => {
    if (deleting) return;
    setOpen(false);
    setProblem(null);
  };
  const confirm = async () => {
    setDeleting(true);
    setProblem(null);
    try {
      await deleteCourseRequest(course.id);
      onDeleted();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "Orca couldn't delete this course.");
      setDeleting(false);
    }
  };

  return (
    <>
      <Card className="flex flex-col gap-[12px] px-[20px] pb-[22px] pt-[20px]">
        <div className="flex flex-col gap-[4px]">
          <h2 className="text-[22px] font-bold text-bad-text">Delete this course</h2>
          <p className="text-[14px] font-medium text-wisteria-deep">Removes the course, its topics, questions and progress from Orca, and stops any upload still being built.</p>
        </div>
        <Button size="sm" variant="danger" className="self-start" onClick={() => setOpen(true)} data-part="delete-course">
          Delete this course
        </Button>
      </Card>

      <AnimatePresence>
        {open && (
          <motion.div key="overlay" className="fixed inset-0 z-50 flex items-center justify-center bg-prussian/70 p-6" variants={overlayFade} initial="hidden" animate="show" exit="exit" onClick={close}>
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-labelledby="delete-course-title"
              variants={popIn}
              initial="hidden"
              animate="show"
              exit="exit"
              onClick={(e) => e.stopPropagation()}
              className="relative flex w-[520px] max-w-full flex-col items-center gap-[20px] rounded-[32px] bg-parchment px-[36px] pb-[32px] pt-[40px] text-center lip-8 lip-alice"
              data-part="delete-course-confirm"
            >
              <RoundButton size={44} label="Close" onClick={close} className="absolute right-[24px] top-[24px]">
                <IconClose size={20} />
              </RoundButton>
              <div className="flex flex-col gap-[6px] px-[40px]">
                <h2 id="delete-course-title" className="text-[28px] font-bold leading-tight text-prussian">
                  Delete {course.name}?
                </h2>
                <p className="text-[15px] font-medium text-wisteria-deep">Its island, topics, questions, exams and progress disappear from Orca. You can&apos;t undo this from the app.</p>
              </div>
              {problem && <p role="alert" className="text-[14px] font-semibold text-bad-text">{problem}</p>}
              <div className="flex items-center gap-[12px]">
                <Button size="sm" variant="ghost" onClick={close} disabled={deleting}>
                  Keep it
                </Button>
                <Button size="sm" variant="danger" onClick={() => void confirm()} disabled={deleting} data-part="delete-course-yes">
                  {deleting ? "Deleting…" : "Delete course"}
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
