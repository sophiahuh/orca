import test from "node:test";
import assert from "node:assert/strict";
import { DEAD_RUN_ERROR, DEAD_RUN_MS, type Dispatch, HANDOFF_MS, NEVER_STARTED_ERROR, STOPPED_ERROR, type StartDeps, pauseUploadRuns, resumeNext, stopRun, startDeepReviewJob, startTopUpJob, startUploadJob } from "../../src/lib/jobs/start.ts";

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

test("two uploads started together run oldest first: both requests hand off the earlier run, the later one stays queued", async () => {
  const m2 = { id: "m2", owner_id: OWNER, course_id: "c1", status: "ready" };
  const f = fakeDb({ materials: [material, m2], material_pages: [page, { ...page, material_id: "m2" }], pipeline_runs: [] });
  let n = 0;
  const { deps: d, sent } = deps(f.db, "claude-opus-5-5");
  d.newId = () => `run-${++n}`;
  // Interleaved: each request inserts its run before either one decides what to start.
  const [first, second] = await Promise.all([startUploadJob(d, OWNER, "m1"), startUploadJob(d, OWNER, "m2")]);
  assert.deepEqual(first, { state: "started", runId: "run-1" });
  assert.deepEqual(second, { state: "queued", runId: "run-2" });
  assert.ok(sent.length > 0 && sent.every((s) => s.job.runId === "run-1"), "only the earlier upload is handed off");
  assert.equal(f.tables.pipeline_runs.find((r) => r.id === "run-2")!.status, "queued");
});

test("a run handed to a job that never claimed it is failed after HANDOFF_MS, and uploading again starts a new one", async () => {
  const at = new Date(now.getTime() - HANDOFF_MS - 1000).toISOString();
  const dropped = { id: "run-dropped", owner_id: OWNER, course_id: "c1", material_id: "m1", kind: "upload", status: "queued", at, started_at: at };
  const f = fakeDb({ materials: [material], material_pages: [page], pipeline_runs: [dropped] });
  const { deps: d, sent } = deps(f.db, "claude-opus-5-5");
  assert.deepEqual(await startUploadJob(d, OWNER, "m1"), { state: "started", runId: "run-new" });
  assert.equal(dropped.status, "failed");
  assert.equal((dropped as Row).error, NEVER_STARTED_ERROR);
  assert.deepEqual(sent, [{ kind: "material", job: { ownerId: OWNER, runId: "run-new", materialId: "m1" } }]);
});

test("a hand-off stamps started_at, so a recently handed-off run is left to its job and re-uploading hands it off again", async () => {
  const f = fakeDb({ materials: [material], material_pages: [page], pipeline_runs: [] });
  const { deps: d, sent } = deps(f.db, "claude-opus-5-5");
  await startUploadJob(d, OWNER, "m1");
  const run = f.tables.pipeline_runs[0];
  assert.equal(run.started_at, now.toISOString());
  assert.equal(run.status, "queued");
  // Still unclaimed a minute later: handed off again (the claim takes it once), not failed.
  d.now = () => new Date(now.getTime() + 60_000);
  assert.deepEqual(await startUploadJob(d, OWNER, "m1"), { state: "started", runId: "run-new" });
  assert.equal(run.status, "queued");
  assert.equal(run.started_at, new Date(now.getTime() + 60_000).toISOString());
  assert.equal(sent.length, 2);
});

test("a top-up handed off at once is stamped; one queued behind another job isn't until it's handed off", async () => {
  const f = fakeDb({ session_results: [session], pipeline_runs: [] });
  const { deps: d } = deps(f.db, "claude-opus-5-5");
  await startTopUpJob(d, OWNER, { courseId: "c1", sessionId: "sess-1", objectiveIds: ["o1"] });
  assert.equal(f.tables.pipeline_runs[0].started_at, now.toISOString());
  const busy = { id: "run-busy", owner_id: OWNER, course_id: "c2", material_id: "m0", kind: "upload", status: "running", at: now.toISOString(), started_at: now.toISOString() };
  const g = fakeDb({ session_results: [session], pipeline_runs: [busy] });
  const { deps: e } = deps(g.db, "claude-opus-5-5");
  await startTopUpJob(e, OWNER, { courseId: "c1", sessionId: "sess-1", objectiveIds: ["o1"] });
  assert.equal(g.tables.pipeline_runs.find((r) => r.kind === "top-up")!.started_at, undefined);
});

