/**
 * Proves students can't reach each other's data through Supabase's real HTTP API (REST, RPC and
 * Storage), the way the browser will. Creates two throwaway confirmed accounts, has A build a
 * small course and upload a file, then checks that B and a signed-out caller can't read, change,
 * attach to or delete any of it. Deletes both accounts and the file afterwards.
 *
 *   npm run check:isolation                      # local stack (reads `supabase status`)
 *   SUPABASE_URL=… SUPABASE_PUBLISHABLE_KEY=… SUPABASE_SECRET_KEY=… npm run check:isolation   # hosted
 *
 * Exits non-zero if any check fails. The secret key is used only to create, confirm and delete the
 * test accounts and the file, never for a check.
 */
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

function localEnv(): Record<string, string> {
  const out = execFileSync("npx", ["supabase", "status", "-o", "env"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  return Object.fromEntries(out.split("\n").flatMap((line) => {
    const m = /^([A-Z_]+)="?(.*?)"?$/.exec(line.trim());
    return m ? [[m[1], m[2]]] : [];
  }));
}

const env = process.env.SUPABASE_URL ? process.env : { ...localEnv(), ...process.env };
const URL_ = env.SUPABASE_URL ?? env.API_URL;
const PUBLISHABLE = env.SUPABASE_PUBLISHABLE_KEY ?? env.PUBLISHABLE_KEY;
const SECRET = env.SUPABASE_SECRET_KEY ?? env.SECRET_KEY;
if (!URL_ || !PUBLISHABLE || !SECRET) throw new Error("Set SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY, or start the local stack");

interface Reply {
  status: number;
  body: unknown;
}

async function call(path: string, opts: { method?: string; token?: string; key?: string; body?: unknown; raw?: BodyInit; headers?: Record<string, string> } = {}): Promise<Reply> {
  const key = opts.key ?? PUBLISHABLE!;
  const headers: Record<string, string> = { apikey: key, ...opts.headers };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  else if (key === SECRET) headers.Authorization = `Bearer ${key}`;
  let body: BodyInit | undefined = opts.raw;
  if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  const res = await fetch(`${URL_}${path}`, { method: opts.method ?? "GET", headers, body });
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  return { status: res.status, body: parsed };
}

const results: Array<{ ok: boolean; name: string; detail: string }> = [];
function check(name: string, ok: boolean, detail: unknown) {
  results.push({ ok, name, detail: typeof detail === "string" ? detail : JSON.stringify(detail).slice(0, 300) });
}
const isEmptyList = (r: Reply) => r.status === 200 && Array.isArray(r.body) && r.body.length === 0;
const refused = (r: Reply) => r.status >= 400;

async function createUser(label: string) {
  const email = `isolation-${label}-${randomUUID().slice(0, 8)}@example.com`;
  const password = `pw-${randomUUID()}`;
  const made = await call("/auth/v1/admin/users", { method: "POST", key: SECRET, body: { email, password, email_confirm: true, user_metadata: { timezone: "UTC" } } });
  if (made.status !== 200) throw new Error(`Couldn't create test user ${label}: ${made.status} ${JSON.stringify(made.body)}`);
  const id = (made.body as { id: string }).id;
  const session = await call("/auth/v1/token?grant_type=password", { method: "POST", body: { email, password } });
  if (session.status !== 200) throw new Error(`Couldn't sign in test user ${label}: ${session.status} ${JSON.stringify(session.body)}`);
  return { id, token: (session.body as { access_token: string }).access_token };
}

const ids = { course: randomUUID(), material: randomUUID(), topic: randomUUID(), objective: randomUUID(), question: randomUUID(), event: randomUUID(), run: randomUUID() };
const PDF = new Blob(["%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n"], { type: "application/pdf" });

async function main() {
  const A = await createUser("a");
  const B = await createUser("b");
  const filePath = `${A.id}/${ids.material}/L01.pdf`;
  const prefer = { Prefer: "return=representation" };
  try {
    /* ── A builds a course through the paths the app uses ── */
    const course = await call("/rest/v1/courses", { method: "POST", token: A.token, headers: prefer, body: { id: ids.course, slug: "ald", name: "Advanced Logic Design", short: "ALD", variant: "ald", pos_x: 0, pos_y: 0, review_config: {}, weights: {} } });
    check("A adds a course", course.status === 201, course);
    const material = await call("/rest/v1/materials", { method: "POST", token: A.token, body: { id: ids.material, course_id: ids.course, filename: "L01.pdf", type: "Lecture", storage_path: filePath } });
    check("A adds a material", material.status === 201, material);
    const saved = await call("/rest/v1/rpc/save_structure", {
      method: "POST",
      token: A.token,
      body: {
        course: ids.course,
        rows: {
          runs: [{ id: ids.run, material_id: ids.material, kind: "upload", at: new Date().toISOString(), model: "stub" }],
          topics: [{ id: ids.topic, sort_order: 0, name: "Boolean algebra", review: "proposed", pos_x: 0, pos_y: 0 }],
          objectives: [{ id: ids.objective, topic_id: ids.topic, name: "Simplify", description: "d", origin: "material", review: "proposed", material_id: ids.material, run_id: ids.run }],
          questions: [{ id: ids.question, topic_id: ids.topic, sort_order: 0, objective_id: ids.objective, kind: "Short answer", topic_name: "Boolean algebra", prompt: "Simplify x + xy.", answer: -1, exact: ["x"], explanation: "e", anchor: { locator: "slide 3", excerpt: "x + xy = x" } }],
        },
      },
    });
    check("A saves structure through save_structure", saved.status === 200 || saved.status === 204, saved);
    const event = await call("/rest/v1/calendar_events", { method: "POST", token: A.token, body: { id: ids.event, date: "2026-10-20", kind: "exam", title: "Midterm", course_id: ids.course } });
    check("A adds a calendar entry", event.status === 201, event);
    const session = await call("/rest/v1/session_results", { method: "POST", token: A.token, body: { course_id: ids.course, mode: "quick", session_id: "s1", correct: 1, total: 1, seconds: 30 } });
    check("A records a finished session", session.status === 201, session);
    const upload = await call(`/storage/v1/object/materials/${filePath}`, { method: "POST", token: A.token, raw: PDF, headers: { "Content-Type": "application/pdf" } });
    check("A uploads a file into their folder", upload.status === 200, upload);
    const ownEvidence = await call("/rest/v1/evidence_events", { method: "POST", token: A.token, body: { id: randomUUID(), owner_id: A.id, kind: "answer", at: new Date().toISOString(), course_id: ids.course, topic_id: ids.topic, objective_id: ids.objective, question_id: ids.question, outcome: "correct", grader: "exact", source: "quiz", session_id: "s1" } });
    check("A cannot write evidence directly", refused(ownEvidence), ownEvidence);

    /* ── B can't read any of it ── */
    for (const table of ["courses", "materials", "material_pages", "pipeline_runs", "topics", "objectives", "relations", "questions", "session_results", "calendar_events", "evidence_events", "objective_state"]) {
      const r = await call(`/rest/v1/${table}?select=owner_id`, { token: B.token });
      check(`B reads no ${table}`, isEmptyList(r), r);
    }
    const profiles = await call("/rest/v1/profiles?select=owner_id", { token: B.token });
    check("B reads only their own profile", profiles.status === 200 && JSON.stringify(profiles.body) === JSON.stringify([{ owner_id: B.id }]), profiles);
    const byId = await call(`/rest/v1/questions?id=eq.${ids.question}&select=prompt`, { token: B.token });
    check("B can't read A's question even by its id", isEmptyList(byId), byId);
    const graphql = await call("/graphql/v1", { method: "POST", token: B.token, body: { query: "{ coursesCollection { edges { node { name } } } }" } });
    // Hosted projects have GraphQL on by default (it obeys RLS); the local stack may have it off.
    const graphqlOff = JSON.stringify(graphql.body).includes("pg_graphql extension is not enabled");
    check(graphqlOff ? "GraphQL is off, so nothing is exposed through it" : "B reads no courses through GraphQL", graphql.status === 200 && (graphqlOff || JSON.stringify(graphql.body).includes('"edges":[]')), graphql);

    /* ── B can't change, delete or attach to it ── */
    const patch = await call(`/rest/v1/courses?id=eq.${ids.course}`, { method: "PATCH", token: B.token, headers: prefer, body: { name: "Hacked" } });
    check("B's update of A's course changes nothing", isEmptyList(patch), patch);
    const del = await call(`/rest/v1/calendar_events?id=eq.${ids.event}`, { method: "DELETE", token: B.token, headers: prefer });
    check("B's delete of A's calendar entry deletes nothing", isEmptyList(del), del);
    const attach = await call("/rest/v1/topics", { method: "POST", token: B.token, body: { id: randomUUID(), course_id: ids.course, sort_order: 1, name: "Mine", review: "proposed", pos_x: 0, pos_y: 0 } });
    check("B cannot add a topic to A's course", refused(attach), attach);
    const impersonate = await call("/rest/v1/topics", { method: "POST", token: B.token, body: { id: randomUUID(), owner_id: A.id, course_id: ids.course, sort_order: 1, name: "Mine", review: "proposed", pos_x: 0, pos_y: 0 } });
    check("B cannot add a topic claiming to be A", refused(impersonate), impersonate);
    const rpc = await call("/rest/v1/rpc/save_structure", { method: "POST", token: B.token, body: { course: ids.course, rows: { topics: [{ id: ids.topic, name: "Hacked" }] } } });
    check("B cannot save structure into A's course", refused(rpc), rpc);
    const evidence = await call("/rest/v1/evidence_events", { method: "POST", token: B.token, body: { id: randomUUID(), owner_id: A.id, kind: "answer", at: new Date().toISOString(), course_id: ids.course, topic_id: ids.topic, objective_id: ids.objective, question_id: ids.question, outcome: "incorrect", grader: "exact", source: "quiz", session_id: "x" } });
    check("B cannot write evidence for A", refused(evidence), evidence);

    /* ── B can't reach A's file ── */
    const download = await call(`/storage/v1/object/materials/${filePath}`, { token: B.token });
    check("B cannot download A's file", refused(download), download.status);
    const list = await call("/storage/v1/object/list/materials", { method: "POST", token: B.token, body: { prefix: `${A.id}/${ids.material}`, limit: 10 } });
    check("B cannot list A's folder", isEmptyList(list), list);
    const signed = await call(`/storage/v1/object/sign/materials/${filePath}`, { method: "POST", token: B.token, body: { expiresIn: 60 } });
    check("B cannot get a signed link to A's file", refused(signed), signed);
    const overwrite = await call(`/storage/v1/object/materials/${filePath}`, { method: "PUT", token: B.token, raw: PDF, headers: { "Content-Type": "application/pdf" } });
    check("B cannot overwrite A's file", refused(overwrite), overwrite);
    const plant = await call(`/storage/v1/object/materials/${A.id}/${randomUUID()}/planted.pdf`, { method: "POST", token: B.token, raw: PDF, headers: { "Content-Type": "application/pdf" } });
    check("B cannot upload into A's folder", refused(plant), plant);
    const removeFile = await call(`/storage/v1/object/materials/${filePath}`, { method: "DELETE", token: B.token });
    const stillThere = await call(`/storage/v1/object/materials/${filePath}`, { token: A.token });
    check("B cannot delete A's file", stillThere.status === 200, { delete: removeFile.status, afterwards: stillThere.status });

    /* ── Signed out: nothing ── */
    const anonCourses = await call("/rest/v1/courses?select=id");
    check("signed out reads no courses", isEmptyList(anonCourses) || refused(anonCourses), anonCourses);
    const anonFile = await call(`/storage/v1/object/materials/${filePath}`);
    check("signed out cannot download the file", refused(anonFile), anonFile.status);
    const anonRpc = await call("/rest/v1/rpc/save_structure", { method: "POST", body: { course: ids.course, rows: {} } });
    check("signed out cannot call save_structure", refused(anonRpc), anonRpc);

    /* ── A's data is untouched ── */
    const mine = await call(`/rest/v1/courses?id=eq.${ids.course}&select=name`, { token: A.token });
    check("A's course is unchanged", JSON.stringify(mine.body) === JSON.stringify([{ name: "Advanced Logic Design" }]), mine);
    const mineTopic = await call(`/rest/v1/topics?id=eq.${ids.topic}&select=name`, { token: A.token });
    check("A's topic is unchanged", JSON.stringify(mineTopic.body) === JSON.stringify([{ name: "Boolean algebra" }]), mineTopic);
    const mineEvent = await call(`/rest/v1/calendar_events?id=eq.${ids.event}&select=id`, { token: A.token });
    check("A's calendar entry is still there", Array.isArray(mineEvent.body) && mineEvent.body.length === 1, mineEvent);
  } finally {
    await call(`/storage/v1/object/materials`, { method: "DELETE", key: SECRET, body: { prefixes: [filePath] } });
    for (const u of [A, B]) await call(`/auth/v1/admin/users/${u.id}`, { method: "DELETE", key: SECRET });
  }

  for (const r of results) console.log(`${r.ok ? "ok  " : "FAIL"} ${r.name}${r.ok ? "" : `\n     ${r.detail}`}`);
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed} of ${results.length} checks passed against ${URL_}`);
  if (failed) process.exit(1);
}

await main();
