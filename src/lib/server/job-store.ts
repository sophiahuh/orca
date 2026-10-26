/**
 * `JobStore` (src/lib/jobs/jobs.ts) on Supabase, for one student. Uses the service-role client, so
 * every query names the owner: the owner is the user a route verified when it started the job,
 * carried in the job's payload, never anything the browser sent.
 */
import type { Material, MaterialPages, QuizQuestion } from "@/lib/data";
import type { JobStore, LoadedCourse, WaitingProgress } from "@/lib/jobs/jobs";
import { LIMITS } from "@/lib/limits";
import { checkBudget } from "@/lib/server/usage";
import { flaggedForWriting } from "@/lib/pipeline/flagged";
import { notesForPrompts } from "@/lib/pipeline/notes";
import { recordSecurityEvents } from "@/lib/server/security";
import { materialFromRow, objectiveFromRow, questionFromRow, relationFromRow, runFromRow, topicFromRow } from "@/lib/supabase/app-rows";
import type { Json } from "@/lib/supabase/database.types";
import type { OrcaSupabase } from "@/lib/supabase/server";

/** PostgREST returns at most 1,000 rows per request, so long lists are read in pages. */
const PAGE = 1000;

async function readAll<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>, what: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw new Error(`Couldn't read ${what}: ${error.message}`);
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) return out;
  }
}

function check(what: string, result: { error: { message: string } | null }) {
  if (result.error) throw new Error(`Couldn't ${what}: ${result.error.message}`);
}

