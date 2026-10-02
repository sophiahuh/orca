# Orca

Mastery made easy. Orca turns every college class into an island on a knowledge map, runs a
Duolingo-style trail of topics inside each island, quizzes you, and nudges reviews on a cadence
you configure per class.

This is the v1 web prototype: Next.js 16 (App Router) + Tailwind v4 + `motion`. State lives in a
React context persisted to `localStorage`; Supabase is the planned backend. See `CLAUDE.md` for
the build plan and `docs/ANIMATION.md` for how motion is organised.

## Run it

```bash
npm install
npm run dev        # http://localhost:3000
```

Optional: put `ANTHROPIC_API_KEY=...` in `.env.local` and `/chat` talks to Claude
(`claude-sonnet-5-5`). Without a key the chat route returns a canned demo reply.

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
| `/chat` | Ask Orca (POST `/api/chat`) |
| `/settings` | Review configurations + material-type weights |
| `/calendar` | Month view with HW / Lab / Review / Exam tags |
| `/add-material` | Upload a document with type, dates, reflect toggle |
| `/new-course` | Create a new island |

Design source: Figma "Orca – Study App Mockups" (`docs/figma/screens.png`, `docs/figma/styleguide.png`).
