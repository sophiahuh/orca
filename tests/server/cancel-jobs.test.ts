import test from "node:test";
import assert from "node:assert/strict";
import { cancelJobs } from "../../src/lib/server/jobs/start.ts";

type Row = { id: string; owner_id: string; job_id: string | null };

/** The one query cancelJobs makes: select id, job_id … eq owner … in ids. */
function fakeDb(rows: Row[]) {
  const q = {
    rows,
    select: () => q,
    eq: (k: keyof Row, v: string) => ((q.rows = q.rows.filter((r) => r[k] === v)), q),
    in: (k: keyof Row, vs: string[]) => ((q.rows = q.rows.filter((r) => vs.includes(r[k] as string))), q),
    then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: q.rows, error: null }).then(ok),
  };
  return { from: () => q } as unknown as Parameters<typeof cancelJobs>[0];
}

test("stopping or removing cancels the Trigger runs behind the pipeline runs, by stored job id; unknown ones are ignored; inline mode cancels nothing", async () => {
  const rows: Row[] = [
    { id: "r1", owner_id: "me", job_id: "run_a" },
    { id: "r2", owner_id: "me", job_id: null },
    { id: "r3", owner_id: "me", job_id: "run_gone" },
    { id: "r4", owner_id: "other", job_id: "run_x" },
  ];
  const before = process.env.ORCA_JOBS;
  process.env.ORCA_JOBS = "trigger";
  try {
    const cancelled: string[] = [];
    const cancel = async (id: string) => {
      if (id === "run_gone") throw new Error("not found");
      cancelled.push(id);
    };
    assert.equal(await cancelJobs(fakeDb(rows), "me", ["r1", "r2", "r3", "r4"], cancel), 1);
    assert.deepEqual(cancelled, ["run_a"], "only the student's own runs with a job id, and a failed cancel is ignored");
    process.env.ORCA_JOBS = "inline";
    assert.equal(await cancelJobs(fakeDb(rows), "me", ["r1"], cancel), 0, "inline: nothing to cancel");
    assert.deepEqual(cancelled, ["run_a"]);
  } finally {
    if (before === undefined) delete process.env.ORCA_JOBS;
    else process.env.ORCA_JOBS = before;
  }
});
