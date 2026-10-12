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

/** How many questions the pipeline stocks per objective. */
export const QUESTIONS_PER_OBJECTIVE = 6;
