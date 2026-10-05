/**
 * Input limits (Phase 4 plan, decision 10). Each is checked on the server before any work that
 * costs something; the browser may check them too, but only to say so sooner. Task 7 adds the
 * quotas, rate limits and budgets here.
 */
export const LIMITS = {
  /** Largest file a student can upload (the `materials` bucket enforces the same). */
  uploadBytes: 25 * 1024 * 1024,
  /** File types Orca can read. */
  uploadMime: "application/pdf",
  /** Most pages read from one file. */
  pagesPerFile: 150,
  /** Most characters kept from one page after sanitising (a dense slide has a few thousand). */
  pageChars: 20_000,
} as const;
