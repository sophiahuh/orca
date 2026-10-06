/**
 * Remove abandoned uploads and old failed reads (`src/lib/material/cleanup.ts`): their files in
 * Storage and their rows. The scheduled Trigger.dev task (`src/trigger/maintenance.ts`) does the
 * same in production; this runs it by hand or from a cron.
 *
 *   npm run cleanup:uploads                      # local stack (reads `supabase status`)
 *   SUPABASE_URL=… SUPABASE_SECRET_KEY=… npm run cleanup:uploads   # hosted
 *   npm run cleanup:uploads -- --dry             # only say what would go
 *
 * Uses the secret key (it has to see every student's uploads); nothing it reads is printed beyond
 * ids and paths.
 */
import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/lib/supabase/database.types.ts";
import { cleanupUploads, staleUploads } from "../src/lib/material/cleanup.ts";

function localEnv(): Record<string, string> {
  const out = execFileSync("npx", ["supabase", "status", "-o", "env"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  return Object.fromEntries(
    out.split("\n").flatMap((line) => {
      const m = /^([A-Z_]+)="?(.*?)"?$/.exec(line.trim());
      return m ? [[m[1], m[2]]] : [];
    }),
  );
}

const env = process.env.SUPABASE_URL ? process.env : { ...localEnv(), ...process.env };
const URL_ = env.SUPABASE_URL ?? env.API_URL;
const SECRET = env.SUPABASE_SECRET_KEY ?? env.SECRET_KEY;
if (!URL_ || !SECRET) throw new Error("Set SUPABASE_URL and SUPABASE_SECRET_KEY, or start the local stack");
const dry = process.argv.includes("--dry");

const db = createClient<Database>(URL_, SECRET, { auth: { persistSession: false, autoRefreshToken: false } });
if (dry) {
  const { data, error } = await db.from("materials").select("id, owner_id, status, created_at, reading_since, storage_path").in("status", ["uploaded", "reading", "failed"]);
  if (error) throw new Error(error.message);
  const stale = staleUploads(data, new Date());
  for (const u of stale) console.log(`would remove ${u.why} upload ${u.id} (${u.path ?? "no file"})`);
  console.log(`${stale.length} stale upload(s) found, nothing removed (--dry)`);
} else {
  const { removed, failed } = await cleanupUploads(db);
  for (const u of removed) console.log(`removed ${u.why} upload ${u.id} (${u.path ?? "no file"})`);
  for (const f of failed) console.error(`couldn't remove ${f.id}: ${f.error}`);
  console.log(`${removed.length} removed, ${failed.length} failed`);
  if (failed.length) process.exit(1);
}
