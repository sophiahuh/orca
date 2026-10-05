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

Optional: put `ANTHROPIC_API_KEY=...` in `.env.local` so material extraction and short-answer
grading use Claude (`claude-opus-5-5`). Without a key those routes run in demo mode. Next 16 needs
Node ≥ 20.9; the unit tests added in Phase 1 need Node ≥ 22.6 (`.nvmrc`).

## Checks

```bash
npx tsc --noEmit
npm run lint
npm run build
```

## Routes

| Route | Screen |
|---|---|
| `/` | Onboarding |
| `/home` | Knowledge map (islands, due sidebar, class config modal) |
| `/course/[slug]` | Knowledge path (dotted trail, topic nodes) |
| `/quiz/[slug]/[topic]` | Quiz, then the quiz-end card |
| `/chat` | Ask Orca (POST `/api/chat`). Being removed in Phase 1; Orca has no in-app chat. |
| `/settings` | Review configurations + material-type weights |
| `/calendar` | Month view with HW / Lab / Review / Exam tags |
| `/add-material` | Upload a document with type, dates, reflect toggle |
| `/new-course` | Create a new island |

Design source: Figma "Orca – Study App Mockups" (`docs/figma/screens.png`, `docs/figma/styleguide.png`).
