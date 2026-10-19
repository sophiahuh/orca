# CourseWorks / Canvas sync: implementation plan

> **Status: planned, not implemented (2026-10-06).** This document is the source of truth for a
> future implementation. CourseWorks is Columbia's Canvas deployment. Build a direct, read-only
> Canvas OAuth integration; do **not** make an MCP server part of Orca's production sync path.

## 1. Product outcome

A student can connect their CourseWorks account once and then:

1. see active Canvas courses in Orca and link each to an existing Orca course or create a new one;
2. see Canvas assignments, exams, and Planner/calendar dates in Orca's calendar;
3. choose Canvas modules, pages, or files to import as Orca material and process with the existing
   extraction pipeline;
4. refresh manually or see a recent, clearly labelled sync state; and
5. disconnect at any time, revoking Orca's access and deleting refresh credentials.

The integration improves organization and import convenience. It does **not** count Canvas activity,
grades, page views, or submissions as mastery evidence. Only Orca's graded study evidence changes
mastery.

## 2. Non-negotiable product and safety decisions

### Use Canvas OAuth, never pasted personal tokens

Canvas's own OAuth documentation says a multi-user application must use OAuth rather than ask users
to manually generate and enter personal API tokens. Those tokens are password-equivalent. Orca must
therefore use an authorization-code OAuth flow with PKCE and a registered Developer Key; client
secrets and refresh tokens remain server-only.

- CourseWorks base URL: `https://courseworks2.columbia.edu`.
- Request only the read scopes listed in §5.
- Store encrypted refresh credentials outside browser-readable tables; do not send them to the
  browser, model provider, logs, analytics, or error reporting.
- Validate `state`, PKCE verifier, redirect URI, issuer/domain, expiry, and user identity on every
  OAuth callback.
- On a `401`, refresh once; if refresh fails, mark the connection `reauth_required` and ask the
  student to reconnect. Never silently retry forever.
- Columbia must approve/enable Orca's Developer Key and requested scopes. A personal developer
  token is acceptable only for a developer's local test account, never as an end-user onboarding
  fallback.

