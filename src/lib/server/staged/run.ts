import { buildPrompt } from "@/lib/pipeline/prompts";
import { STEPS } from "@/lib/pipeline/schemas";
import { STEP_BUDGET } from "@/lib/pipeline/budget";
import { resolveStepModel } from "@/lib/model-config";
import { resolveObjectiveId } from "@/lib/mastery/catalogue";
import { createHash } from "node:crypto";
import type { PipelineRun, QuizQuestion } from "@/lib/data";
import { PipelineDeferred, PIPELINE_LIMITS, concurrent, type StageJob, type StageTask } from "@/lib/jobs/staged/types";
import { supabaseJobStore } from "@/lib/server/job-store";
import { adminClient } from "@/lib/supabase/server";
import { pageRenderer, figureRenderer } from "@/lib/server/figures";
import { stepCaller } from "@/lib/server/model";
import { describeFigures, transcribePages } from "@/lib/pipeline/transcribe";
import { type CallStep, type RunInput, runUpload, uploadWritingTargets, writeQuestions } from "@/lib/pipeline/run";
import { applyUploadPlan } from "@/lib/pipeline/apply";
import { pagesFor } from "@/lib/pipeline/topup";
import { structureRows } from "@/lib/supabase/app-rows";
import { laidOut } from "@/lib/course/layout";
import { markerFlagId } from "@/lib/mastery/ids";
import { recordEvent } from "@/lib/mastery/snapshots";
import { RULES_VERSION } from "@/lib/mastery/objective-state";
import { eventToRow, eventFromRow, type EvidenceRow } from "@/lib/supabase/rows";
import { RecordError, supabaseSnapshotStore } from "@/lib/server/snapshot-store";
import type { ConfusionEvent } from "@/lib/mastery/types";
import { pipelineRpc } from "./db";
import { pipelineSnapshot } from "./snapshot";
import { coordinateWriting, questionRows, writingLease } from "./writing";

