import test from "node:test";
import assert from "node:assert/strict";
import { DEAD_RUN_ERROR, DEAD_RUN_MS, type Dispatch, type StartDeps, startTopUpJob, startUploadJob } from "../../src/lib/jobs/start.ts";

type Row = Record<string, unknown>;

/**
 * Just enough of the Supabase query builder for src/lib/jobs/start.ts, over in-memory tables:
 * select/update/insert with eq, in, lt, order, limit, maybeSingle and a head count.
 */
function fakeDb(tables: Record<string, Row[]>, opts: { uniqueInFlight?: boolean } = {}) {
  const writes: { table: string; op: string; row: Row }[] = [];
  function from(table: string) {
    const rows = (tables[table] ??= []);
    const filters: ((r: Row) => boolean)[] = [];
    let op: "select" | "update" | "insert" = "select";
    let values: Row = {};
    let head = false;
    let single = false;
    const run = () => {
      if (op === "insert") {
        const live = (r: Row) => r.kind === values.kind && ["queued", "waiting", "running"].includes(r.status as string) && (r.kind === "upload" ? r.material_id === values.material_id : r.course_id === values.course_id);
        if (opts.uniqueInFlight !== false && table === "pipeline_runs" && rows.some(live)) return { data: null, error: { code: "23505", message: "duplicate" } };
        rows.push({ ...values });
        writes.push({ table, op, row: values });
        return { data: null, error: null };
      }
      const hit = rows.filter((r) => filters.every((f) => f(r)));
      if (op === "update") {
        for (const r of hit) Object.assign(r, values);
        for (const r of hit) writes.push({ table, op, row: { ...r } });
        return { data: hit, error: null };
      }
      if (head) return { data: null, count: hit.length, error: null };
      if (single) return { data: hit[0] ?? null, error: null };
      return { data: hit, error: null };
    };
    const q = {
      select(_cols?: string, o?: { head?: boolean }) {
        head = !!o?.head;
        return q;
      },
      update(v: Row) {
        op = "update";
        values = v;
        return q;
      },
      insert(v: Row) {
        op = "insert";
        values = v;
        return q;
      },
      eq: (k: string, v: unknown) => (filters.push((r) => r[k] === v), q),
      in: (k: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[k])), q),
      lt: (k: string, v: string) => (filters.push((r) => (r[k] as string) < v), q),
      order: () => q,
      limit: () => q,
      maybeSingle() {
        single = true;
        return q;
      },
      then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve().then(run).then(ok, bad),
    };
    return q;
  }
  return { db: { from } as unknown as StartDeps["db"], writes, tables };
}

const OWNER = "owner-1";
const now = new Date("2026-10-05T12:00:00.000Z");
const material = { id: "m1", owner_id: OWNER, course_id: "c1", status: "ready" };
const page = { owner_id: OWNER, material_id: "m1", n: 1 };
const session = { id: "s-row", owner_id: OWNER, course_id: "c1", session_id: "sess-1" };

function deps(db: StartDeps["db"], model: string | null, dispatch: (d: Dispatch) => Promise<void> = async () => {}) {
  const sent: Dispatch[] = [];
  return { deps: { db, model, now: () => now, newId: () => "run-new", dispatch: async (d: Dispatch) => (sent.push(d), dispatch(d)) } satisfies StartDeps, sent };
}

test("without a model key an upload answers no-model and queues nothing", async () => {
  const f = fakeDb({ materials: [material], material_pages: [page], pipeline_runs: [] });
  const { deps: d, sent } = deps(f.db, null);
  assert.deepEqual(await startUploadJob(d, OWNER, "m1"), { state: "no-model" });
  assert.equal(f.tables.pipeline_runs.length, 0);
  assert.deepEqual(sent, []);
});