References: [CourseWorks Canvas OAuth](https://courseworks2.columbia.edu/doc/api/file.oauth.html),
[Developer Key scopes](https://courseworks2.columbia.edu/doc/api/file.developer_keys.html).

### Canvas is a source, not the owner of Orca data

Canvas-synced records must carry `source = "canvas"`, the Canvas instance, and a stable Canvas ID.
They are updated only by their matching Canvas source record. User-created Orca courses, materials,
calendar events, exams, and settings are never overwritten by sync.

Conflict rules:

| Data | Canvas changes | Student changes in Orca |
| --- | --- | --- |
| Course link | update Canvas display metadata only | link/unlink explicitly; never auto-relink by name after initial confirmation |
| Assignment due date/title | update the synced event | user may hide/dismiss the synced event; do not rewrite it as a user event |
| Material import | source page/file is immutable after import | Orca's topics/objectives/review remain Orca-owned; a later Canvas edit is a new import decision |
| Course settings | never read or write Canvas settings | always Orca-owned |

Canvas grades/submission state may be displayed later as private, read-only context. They must never
raise mastery, change an objective state, or be sent to an LLM by default.

### MCP is not the sync layer

Third-party Canvas MCP servers are useful for local prototyping or a developer assistant, but they
are an agent/tool wrapper over the Canvas API, not a durable synchronization primitive. Many expose
write tools and ask for a Canvas token. Orca's production service should call the Canvas REST API
directly with its constrained OAuth credentials. If an MCP is used during development, run it
read-only and keep it out of the user request path.

Examples researched: [canvas-mcp](https://github.com/vishalsachdev/canvas-mcp),
[canvas-lms-mcp](https://github.com/bruchris/canvas-lms-mcp).

## 3. First-release experience

### Connect and map courses

1. Master Settings gains a **Connected services** card with **Connect CourseWorks**.
2. The button starts Canvas OAuth in a top-level browser redirect, returning to
   `/settings/integrations/courseworks/callback`.
3. On success, Orca fetches active student enrollments and presents a mapping screen:
   - **Link to [existing Orca course]**;
   - **Create Orca course** using the Canvas course's full name, preserving capitalization; or
   - **Skip for now**.
4. A linked course shows a subtle `CourseWorks connected` source line and a **Sync now** action.

Never infer a link solely by fuzzy course-name matching. Suggestions are fine; confirmation is
required because course names and semesters repeat.

### Calendar sync

For every linked course, import the student's dated Canvas assignments and Calendar/Planner items.
The event title, due time/date, Canvas URL, Canvas object ID, and latest Canvas update time are kept.
Orca's calendar shows a source affordance and opens Canvas in a new tab when selected.

Initial release behavior:

- create/update Canvas-originated events only;
- retain a deleted-from-Canvas event as `removed_at`/hidden rather than deleting history outright;
- no write-back to Canvas;
- normalize Canvas timestamps into the student's Orca timezone for display, while retaining the
  original UTC timestamp;
- deduplicate by `(connection_id, canvas_object_type, canvas_object_id)`, never title/date.

Canvas supports user calendar listings that include assignment items, and Canvas Planner exposes
learning objects intended for student planning. [Calendar Events API](https://courseworks2.columbia.edu/doc/api/calendar_events.html),
[Planner API](https://courseworks2.columbia.edu/doc/api/planner.html).

### Selective material import

The course page's **Add material** flow gains **From CourseWorks** after a course is linked:

1. list modules, pages, and downloadable files the current student can access;
2. let the student select one or more entries and preview title/type/date;
3. download the selected file or fetch the selected page server-side with the user's Canvas OAuth
   credential;
4. create a normal Orca `materials` record with `source = canvas` metadata and stored source hash;
5. run the existing reader/extraction/review flow; and
6. show the Canvas item title and a link back to its original page in material provenance.

Only an explicit selection enters the LLM pipeline. Do not bulk-ingest an entire course, discussion
board, or submission history. Treat Canvas HTML, files, and page text as untrusted material exactly
like existing uploads. Canvas Modules organize course learning materials and their order, and Files
has a first-party API suitable for the selector. [Modules API](https://courseworks2.columbia.edu/doc/api/modules.html),
[Files API](https://courseworks2.columbia.edu/doc/api/files.html).

## 4. Data model and server boundaries

Add a migration and generated Supabase types before UI work. Suggested rows (names may change, but
ownership/source semantics may not):

```text
canvas_connections
  id, owner_id, canvas_base_url, canvas_user_id, status,
  encrypted_refresh_token, token_expires_at, scopes,
  last_synced_at, last_error, created_at, updated_at

canvas_course_links
  id, connection_id, owner_id, canvas_course_id, course_id,
  canvas_name, canvas_code, workflow_state, last_synced_at, unique(connection_id, canvas_course_id)

canvas_sync_items
  id, connection_id, owner_id, course_id nullable,
  canvas_course_id, canvas_object_type, canvas_object_id,
  title, url, due_at, canvas_updated_at, payload_hash,
  removed_at nullable, last_synced_at,
  unique(connection_id, canvas_object_type, canvas_object_id)

canvas_material_sources
  material_id, connection_id, canvas_course_id,
  canvas_object_type, canvas_object_id, source_url, canvas_updated_at, source_hash
```

Do not put OAuth credentials in `profiles`, browser local storage, or generic material metadata.
Use a server-side encryption/KMS abstraction with key rotation, and make connection rows inaccessible
to normal client queries. Deleting a connection deletes encrypted credentials and source metadata;
it does not delete already-imported Orca material without a separate explicit user action.

Server routes/services:

| Boundary | Purpose |
| --- | --- |
| `GET /api/integrations/courseworks/connect` | create one-time OAuth state + PKCE verifier; redirect to Canvas |
| `GET /api/integrations/courseworks/callback` | verify state, exchange code server-side, create connection, redirect to mapping UI |
| `GET /api/integrations/courseworks` | read connection/sync status for signed-in user |
| `PUT /api/integrations/courseworks/course-links` | explicitly link, create, or unlink an Orca course |
| `POST /api/integrations/courseworks/sync` | manually queue/safely coalesce a read-only sync for the signed-in user |
| scheduled job | sync connected active courses at a conservative cadence; no overlapping runs per connection |
| `GET /api/integrations/courseworks/materials` | list selectable module/page/file metadata for one linked course |
| `POST /api/integrations/courseworks/materials/import` | fetch explicitly selected item, create standard material, start existing pipeline |

Every endpoint authenticates the Orca user, scopes all reads/writes to `owner_id`, validates a link
belongs to that connection, and uses a per-user rate limit. OAuth callbacks must be CSRF-safe even
though they begin outside Orca.

## 5. Minimal read scopes and API calls

Ask Columbia for the narrowest read-only Developer Key scopes necessary. Start with these capabilities;
translate to exact Canvas scope strings during registration:

| Need | Canvas read operation |
| --- | --- |
| identify current user | `GET /api/v1/users/self/profile` |
| active course choices | `GET /api/v1/courses` with enrollment/workflow filtering |
| assignment dates | `GET /api/v1/users/self/calendar_events?type=assignment` and/or course assignments |
| general due items | Planner API for the current user |
| module selector | `GET /api/v1/courses/:course_id/modules` and module items |
| page selector/content | course Pages endpoints |
| file selector/download metadata | course Files endpoints |
| optional later context | own submissions only, never other students' data |

Do not request write scopes, roster data, SIS data, other students' submissions, messages, gradebook
management, or account administration. Canvas Developer Key scopes are endpoint-specific and Canvas
will reject a request outside the approved scope. [Developer-key scope behavior](https://courseworks2.columbia.edu/doc/api/file.developer_keys.html)

## 6. Sync algorithm

### Initial sync

1. fetch current user and active enrollments;
2. save a connection and Canvas course snapshots;
3. ask the student to map each course;
4. sync dated assignments/calendar/Planner items only for linked courses;
5. return counts: created, updated, hidden because removed, skipped/unlinked, errors;
6. never call the material importer until the student selects an item.

### Incremental sync

Run on **Sync now**, after linking a course, on app open when `last_synced_at` is stale (for example,
15 minutes), and through a conservative background schedule. Coalesce concurrent requests for the
same connection. Use Canvas pagination, ETags/updated timestamps when available, and payload hashes
to avoid needless writes.

For each Canvas object:

```text
same source ID + unchanged hash -> no write
same source ID + changed hash   -> update Canvas-owned fields only
source ID absent after a full successful listing -> set removed_at, hide from calendar
network/rate-limit failure       -> leave prior data visible; record last_error; do not infer deletion
```

Show `Last synced just now`, `Synced 8 min ago`, `Needs reconnect`, or `Couldn't sync — Try again`.
Never show a stale timestamp as a successful current sync.

Canvas requests are rate-limited/throttled, so implement pagination, bounded concurrency, exponential
backoff for transient failures, and a connection-level lock. Do not use account-level Canvas Data
Services/webhooks in the first release; they require institutional administration and are not needed
for reliable student-facing polling.

## 7. Relationship to Orca's learning model

Canvas signals can improve **priority**, but not mastery:

- an upcoming synced assignment/exam can raise review urgency for manually selected/in-scope topics;
- a selected Canvas file/page becomes ordinary material and follows the normal extractor policy;
- a student can explicitly mark imported material as exam-relevant or map it to an exam;
- Canvas grades, submissions, and AI-generated interpretations are not answer evidence.

Do not infer exact exam topic coverage from an assignment title alone. Require the imported material,
an instructor-provided scope, or explicit student selection/review.

## 8. Delivery phases and acceptance checks

### Phase A — institution approval and OAuth foundation

- obtain a Columbia-approved Developer Key, redirect URI, exact read scopes, and privacy/security
  review;
- implement encrypted connection storage, OAuth state/PKCE/callback, disconnect, token refresh,
  and audit-safe error handling;
- test authorization denial, expired refresh token, revoked consent, wrong state, and a connection
  belonging to another Orca user.

**Done when:** a student can connect and disconnect without any personal-token paste field, and no
credential appears in browser payloads/logs.

### Phase B — courses and calendar

- implement course mapping and read-only calendar/assignment/Planner sync;
- add source-labelled calendar UI, manual sync, stale/error states, and non-destructive removal;
- add integration tests for pagination, idempotence, source-ID updates, unlinking, and ownership.

**Done when:** repeating a sync changes nothing when Canvas has not changed; a Canvas due-date change
updates only its synced event; an Orca-created event is untouched.

### Phase C — selected material import

- implement module/page/file selection and authorized fetch/download;
- route all imported bytes/text through existing material sanitization, duplicate detection, reading,
  extraction, review, and provenance UI;
- add source hashes and an explicit `Import updated version` choice rather than silently replacing
  a prior study source.

**Done when:** a student can select one Canvas page or PDF, review the resulting proposed structure,
and trace it back to Canvas; unselected course content never reaches the model.

### Phase D — priority context, only after Phases A–C are stable

- propose how synced due items map to a course/exam scope;
- add transparent priority reasons such as `Assignment due Friday`, with an opt-out;
- validate that no connector signal changes objective mastery without Orca answer evidence.

**Done when:** upcoming Canvas work can affect what Orca recommends, but cannot falsely mark a
topic learned.

## 9. Open decisions to resolve before implementation

1. Which Columbia office approves a CourseWorks Developer Key, scopes, redirect URI, and privacy
   review for a student-facing third-party app?
2. What credential-encryption/KMS service will production use, and what is the retention/deletion
   policy?
3. Does Columbia allow background refresh tokens for this key, or must syncing occur only while the
   user is actively present?
4. Which Canvas item types belong in v1: assignments/calendar, modules, pages, and PDFs are
   recommended; discussions, quizzes, and submission files should wait.
5. Should a disconnected connection retain read-only calendar history, or hide all Canvas-originated
   events immediately?
6. Is LTI 1.3 a later institutional partnership track? It is useful for in-CourseWorks launch and
   instructor-supported flows, but should not block OAuth calendar/material sync.

