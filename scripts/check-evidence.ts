/**
 * Proves the evidence path over real HTTP: Orca's own routes (POST /api/evidence, GET /api/state)
 * on a Next dev server, against Supabase. Two throwaway accounts: A builds a small course the way
 * the browser does (REST and save_structure), answers through /api/evidence, and after every step
 * the snapshots /api/state returns are compared with a full replay of A's evidence log computed
 * here from the same pure fold. Forces version conflicts (concurrent answers), merges objectives,
 * adds a mechanism-tier question, bumps the rules version on a snapshot and changes the timezone,
 * and checks each marks the right snapshots stale and the next read rebuilds them. B and a
 * signed-out caller are refused.
 *
 *   npm run check:evidence                       # local stack; starts its own `next dev`
 *   ORCA_URL=http://localhost:3000 npm run check:evidence    # use a server that's already running
 *   SUPABASE_URL=… SUPABASE_PUBLISHABLE_KEY=… SUPABASE_SECRET_KEY=… ORCA_URL=… npm run check:evidence   # hosted
 *
 * The secret key is used only to create and delete the accounts and to stand in for a rules bump
 * (rewriting one snapshot's rules_version), never to read what a check compares. No model is called.
 */
import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { isDeepStrictEqual } from "node:util";
import { eventsCountingFor } from "../src/lib/mastery/attribution.ts";
import { RULES_VERSION, replayObjective } from "../src/lib/mastery/objective-state.ts";
import { courseView, eventFromRow } from "../src/lib/supabase/rows.ts";

