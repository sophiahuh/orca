import type { OrcaSupabase } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/database.types";

/** JSON RPC boundary; every function validates its shape in Postgres. */
export async function pipelineRpc<T>(db: OrcaSupabase, operation: string, input: Record<string, unknown>): Promise<T> {
  const invoke = db.rpc.bind(db) as unknown as (name: string, args: { payload: Json }) => PromiseLike<{ data: unknown; error: { code: string; message: string } | null }>;
  const { data, error } = await invoke(`pipeline_${operation}`, { payload: input as Json });
  if (error) throw Object.assign(new Error(`Pipeline ${operation}: ${error.message}`), { code: error.code });
  return data as T;
}
export function stagedPipeline(): boolean { return process.env.ORCA_UPLOAD_PIPELINE === "staged"; }
