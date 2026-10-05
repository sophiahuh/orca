/** Which routes a signed-out visitor may open, and where a `next` parameter may send someone. Pure. */

const PUBLIC = ["/sign-in", "/sign-up", "/forgot-password", "/reset-password", "/auth/callback"];

export function isPublicPath(pathname: string): boolean {
  return PUBLIC.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** Pages that make no sense once signed in (reset-password does: it follows a recovery link). */
export function isGuestOnlyPath(pathname: string): boolean {
  return ["/sign-in", "/sign-up", "/forgot-password"].includes(pathname);
}

/** A same-site path, or "/" — never another origin (`//evil.com`, `https://…`, `/\evil.com`). */
export function safeNext(next: string | null | undefined): string {
  if (!next || !/^\/(?![/\\])/.test(next)) return "/";
  return next;
}
