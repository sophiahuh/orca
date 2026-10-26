import type { OrcaSupabase } from "@/lib/supabase/server";
import { checkNotes } from "@/lib/pipeline/notes";
import { recordSecurityEvents } from "@/lib/server/security";
import { reply } from "@/lib/server/student";

/**
 * A Notes for Orca the student is saving: cleaned, or refused with the span that tries to instruct
 * the model (a 400 they can act on). Anything the screen flags is logged, whether or not it's refused.
 */
export async function acceptNotes(db: OrcaSupabase, ownerId: string, raw: string | null): Promise<{ ok: true; text: string | null } | { ok: false; response: Response }> {
  const out = checkNotes(raw);
  await recordSecurityEvents(db, ownerId, "orca_notes", out.hits);
  if (!out.ok) return { ok: false, response: reply(400, { error: `Orca can't use notes that give its AI instructions ("${out.quote}"). Describe the class instead.` }) };
  return { ok: true, text: out.text };
}