test("a Dive In starts at once beside a running upload, never queued behind it", async () => {
  const course = { id: "c1", owner_id: OWNER };
  const upload = { id: "run-up", owner_id: OWNER, course_id: "c1", material_id: "m1", kind: "upload", status: "running", at: now.toISOString(), started_at: now.toISOString() };
  const f = fakeDb({ courses: [course], pipeline_runs: [upload] });
  const { deps: d, sent } = deps(f.db, "gpt-6.1-sol");
  assert.deepEqual(await startDeepReviewJob(d, OWNER, { courseId: "c1", minutes: 10, objectiveIds: ["o1"] }), { state: "started", runId: "run-new" });
  assert.deepEqual(sent, [{ kind: "deep-review", job: { ownerId: OWNER, runId: "run-new", objectiveIds: ["o1"], minutes: 10 } }]);
  assert.ok(f.tables.pipeline_runs.find((r) => r.id === "run-new")!.started_at, "handed off, so a dropped hand-off is caught by HANDOFF_MS");
});

test("a Dive In queued behind an upload before the fix is handed off when the student starts it again", async () => {
  const course = { id: "c1", owner_id: OWNER };
  const upload = { id: "run-up", owner_id: OWNER, course_id: "c1", material_id: "m1", kind: "upload", status: "running", at: now.toISOString(), started_at: now.toISOString() };
  const stuck = { id: "run-dive", owner_id: OWNER, course_id: "c1", material_id: null, kind: "deep-review", status: "queued", at: now.toISOString(), started_at: null, objective_ids: ["o1"], deep_minutes: 10 };
  const f = fakeDb({ courses: [course], pipeline_runs: [upload, stuck] });
  const { deps: d, sent } = deps(f.db, "gpt-6.1-sol");
  assert.deepEqual(await startDeepReviewJob(d, OWNER, { courseId: "c1", minutes: 10, objectiveIds: ["o1"] }), { state: "started", runId: "run-dive" });
  assert.deepEqual(sent, [{ kind: "deep-review", job: { ownerId: OWNER, runId: "run-dive", objectiveIds: ["o1"], minutes: 10 } }]);
});

test("a running Dive In doesn't hold back the student's queued upload", async () => {
  const dive = { id: "run-dive", owner_id: OWNER, course_id: "c1", material_id: null, kind: "deep-review", status: "running", at: now.toISOString(), started_at: now.toISOString(), objective_ids: ["o1"], deep_minutes: 10 };
  const queued = { id: "run-up", owner_id: OWNER, course_id: "c1", material_id: "m1", kind: "upload", status: "queued", at: now.toISOString(), started_at: null };
  const f = fakeDb({ pipeline_runs: [dive, queued] });
  const { deps: d, sent } = deps(f.db, "gpt-6.1-sol");
  assert.deepEqual(await resumeNext(d, OWNER), { kind: "material", job: { ownerId: OWNER, runId: "run-up", materialId: "m1" } });
  assert.deepEqual(sent.map((s) => s.kind), ["material"]);
});

test("a queued upload can be paused: it leaves the queue (never taken for dead, nothing waits behind it) and uploading its file again resumes it in line", async () => {
  const running = { id: "run-a", owner_id: OWNER, course_id: "c1", material_id: "m0", kind: "upload", status: "running", at: "2026-10-05T10:00:00.000Z", started_at: "2026-10-05T11:59:00.000Z" };
  const queued = { id: "run-b", owner_id: OWNER, course_id: "c1", material_id: "m1", kind: "upload", status: "queued", at: "2026-10-05T10:01:00.000Z", started_at: null };
  const { db, tables } = fakeDb({ pipeline_runs: [running, queued], materials: [material], material_pages: [page] });
  const { deps: d, sent } = deps(db, "claude");
  // Only queued runs pause; the running one is the job's.
  assert.equal(await pauseUploadRuns(d, OWNER, { courseId: "c1" }, true), 1);
  assert.deepEqual(tables.pipeline_runs.map((r) => r.status), ["running", "paused"]);
  // The running job finishes: resumeNext skips the paused run (nothing to start).
  tables.pipeline_runs[0].status = "done";
  assert.equal(await resumeNext(d, OWNER), null);
  assert.equal(sent.length, 0);
  // A new upload doesn't wait behind a paused one: it starts at once.
  tables.materials.push({ id: "m2", owner_id: OWNER, course_id: "c1", status: "ready" });
  tables.material_pages.push({ owner_id: OWNER, material_id: "m2", n: 1 });
  assert.deepEqual(await startUploadJob(d, OWNER, "m2"), { state: "started", runId: "run-new" });
  tables.pipeline_runs.find((r) => r.id === "run-new")!.status = "done";
  // Re-uploading the paused file resumes its run (no second run) and, with nothing running, starts it.
  assert.deepEqual(await startUploadJob(d, OWNER, "m1"), { state: "started", runId: "run-b" });
  assert.equal(tables.pipeline_runs.filter((r) => r.material_id === "m1").length, 1);
  assert.deepEqual(sent.map((s) => s.job.runId), ["run-new", "run-b"]);
});

