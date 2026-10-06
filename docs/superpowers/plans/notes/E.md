# E: auth and upload findings (2026-10-05, cloud container)

## Status

Done on `phase-4`, one commit after F's. Redone from scratch (the teammate's Wave 1 run of E
stopped at its session limit before anything was committed).

### Auth

- **`SITE_URL`** (`src/lib/auth/site.ts`, pure `linkOrigin`; read by `src/app/auth/actions.ts`).
  Confirmation and reset links use its origin. Development without it still falls back to the
  request's host (http for local addresses), as before; production without it sends no link and
  the form says "Orca can't send email links right now (its site address isn't configured)", with
  the cause in the server log. `SITE_URL` must be https in production unless it's a local address.
  Added to `.env.example`; Playwright sets it to `http://localhost:3100` for the e2e server.
  Tests: `tests/auth.test.ts` (unit, every branch) and `e2e/auth.spec.ts` (a sign-up made through
  `127.0.0.1:3100` still gets a link whose `redirect_to` is `http://localhost:3100/auth/callback`).
- **`getClaims` in the proxy: accepted**, recorded in a comment in `src/proxy.ts`. The proxy only
  picks page or sign-in redirect; every route and data read verifies with Supabase Auth
  (`signedInUser` → `getUser`), and the browser client fails on its next request. A revoked session
  sees an empty shell for at most the token's hour. Verifying on every navigation would add an Auth
  round trip to every page for no data gain.
- **Token-hash links work now** (`/auth/callback?token_hash=…&type=…`, verified with
  `verifyOtp`; `type` is checked against Supabase's list, a recovery link always lands on
  `/reset-password`). This is the fix for "a link opened in another browser fails": with the
  hosted email templates below, confirm and reset links work from any device. The default
  (`?code=`, PKCE) path is unchanged. e2e: a magic link and a recovery link generated with the
  admin API open in fresh browser contexts; a reused hash lands on sign-in with the link notice.
  - **For Task 10 (hosted, 9b: put this in `docs/SETUP-HOSTED.md`):** in Authentication → Email
    Templates, change the link in *Confirm signup* to
    `{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=signup&next=/` and in *Reset
    password* to `{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=recovery`
    (and *Magic Link* to `…&type=magiclink` if ever enabled). Site URL in URL Configuration must be
    the production address, the same as `SITE_URL`. The local stack keeps Supabase's default
    templates (PKCE), which the existing e2e cover.

### Uploads

- **Cleanup** (`src/lib/material/cleanup.ts`, Node-loadable, Supabase client passed in):
  `staleUploads` decides (pure, unit-tested), `cleanupUploads` removes the file first, then the
  row (pages cascade), each delete keyed by the row's own owner and id. Ages: `uploaded` or
  `reading` (from the claim, or creation) after 24 h = abandoned; `failed` after 7 days. `ready` and
  `processing` are never returned, whatever their age, so nothing a student can see is deleted.
  Entry points: `npm run cleanup:uploads` (`scripts/cleanup-uploads.ts`, `--dry` lists only) and the
  scheduled task `src/trigger/maintenance.ts` (`schedules.task`, 04:17 UTC daily; picked up by
  `trigger.config.ts`'s `dirs`). e2e: seeded rows of each kind plus a real upload, the script run
  against the e2e stack; the right rows and files go and the rest stay. No migration was needed
  (the service role deletes; students still have no delete policy).
  - Not covered: a Storage object with no `materials` row at all. `startUpload` writes the row
    before signing the URL and `discard` removes both, so none should exist; a bucket listing
    pass can be added if one ever shows up.
- **Sanitiser** (`src/lib/untrusted/sanitize.ts`): tabs are kept (a run of tabs and spaces becomes
  one tab; runs of spaces one space). Superscript and subscript characters are spelled out before
  NFKC as `^{…}` and `_{…}` (x² → x^{2}, 2⁻ⁿ → 2^{-n}, x₁ → x_{1}); NFKC stays for everything else.
- **What the ALD decks actually contain** (checked with pdf.js over L01–L04): no Unicode
  superscript or subscript characters at all, and the only NFKC change is "…" → "...". The
  ambiguity is real but comes from elsewhere: exponents and indices are ordinary digits drawn
  smaller above or below the baseline, so slide 17 of L03 read as "(1/2 16)" for 1/2¹⁶ and slide
  15 of L02 as "x 1 x 2 … x n". Fixed where the text is assembled (`src/lib/material/page-text.ts`):
  an item on the same line whose baseline is shifted by at least 0.2 of the running size and that
  isn't bigger (≤ 1.05×) becomes `^{…}` or `_{…}`, with sensible spacing. Those two slides now
  read `(1/2^{16})` and `x_{1} x_{2} … x_{n}` (unit tests on the real decks and on synthetic items).
  `scripts/score-extraction.ts` uses the same function, so the baseline reads the same text.
- **The PDF read budget is enforced** (`src/lib/material/read-pdf.ts`): pdf.js now parses on a
  `worker_threads` thread (a `MessageChannel` port given to `PDFWorker`; the thread runs pdf.js's
  own worker module from a string, so nothing resolves a file path through the bundler). When the
  budget runs out the thread is terminated, whatever it was doing, and the file is refused (422,
  "gave up"). Before, pdf.js parsed on the main thread, so a file that never yielded could never
  be interrupted. The thread's heap is capped at 1 GB. If the thread can't start at all the read
  falls back to the main thread and says so (`engine: "main-thread"` in the result); a thread that
  dies with the document open makes the file unreadable (the file's fault), never a retry on the
  main thread. Tests: a parser that spins forever is cut off within the budget; a thread that dies
  at start falls back and reads the same pages; one that dies mid-file is a 422.
  `next.config.ts` gains `outputFileTracingIncludes` for the worker module, which file tracing
  can't see (this also covers the old fake-worker path, which imported it by a variable), and
  `allowedDevOrigins: ["127.0.0.1"]` for the e2e above.

## Proof (final run, all green)

See the commit message for counts: unit, pgTAP, isolation, evidence, e2e, build, tsc, lint.

## Judgement calls

- Cleanup ages (24 h, 7 days) live in `cleanup.ts` as `CLEANUP`, not in `limits.ts` (B's file).
- The script resolves the local stack through `supabase status` like `check:isolation` does, and
  needs the secret key; it prints ids and paths only.
- `src/trigger/maintenance.ts` imports `adminClient` from `@/lib/supabase/server`, which pulls in
  `next/headers`, exactly as `src/lib/server/jobs/run.ts` does (W0 noted it). Task 10's Trigger.dev
  build will tell; the fix (an `adminClient` in a module without Next imports) is one move.
- The e2e stack now sets `SITE_URL` in `playwright.config.ts` (F's file in the plan; one line).
- The hosted email-template change is the owner's step (Task 10); until then hosted links open
  only in the browser that asked, as before.