export function supabaseJobStore(db: OrcaSupabase, ownerId: string): JobStore {
  return {
    async run(runId) {
      const { data, error } = await db.from("pipeline_runs").select().eq("owner_id", ownerId).eq("id", runId).maybeSingle();
      if (error) throw new Error(`Couldn't read the run: ${error.message}`);
      return data ? runFromRow(data) : null;
    },

    async claim(runId, progress) {
      const { data, error } = await db
        .from("pipeline_runs")
        // started_at is when the job took the run: dead-run detection measures from it (src/lib/jobs/start.ts).
        .update({ status: "running", started_at: new Date().toISOString(), progress: progress as unknown as Json })
        .eq("owner_id", ownerId)
        .eq("id", runId)
        .in("status", ["queued", "waiting"])
        .select("id");
      // Another of the student's runs is running (the one-running-per-student index): leave this one queued.
      if (error?.code === "23505") return false;
      if (error) throw new Error(`Couldn't start the run: ${error.message}`);
      return data.length > 0;
    },

    budget(pages) {
      return checkBudget(db, ownerId, pages);
    },

    async wait(runId, verdict) {
      const progress: WaitingProgress = { stage: "waiting", reason: verdict.reason, message: verdict.message };
      check("hold the run", await db.from("pipeline_runs").update({ status: "waiting", progress: progress as unknown as Json }).eq("owner_id", ownerId).eq("id", runId).eq("status", "running"));
    },

    async progress(runId, progress) {
      check("record the run's progress", await db.from("pipeline_runs").update({ progress: progress as unknown as Json }).eq("owner_id", ownerId).eq("id", runId).eq("status", "running"));
    },

    async fail(runId, error) {
      // Only a run still in flight: a run whose save landed (done) stays done even if the reply was lost.
      check("record why the run failed", await db.from("pipeline_runs").update({ status: "failed", error, progress: null }).eq("owner_id", ownerId).eq("id", runId).in("status", ["queued", "waiting", "running"]));
    },

    async course(courseId): Promise<LoadedCourse | null> {
      const { data: course, error } = await db.from("courses").select("id, name, short, orca_notes").eq("owner_id", ownerId).eq("id", courseId).maybeSingle();
      if (error) throw new Error(`Couldn't read the course: ${error.message}`);
      if (!course) return null;
      const { data: profile, error: profileError } = await db.from("profiles").select("orca_notes").eq("owner_id", ownerId).single();
      if (profileError) throw new Error(`Couldn't read the student's notes: ${profileError.message}`);
      // Saved through the routes, notes are already clean; a note written straight through RLS is held to the same rules here.
      const { notes, refused } = notesForPrompts({ account: profile.orca_notes, course: course.orca_notes });
      for (const hits of refused) await recordSecurityEvents(db, ownerId, "orca_notes", hits);
      const [topics, objectives, relations, questions] = await Promise.all([
        readAll((a, b) => db.from("topics").select().eq("owner_id", ownerId).eq("course_id", courseId).order("sort_order").order("id").range(a, b), "the topics"),
        readAll((a, b) => db.from("objectives").select().eq("owner_id", ownerId).eq("course_id", courseId).order("created_at").order("id").range(a, b), "the objectives"),
        readAll((a, b) => db.from("relations").select().eq("owner_id", ownerId).eq("course_id", courseId).order("created_at").order("id").range(a, b), "the relations"),
        readAll((a, b) => db.from("questions").select().eq("owner_id", ownerId).eq("course_id", courseId).order("sort_order").order("id").range(a, b), "the questions"),
      ]);
      const bank: Record<string, QuizQuestion[]> = {};
      for (const q of questions) (bank[q.topic_id] ??= []).push(questionFromRow(q));
      const structure = {
        topics: topics.map(topicFromRow),
        objectives: Object.fromEntries(objectives.map((o) => [o.id, objectiveFromRow(o)])),
        bank,
        relations: relations.map(relationFromRow),
      };
      return { course: { id: course.id, name: course.name, short: course.short, topics: structure.topics }, structure, notes };
    },

    async materials(courseId): Promise<Material[]> {
      const rows = await readAll((a, b) => db.from("materials").select().eq("owner_id", ownerId).eq("course_id", courseId).eq("status", "ready").order("created_at").range(a, b), "the materials");
      return rows.map(materialFromRow);
    },

    async pages(materialIds) {
      const out: Record<string, MaterialPages> = {};
      // One request per material: a file has at most LIMITS.pagesPerFile pages, under the row cap.
      await Promise.all(
        materialIds.map(async (id) => {
          const { data, error } = await db.from("material_pages").select("n, text, source").eq("owner_id", ownerId).eq("material_id", id).order("n").limit(LIMITS.pagesPerFile);
          if (error) throw new Error(`Couldn't read the material's pages: ${error.message}`);
          if (data.length) out[id] = data.map((p) => ({ n: p.n, text: p.text, source: p.source as NonNullable<MaterialPages[number]["source"]> }));
        }),
      );
      return out;
    },

    async savePages(materialId, pages, source) {
      for (const p of pages) {
        const { error } = await db.from("material_pages").update({ text: p.text, source }).eq("owner_id", ownerId).eq("material_id", materialId).eq("n", p.n);
        if (error) throw new Error(`Couldn't store page ${p.n}'s text: ${error.message}`);
      }
    },

    async answered(courseId) {
      const rows = await readAll(
        (a, b) => db.from("evidence_events").select("question_id").eq("owner_id", ownerId).eq("course_id", courseId).eq("kind", "answer").order("at").order("id").range(a, b),
        "the answers",
      );
      // A question the student gave a thumbs down counts as used: it's never asked again, so the
      // top-up writes a replacement and a dive doesn't reuse it.
      const { data: down, error } = await db.from("question_feedback").select("question_id").eq("owner_id", ownerId).eq("course_id", courseId).eq("rating", "down");
      if (error) throw new Error(`Couldn't read the student's question ratings: ${error.message}`);
      return new Set([...rows.flatMap((r) => (r.question_id ? [r.question_id] : [])), ...down.map((r) => r.question_id)]);
    },

    async flagged(courseId) {
      const { data, error } = await db
        .from("question_feedback")
        .select("reason, note, questions(prompt, objective_id)")
        .eq("owner_id", ownerId)
        .eq("course_id", courseId)
        .eq("rating", "down")
        .order("updated_at", { ascending: false })
        .limit(30);
      if (error) throw new Error(`Couldn't read the student's thumbs-down questions: ${error.message}`);
      return flaggedForWriting(
        data.flatMap((r) => {
          const q = Array.isArray(r.questions) ? r.questions[0] : r.questions;
          return q ? [{ objectiveId: q.objective_id, prompt: q.prompt, reason: r.reason, note: r.note }] : [];
        }),
      );
    },

    async save(courseId, rows) {
      // save_structure takes the owner from the course row; check it's this student's first.
      const { data, error } = await db.from("courses").select("id").eq("owner_id", ownerId).eq("id", courseId).maybeSingle();
      if (error) throw new Error(`Couldn't read the course: ${error.message}`);
      if (!data) throw new Error("the course isn't this student's");
      check("save the course", await db.rpc("save_structure", { course: courseId, rows: rows as unknown as Json }));
    },
  };
}
