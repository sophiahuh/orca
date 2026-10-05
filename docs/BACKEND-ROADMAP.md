# Backend roadmap

How Orca gets a real backend. Decided 2026-10-04: build the backend in this repo, using Orca's own
learner model (`docs/MASTERY-PLAN.md`), and port the parts of `ai-native-learning-platform` that fit
(`docs/BACKEND-NOTES.md` maps them). The platform repo is a reference, not a dependency.

Each phase gets its own plan in `docs/superpowers/plans/` when it starts. Only Phase 1 has one so far.
Open questions live in `docs/TO-DISCUSS.md`.

## Decisions

- **Unit of mastery is the objective** ("can do X"): course → topic → objective, created once per
  course (at upload from Phase 4) and stored as course data. Questions belong
  to an objective. Concepts from extraction come in Phase 4 as tags on objectives, used for merging
  duplicates and grounding, not as the unit students see.
- **Learner state is derived, never written.** Every answer appends an evidence event; objective
  state, topic progress and island level are pure functions of the events and the clock. An answer
  counts toward its question's current objective, so re-sorting questions re-files past answers.
- **Question supply comes from generation.** Mastery needs 3 different questions per objective;
  most built-in ALD objectives have fewer, and Phases 4 and 6 fill the gap (aim: 6+ per objective).
- **Only ALD ships seeded.** The four content-free demo courses are removed.
- **Mastery is a decision, not an average:** 3 credited answers on 3 different questions, on at
  least 2 days, last two correct, no open mix-up. Stability grows ×2.2 per successful spaced check
  (cap 60 days); a miss cuts it to a third; mastered + cap + 3 checks = retired.
- **Topics are not gates.** Every topic is playable. The trail shows progress, not locks.
- **Islands show mastery.** Each course's island takes one of four fixed visuals by mastery level
  (thresholds provisional, see TO-DISCUSS).
- **No in-app AI chat.** The `/chat` screen and `/api/chat` are removed. The tutor-agent pieces of the
  platform are not ported. The MCP connector (Phase 7) is unaffected: it lets the student's own
  Claude or ChatGPT log study activity as a priority signal.
- **Priority omits the "current topic" boost and the distance discount** until discussed.
- **Claude for all model calls** (`claude-opus-5-5`, via `@anthropic-ai/sdk`); the bring-your-own
  path stays until discussed.

## Process

- Plan and build each phase with the superpowers skills: `superpowers:brainstorming` when a phase
  still has open design questions, then `superpowers:writing-plans`, then
  `superpowers:subagent-driven-development`.
- Not Spec Kit. The platform ran both flows side by side; one is enough here.
- Ported from the platform in Phase 1: its engineering invariants (into `CLAUDE.md`), its
  `learner-graph` and `assessment-pipeline` skills (rewritten for objectives and Claude), and its
  typecheck-on-edit hook. Not ported: `concept-atlas` and Spec Kit skills. The Trigger.dev skills
  come over only if Phase 4 picks Trigger.dev.

## Phases

### Phase 1 — Mastery core, on-device
Plan: `docs/superpowers/plans/2026-10-04-orca-phase1-mastery-core.md`.
Remove the AI chat. Add a test runner. Tag every built-in ALD question with an objective. Evidence
log in the store; pure `computeObjectiveState`, topic progress and island level. The quiz writes
evidence; the trail and islands read derived state. Still localStorage.

### Phase 2 — Scheduling, on-device
Priority (`docs/MASTERY-PLAN.md` §2.6 minus the frontier and distance terms) with a reason
sentence per term. `Due today / Due tomorrow` derived from objective due dates, replacing
`SEED_DUE`. Quick-review session composed from `ReviewConfig.quick.duration`, preferring unseen
questions and including at least one mechanism question. The poor-quiz loop: a Review to-do with the
slide range and missed explanations, and a re-quiz the next day. The streak decision from
TO-DISCUSS.

### Phase 3 — Supabase foundation
Supabase project, auth screens in Orca's style, `proxy.ts` session refresh (Next 16 name for
middleware). Tables: `courses`, `topics`, `objectives`, `questions`, `evidence_events`
(append-only), `materials`, `review_preferences`, `calendar_events`; `owner_id = auth.uid()` RLS on
every table. Start from the platform's migrations 0001/0004/0015/0016/0017 and their policies; its
`artifacts` bugs (no student UPDATE policy; the `status` column excluded from the column grant)
are the checklist. Swap the store's persistence behind `useOrca()` so screens don't change.
Verify live: push migrations, prove RLS with two users, run a real upload.

### Phase 4 — Material pipeline, server-side
**Objectives are created once, at upload, and never regenerated.** For each upload:
1. Extraction (Claude, PDF document blocks) reads the material together with the course's existing
   topics and objectives, and proposes new topics, new objectives, and which existing objectives
   the material covers. It may use general knowledge of the subject as well as the material.
2. Reconciliation labels each proposed objective `same as <existing id> | new | uncertain` (the
   platform's `merge | distinct | uncertain` prompt, applied to objectives). Matches attach to the
   existing objective; nothing gets a new id if it already exists.
3. The student reviews the proposals (rename, merge, drop) before they land; `uncertain` ones are
   highlighted.
4. Questions are generated per objective (aim: 6+), validated (port the ambiguity check and
   answer agreement), and attached.

Rules decided 2026-10-04:
- **Inferred objectives are allowed, flagged.** An objective that comes from general knowledge
  rather than the uploaded material is created and quizzable, marked `origin: "inferred"`, and its
  questions carry no source anchor, so they're never presented as course-specific. Objectives
  from the material are `origin: "material"` with anchors; built-in content is `"authored"`.
- **Material type limits what an upload creates.** Lectures and syllabi create topics and
  objectives. Homework and exams mostly attach to existing objectives (marking them as tested, and
  adding practice-style questions), and create a new objective only when it's clearly new.
- Answers are filed by each question's current objective, so the rare merge, split or re-tag
  after reconciliation re-files past answers automatically.

Also in this phase: upload to Storage, concept tags on objectives for duplicate detection, and a
decision on where long jobs run (Vercel function limits vs Trigger.dev vs Supabase functions),
recorded here. Measure objective extraction on a second course with the platform's scoring
harness pattern (`scripts/score-extraction.ts`).

### Phase 5 — Deep review, relationships, exams
Deep review screen (application and connection questions). Connection questions write evidence for
the pair of objectives they link, so relationship mastery exists. `implies` shielding. Exam tier
(port `stage-boundaries.ts`) and calendar reviews derived from the schedule.

### Phase 6 — Drills and exact checkers for ALD
Generators for the procedural objectives in `docs/OBJECTIVES-ALD.md`; Boolean answers checked by
truth-table equivalence.

### Phase 7 — MCP connector
`/api/mcp` with per-student tokens: `log_study`, `get_due`, `get_material`
(`docs/MASTERY-PLAN.md` §5). Connector events raise priority; they never count toward mastery.
