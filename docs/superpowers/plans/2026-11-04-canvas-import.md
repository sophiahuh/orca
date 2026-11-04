# Canvas import (2026-11-04)

**Why.** Onboarding is Orca's biggest friction (owner, 2026-11-04): create a course, upload every
file, wait, review. Columbia's CourseWorks is Canvas, and Canvas already holds the course list,
the lecture files, the assignments with due dates, the exam dates and the syllabus. Connecting it
once turns onboarding into "pick the course", and the exam countdown exists before any slide is
read. The owner's ALD week is the spec: material in with no uploading, dates known, scope from
the professor's words, then study.

**What a student does.** Settings → Canvas: paste their Canvas access token (Canvas → Account →
Settings → Approved Integrations → New Access Token) and the site (default
`https://courseworks2.columbia.edu`). Then New course → "Import from Canvas": a list of their
active Canvas courses; Import on one creates the Orca course (or fills the one already linked),
adds its assignments to the calendar and its exams to the exams table, saves the syllabus as a
material, and pulls every PDF and .pptx from the course's modules and files into the normal
upload pipeline (same `startUpload` → Storage → `processUpload` → job as the browser, so
duplicates, the 30 MB limit, reading, pause/stop/remove and Try again all apply). Import again
later to pick up new files: everything is linked by Canvas id, so nothing is imported twice.

**Assumptions (recorded in `docs/TO-DISCUSS.md`).**
- Whether the class has reached a file can't be read from the fact that it was posted (owner:
  "some profs upload nothing, others upload everything from the jump"). Files posted over the
  weeks were posted as the class reached them (except a module that opens in the future). Three
  or more files posted within three days of each other were posted all at once: they're imported
  as `upcoming` and the import page asks "How far has the class got?", the upload page's bulk
  question, saved file by file through the store. Either way the question is shown after any
  import of two or more files, and the Uploads tab's "Mark covered" still works.
- An assignment whose name contains exam, midterm, final, quiz or test is an exam (exams table,
  drives the exam cadences); the rest are homework on the calendar (`hw`; "lab" if the name says
  lab). Assignments with no due date are skipped.
- Material type from the name: syllabus → Syllabus, homework/problem set/pset/hw → Homework,
  exam or midterm or final → Past exam, solutions → Practice problems, else Lecture.
- Assigned date: the module's unlock date, else the file's Canvas creation date.
- Token auth only. Claude-style OAuth needs a developer key from the university's Canvas admins;
  if Columbia hides the "New Access Token" button, that's the next step (see
  `docs/SETUP-HOSTED.md` §9). The token is stored encrypted (AES-256-GCM, key derived from
  `SUPABASE_SECRET_KEY` with HKDF) in a service-role-only table; it never reaches the browser.

**Pieces.**
1. Migration `20261104100000_canvas.sql`: `canvas_connections` (one per student: site, encrypted
   token, Canvas user name, created and last used) and `canvas_links` (owner, kind course | file |
   assignment | syllabus, canvas id → Orca row id), both RLS-enabled with no policies.
2. `src/lib/canvas/` (pure, Node-loadable): the Canvas REST client (bearer token, `Link`-header
   pagination, injectable fetch), the shapes Orca reads, and the decisions above as functions:
   `classifyAssignment`, `materialTypeFor`, `pickFiles` (modules first, in order, then files not in a
   module; PDF and .pptx only; one entry per Canvas file id), `assignedDateFor`.
3. `src/lib/server/canvas.ts`: token encryption, connection save (checked against
   `/api/v1/users/self`), status and revoke; `listCanvasCourses`; `importCanvasCourse` (course
   row through the same helpers the store uses, exams, calendar, syllabus, files, links, a time
   budget so one request stays under the route's 300 s and reports `remaining`).
4. Routes: `GET|POST|DELETE /api/canvas`, `GET /api/canvas/courses`, `POST /api/canvas/import`
   (rate: `LIMITS.rate.canvasImport`).
5. UI: Settings → Canvas card; `/import/canvas` page (course list, Import, progress and summary,
   link to the course's Uploads tab); "Import from Canvas" on `/new-course`.
6. Tests: pure module (`tests/canvas/`), encryption and client pagination with a fake fetch,
   pgTAP `16_canvas.test.sql`; a smoke run against the local stack with a fake Canvas server.

**Out of scope now.** Scheduled re-sync (a cron), Canvas announcements as scope hints, module
unlock dates as `upcoming`, OAuth.