function localEnv(): Record<string, string> {
  const out = execFileSync("npx", ["supabase", "status", "-o", "env"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  return Object.fromEntries(out.split("\n").flatMap((line) => {
    const m = /^([A-Z_]+)="?(.*?)"?$/.exec(line.trim());
    return m ? [[m[1], m[2]]] : [];
  }));
}

const env = process.env.SUPABASE_URL ? process.env : { ...localEnv(), ...process.env };
const SUPABASE = env.SUPABASE_URL ?? env.API_URL;
const PUBLISHABLE = env.SUPABASE_PUBLISHABLE_KEY ?? env.PUBLISHABLE_KEY;
const SECRET = env.SUPABASE_SECRET_KEY ?? env.SECRET_KEY;
if (!SUPABASE || !PUBLISHABLE || !SECRET) throw new Error("Set SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY, or start the local stack");

interface Reply {
  status: number;
  body: unknown;
}

async function call(base: string, path: string, opts: { method?: string; token?: string; key?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<Reply> {
  const headers: Record<string, string> = { ...opts.headers };
  if (base === SUPABASE) headers.apikey = opts.key ?? PUBLISHABLE!;
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  else if (opts.key === SECRET) headers.Authorization = `Bearer ${SECRET}`;
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(`${base}${path}`, { method: opts.method ?? "GET", headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  return { status: res.status, body: parsed };
}
const db = (path: string, opts: Parameters<typeof call>[2] = {}) => call(SUPABASE!, path, opts);

const results: Array<{ ok: boolean; name: string; detail: string }> = [];
function check(name: string, ok: boolean, detail: unknown) {
  results.push({ ok, name, detail: typeof detail === "string" ? detail : JSON.stringify(detail).slice(0, 400) });
}

async function createUser(label: string) {
  const email = `evidence-${label}-${randomUUID().slice(0, 8)}@example.com`;
  const password = `pw-${randomUUID()}`;
  const made = await db("/auth/v1/admin/users", { method: "POST", key: SECRET, body: { email, password, email_confirm: true, user_metadata: { timezone: "America/New_York" } } });
  if (made.status !== 200) throw new Error(`Couldn't create test user ${label}: ${made.status} ${JSON.stringify(made.body)}`);
  const session = await db("/auth/v1/token?grant_type=password", { method: "POST", body: { email, password } });
  if (session.status !== 200) throw new Error(`Couldn't sign in test user ${label}: ${session.status} ${JSON.stringify(session.body)}`);
  return { id: (made.body as { id: string }).id, token: (session.body as { access_token: string }).access_token };
}

/* ── The app server ── */

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once("error", reject);
    s.listen(0, () => {
      const { port } = s.address() as { port: number };
      s.close(() => resolve(port));
    });
  });
}

async function startApp(): Promise<{ url: string; stop: () => void }> {
  if (process.env.ORCA_URL) return { url: process.env.ORCA_URL.replace(/\/$/, ""), stop: () => {} };
  const port = await freePort();
  const child: ChildProcess = spawn("npx", ["next", "dev", "--port", String(port)], {
    env: {
      ...process.env,
      NEXT_PUBLIC_SUPABASE_URL: SUPABASE,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE,
      SUPABASE_SECRET_KEY: SECRET,
      // Never a model: these routes don't call one, and nothing here may spend.
      ANTHROPIC_API_KEY: "",
      OPENAI_API_KEY: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  let output = "";
  child.stdout!.on("data", (d) => (output += d));
  child.stderr!.on("data", (d) => (output += d));
  const stop = () => {
    try {
      process.kill(-child.pid!, "SIGTERM");
    } catch {
      /* already gone */
    }
  };
  const url = `http://localhost:${port}`;
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`next dev exited (${child.exitCode}):\n${output}`);
    try {
      // The first request compiles the route; a 401 means it's up and asking for a session.
      const res = await fetch(`${url}/api/state?course=${randomUUID()}`);
      if (res.status === 401) return { url, stop };
    } catch {
      /* not listening yet */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  stop();
  throw new Error(`next dev didn't answer within 3 minutes:\n${output}`);
}

/* ── The course A builds ── */

const ids = {
  course: randomUUID(),
  material: randomUUID(),
  topic: randomUUID(),
  o1: randomUUID(),
  o2: randomUUID(),
  q: [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()],
  mechanism: randomUUID(),
};

interface StateBody {
  rulesVersion: number;
  objectives: Array<{ objectiveId: string; accumulator: unknown; version: number; saved: boolean }>;
  rebuilt: string[];
}

async function main() {
  const app = await startApp();
  const A = await createUser("a");
  const B = await createUser("b");
  const api = (path: string, opts: Parameters<typeof call>[2] = {}) => call(app.url, path, opts);
  const answer = (token: string, q: string, outcome: string, over: Record<string, unknown> = {}) =>
    api("/api/evidence", { method: "POST", token, body: { kind: "answer", id: randomUUID(), courseId: ids.course, questionId: q, outcome, grader: "choice", source: "quiz", sessionId: "s1", ...over } });
  const state = async (token = A.token) => {
    const r = await api(`/api/state?course=${ids.course}`, { token });
    if (r.status !== 200) throw new Error(`GET /api/state answered ${r.status}: ${JSON.stringify(r.body)}`);
    return r.body as StateBody;
  };
  const snapshotRows = async () =>
    (await db(`/rest/v1/objective_state?course_id=eq.${ids.course}&select=objective_id,stale,version`, { token: A.token })).body as Array<{ objective_id: string; stale: boolean; version: number }>;
  const staleOf = async (id: string) => (await snapshotRows()).find((r) => r.objective_id === id)?.stale;

  /** A full replay of A's log, read as A through the REST API, with the course as it is now. */
  async function replay() {
    const read = async (path: string) => {
      const r = await db(path, { token: A.token });
      if (r.status !== 200) throw new Error(`${path}: ${r.status} ${JSON.stringify(r.body)}`);
      return r.body;
    };
    const [topics, objectives, questions, profile, log] = await Promise.all([
      read(`/rest/v1/topics?course_id=eq.${ids.course}&select=id,review,sort_order`),
      read(`/rest/v1/objectives?course_id=eq.${ids.course}&select=id,topic_id,name,review,merged_into`),
      read(`/rest/v1/questions?course_id=eq.${ids.course}&select=id,topic_id,objective_id,tier,sort_order`),
      read(`/rest/v1/profiles?select=timezone`),
      read(`/rest/v1/evidence_events?course_id=eq.${ids.course}&select=*&order=at,id`),
    ]);
    const view = courseView({ topics, objectives, questions, timezone: (profile as Array<{ timezone: string }>)[0].timezone } as Parameters<typeof courseView>[0]);
    const events = (log as Parameters<typeof eventFromRow>[0][]).map(eventFromRow);
    return new Map(
      [...view.attribution.objectives.values()].flatMap((o) => {
        const mine = eventsCountingFor(o.id, events, view.attribution);
        return mine.length ? [[o.id, replayObjective(o.id, mine, { hasMechanismQuestions: o.hasMechanismQuestions, dayKey: view.dayKey })]] : [];
      }),
    );
  }
  const sameAsReplay = async (label: string, s: StateBody) => {
    const expected = await replay();
    // Compared as values: jsonb doesn't keep key order, numbers must come back exactly.
    const got = new Map(s.objectives.map((o) => [o.objectiveId, o.accumulator]));
    const ok = expected.size === got.size && [...expected].every(([id, acc]) => isDeepStrictEqual(got.get(id), acc));
    check(`${label}: every snapshot equals a full replay of the log`, ok, { expected: Object.fromEntries(expected), got: Object.fromEntries(got) });
  };

  try {
    /* ── A builds a course ── */
    const prefer = { Prefer: "return=representation" };
    const course = await db("/rest/v1/courses", { method: "POST", token: A.token, headers: prefer, body: { id: ids.course, slug: "ald", name: "Advanced Logic Design", short: "ALD", variant: "ald", pos_x: 0, pos_y: 0, review_config: {}, weights: {} } });
    const material = await db("/rest/v1/materials", { method: "POST", token: A.token, body: { id: ids.material, course_id: ids.course, filename: "L01.pdf", type: "Lecture" } }); // a record without a file: only the server sets a storage path
    const question = (id: string, objective: string, n: number, tier = "retrieval") => ({
      id, topic_id: ids.topic, sort_order: n, objective_id: objective, kind: "True or false", tier, topic_name: "Boolean algebra",
      prompt: `Statement ${n}`, options: ["True", "False"], answer: 0, explanation: "e", anchor: { locator: `slide ${n}`, excerpt: "x" }, material_id: ids.material,
    });
    const saved = await db("/rest/v1/rpc/save_structure", {
      method: "POST",
      token: A.token,
      body: {
        course: ids.course,
        rows: {
          topics: [{ id: ids.topic, sort_order: 0, name: "Boolean algebra", review: "confirmed", pos_x: 0, pos_y: 0 }],
          objectives: [
            { id: ids.o1, topic_id: ids.topic, name: "Simplify", description: "d", origin: "material", review: "confirmed", material_id: ids.material },
            { id: ids.o2, topic_id: ids.topic, name: "Simplify expressions", description: "d", origin: "material", review: "confirmed", material_id: ids.material },
          ],
          questions: [question(ids.q[0], ids.o1, 0), question(ids.q[1], ids.o1, 1), question(ids.q[2], ids.o1, 2), question(ids.q[3], ids.o2, 3), question(ids.q[4], ids.o2, 4)],
        },
      },
    });
    if (course.status !== 201 || material.status !== 201 || ![200, 204].includes(saved.status)) {
      throw new Error(`A couldn't build the course: ${JSON.stringify({ course, material, saved })}`);
    }

    /* ── Refused: signed out, a bad token, B ── */
    const anon = await api("/api/evidence", { method: "POST", body: { kind: "answer", id: randomUUID(), courseId: ids.course, questionId: ids.q[0], outcome: "correct", grader: "choice", source: "quiz", sessionId: "s" } });
    check("signed out cannot record evidence", anon.status === 401, anon);
    const anonState = await api(`/api/state?course=${ids.course}`);
    check("signed out cannot read state", anonState.status === 401, anonState);
    const forged = await answer("not-a-real-token", ids.q[0], "correct");
    check("a forged token cannot record evidence", forged.status === 401, forged);
    const bAnswer = await answer(B.token, ids.q[0], "correct");
    check("B cannot record evidence in A's course", bAnswer.status === 404, bAnswer);
    const bState = await api(`/api/state?course=${ids.course}`, { token: B.token });
    check("B cannot read the state of A's course", bState.status === 404, bState);
    const bad = await api("/api/evidence", { method: "POST", token: A.token, body: { kind: "answer", id: "x", courseId: ids.course } });
    check("a malformed event is refused", bad.status === 400, bad);

    /* ── A answers ── */
    const sentAt = "2001-01-01T00:00:00.000Z";
    const first = await answer(A.token, ids.q[0], "correct", { at: sentAt, tier: "mechanism", objectiveId: ids.o2, topicId: randomUUID() });
    const firstBody = first.body as { event: { at: string; tier: string | null; objectiveId: string }; countsFor: string; snapshot: { version: number } };
    check("A's answer is recorded", first.status === 201, first);
    check("the server stamps the time, not the browser", first.status === 201 && firstBody.event.at !== sentAt && Math.abs(Date.parse(firstBody.event.at) - Date.now()) < 60_000, firstBody?.event);
    check("tier and objective come from the question, not the request", first.status === 201 && firstBody.event.tier === "retrieval" && firstBody.event.objectiveId === ids.o1, firstBody?.event);
    check("the first answer creates the snapshot at version 1", firstBody?.snapshot?.version === 1 && firstBody.countsFor === ids.o1, firstBody);
    for (const [q, outcome] of [[ids.q[1], "incorrect"], [ids.q[3], "correct"], [ids.q[4], "partial"]] as const) {
      const r = await answer(A.token, q, outcome);
      check(`A's ${outcome} answer is recorded`, r.status === 201, r);
    }
    const again = await api("/api/evidence", { method: "POST", token: A.token, body: { kind: "answer", id: (first.body as { event: { id: string } }).event.id, courseId: ids.course, questionId: ids.q[0], outcome: "correct", grader: "choice", source: "quiz", sessionId: "s1" } });
    check("the same event id can't be recorded twice", again.status === 409, again);
    const s1 = await state();
    check("state reads fresh snapshots without rebuilding", s1.rebuilt.length === 0 && s1.rulesVersion === RULES_VERSION, s1);
    await sameAsReplay("after four answers", s1);
    const bRows = await db(`/rest/v1/objective_state?select=objective_id`, { token: B.token });
    check("B reads none of A's snapshots through the REST API", bRows.status === 200 && Array.isArray(bRows.body) && bRows.body.length === 0, bRows);
    const direct = await db("/rest/v1/rpc/record_evidence", { method: "POST", token: A.token, body: { owner: A.id, event: {}, objective: ids.o1, accumulator: {}, rules_version: RULES_VERSION, expected_version: 1 } });
    check("A cannot call record_evidence directly", direct.status >= 400, direct);
    const directSave = await db("/rest/v1/rpc/save_snapshot", { method: "POST", token: A.token, body: { owner: A.id, objective: ids.o1, accumulator: {}, rules_version: RULES_VERSION, expected_version: 1 } });
    check("A cannot call save_snapshot directly", directSave.status >= 400, directSave);

    /* ── Version conflicts: two tabs answering at once ── */
    let conflicts = 0;
    let pairs = 0;
    let allRecorded = true;
    while (conflicts === 0 && pairs < 25) {
      pairs += 1;
      const both = await Promise.all([answer(A.token, ids.q[2], "correct", { sessionId: `tab1-${pairs}` }), answer(A.token, ids.q[1], "correct", { sessionId: `tab2-${pairs}` })]);
      for (const r of both) {
        if (r.status !== 201) allRecorded = false;
        else if ((r.body as { retried: boolean }).retried) conflicts += 1;
      }
    }
    check("concurrent answers to one objective hit a version conflict", conflicts > 0, `${pairs} concurrent pairs, ${conflicts} retried`);
    check("every concurrent answer was recorded (the loser retried from the log)", allRecorded, `${pairs} pairs`);
    await sameAsReplay("after concurrent answers", await state());

    /* ── A merge marks both objectives stale; the next read rebuilds ── */
    const merge = await db("/rest/v1/rpc/save_structure", { method: "POST", token: A.token, body: { course: ids.course, rows: { objectives: [{ id: ids.o2, merged_into: ids.o1, review: "archived" }] } } });
    check("A merges two objectives through save_structure", [200, 204].includes(merge.status), merge);
    check("the merge marks the loser and the winner stale", (await staleOf(ids.o1)) === true && (await staleOf(ids.o2)) === true, await snapshotRows());
    const merged = await state();
    check("the next read rebuilds the winner (the loser holds no state now)", JSON.stringify(merged.rebuilt) === JSON.stringify([ids.o1]) && merged.objectives.every((o) => o.saved), merged);
    await sameAsReplay("after the merge", merged);
    check("the rebuild is saved, so the following read doesn't replay", (await state()).rebuilt.length === 0, "");
    const afterMerge = await answer(A.token, ids.q[3], "correct");
    check("an answer to the merged objective's question counts for the winner", afterMerge.status === 201 && (afterMerge.body as { countsFor: string }).countsFor === ids.o1, afterMerge);
    await sameAsReplay("after answering past the merge", await state());

    /* ── A first mechanism-tier question changes the fold ── */
    const mech = await db("/rest/v1/rpc/save_structure", { method: "POST", token: A.token, body: { course: ids.course, rows: { questions: [question(ids.mechanism, ids.o1, 5, "mechanism")] } } });
    check("A adds a mechanism-tier question", [200, 204].includes(mech.status), mech);
    check("its objective's snapshot is marked stale", (await staleOf(ids.o1)) === true, await snapshotRows());
    const afterMech = await state();
    check("and rebuilt on the next read", afterMech.rebuilt.includes(ids.o1), afterMech);
    await sameAsReplay("after the mechanism question", afterMech);

    /* ── A rules bump: a snapshot folded under an older version is rebuilt ── */
    const bump = await db(`/rest/v1/objective_state?objective_id=eq.${ids.o1}`, { method: "PATCH", key: SECRET, headers: prefer, body: { rules_version: RULES_VERSION - 1, accumulator: { forged: true } } });
    check("(setup) one snapshot now claims an older RULES_VERSION", bump.status === 200, bump);
    const afterBump = await state();
    check("a snapshot from older rules is rebuilt on read", afterBump.rebuilt.includes(ids.o1), afterBump);
    await sameAsReplay("after the rules bump", afterBump);
    const fastPath = await answer(A.token, ids.q[0], "incorrect", { sessionId: "s9" });
    check("an answer after a stale snapshot was rebuilt extends it without replaying", fastPath.status === 201 && (fastPath.body as { rebuilt: boolean }).rebuilt === false, fastPath);

    /* ── A timezone change marks every snapshot stale ── */
    const tz = await db(`/rest/v1/profiles?owner_id=eq.${A.id}`, { method: "PATCH", token: A.token, headers: prefer, body: { timezone: "Pacific/Kiritimati" } });
    check("A changes their timezone", tz.status === 200, tz);
    check("every snapshot of A's is stale", (await snapshotRows()).every((r) => r.stale), await snapshotRows());
    await sameAsReplay("after the timezone change", await state());

    /* ── Confusion from a homework reflection ── */
    const confused = await api("/api/evidence", { method: "POST", token: A.token, body: { kind: "confusion", id: randomUUID(), courseId: ids.course, objectiveId: ids.o2, materialId: ids.material, note: "I don't get absorption." } });
    check("a confusion event is recorded, counting for the objective its own was merged into", confused.status === 201 && (confused.body as { countsFor: string }).countsFor === ids.o1, confused);
    const bConfused = await api("/api/evidence", { method: "POST", token: B.token, body: { kind: "confusion", id: randomUUID(), courseId: ids.course, objectiveId: ids.o1, materialId: ids.material, note: "x" } });
    check("B cannot record confusion in A's course", bConfused.status === 404, bConfused);
    await sameAsReplay("after confusion", await state());

    const log = await db(`/rest/v1/evidence_events?course_id=eq.${ids.course}&select=owner_id`, { token: A.token });
    check("every event in A's log is A's", Array.isArray(log.body) && log.body.length > 0 && (log.body as Array<{ owner_id: string }>).every((r) => r.owner_id === A.id), log.status);
  } finally {
    for (const u of [A, B]) await db(`/auth/v1/admin/users/${u.id}`, { method: "DELETE", key: SECRET });
    app.stop();
  }

  for (const r of results) console.log(`${r.ok ? "ok  " : "FAIL"} ${r.name}${r.ok ? "" : `\n     ${r.detail}`}`);
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed} of ${results.length} checks passed against ${app.url} and ${SUPABASE}`);
  process.exit(failed ? 1 : 0);
}

await main();
