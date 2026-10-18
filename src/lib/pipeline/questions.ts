/** Question helpers shared by the pipeline and the store. */

/**
 * The key for spotting a question the course already has: case, Unicode forms and spacing don't
 * matter, symbols do ("a + ac" and "a + a'c" stay different). A duplicate check, never an id.
 */
export function promptKey(prompt: string) {
  return prompt
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s*([^\p{L}\p{N}\s])\s*/gu, "$1")
    .replace(/\s+/g, " ")
    .replace(/[.?!]+$/, "")
    .trim();
}

/**
 * How many questions an upload writes per objective (owner, 2026-10-18; was 6): enough for a first
 * attempt and a retry. More are written as the student practises (`TOP_UP_RULES` in topup.ts), so
 * objectives never studied don't cost a stock of questions, and the upload finishes sooner.
 */
export const QUESTIONS_PER_OBJECTIVE = 2;
