import test from "node:test";
import assert from "node:assert/strict";
import { DEAD_RUN_ERROR, DEAD_RUN_MS, type Dispatch, type StartDeps, resumeNext, startTopUpJob, startUploadJob } from "../../src/lib/jobs/start.ts";

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
      neq: (k: string, v: unknown) => (filters.push((r) => r[k] !== v), q),
      gte: (k: string, v: string) => (filters.push((r) => (r[k] as string) >= v), q),
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
  const d: StartDeps = { db, model, now: () => now, newId: () => "run-new", dispatch: async (x: Dispatch) => (sent.push(x), dispatch(x)) };
  return { deps: d, sent };
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
  const dead = { id: "run-dead", owner_id: OWNER, course_id: "c1", material_id: "m1", kind: "upload", status: "running", at, started_at: at };
  const f = fakeDb({ materials: [material], material_pages: [page], pipeline_runs: [dead] });
  const { deps: d } = deps(f.db, "claude-opus-5-5");
  assert.deepEqual(await startUploadJob(d, OWNER, "m1"), { state: "started", runId: "run-new" });
  assert.equal(dead.status, "failed");
  assert.equal((dead as Row).error, DEAD_RUN_ERROR);
});

test("a recent run is still followed, and another student's dead run is left alone", async () => {
  const old = new Date(now.getTime() - DEAD_RUN_MS.upload - 1000).toISOString();
  const mine = { id: "run-live", owner_id: OWNER, course_id: "c1", material_id: "m1", kind: "upload", status: "running", at: new Date(now.getTime() - 60_000).toISOString(), started_at: new Date(now.getTime() - 60_000).toISOString() };
  const theirs = { id: "run-theirs", owner_id: "owner-2", course_id: "c9", material_id: "m1", kind: "upload", status: "running", at: old, started_at: old };
  const f = fakeDb({ materials: [material], material_pages: [page], pipeline_runs: [mine, theirs] });
  const { deps: d, sent } = deps(f.db, "claude-opus-5-5");
  assert.deepEqual(await startUploadJob(d, OWNER, "m1"), { state: "running", runId: "run-live" });
  assert.equal(theirs.status, "running");
  assert.deepEqual(sent, []);
});

test("a run waiting for tomorrow's limit is never taken for dead; re-uploading its file says it is waiting, or starts it once the limit allows", async () => {
  const at = new Date(now.getTime() - 10 * DEAD_RUN_MS.upload).toISOString();
  const waiting = { id: "run-wait", owner_id: OWNER, course_id: "c1", material_id: "m1", kind: "upload", status: "waiting", at };
  const f = fakeDb({ materials: [material], material_pages: [page], pipeline_runs: [waiting] });
  const { deps: d, sent } = deps(f.db, "claude-opus-5-5");
  d.budget = async () => ({ ok: false, reason: "daily-pages", message: "held" });
  assert.deepEqual(await startUploadJob(d, OWNER, "m1"), { state: "waiting", runId: "run-wait" });
  assert.equal(waiting.status, "waiting");
  assert.deepEqual(sent, []);
  // Tomorrow: the same re-upload starts it.
  d.budget = async () => ({ ok: true });
  assert.deepEqual(await startUploadJob(d, OWNER, "m1"), { state: "started", runId: "run-wait" });
  assert.equal(waiting.status, "queued", "back to queued for the job to claim");
  assert.equal(sent.length, 1);
});

/* ── Review fixes (Wave 3): dead runs are judged from when they were claimed, for the whole student ── */

test("a run that queued for an hour and started recently is alive: re-uploading its file follows it, nothing is paid twice", async () => {
  const created = new Date(now.getTime() - 2 * DEAD_RUN_MS.upload).toISOString();
  const claimed = new Date(now.getTime() - 5 * 60_000).toISOString();
  const live = { id: "run-slow", owner_id: OWNER, course_id: "c1", material_id: "m1", kind: "upload", status: "running", at: created, started_at: claimed };
  const f = fakeDb({ materials: [material], material_pages: [page], pipeline_runs: [live] });
  const { deps: d, sent } = deps(f.db, "claude-opus-5-5");
  assert.deepEqual(await startUploadJob(d, OWNER, "m1"), { state: "running", runId: "run-slow" });
  assert.equal(live.status, "running");
  assert.deepEqual(sent, []);
});

