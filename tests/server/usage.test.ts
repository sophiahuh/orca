import test from "node:test";
import assert from "node:assert/strict";
import { usageToday } from "../../src/lib/server/usage.ts";

/**
 * The daily sums behind the budgets (review fix, Wave 3): the pages of the run asking are the
 * `pages` the check adds, so a running run's pages are not counted again here, and the job and
 * `resumeNext` see the same number.
 */
type Row = Record<string, unknown>;

function fakeDb(tables: Record<string, Row[]>) {
  function from(table: string) {
    const rows = tables[table] ?? [];
    const filters: ((r: Row) => boolean)[] = [];
    let head = false;
    let single = false;
    const q = {
      select: (_cols?: string, o?: { head?: boolean }) => ((head = !!o?.head), q),
      eq: (k: string, v: unknown) => (filters.push((r) => r[k] === v), q),
      in: (k: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[k])), q),
      gte: (k: string, v: string) => (filters.push((r) => (r[k] as string) >= v), q),
      maybeSingle: () => ((single = true), q),
      then: (ok: (v: unknown) => unknown) => {
        const hit = rows.filter((r) => filters.every((f) => f(r)));
        return Promise.resolve(head ? { data: null, count: hit.length, error: null } : single ? { data: hit[0] ?? null, error: null } : { data: hit, error: null }).then(ok);
      },
    };
    return q;
  }
  return { from } as unknown as Parameters<typeof usageToday>[0];
}

const OWNER = "owner-1";
const now = new Date("2026-10-05T15:00:00.000Z");
const today = "2026-10-05T10:00:00.000Z";
const yesterday = "2026-10-04T10:00:00.000Z";
const run = (id: string, material: string, status: string, at = today) => ({ id, owner_id: OWNER, kind: "upload", material_id: material, status, at });
const pages = (material: string, n: number) => Array.from({ length: n }, (_, i) => ({ owner_id: OWNER, material_id: material, n: i + 1 }));

test("today's pages are those of finished uploads; the running run's own pages are not counted twice", async () => {
  const db = fakeDb({
    profiles: [{ owner_id: OWNER, timezone: "UTC" }],
    pipeline_runs: [run("a", "mA", "done"), run("b", "mB", "failed"), run("c", "mC", "running"), run("q", "mQ", "queued"), run("w", "mW", "waiting"), run("old", "mOld", "done", yesterday)],
    material_pages: [...pages("mA", 100), ...pages("mB", 100), ...pages("mC", 100), ...pages("mQ", 50), ...pages("mW", 50), ...pages("mOld", 100)],
    model_usage: [],
  });
  const used = await usageToday(db, OWNER, now);
  assert.equal(used.pages, 200, "A and B finished today; C is the job asking (its pages are added by the check); Q and W haven't run; Old was yesterday");
});

test("tokens are the student's for their day, spend is everyone's for the UTC day", async () => {
  const db = fakeDb({
    profiles: [{ owner_id: OWNER, timezone: "America/New_York" }],
    pipeline_runs: [],
    material_pages: [],
    model_usage: [
      { owner_id: OWNER, at: "2026-10-05T12:00:00.000Z", input_tokens: 100, output_tokens: 10, cache_write_tokens: 5, cache_read_tokens: 1, cost_usd: "0.5" },
      // 03:30Z is 23:30 the day before in New York: not the student's today, but today's UTC spend.
      { owner_id: OWNER, at: "2026-10-05T03:30:00.000Z", input_tokens: 1000, output_tokens: 0, cache_write_tokens: 0, cache_read_tokens: 0, cost_usd: "1.25" },
      { owner_id: "owner-2", at: "2026-10-05T14:00:00.000Z", input_tokens: 7, output_tokens: 7, cache_write_tokens: 0, cache_read_tokens: 0, cost_usd: "2" },
    ],
  });
  const used = await usageToday(db, OWNER, now);
  assert.equal(used.tokens, 116);
  assert.equal(used.globalUsd, 3.75);
});
