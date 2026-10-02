# Orca — study app (v1 web prototype)

Orca turns every college class into an "island" on a knowledge map. Inside an island is a
Duolingo-style trail of topics; topics run quizzes; the orca mascot nudges reviews on a cadence the
student configures per class. Tagline: "Mastery Made Easy."

Design source of truth: Figma file `Xt9CiD6SpdN0BPma1q2pzZ` ("Orca – Study App Mockups").
Reference renders live in `docs/figma/` (`screens.png` = all 11 screens, `styleguide.png`, and the
traced SVG assets in `docs/figma/assets/`). Frames are 1194×834; v1 ships as a laptop website.

## Stack

- Next.js 16 (App Router, `src/` dir, TypeScript), Tailwind v4, `motion` (Framer Motion) for animation.
- No backend yet. State is a React context persisted to localStorage (`src/lib/store.tsx`).
  Supabase is the planned backend; the types in `src/lib/data.ts` are the future table shapes.
- AI chat / quiz generation will use the Claude API (`claude-opus-5-5`). Load the `claude-api`
  skill before writing any API route. Until a key exists, `/api/chat` must return a canned reply.

## Design tokens (already in `src/app/globals.css`)

Colors: `prussian #151D3A`, `wisteria #839BEC` / `wisteria-deep #5B78D8`, `periwinkle #AFB5F2` /
`periwinkle-deep #8C93DE`, `alice #E1ECFA` / `alice-deep #B4C8E6`, `parchment #FCF7F4` /
`parchment-deep #E3D9D2`, `orca-shadow #D9D0CB`, `ink-deep #0A0F22`. Font: Gabarito (Google).
Deep shades are used ONLY for the bottom "lip" shadow and strokes.

Utilities: `lip-{1..10}` sets the offset shadow size, `lip-{alice|wisteria|periwinkle|ink|parchment}`
sets its color, `pressable` sinks the control into its lip on :active, `eyebrow` = tracked caps label.

Type scale from Figma: H1 40 bold, H2 28 semibold, Button 17 bold, Caption 14 regular; big headlines
34–68 bold; eyebrows 15 semibold tracked 1.5px.

## What exists (all 11 Figma screens are built)

- `src/lib/motion.ts` — every spring/variant/loop preset. All animation pulls from here.
- `src/lib/data.ts` — model + seed (5 courses, due items, calendar events, K-Maps quiz, `quizFor`,
  weight + date helpers).
- `src/lib/store.tsx` — `OrcaProvider`, `useOrca()`, `useCourse(slug)`; persisted to localStorage.
- `src/app/providers.tsx` — store + `MotionConfig reducedMotion="user"`. `src/app/template.tsx` — page transitions.
- `src/hooks/useFitScale.ts` (854×834 canvas scaling), `src/hooks/useToday.ts` (hydration-safe date).
- `src/components/icons.tsx`, `brand/` (OrcaLogo, Island, Wave, Bubble).
- `src/components/ui/` — Button, Chip/ContextPill, RoundButton, ProgressBar, Card, Tag, Stat, Select,
  Toggle, Slider, AnswerOption, DueCard, PathNode (barrel in `ui/index.ts`).
- `src/components/layout/` — AppShell (main + 340px Sidebar with NavBar), BackButton, Screen.
- Feature components: `map/` (KnowledgeMap, LabelPill), `path/KnowledgePath`, `quiz/` (TruthTable,
  QuizEnd), `chat/ChatBubble`, `config/` (ConfigRow, ClassConfigModal), `calendar/MonthGrid`.
- Routes: `/`, `/home`, `/course/[slug]`, `/quiz/[slug]/[topic]`, `/chat` + `/api/chat`, `/settings`,
  `/calendar`, `/add-material`, `/new-course`. Dynamic pages read `params`/`searchParams` with
  React `use()` and the generated `PageProps<...>` types (run `npx next typegen` before `tsc`).
- `/api/chat` uses `@anthropic-ai/sdk` (`claude-opus-5-5`, low effort, server-side refusal
  fallbacks). With no `ANTHROPIC_API_KEY` it returns a canned demo reply.

## What to build next

1. Backend: Supabase auth + tables matching `src/lib/data.ts`; swap the store's persistence layer.
2. Real spaced repetition: a scheduler that turns `ReviewConfig` + `Weights` + quiz results into
   `DueItem`s (today/tomorrow) and calendar reviews. See `docs/BACKEND-NOTES.md` once written.
3. Quiz generation from uploaded materials via Claude (structured outputs), with source anchors.
4. Streaming chat replies; chat that can schedule reviews and start quizzes.
5. Animation next steps listed in `docs/ANIMATION.md`.

## Animation architecture (the "clear path forward")

- Everything visual that will move is already an SVG `motion.path`/`motion.div`: islands, orca, waves,
  trail, nodes. Target parts via `data-part` attributes.
- Presets in `src/lib/motion.ts`: `spring`, `fadeUp`, `popIn`, `stagger`, `page`, `floatIsland(seed)`,
  `driftWave(seed)`, `swimOrca`, `pulseHalo`, `drawTrail`. Add new ones there, never inline.
- Buttons/chips/cards press via CSS (`pressable`), not JS, so they stay cheap.
- Lists use `stagger()` parents with `fadeUp` children; modals/result cards use `popIn` + `AnimatePresence`.
- Next steps when ready: orca follows a path on the map (`offsetPath`), islands "grow" trees as topics
  complete (animate tree `r`/`height` from 0), trail segments fill as nodes complete, confetti on quiz end.

## Conventions

- Keep screens thin: data from `useOrca()`, visuals from components, timing from `motion.ts`.
- Pixel values from Figma are fine inline (`text-[22px]`, `rounded-[20px]`); colors must be tokens.
- Run `npx tsc --noEmit` and `npm run lint` before committing. `npm run dev` for the preview.
