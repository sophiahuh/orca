/** Explicit operator action. Never invoked automatically by dev/build/deploy. */
import { existsSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import type { OrcaSupabase } from "../src/lib/supabase/server.ts";
import { pipelineRpc } from "../src/lib/server/staged/db.ts";
for (const file of [".env.local", ".env"]) if (existsSync(file)) process.loadEnvFile(file);
const action = process.argv[2];
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
if (!url || !process.env.SUPABASE_SECRET_KEY) throw new Error("Configure Supabase first");
const project = new URL(url).hostname.split(".")[0];
if (!['status', 'enable', 'disable', 'backfill'].includes(action)) throw new Error("Usage: upload-pipeline.ts status|enable|disable|backfill --project-ref <expected ref>");
if (action !== 'status' && process.argv[process.argv.indexOf('--project-ref') + 1] !== project) throw new Error(`Explicit --project-ref ${project} is required for this operation`);
const db = createClient(url, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } }) as OrcaSupabase;
if (action === 'status') {
  const [control, active, unknown] = await Promise.all([db.from('pipeline_control').select('enabled'), db.from('pipeline_tasks').select('phase,state'), db.from('pipeline_call_reservations').select('tokens,usd').eq('state','unknown')]);
  for (const result of [control, active, unknown]) if (result.error) throw new Error(result.error.message);
  console.log(JSON.stringify({ project, control: control.data, tasks: active.data, unknownAttempts: unknown.data }, null, 2));
} else {
  await pipelineRpc(db, action === 'backfill' ? 'backfill' : 'enable', action === 'backfill' ? {} : { enabled: action === 'enable' });
  console.log(`${action} completed for ${project}`);
}
