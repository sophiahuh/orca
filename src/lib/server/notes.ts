import type { OrcaSupabase } from "@/lib/supabase/server";
import { LIMITS } from "@/lib/limits";
import { checkNotes } from "@/lib/pipeline/notes";
import { recordSecurityEvents } from "@/lib/server/security";
import { reply } from "@/lib/server/student";

/**
 * A Notes for Orca (or the description of the student's confusion marks) the student is saving:
 * cleaned, or refused with the span that tries to instruct the model (a 400 they can act on).
 * Anything the screen flags is logged, whether or not it's refused.
 */
export async function acceptNotes(
  db: OrcaSupabase,
  ownerId: string,
  raw: string | null,
  opts: { kind: "orca_notes" | "marker_notes"; maxChars: number } = { kind: "orca_notes", maxChars: LIMITS.notesChars },
): Promise<{ ok: true; text: string | null } | { ok: false; response: Response }> {
  const out = checkNotes(raw, opts.maxChars);
  await recordSecurityEvents(db, ownerId, opts.kind, out.hits);
  if (!out.ok) {
    const error =
      opts.kind === "marker_notes"
        ? `Orca can't use a description that gives its AI instructions ("${out.quote}"). Describe your marks instead.`
        : `Orca can't use notes that give its AI instructions ("${out.quote}"). Describe the class instead.`;
    return { ok: false, response: reply(400, { error }) };
  }
  return { ok: true, text: out.text };
}
