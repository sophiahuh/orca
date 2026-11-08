import { dayStartIn } from "@/lib/jobs/budget";
import { LIMITS, globalDailyBudgetUsd } from "@/lib/limits";
import { forStudent, reply } from "@/lib/server/student";
import { timezoneOf, usageToday } from "@/lib/server/usage";

/**
 * GET → today's model use for the signed-in student against their daily caps (owner, 2026-11-08: the
 * home page shows it, so a held upload or dive is explained): pages and tokens used and allowed,
 * when the day resets (their timezone), and whether Orca's own daily budget is spent.
 */
export const runtime = "nodejs";

export function GET(request: Request) {
  return forStudent(request, async (student, db) => {
    const now = new Date();
    const timeZone = await timezoneOf(db, student.id);
    const used = await usageToday(db, student.id, now);
    const resetsAt = new Date(dayStartIn(timeZone, now).getTime() + 24 * 3600 * 1000).toISOString();
    const globalCap = globalDailyBudgetUsd();
    return reply(200, {
      pages: used.pages,
      pagesPerDay: LIMITS.pagesPerDay,
      tokens: used.tokens,
      tokensPerDay: LIMITS.tokensPerDay,
      resetsAt,
      timeZone,
      globalSpent: globalCap !== null && used.globalUsd >= globalCap,
    });
  });
}
