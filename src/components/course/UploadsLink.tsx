"use client";

import Link from "next/link";
import { useOrca } from "@/lib/store";
import type { Course } from "@/lib/data";
import { courseUploads, pendingReview, uploadsInProgress } from "@/lib/course/review";
import { isFinished, useRun } from "@/hooks/useRun";

/**
 * The course's Uploads pill, beside Path | List | Atlas on all three. It follows the course's building
 * uploads (so the store reloads, and the badge drops, when one finishes) and opens the Uploads tab while
 * something is building or nothing waits for review, else the Review tab.
 */
export function UploadsLink({ course }: { course: Course }) {
  const { runs, objectives } = useOrca();
  const uploading = uploadsInProgress(runs, course.id);
  const toReview = pendingReview(course.topics, objectives[course.id] ?? {}).count;
  const label = "Uploads";
  return (
    <>
      {courseUploads(runs, course.id)
        .filter((u) => !isFinished(u))
        .map((u) => (
          <FollowRun key={u.id} runId={u.id} />
        ))}
      <Link
        href={`/course/${course.slug}/review${uploading > 0 || toReview === 0 ? "?tab=uploads" : "?tab=review"}`}
        aria-label={uploading > 0 ? `${label}, ${uploading} building` : label}
        className="pressable flex items-center gap-[6px] rounded-pill bg-parchment px-[14px] py-[7px] text-[13px] font-bold text-prussian ring-2 ring-inset ring-alice-deep lip-2 lip-alice"
        data-part="uploads-link"
      >
        {label}
        {uploading > 0 && <span className="flex h-[20px] min-w-[20px] items-center justify-center rounded-pill bg-wisteria px-[6px] text-[11px] font-bold text-parchment">{uploading}</span>}
      </Link>
    </>
  );
}

/** Follows one building upload (the store reloads when it finishes); draws nothing. */
function FollowRun({ runId }: { runId: string }) {
  useRun(runId);
  return null;
}
