/** Which routes a signed-out visitor may open, and where a `next` parameter may send someone. Pure. */

const PUBLIC = ["/sign-in", "/sign-up", "/forgot-password", "/reset-password", "/auth/callback"];

export function isPublicPath(pathname: string): boolean {
  return PUBLIC.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** Pages that make no sense once signed in (reset-password does: it follows a recovery link). */
export function isGuestOnlyPath(pathname: string): boolean {
  return ["/sign-in", "/sign-up", "/forgot-password"].includes(pathname);
}

/**
 * A same-site path, or "/" — never another origin. Control characters are refused (the URL parser
 * strips tabs and newlines, so `/\t/evil.com` would become `//evil.com`), and the result is what the
 * URL parser itself says stays on this origin.
 */
export function safeNext(next: string | null | undefined): string {
  if (!next || !/^\/(?![/\\])/.test(next) || /[\u0000-\u001f\u007f]/.test(next)) return "/";
  try {
    const u = new URL(next, "http://x");
    if (u.origin !== "http://x") return "/";
    return u.pathname + u.search + u.hash;
  } catch {
    return "/";
  }
}
