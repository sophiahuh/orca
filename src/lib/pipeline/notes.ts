/**
 * Notes for Orca (owner, 2026-10-25): what the student knows about a class, for all their classes
 * (profiles.orca_notes) and for one (courses.orca_notes). The writing steps get them as a
 * student_notes data block; the system prompt says how far they may shape the work. Sanitised and
 * screened when saved (routes) and again when a job loads them, so a note written straight through
 * RLS is held to the same rules. A strong screen hit is refused, never shortened into something
 * that looks like the student's text. Pure; loads under plain Node.
 */
import { LIMITS } from "../limits.ts";
import { sanitize } from "../untrusted/sanitize.ts";
import { type ScreenHit, screen } from "../untrusted/screen.ts";

export interface OrcaNotes {
  forAllClasses: string | null;
  forThisClass: string | null;
}

export type NotesCheck = { ok: true; text: string | null; hits: ScreenHit[] } | { ok: false; quote: string; hits: ScreenHit[] };

/** One note: cleaned text (null when blank), or refused with the span that tries to instruct the model. */
export function checkNotes(raw: string | null): NotesCheck {
  if (raw === null) return { ok: true, text: null, hits: [] };
  const text = sanitize(raw, LIMITS.notesChars).text;
  if (!text) return { ok: true, text: null, hits: [] };
  const screened = screen(text);
  if (screened.strong) return { ok: false, quote: screened.hits.find((h) => h.severity === "strong")!.quote, hits: screened.hits };
  return { ok: true, text, hits: screened.hits };
}

/** Both notes as the prompts take them; a refused one is left out and its hits returned for the security log. Null when neither is usable. */
export function notesForPrompts(raw: { account: string | null; course: string | null }): { notes: OrcaNotes | null; refused: ScreenHit[][] } {
  const refused: ScreenHit[][] = [];
  const keep = (value: string | null) => {
    const out = checkNotes(value);
    if (!out.ok) {
      refused.push(out.hits);
      return null;
    }
    return out.text;
  };
  const notes = { forAllClasses: keep(raw.account), forThisClass: keep(raw.course) };
  return { notes: notes.forAllClasses || notes.forThisClass ? notes : null, refused };
}
