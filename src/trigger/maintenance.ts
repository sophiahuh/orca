/**
 * Scheduled upkeep (`ORCA_JOBS=trigger`, production). Once a day, remove abandoned uploads and old
 * failed reads (`src/lib/material/cleanup.ts`): nothing a student can see is touched. The same
 * function runs by hand with `npm run cleanup:uploads`. Deployed with the jobs in Task 10.
 */
import { schedules } from "@trigger.dev/sdk";
import { cleanupUploads } from "@/lib/material/cleanup";
import { adminClient } from "@/lib/supabase/server";

export const cleanupUploadsTask = schedules.task({
  id: "cleanup-uploads",
  // 04:17 UTC daily: a quiet hour for students in the Americas, and not on the hour.
  cron: "17 4 * * *",
  maxDuration: 300,
  run: async () => {
    const { removed, failed } = await cleanupUploads(adminClient());
    return { removed: removed.length, failed };
  },
});