test("a dead run of another material is failed when the student starts anything, so it can't block them for good", async () => {
  const old = new Date(now.getTime() - DEAD_RUN_MS.upload - 1000).toISOString();
  const dead = { id: "run-dead", owner_id: OWNER, course_id: "c1", material_id: "m0", kind: "upload", status: "running", at: old, started_at: old };
  const f = fakeDb({ materials: [material, { id: "m0", owner_id: OWNER, course_id: "c1", status: "ready" }], material_pages: [page], pipeline_runs: [dead] });
  const { deps: d, sent } = deps(f.db, "claude-opus-5-5");
  assert.deepEqual(await startUploadJob(d, OWNER, "m1"), { state: "started", runId: "run-new" });
  assert.equal(dead.status, "failed");
  assert.equal(sent.length, 1);
  // A dead top-up is judged by its own, shorter, limit, also from resumeNext.
  const deadTopUp = { id: "run-t", owner_id: OWNER, course_id: "c1", material_id: null, kind: "top-up", status: "running", at: old, started_at: new Date(now.getTime() - DEAD_RUN_MS["top-up"] - 1000).toISOString() };
  f.tables.pipeline_runs.push(deadTopUp);
  f.tables.pipeline_runs.find((r) => r.id === "run-new")!.status = "done";
  assert.equal(await resumeNext(d, OWNER), null);
  assert.equal(deadTopUp.status, "failed");
});

test("an orphaned queued run (nothing running) is started when the student next starts a job, and the new one queues behind it", async () => {
  const orphan = { id: "run-orphan", owner_id: OWNER, course_id: "c1", material_id: "m0", kind: "upload", status: "queued", at: new Date(now.getTime() - 3_600_000).toISOString() };
  const f = fakeDb({ materials: [material, { id: "m0", owner_id: OWNER, course_id: "c1", status: "ready" }], material_pages: [page], pipeline_runs: [orphan] });
  const { deps: d, sent } = deps(f.db, "claude-opus-5-5");
  assert.deepEqual(await startUploadJob(d, OWNER, "m1"), { state: "queued", runId: "run-new" });
  assert.deepEqual(sent, [{ kind: "material", job: { ownerId: OWNER, runId: "run-orphan", materialId: "m0" } }], "the oldest eligible run goes first");
});

