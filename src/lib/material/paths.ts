/** Where an upload lives in the `materials` bucket: "<owner>/<material id>" (before 2026-10-17, "<owner>/<material id>/<safe name>"). Pure. */

/** The path a new upload is stored at. */
export function uploadPath(ownerId: string, materialId: string): string {
  return `${ownerId}/${materialId}`;
}

/**
 * Whether a stored path is exactly a shape the server makes for this student and material: today's
 * "<owner>/<material id>", or the older one with a safe file name after it. The path is read with the
 * secret key, so it's checked here as well as by the database.
 */
export function isOwnPath(path: string, ownerId: string, materialId: string): boolean {
  if (path === uploadPath(ownerId, materialId)) return true;
  const prefix = `${ownerId}/${materialId}/`;
  if (!path.startsWith(prefix)) return false;
  const name = path.slice(prefix.length);
  return /^[A-Za-z0-9._-]+$/.test(name) && name !== "." && name !== "..";
}