test("without a model key a top-up answers no-model and queues nothing", async () => {
  const f = fakeDb({ session_results: [session], pipeline_runs: [] });
  const { deps: d, sent } = deps(f.db, null);
  assert.deepEqual(await startTopUpJob(d, OWNER, { courseId: "c1", sessionId: "sess-1", objectiveIds: [] }), { state: "no-model" });
  assert.equal(f.tables.pipeline_runs.length, 0);
  assert.deepEqual(sent, []);
});

test("with a key an upload queues one run and hands it off", async () => {
  const f = fakeDb({ materials: [material], material_pages: [page], pipeline_runs: [] });
  const { deps: d, sent } = deps(f.db, "claude-opus-5-5");
  assert.deepEqual(await startUploadJob(d, OWNER, "m1"), { state: "started", runId: "run-new" });
  assert.equal(f.tables.pipeline_runs.length, 1);
  assert.deepEqual(sent, [{ kind: "material", job: { ownerId: OWNER, runId: "run-new", materialId: "m1" } }]);
});

test("a run that died long ago is failed, and uploading again starts a new one", async () => {
  const at = new Date(now.getTime() - DEAD_RUN_MS.upload - 1000).toISOString();
  const dead = { id: "run-dead", owner_id: OWNER, course_id: "c1", material_id: "m1", kind: "upload", status: "running", at };
  const f = fakeDb({ materials: [material], material_pages: [page], pipeline_runs: [dead] });
  const { deps: d } = deps(f.db, "claude-opus-5-5");
  assert.deepEqual(await startUploadJob(d, OWNER, "m1"), { state: "started", runId: "run-new" });
  assert.equal(dead.status, "failed");
  assert.equal((dead as Row).error, DEAD_RUN_ERROR);
});

test("a recent run is still followed, and another student's dead run is left alone", async () => {
  const old = new Date(now.getTime() - DEAD_RUN_MS.upload - 1000).toISOString();
  const mine = { id: "run-live", owner_id: OWNER, course_id: "c1", material_id: "m1", kind: "upload", status: "running", at: new Date(now.getTime() - 60_000).toISOString() };
  const theirs = { id: "run-theirs", owner_id: "owner-2", course_id: "c9", material_id: "m1", kind: "upload", status: "running", at: old };
  const f = fakeDb({ materials: [material], material_pages: [page], pipeline_runs: [mine, theirs] });
  const { deps: d, sent } = deps(f.db, "claude-opus-5-5");
  assert.deepEqual(await startUploadJob(d, OWNER, "m1"), { state: "running", runId: "run-live" });
  assert.equal(theirs.status, "running");
  assert.deepEqual(sent, []);
});

test("a run waiting for tomorrow's limit is never taken for dead", async () => {
  const at = new Date(now.getTime() - 10 * DEAD_RUN_MS.upload).toISOString();
  const waiting = { id: "run-wait", owner_id: OWNER, course_id: "c1", material_id: "m1", kind: "upload", status: "waiting", at };
  const f = fakeDb({ materials: [material], material_pages: [page], pipeline_runs: [waiting] });
  const { deps: d } = deps(f.db, "claude-opus-5-5");
  assert.deepEqual(await startUploadJob(d, OWNER, "m1"), { state: "running", runId: "run-wait" });
  assert.equal(waiting.status, "waiting");
});

test("a hand-off that fails marks the run failed and says why", async () => {
  const f = fakeDb({ session_results: [session], pipeline_runs: [] });
  const { deps: d } = deps(f.db, "claude-opus-5-5", async () => {
    throw new Error("Trigger.dev is unreachable");
  });
  await assert.rejects(startTopUpJob(d, OWNER, { courseId: "c1", sessionId: "sess-1", objectiveIds: [] }), /couldn't start the job: Trigger.dev is unreachable/);
  assert.deepEqual(
    f.tables.pipeline_runs.map((r) => [r.status, r.error]),
    [["failed", "Orca couldn't start the job: Trigger.dev is unreachable"]],
  );
});
