/** Where an upload lives in the `materials` bucket: "<owner>/<material id>/<safe name>". Pure. */

/** The file's name as stored: anything but letters, digits, dot, dash and underscore becomes "_". */
export function safeName(filename: string): string {
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120);
  return /[a-zA-Z0-9]/.test(safe) ? safe : "file.pdf";
}

/**
 * Whether a stored path is exactly the shape `startUpload` makes for this student and material.
 * The path is read with the secret key, so it's checked here as well as by the database.
 */
export function isOwnPath(path: string, ownerId: string, materialId: string): boolean {
  const prefix = `${ownerId}/${materialId}/`;
  if (!path.startsWith(prefix)) return false;
  const name = path.slice(prefix.length);
  return /^[A-Za-z0-9._-]+$/.test(name) && name !== "." && name !== "..";
}