interface QuestionCheckpoint { targets: Array<{ objectiveId: string; desired: number }>; written?: Record<string, QuizQuestion[]>; dropped?: PipelineRun["dropped"] }
export async function runPipelineStage(job: StageJob): Promise<void> {
  const db = adminClient();
  let task: StageTask;
  try { task = await pipelineRpc<StageTask>(db, "task", { ...job }); } catch { return; } // duplicate/stale delivery
  const store = supabaseJobStore(db, job.ownerId);
  const checkpoint = (data: Record<string, unknown>) => pipelineRpc(db, "checkpoint", { ...job, ...data });
  let leaseLost = false;
  const heartbeat = setInterval(() => { void checkpoint({}).catch(() => { leaseLost = true; }); }, 30_000);
  const base = stepCaller({ ownerId: job.ownerId, runId: task.runId, kind: "upload", task: job, phase: task.phase }, { guard: "none" });
  if (!base) { clearInterval(heartbeat); await pipelineRpc(db, "fail", { ...job, error: "No AI connected." }); return; }
  // Successful replies survive transaction conflicts and process restarts. Changed prompt inputs never reuse stale answers.
  const call = (async (step: string, input: unknown) => {
    if (leaseLost) throw new Error("Pipeline lease was revoked");
    const name = step as Parameters<CallStep>[0];
    const inputHash = createHash("sha256").update(JSON.stringify({ step, model: resolveStepModel(process.env, step)?.model, budget: STEP_BUDGET[name], built: buildPrompt(name, input as never) })).digest("hex");
    const cached = await pipelineRpc<{ result: unknown } | null>(db, "cached", { ...job, inputHash });
    if (cached) return STEPS[name].output.parse(cached.result);
    const result = await base(step as Parameters<CallStep>[0], input as never);
    await checkpoint({ inputHash, result });
    return result;
  }) as CallStep;
  try {
    const materials = await store.materials(task.courseId);
    const material = materials.find((m) => m.id === task.materialId);
    if (!material) throw new Error("The material was removed");
    let pages = (await store.pages([material.id]))[material.id];
    if (!pages?.length) throw new Error("Orca found no readable pages");
    await pipelineRpc(db, "pages", { ...job, pages: pages.length });
    const loaded = await store.course(task.courseId);
    if (!loaded) throw new Error("The course was deleted");
    if (task.phase === "prepare") {
      const render = pageRenderer(db, job.ownerId);
      const warnings: Array<{ n: number; reason: string }> = [];
      for (const pass of [{ marked: "needs-vision", done: "vision", read: transcribePages }, { marked: "needs-figure", done: "figure", read: describeFigures }] as const) {
        if (!pages.some((p) => p.source === pass.marked)) continue;
        const result = await pass.read({ course: loaded.course, material, pages, markers: loaded.markers }, { call, render: (n) => render(material, n), checkpoint: async (read) => { await checkpoint({ pages: read, source: pass.done }); } });
        warnings.push(...result.kept);
        if (pass.done === "vision" && !result.read.length && pages.every((p) => p.source === "needs-vision")) throw new Error("None of the scanned pages could be read");
        const updated = new Map(result.read.map((p) => [p.n, p.text]));
        pages = pages.map((p) => updated.has(p.n) ? { ...p, text: updated.get(p.n)!, source: pass.done } : p);
      }
      await pipelineRpc(db, "finish", { ...job, checkpoint: { warnings, markers: loaded.markers } });
    } else if (task.phase === "structure") {
      for (let attempt = 0; ; attempt++) {
        const snapshot = await pipelineSnapshot(db, job.ownerId, task.courseId);
        const prep = task.checkpoint as { warnings?: Array<{ n: number; reason: string }>; markers?: string | null } | null;
        const input: RunInput = { course: snapshot.course, ...snapshot.structure, material, materials, pages, notes: loaded.notes, markers: prep?.markers ?? loaded.markers, flagged: await store.flagged(task.courseId), runId: task.runId, model: (await store.run(task.runId))!.model, now: new Date().toISOString() };
        const plan = await runUpload(input, { call, newId: () => crypto.randomUUID(), structureOnly: true, onProgress: (progress) => { void checkpoint({ progress }).catch(() => { leaseLost = true; }); } });
        for (const w of prep?.warnings ?? []) plan.run.dropped.push({ prompt: `Page ${w.n}`, reason: `kept the file's text: ${w.reason}` });
        const { byTopic } = uploadWritingTargets(input, plan);
        const flagged = new Set(plan.flags.map((f) => f.objectiveId));
        const specs = [...byTopic.values()].flatMap((g) => g.targets.map((t) => ({ objectiveId: t.objective.id, desired: t.existing.length + t.need })));
        const flags: ConfusionEvent[] = plan.flags.map((f) => ({ kind: "confusion", id: markerFlagId(material.id, f.page, f.objectiveId), at: plan.run.at, courseId: task.courseId, topicId: [...Object.values(snapshot.structure.objectives), ...plan.newObjectives].find((o) => o.id === f.objectiveId)!.topicId, objectiveId: f.objectiveId, materialId: material.id, note: f.quote, flagSource: "handwritten-marker", page: f.page }));
        const after = applyUploadPlan(snapshot.structure, plan);
        after.topics = laidOut(after.topics);
        await checkpoint({ checkpoint: { ...prep, plan, revision: snapshot.revision } });
        try {
          await pipelineRpc(db, "commit_structure", { ...job, revision: snapshot.revision, rows: structureRows(snapshot.structure, after), plan, flags: flags.map(eventToRow), targets: specs.filter((t) => flagged.has(t.objectiveId)), warmup: specs.filter((t) => !flagged.has(t.objectiveId)), summary: { topics: plan.run.topicsCreated, objectives: plan.run.objectivesCreated, attached: plan.run.objectivesAttached, dropped: plan.run.dropped, security: plan.run.security } });
          break;
        } catch (error) {
          if (!(error && typeof error === "object" && "code" in error && error.code === "40001") || attempt >= PIPELINE_LIMITS.structureRetries) throw error;
          // A changed input fingerprint causes only the affected model calls to be paid for again.
        }
      }
    } else {
      const snapStore = supabaseSnapshotStore(db, job.ownerId, task.courseId);
      const intents = (await pipelineRpc<EvidenceRow[]>(db, "flags", { ...job })).map(eventFromRow);
      for (const event of intents) {
        await recordEvent({ ...snapStore, async record(ev, write) {
          try { return await pipelineRpc<boolean>(db, "record_flag", { ...job, event: eventToRow(ev), objective: write?.objectiveId ?? null, accumulator: write?.accumulator ?? null, rules_version: write ? RULES_VERSION : null, expected_version: write?.expectedVersion ?? null }); }
          catch (error) { throw new RecordError(error && typeof error === "object" && "code" in error ? String(error.code) : "", error instanceof Error ? error.message : String(error)); }
        } }, event);
      }
      const saved = task.checkpoint as QuestionCheckpoint;
      let written = saved.written;
      const dropped = saved.dropped ?? [];
      if (!written) {
        written = {};
        const snapshot = await pipelineSnapshot(db, job.ownerId, task.courseId);
        const desired = new Map<string, number>();
        for (const spec of saved.targets) {
          const id = resolveObjectiveId(spec.objectiveId, snapshot.structure.objectives);
          desired.set(id, Math.max(desired.get(id) ?? 0, spec.desired));
        }
        const topics = new Map(snapshot.structure.topics.map((t) => [t.id, t]));
        const targets = [...desired].flatMap(([id, count]) => {
          const o = snapshot.structure.objectives[id];
          if (!o || o.review === "archived") return [];
          const existing = Object.values(snapshot.structure.bank).flat().filter((q) => resolveObjectiveId(q.objectiveId, snapshot.structure.objectives) === id);
          const need = Math.max(0, count - existing.length);
          if (!need) return [];
          const source = pagesFor(o, topics.get(o.topicId), material, pages);
          if (!source) { dropped.push({ prompt: `Objective "${o.name}"`, reason: "Its source pages are no longer available for question writing." }); return []; }
          return [{ objective: o, existing, need }];
        });
        if (targets.length) {
          const render = figureRenderer(db, job.ownerId);
          const groups = new Map<string, typeof targets>();
          for (const target of targets) groups.set(target.objective.topicId, [...(groups.get(target.objective.topicId) ?? []), target]);
          // Preserve the original topic-scoped prompts: parallelism must not send the whole file per topic.
          const results = await concurrent([...groups.values()], 2, async (group) => {
            const groupPages = new Set(group.flatMap((t) => (pagesFor(t.objective, topics.get(t.objective.topicId), material, pages) ?? []).map((p) => p.n)));
            return writeQuestions({ course: snapshot.course, material, pages: pages.filter((p) => groupPages.has(p.n)), topics, targets: group, bank: snapshot.structure.bank, notes: loaded.notes, flagged: await store.flagged(task.courseId) }, { call, newId: () => crypto.randomUUID(), claimWriting: coordinateWriting(db, writingLease(job, task.runId), desired), renderFigure: (n) => render(material, n) });
          });
          for (const result of results) {
            for (const [topicId, questions] of Object.entries(result.questions)) written[topicId] = [...(written[topicId] ?? []), ...questions];
            dropped.push(...result.dropped);
          }
        }
        await checkpoint({ checkpoint: { ...saved, written, dropped } });
      }
      await pipelineRpc(db, "commit_questions", { ...writingLease(job, task.runId), questions: questionRows(written), dropped });
      await pipelineRpc(db, "finish", { ...job });
    }
  } catch (error) {
    const deferred = error instanceof PipelineDeferred || (error instanceof Error && "code" in error && error.code === "55P03");
    try { await pipelineRpc(db, "fail", { ...job, waiting: deferred, error: error instanceof Error ? error.message : String(error) }); } catch { /* stop/lease replacement won; never revive it */ }
  } finally { clearInterval(heartbeat); }
}
