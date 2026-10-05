# Orca

Mastery made easy. Orca turns every college class into an island on a knowledge map, runs a
Duolingo-style trail of topics inside each island, quizzes you, and nudges reviews on a cadence
you configure per class. Mastery is tracked per learning objective from your answers, with spaced
checks, and each island's look shows how much of its course you've mastered.

This is the v1 web prototype: Next.js 16 (App Router) + Tailwind v4 + `motion`. State lives in a
React context persisted to `localStorage`; Supabase is the planned backend. See `CLAUDE.md` for
the product model, `docs/BACKEND-ROADMAP.md` for the build plan, and `docs/ANIMATION.md` for how
motion is organised.

## Run it

```bash
npm install
npm run dev        # http://localhost:3000
```

Optional: put `ANTHROPIC_API_KEY=...` in `.env.local` so uploads are mapped into topics,
objectives and checked questions, and short answers are graded, by Claude (`claude-opus-5-5`), or
connect your own model in Settings. With neither, an upload is saved but nothing is generated, and
prose answers fall back to self-marking. Next 16 needs
Node ≥ 20.9; the unit tests need Node ≥ 22.6 (`.nvmrc`).

## Checks

```bash
npx tsc --noEmit
npm run lint
npm test        # unit tests (Node ≥ 22.6)
npm run test:e2e  # browser tests (Playwright; first run: npx playwright install chromium)
npm run score:extraction  # score extraction on the ALD decks (needs ANTHROPIC_API_KEY; --dry without)
npm run build
```

## Routes

| Route | Screen |
|---|---|
| `/` | Onboarding |
| `/home` | Knowledge map (islands, due sidebar, class config modal) |
| `/course/[slug]` | Knowledge path (dotted trail, topic nodes) |
| `/course/[slug]/review` | After an upload: confirm, rename or reject new topics; settle possible duplicates |
| `/course/[slug]/objectives` | Every objective: review status, origin, mastery, weight; reject, restore, merge |
| `/course/[slug]/reflect` | Homework reflection: what tripped you up goes back to practice |
| `/quiz/[slug]/[topic]` | Quiz, then the quiz-end card |
| `/settings` | Review configurations + material-type weights |
| `/calendar` | Month view with HW / Lab / Review / Exam tags |
| `/add-material` | Upload a PDF: Orca maps it onto the course, writes and checks questions |
| `/new-course` | Create a new island |

Design source: Figma "Orca – Study App Mockups" (`docs/figma/screens.png`, `docs/figma/styleguide.png`).
