import test from "node:test";
import assert from "node:assert/strict";
import { dayStartIn, judgeBudget } from "../../src/lib/jobs/budget.ts";

const limits = { pagesPerDay: 300, tokensPerDay: 2_000_000, globalUsdPerDay: 50 };

test("a job starts when it fits, and waits for the first limit it would break: global, then tokens, then pages", () => {
  assert.deepEqual(judgeBudget({ pages: 100, tokens: 500_000, globalUsd: 10 }, 150, limits), { ok: true });
  assert.deepEqual(judgeBudget({ pages: 100, tokens: 500_000, globalUsd: 10 }, 201, limits), { ok: false, reason: "daily-pages", message: "Daily limit reached: processing resumes tomorrow." });
  assert.equal(judgeBudget({ pages: 0, tokens: 2_000_000, globalUsd: 0 }, 1, limits).ok, false);
  assert.equal((judgeBudget({ pages: 0, tokens: 2_000_000, globalUsd: 0 }, 1, limits) as { reason: string }).reason, "daily-tokens");
  assert.equal((judgeBudget({ pages: 0, tokens: 0, globalUsd: 50 }, 1, limits) as { reason: string }).reason, "global-budget");
  // A top-up sends no counted pages: only the token and global limits apply to it.
  assert.deepEqual(judgeBudget({ pages: 300, tokens: 0, globalUsd: 0 }, 0, limits), { ok: true });
  // No global ceiling configured: only per-student limits.
  assert.deepEqual(judgeBudget({ pages: 0, tokens: 0, globalUsd: 1e9 }, 1, { ...limits, globalUsdPerDay: null }), { ok: true });
});

test("the student's day starts at their midnight, across daylight saving changes", () => {
  assert.equal(dayStartIn("UTC", new Date("2026-10-05T23:59:59.500Z")).toISOString(), "2026-10-05T00:00:00.000Z");
  // New York, EDT (UTC-4): 2026-10-05 03:59Z is still 2026-10-04 locally.
  assert.equal(dayStartIn("America/New_York", new Date("2026-10-05T03:59:00Z")).toISOString(), "2026-10-04T04:00:00.000Z");
  assert.equal(dayStartIn("America/New_York", new Date("2026-10-05T04:00:00Z")).toISOString(), "2026-10-05T04:00:00.000Z");
  // Spring forward (2026-03-08): the afternoon of a 23-hour day still starts at local midnight (05:00Z).
  assert.equal(dayStartIn("America/New_York", new Date("2026-03-08T20:00:00Z")).toISOString(), "2026-03-08T05:00:00.000Z");
  // Fall back (2026-11-01): a 25-hour day starts at 04:00Z.
  assert.equal(dayStartIn("America/New_York", new Date("2026-11-02T03:00:00Z")).toISOString(), "2026-11-01T04:00:00.000Z");
  assert.equal(dayStartIn("Asia/Kolkata", new Date("2026-10-05T18:30:00Z")).toISOString(), "2026-10-05T18:30:00.000Z");
  assert.throws(() => dayStartIn("Mars/Olympus_Mons", new Date()), RangeError);
});