test("resuming puts paused uploads back in the queue, oldest first; a resumed run only starts when nothing is running", async () => {
  const running = { id: "run-a", owner_id: OWNER, course_id: "c1", material_id: "m0", kind: "upload", status: "running", at: "2026-10-05T10:00:00.000Z", started_at: "2026-10-05T11:59:00.000Z" };
  const p1 = { id: "run-b", owner_id: OWNER, course_id: "c1", material_id: "m1", kind: "upload", status: "paused", at: "2026-10-05T10:01:00.000Z", started_at: null };
  const p2 = { id: "run-c", owner_id: OWNER, course_id: "c1", material_id: "m2", kind: "upload", status: "paused", at: "2026-10-05T10:02:00.000Z", started_at: null };
  const { db, tables } = fakeDb({ pipeline_runs: [running, p1, p2] });
  const { deps: d, sent } = deps(db, "claude");
  assert.equal(await pauseUploadRuns(d, OWNER, { runId: "run-c" }, false), 1);
  assert.deepEqual(tables.pipeline_runs.map((r) => r.status), ["running", "paused", "queued"]);
  assert.equal(await resumeNext(d, OWNER), null, "still running: the resumed run waits its turn");
  tables.pipeline_runs[0].status = "done";
  assert.equal(await pauseUploadRuns(d, OWNER, { courseId: "c1" }, false), 1);
  const next = await resumeNext(d, OWNER);
  assert.equal(next?.job.runId, "run-b", "oldest first, by upload time");
  assert.deepEqual(sent.map((s) => s.job.runId), ["run-b"]);
});

test("a student can stop an upload's run at any stage: it is failed with the stopped message and the next queued job starts; a finished run can't be stopped", async () => {
  const running = { id: "run-a", owner_id: OWNER, course_id: "c1", material_id: "m0", kind: "upload", status: "running", at: "2026-10-05T10:00:00.000Z", started_at: "2026-10-05T11:59:00.000Z" };
  const queued = { id: "run-b", owner_id: OWNER, course_id: "c1", material_id: "m1", kind: "upload", status: "queued", at: "2026-10-05T10:01:00.000Z", started_at: null };
  const done = { id: "run-c", owner_id: OWNER, course_id: "c1", material_id: "m2", kind: "upload", status: "done", at: "2026-10-05T09:00:00.000Z", started_at: null };
  const other = { id: "run-x", owner_id: "someone-else", course_id: "c9", material_id: "m9", kind: "upload", status: "running", at: "2026-10-05T10:00:00.000Z", started_at: "2026-10-05T11:59:00.000Z" };
  const { db, tables } = fakeDb({ pipeline_runs: [running, queued, done, other] });
  const { deps: d, sent } = deps(db, "claude");
  assert.equal(await stopRun(d, OWNER, "run-c"), false, "finished: nothing to stop");
  assert.equal(await stopRun(d, OWNER, "run-x"), false, "not this student's");
  assert.equal(await stopRun(d, OWNER, "run-a"), true);
  assert.equal(tables.pipeline_runs[0].status, "failed");
  assert.equal(tables.pipeline_runs[0].error, STOPPED_ERROR);
  const next = await resumeNext(d, OWNER);
  assert.equal(next?.job.runId, "run-b", "the queue moves on");
  assert.deepEqual(sent.map((s) => s.job.runId), ["run-b"]);
  assert.equal(tables.pipeline_runs[3].status, "running", "the other student's run is untouched");
});
