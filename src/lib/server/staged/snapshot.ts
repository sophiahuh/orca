import type { Database } from "@/lib/supabase/database.types";
import type { OrcaSupabase } from "@/lib/supabase/server";
import { objectiveFromRow, questionFromRow, relationFromRow, topicFromRow } from "@/lib/supabase/app-rows";
import { fileQuestions, withCurrentTopics } from "@/lib/mastery/catalogue";
import { pipelineRpc } from "./db";

type Tables = Database["public"]["Tables"];
interface Snapshot {
  revision: number;
  course: { id: string; name: string; short: string };
  topics: Tables["topics"]["Row"][];
  objectives: Tables["objectives"]["Row"][];
  relations: Tables["relations"]["Row"][];
  questions: Tables["questions"]["Row"][];
}
export async function pipelineSnapshot(db: OrcaSupabase, ownerId: string, courseId: string) {
  const data = await pipelineRpc<Snapshot>(db, "snapshot", { ownerId, courseId });
  const topics = data.topics.map(topicFromRow);
  const merges = new Map(data.topics.flatMap((t) => t.merged_into ? [[t.id, t.merged_into] as const] : []));
  const objectives = withCurrentTopics(Object.fromEntries(data.objectives.map((o) => [o.id, objectiveFromRow(o)])), merges);
  return { revision: data.revision, course: { ...data.course, topics }, structure: { topics, objectives, bank: fileQuestions(data.questions.map(questionFromRow), objectives, merges), relations: data.relations.map(relationFromRow) } };
}
