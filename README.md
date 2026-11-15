# Orca

Mastery made easy. Orca turns every college class into an island on a knowledge map, runs a
Duolingo-style trail of topics inside each island, quizzes you, and nudges reviews on a cadence
you configure per class. Mastery is tracked per learning objective from your answers, with spaced
checks (FSRS), and each island's look shows how much of its course you've mastered.

**Status (2026-11-10):** live at https://orca.us.com. Phases 1–4 are built: mastery
tracking, courses built from uploaded material (PDFs, .pptx decks, handwritten and typed notes,
AI chats and web pages), scheduled quick reviews and dives, and a Supabase backend with accounts.
Since then: a Claude connector (an MCP server Claude calls while a student studies in a chat) and
Canvas import (connect CourseWorks once, import a course instead of uploading it), and weak points
first: only what a student flagged or missed comes due
(`docs/superpowers/specs/2026-11-04-weak-points-first-design.md`). Phases 5 and 6 (relation mastery
and exam review, ALD drills) haven't started. Each change gets its own branch off `main`, reaches
`main` by pull request, and deploys automatically (the site to Vercel, the background jobs to
Trigger.dev). New here, human or agent? Read `CLAUDE.md` →
"Start here".

Stack: Next.js 16 (App Router) + Tailwind v4 + `motion`, Supabase (Postgres with row-level
security, Auth, Storage), and OpenAI or Claude on the server for reading material, writing
questions and grading short answers. See `CLAUDE.md` for the product model,
`docs/BACKEND-ROADMAP.md` for decisions and phases, `docs/SETUP-HOSTED.md` for the hosted setup,
and `docs/ANIMATION.md` for how motion is organised.

## Run it

```bash
npm install
cp .env.example .env.local   # then fill it in (below)
npm run dev                  # http://localhost:3000
```

The app needs a Supabase project: either the local stack (`npm run db:start` prints its URL and
keys; needs Docker) or a hosted one. Set `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SECRET_KEY`; without them the app says it
isn't connected. For uploads to generate topics and questions, and for short answers to be graded,
set `OPENAI_API_KEY` (default model `gpt-6.1-sol`) or `ANTHROPIC_API_KEY` (`claude-opus-5-5`).
Without a key an upload is stored but nothing is generated, and prose answers are self-marked.
Every variable is described in `.env.example`.

Next 16 needs Node ≥ 20.9; the unit tests need Node ≥ 22.6 (`.nvmrc`).

## Checks

```bash
npx tsc --noEmit
npm run lint
npm test                 # unit tests
npm run build
# These need the local Supabase stack (npm run db:start); run them through the stack lock:
npm run locked -- npm run test:db           # database tests (pgTAP)
npm run locked -- npm run test:e2e          # browser tests (Playwright, against a fake model API)
npm run locked -- npm run check:isolation   # two accounts can't see each other's data
npm run locked -- npm run check:evidence    # the answer-recording API over HTTP
```

No test calls a real model. CI (`.github/workflows/ci.yml`) runs all of the above on every push to
`main`, `backend-implementation` and `phase-*`, and on pull requests. `npm run score:extraction`
scores extraction on the ALD decks with a real key (`--dry` without); the decks aren't in the repo
(`docs/samples/README.md`). `npm run cleanup:uploads` removes uploads that were never read and old
failed reads.

## Routes

| Route | Screen |
|---|---|
| `/` | Courses map: one island per course, due sidebar (`/home` redirects here) |
| `/welcome` | Onboarding |
| `/sign-in`, `/sign-up`, `/forgot-password`, `/reset-password` | Accounts |
| `/new-course` | Create a course (or import it from Canvas) |
| `/import/canvas` | Pick a Canvas course to import: files, assignments, exam dates and syllabus |
| `/add-material` | Upload PDFs, .pptx decks, handwritten or typed notes (several files or a folder at once), or add an AI chat or a web page, with a homework reflection; Orca maps it onto the course and writes questions |
| `/course/[slug]` | The course's trail of topics; each topic's play button opens a dive into it |
| `/course/[slug]/review` | After an upload: confirm, rename or reject new topics; settle possible duplicates. Its Uploads tab lists every file with its progress (pause, stop, try again, remove) |
| `/course/[slug]/objectives` | Every objective: review status, origin, mastery, weight; reject, restore, merge |
| `/course/[slug]/atlas` | Concept Atlas: the course's topics and how they connect |
| `/course/[slug]/settings` | The course's own review settings (overriding the account defaults), class times and review days, and its Notes for Orca |
| `/session/[slug]?kind=quick\|deep` | A quick review (sized to the course's time budget) or a dive (harder questions written when it starts) |
| `/quiz/[slug]/[topic]` | The older single-topic quiz (nothing links to it any more) |
| `/settings` | Account, default review settings, Notes for Orca for all classes, your metrics, the Claude connector and the Canvas connection |
| `/calendar` | Scheduled reviews and exams, filterable by course |

Design source: Figma "Orca – Study App Mockups" (`docs/figma/screens.png`, `docs/figma/styleguide.png`).
