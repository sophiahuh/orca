/**
 * Deterministic event ids (Phase 4, Task 5 review). A homework reflection records one confusion
 * event per objective the student confirmed. If the saves half-fail and the student saves again,
 * fresh random ids would record the same confusion twice. The id is instead derived from what the
 * event is about (the material and the objective), so a retry sends the same ids and the server's
 * primary key refuses the duplicates (`/api/evidence` answers 409 "already recorded", which the
 * store treats as done). Pure; loads under plain Node.
 */

/** FNV-1a over UTF-16 code units, 32 bits at a time; two seeds give 128 bits for a UUID. */
function fnv1a32(text: string, seed: number): number {
  let h = seed >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/**
 * A UUID (version-4 shaped, so Postgres and zod accept it) that is the same for the same parts.
 * Not cryptographic: it only needs to be unique per (material, objective) for one student.
 */
export function stableUuid(...parts: string[]): string {
  const text = parts.join("\u0000");
  const words = [0x811c9dc5, 0x01000193, 0x9e3779b9, 0x7f4a7c15].map((seed, i) => fnv1a32(`${i}:${text}`, seed));
  const hex = words.map((w) => w.toString(16).padStart(8, "0")).join("");
  const v = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${((parseInt(hex.slice(16, 17), 16) & 0x3) | 0x8).toString(16)}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
  return v;
}

/** The id of the confusion event a reflection on `materialId` records for `objectiveId`. */
export function confusionEventId(materialId: string, objectiveId: string): string {
  return stableUuid("confusion", materialId, objectiveId);
}