test("a job queued behind a run that is only waiting for its budget starts at once when it fits itself", async () => {
  const held = { id: "run-held", owner_id: OWNER, course_id: "c1", material_id: "m0", kind: "upload", status: "waiting", at: new Date(now.getTime() - 60_000).toISOString() };
  const f = fakeDb({ session_results: [session], pipeline_runs: [held], material_pages: [{ owner_id: OWNER, material_id: "m0", n: 1 }] });
  const { deps: d, sent } = deps(f.db, "claude-opus-5-5");
  d.budget = async (_owner, pages) => (pages > 0 ? { ok: false, reason: "daily-pages", message: "held" } : { ok: true });
  assert.deepEqual(await startTopUpJob(d, OWNER, { courseId: "c1", sessionId: "sess-1", objectiveIds: ["o1"] }), { state: "started", runId: "run-new" });
  assert.deepEqual(sent, [{ kind: "top-up", job: { ownerId: OWNER, runId: "run-new", objectiveIds: ["o1"] } }]);
  assert.equal(held.status, "waiting");
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

/* ── One job at a time per student (decision 10) ── */

test("a second upload while another job is in flight is queued, not dispatched, and starts when resumeNext runs", async () => {
  const other = { id: "run-busy", owner_id: OWNER, course_id: "c1", material_id: "m0", kind: "upload", status: "running", at: now.toISOString() };
  const f = fakeDb({ materials: [material, { id: "m0", owner_id: OWNER, course_id: "c1", status: "ready" }], material_pages: [page], pipeline_runs: [other] });
  const { deps: d, sent } = deps(f.db, "claude-opus-5-5");
  assert.deepEqual(await startUploadJob(d, OWNER, "m1"), { state: "queued", runId: "run-new" });
  assert.deepEqual(sent, [], "nothing handed off while another job runs");
  assert.equal(f.tables.pipeline_runs.find((r) => r.id === "run-new")!.status, "queued");

  // The running job hasn't finished: nothing to resume.
  assert.equal(await resumeNext(d, OWNER), null);
  assert.deepEqual(sent, []);
  // It finishes: the queued one is handed off.
  other.status = "done";
  assert.deepEqual(await resumeNext(d, OWNER), { kind: "material", job: { ownerId: OWNER, runId: "run-new", materialId: "m1" } });
  assert.deepEqual(sent, [{ kind: "material", job: { ownerId: OWNER, runId: "run-new", materialId: "m1" } }]);
});

test("a queued top-up keeps its objectives on the run and is resumed with them, oldest first", async () => {
  const f = fakeDb({ session_results: [session], pipeline_runs: [{ id: "run-busy", owner_id: OWNER, course_id: "c1", material_id: "m0", kind: "upload", status: "running", at: now.toISOString() }] });
  const { deps: d, sent } = deps(f.db, "claude-opus-5-5");
  assert.deepEqual(await startTopUpJob(d, OWNER, { courseId: "c1", sessionId: "sess-1", objectiveIds: ["o1", "o2"] }), { state: "queued", runId: "run-new" });
  assert.deepEqual(f.tables.pipeline_runs.find((r) => r.id === "run-new")!.objective_ids, ["o1", "o2"]);
  f.tables.pipeline_runs[0].status = "failed";
  assert.deepEqual(await resumeNext(d, OWNER), { kind: "top-up", job: { ownerId: OWNER, runId: "run-new", objectiveIds: ["o1", "o2"] } });
  assert.deepEqual(sent.length, 1);
});

test("a waiting run resumes only when its budget allows; one still held is skipped for a later one that fits", async () => {
  const waitingUpload = { id: "run-wait", owner_id: OWNER, course_id: "c1", material_id: "m1", kind: "upload", status: "waiting", at: new Date(now.getTime() - 60_000).toISOString() };
  const queuedTopUp = { id: "run-top", owner_id: OWNER, course_id: "c1", material_id: null, kind: "top-up", status: "waiting", at: now.toISOString(), objective_ids: ["o1"] };
  const f = fakeDb({ materials: [material], material_pages: [page, { ...page, n: 2 }], pipeline_runs: [waitingUpload, queuedTopUp] });
  const asked: number[] = [];
  const { deps: d, sent } = deps(f.db, "claude-opus-5-5");
  d.budget = async (_owner, pages) => {
    asked.push(pages);
    return pages > 0 ? { ok: false, reason: "daily-pages", message: "Daily limit reached: processing resumes tomorrow." } : { ok: true };
  };
  // The upload (2 pages) is still held; the top-up (no pages) fits and goes.
  assert.deepEqual(await resumeNext(d, OWNER), { kind: "top-up", job: { ownerId: OWNER, runId: "run-top", objectiveIds: ["o1"] } });
  assert.deepEqual(asked, [2, 0]);
  assert.equal(waitingUpload.status, "waiting");
  assert.equal(queuedTopUp.status, "queued", "back to queued so the job can claim it");
  assert.equal(sent.length, 1);
  // Tomorrow: the upload fits too.
  d.budget = async () => ({ ok: true });
  queuedTopUp.status = "done";
  assert.deepEqual(await resumeNext(d, OWNER), { kind: "material", job: { ownerId: OWNER, runId: "run-wait", materialId: "m1" } });
});

test("a queued run is never taken for dead, however old: behind a running job it waits its turn, and alone (orphaned) it is started", async () => {
  const at = new Date(now.getTime() - 10 * DEAD_RUN_MS.upload).toISOString();
  const queued = { id: "run-q", owner_id: OWNER, course_id: "c1", material_id: "m1", kind: "upload", status: "queued", at };
  const busy = { id: "run-busy", owner_id: OWNER, course_id: "c1", material_id: "m0", kind: "upload", status: "running", at: now.toISOString(), started_at: now.toISOString() };
  const f = fakeDb({ materials: [material], material_pages: [page], pipeline_runs: [queued, busy] });
  const { deps: d, sent } = deps(f.db, "claude-opus-5-5");
  assert.deepEqual(await startUploadJob(d, OWNER, "m1"), { state: "queued", runId: "run-q" });
  assert.equal(queued.status, "queued");
  assert.deepEqual(sent, []);
  busy.status = "done";
  assert.deepEqual(await startUploadJob(d, OWNER, "m1"), { state: "started", runId: "run-q" });
  assert.deepEqual(sent, [{ kind: "material", job: { ownerId: OWNER, runId: "run-q", materialId: "m1" } }]);
});
