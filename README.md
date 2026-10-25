# Orca

Mastery made easy. Orca turns every college class into an island on a knowledge map, runs a
Duolingo-style trail of topics inside each island, quizzes you, and nudges reviews on a cadence
you configure per class. Mastery is tracked per learning objective from your answers, with spaced
checks (FSRS), and each island's look shows how much of its course you've mastered.

**Status (2026-10-25):** live at https://orca-lake-omega.vercel.app. Phases 1–4 are built: mastery
tracking, courses built from uploaded material (PDFs, .pptx decks, handwritten notes), scheduled
quick reviews and dives, and a Supabase backend with accounts. Phases 5–7 (relation mastery and
exam review, ALD drills, an MCP connector) haven't started. Work lands on `phase-4`, reaches `main`
by pull request, and deploys automatically. New here, human or agent? Read `CLAUDE.md` → "Start
here".

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

No test calls a real model. CI (`.github/workflows/ci.yml`) runs all of the above on every push.
`npm run score:extraction` scores extraction on the ALD decks with a real key (`--dry` without).

## Routes

| Route | Screen |
|---|---|
| `/` | Courses map: one island per course, due sidebar (`/home` redirects here) |
| `/welcome` | Onboarding |
| `/sign-in`, `/sign-up`, `/forgot-password`, `/reset-password` | Accounts |
| `/new-course` | Create a course |
| `/add-material` | Upload a PDF or .pptx (or handwritten notes) and a homework reflection; Orca maps it onto the course and writes questions |
| `/course/[slug]` | The course's trail of topics; each topic's play button opens a dive into it |
| `/course/[slug]/review` | After an upload: confirm, rename or reject new topics; settle possible duplicates |
| `/course/[slug]/objectives` | Every objective: review status, origin, mastery, weight; reject, restore, merge |
| `/course/[slug]/atlas` | Concept Atlas: the course's topics and how they connect |
| `/course/[slug]/settings` | The course's own review settings and weights (overriding the account defaults) |
| `/session/[slug]?kind=quick\|deep` | A quick review (sized to the course's time budget) or a dive (harder questions written when it starts) |
| `/quiz/[slug]/[topic]` | The older single-topic quiz |
| `/settings` | Account, default review settings and material-type weights |
| `/calendar` | Scheduled reviews and exams, filterable by course |

Design source: Figma "Orca – Study App Mockups" (`docs/figma/screens.png`, `docs/figma/styleguide.png`).
