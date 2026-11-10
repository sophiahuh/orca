/** Invoked only by test-staged-pipeline.py against its disposable database and fake API. */
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { pipelineRpc } from "../src/lib/server/staged/db.ts";
import { runPipelineStage } from "../src/lib/server/staged/run.ts";
import type { OrcaSupabase } from "../src/lib/supabase/server.ts";
import type { StageJob } from "../src/lib/jobs/staged/types.ts";
import { type ExtractScenario } from "../tests/support/extract-scenario.ts";

const nativeFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  let url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const parsed = new URL(url);
  assert.ok(parsed.hostname === "127.0.0.1" && ["55329", "55331"].includes(parsed.port), "Tests may contact only their isolated local services");
  if (parsed.port === "55329") url = url.replace("/rest/v1/", "/");
  return nativeFetch(url, init);
};
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } }) as OrcaSupabase;
const ownerId = "aaaaaaaa-0000-4000-8000-000000000291";
const courseId = "c0000000-0000-4000-8000-000000000291";
const check = <T>(r: { data: T; error: { message: string } | null }) => { if (r.error) throw new Error(r.error.message); return r.data; };
// Bootstrap only this scratch schema; auth.users isn't exposed by PostgREST.
await pipelineRpc(db, "test_seed", { ownerId, courseId });
await pipelineRpc(db, "enable", { enabled: true });
const scenario: ExtractScenario = { topics: [{ localId: "t1", existingId: null, name: "Boolean Algebra", summary: "Absorption", slideStart: 1, slideEnd: 2 }], objectives: [{ localId: "o1", existingId: null, emphasis: null, topicRef: "t1", name: "Simplify with absorption", description: "Use x + xy = x", origin: "material", places: [{ locator: "slide 2", excerpt: "x + xy = x" }] }] };
await fetch("http://127.0.0.1:55331/__scenario", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ extract: scenario }) });
const itemId = crypto.randomUUID(), materialId = crypto.randomUUID();
await pipelineRpc(db, "admit", { ownerId, courseId, batchId: itemId, source: "browser", items: [{ id: itemId, name: "Lecture.pdf" }] });
await pipelineRpc(db, "charge_item", { ownerId, itemId });
check(await db.from("materials").insert({ id: materialId, owner_id: ownerId, course_id: courseId, filename: "Lecture.pdf", type: "Lecture", status: "ready", content_hash: "integration-bytes" }));
check(await db.from("material_pages").insert([1, 2].map((n) => ({ owner_id: ownerId, material_id: materialId, n, text: "Absorption: x + xy = x. Simplify Boolean expressions." }))));
const attached = await pipelineRpc<{ runId: string }>(db, "attach", { ownerId, itemId, materialId, model: "claude-opus-5-5" });
for (let i = 0; i < 8; i++) {
  const job = await pipelineRpc<StageJob | null>(db, "claim", { ownerId });
  if (!job) break;
  await runPipelineStage(job);
}
const run = check(await db.from("pipeline_runs").select("*").eq("id", attached.runId).single());
assert.ok(run);
assert.equal(run.status, "done", JSON.stringify({ error: run.error, progress: run.progress }));
assert.ok(run.structure_committed_at);
assert.equal(run.topics_created.length, 1);
assert.equal(run.objectives_created.length, 1);
assert.equal(run.questions_added, 1, "initial warm-up writes exactly once: " + JSON.stringify(run.dropped));
const calls = await (await fetch("http://127.0.0.1:55331/__calls")).json() as { step: string }[];
assert.ok(calls.some((c) => c.step === "map"));
assert.ok(calls.some((c) => c.step === "generate"));
console.log("Real staged workers passed: preparation -> structure commit -> warm-up questions -> terminal run, against isolated PostgREST and fake model.");

// Later folder entries prepare concurrently, reuse the committed catalogue and allocate no second warm-up.
const ids = [crypto.randomUUID(), crypto.randomUUID()];
const mids = [crypto.randomUUID(), crypto.randomUUID()];
await pipelineRpc(db, "admit", { ownerId, courseId, batchId: ids[0], source: "browser", items: ids.map((id, i) => ({ id, name: `Lecture${i + 2}.pdf` })) });
for (let i = 0; i < ids.length; i++) {
  await pipelineRpc(db, "charge_item", { ownerId, itemId: ids[i] });
  check(await db.from("materials").insert({ id: mids[i], owner_id: ownerId, course_id: courseId, filename: `Lecture${i + 2}.pdf`, type: "Lecture", status: "ready", content_hash: `later-${i}` }));
  check(await db.from("material_pages").insert([1, 2].map((n) => ({ owner_id: ownerId, material_id: mids[i], n, text: "Absorption: x + xy = x. Simplify Boolean expressions." }))));
  await pipelineRpc(db, "attach", { ownerId, itemId: ids[i], materialId: mids[i], model: "claude-opus-5-5" });
}
const prepJobs = await Promise.all([pipelineRpc<StageJob>(db, "claim", { ownerId }), pipelineRpc<StageJob>(db, "claim", { ownerId })]);
await Promise.all(prepJobs.map(runPipelineStage));
const firstStructure = await pipelineRpc<StageJob>(db, "claim", { ownerId });
await runPipelineStage(firstStructure);
const blockedQuestions = await pipelineRpc<StageJob>(db, "claim", { ownerId });
const nextStructure = await pipelineRpc<StageJob>(db, "claim", { ownerId });
assert.ok(nextStructure, "questions do not occupy the structure lane");
await runPipelineStage(nextStructure);
// Retry ONLY a question phase and verify no mapping call is repeated.
const beforeRetry = await (await fetch("http://127.0.0.1:55331/__calls")).json() as { step: string }[];
const qTask = check(await db.from("pipeline_tasks").select("run_id").eq("id", blockedQuestions.taskId).single());
assert.ok(qTask);
await pipelineRpc(db, "fail", { ...blockedQuestions, error: "Synthetic interruption before question writing" });
await pipelineRpc(db, "control_run", { ownerId, runId: qTask.run_id, action: "retry" });
for (let i = 0; i < 6; i++) { const job = await pipelineRpc<StageJob | null>(db, "claim", { ownerId }); if (!job) break; await runPipelineStage(job); }
const afterRetry = await (await fetch("http://127.0.0.1:55331/__calls")).json() as { step: string }[];
assert.equal(afterRetry.filter((c) => c.step === "map").length, beforeRetry.filter((c) => c.step === "map").length, "question retry never maps again");
assert.equal(check(await db.from("topics").select("id").eq("course_id", courseId))!.length, 1, "later files reuse the same topic");
assert.equal(check(await db.from("pipeline_warmups").select("course_id").eq("course_id", courseId))!.length, 1, "one warm-up allocation across the folder");
const obj = check(await db.from("objectives").select("signals").eq("course_id", courseId).single());
assert.ok(obj && Array.isArray(obj.signals));
assert.equal(obj.signals.length, 3, "all files' source signals survive ordered extraction");
console.log("Folder overlap, catalogue reuse, source union, once-only warm-up and question-only retry passed.");
