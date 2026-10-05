# Orca — study app (v1 web prototype)

Orca turns every college class into an "island" on a knowledge map. Inside an island is a
Duolingo-style trail of topics; topics run quizzes; the orca mascot nudges reviews on a cadence the
student configures per class. Tagline: "Mastery Made Easy."

Design source of truth: Figma file `Xt9CiD6SpdN0BPma1q2pzZ` ("Orca – Study App Mockups").
Reference renders live in `docs/figma/` (`screens.png` = all 11 screens, `styleguide.png`, and the
traced SVG assets in `docs/figma/assets/`). Frames are 1194×834; v1 ships as a laptop website.

## Product model (the vision the backend is built toward)

Full detail: `docs/BACKEND-ROADMAP.md` (decisions and phases), `docs/MASTERY-PLAN.md` (learner
model), `docs/TO-DISCUSS.md` (open questions). In short:

- **Course → topic → objective → questions.** An objective is a "can do X" statement and the unit
  of mastery. Every question belongs to one objective.
- **Objectives are created once per course**, when material is uploaded: extraction proposes new
  topics and objectives against the course's existing list, reconciliation matches duplicates,
  and the student reviews topics. Inferred objectives (from general knowledge, not the material)
  are allowed and labelled. Unreviewed objectives are quizzable, with an "unreviewed" tag.
- **Learner state is derived, never stored.** Every graded answer appends an evidence event;
  objective status (unseen → learning → mastered → fading → retired, plus mixed-up; table in
  `docs/MASTERY-PLAN.md` §2.3), topic
  progress, the island's mastery level, the due list and the streak are computed from the events
  and the clock. Spacing uses FSRS (`ts-fsrs`, Anki's scheduler) under Orca's own mastery bar.
  The mastery rule is a fold (`applyAnswer`), so the server can keep snapshots instead of
  replaying the log.
- **Weights.** Every topic and objective has a weight (neutral 1.0). Claude records signals from the
  material (coverage, material type, explicit emphasis, what builds on what); code computes the
  weight. The Settings material-type sliders feed it and set deep review's question mix.
- **Practice.** Questions are generated ahead into a per-objective stock; a quiz session is
  assembled instantly at start, sized to the course's time budget. Deep review follows each
  course's own cadence.
- **Self-reported confusion** in a homework reflection resets the matching objectives to learning.
- **Topics are not gates.** Every topic is playable; the trail shows progress, not locks.
- **Islands show mastery.** Each island has one of four fixed looks (uncharted, sprouting,
  growing, thriving) from the share of its course's objectives that are mastered.
- **Nothing hardcoded or faked.** ALD is a labelled sample course; everything else starts empty and
  comes from uploads. Missing data shows as an explicit empty or error state.
- **No in-app AI chat.** Claude is used for extracting material, generating questions and grading
  short answers. Students' own Claude/ChatGPT can connect through an MCP connector (planned) that
  logs study activity as a priority signal, never as mastery.

## Stack

- Next.js 16 (App Router, `src/` dir, TypeScript), Tailwind v4, `motion` (Framer Motion) for animation.
- No backend yet. State is a React context persisted to localStorage (`src/lib/store.tsx`).
  Supabase is the planned backend (Phase 4 of the roadmap); screens only talk to `useOrca()`, so
  the persistence swap happens behind it.
- Model calls use the Claude API (`claude-opus-5-5`). Load the `claude-api` skill before writing
  any API route. Without a key, routes fall back to demo mode.
- Unit tests: `node:test` with Node's type stripping (Node ≥ 22.6), run with `npm test`.
- Browser tests: Playwright (`e2e/`, `playwright.config.ts`), run with `npm run test:e2e`. It starts
  `next dev` on port 3100 (or reuses one) at the 1194×834 frame size; each test gets a fresh
  localStorage. First run: `npx playwright install chromium`, or set `PLAYWRIGHT_CHROMIUM_PATH` to
  an installed Chromium (cloud containers ship one at `/opt/pw-browsers/chromium-*/chrome-linux/chrome`).

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

This describes the code as it is.

- `src/lib/motion.ts` — every spring/variant/loop preset. All animation pulls from here.
- `src/lib/data.ts` — model + seed + weight and date helpers. ALD is the only seed course and is
  labelled a sample course (`sample: true`). No seed due items, calendar events, materials or streak
  (nothing fabricated). `Topic` has no status or lessons; there is no `quizFor` or K-Maps quiz.
- `src/lib/mastery/` — pure domain modules (tested with `npm test`): `types.ts` (evidence events,
  objective info and state), `catalogue.ts` (objectives per topic, unsorted bucket),
  `objective-state.ts` (FSRS via `ts-fsrs` under Orca's mastery bar; the `applyAnswer` / `stateAt`
  fold), `progress.ts` (topic progress, island level), `course-mastery.ts` (per-course roll-up),
  `due.ts` (due today/tomorrow by topic), `streak.ts` (consecutive local days with an unaided graded
  answer). `src/lib/content/ald-objectives.ts` maps the 69 ALD questions to 40 objectives.
- `src/lib/store.tsx` — `OrcaProvider`, `useOrca()`, `useCourse(slug)`; persisted to localStorage
  (key `orca:v5`). Holds per-course `objectives` and an append-only `evidence` log; `recordEvidence`
  is the only writer of learner state. Derived reads: `useMasteryByCourse()`, `useDueItems()`,
  `useStreak()`.
- `src/app/providers.tsx` — store + `MotionConfig reducedMotion="user"`. `src/app/template.tsx` — page transitions.
- `src/hooks/useFitScale.ts` (854×834 canvas scaling), `src/hooks/useToday.ts` (hydration-safe date),
  `src/hooks/useNow.ts` (clock for derived state).
- `src/components/icons.tsx`, `brand/` (OrcaLogo, Island with four mastery looks, Wave, Bubble).
- `src/components/ui/` — Button, Chip/ContextPill, RoundButton, ProgressBar, Card, Tag, Stat, Select,
  Toggle, Slider, AnswerOption, DueCard, PathNode (done / current / upcoming, no locks) (barrel in `ui/index.ts`).
- `src/components/layout/` — AppShell (main + 340px Sidebar with NavBar), BackButton, Screen.
- Feature components: `map/` (KnowledgeMap, LabelPill), `path/KnowledgePath`, `quiz/` (TruthTable,
  QuizEnd, ShortAnswer), `config/` (ConfigRow, ClassConfigModal), `calendar/MonthGrid`.
- Routes: `/`, `/home`, `/course/[slug]`, `/quiz/[slug]/[topic]`, `/settings`,
  `/calendar`, `/add-material`, `/new-course`, `/api/extract`, `/api/grade`, `/api/llm/*`. Dynamic
  pages read `params`/`searchParams` with React `use()` and the generated `PageProps<...>` types
  (run `npx next typegen` before `tsc`).
- Bring-your-own-LLM (`src/lib/llm.ts`, `llm-server.ts`, Settings → "Your AI"): the student picks
  Anthropic / OpenAI / Gemini / OpenRouter / Ollama + a key; it lives in the store (browser only) and
  rides along with each request. Anthropic goes through `@anthropic-ai/sdk`; the rest use the
  OpenAI-compatible chat.completions shape; Ollama is called from the browser. Model routes fall
  back to the server `ANTHROPIC_API_KEY` (`claude-opus-5-5`) and then to demo mode. Whether to keep
  this is open (`docs/TO-DISCUSS.md`).
- Material pipeline (on-device; Phase 2 makes it create objectives, Phase 4 moves it server-side): `src/lib/pdf-text.ts` reads PDFs with pdf.js
  → `/api/extract` asks the model for topics + source-anchored quiz questions (`src/lib/extraction.ts`,
  zod schema) → `importExtraction` in the store appends topics and fills
  `questionBank[courseId][topicId]`. It does not create objectives yet.
- Built-in ALD content: `src/lib/content/ald.ts` (topics + 69 questions); draft objectives in
  `docs/OBJECTIVES-ALD.md`. Sample material: `docs/samples/ald/L01–L04` (real ALD lecture decks;
  syllabus in L01).
- `e2e/mastery-core.spec.ts` — the Phase 1 walkthrough in a real browser: fresh state, no chat,
  island looks, the sample trail (START, objective counts, no locks), empty calendar, quiz answers
  writing evidence and moving the trail, island and streak, and a new course starting uncharted.
  Tests find things by `data-level`, `data-visual` and `data-part`; keep those attributes stable.
- Deploy: Vercel project `orca` (https://orca-lake-omega.vercel.app). Deploy with
  `npx vercel deploy --prod --yes` from a session that has the Vercel credential; GitHub auto-deploy
  is not linked yet. `.vercelignore` keeps docs/ out of uploads.

## What to build next

`docs/BACKEND-ROADMAP.md` is the plan. Phase 1 (mastery core on-device) is done; Phase 2 (uploads
create the course structure) is next. Phases: (1) mastery core on-device, (2) uploads create
topics, objectives, weights and relations (on-device), (3) scheduling and sessions, (4) Supabase
(auth, tables, Storage, snapshots, server-side pipeline), (5) relation mastery, exams and calendar,
(6) ALD drills, (7) MCP connector. Build each phase with
`superpowers:writing-plans` → `superpowers:subagent-driven-development`; plans go in
`docs/superpowers/plans/`. Animation next steps are in `docs/ANIMATION.md`.

## Invariants (ported from ai-native-learning-platform)

- Learner state is derived. Every answer appends an `EvidenceEvent`; objective state, topic progress
  and island level are computed from events and the clock. Never store or write mastery directly.
- Exposure is not mastery. Uploads, reading and connector signals may raise priority; only scored
  answers count toward mastery, and self-marked answers count half. A grading failure records nothing.
- Check exactly when the domain allows (bit strings, numbers, Boolean expressions by truth table).
  Use a model grader only with a structured rubric.
- Course-specific questions carry a source anchor into the course material. Questions for inferred
  objectives have no anchor and must not present themselves as course-specific.
- No silent placeholders: a fallback or unknown value must never look like a computed one. Throw, or
  show an explicit empty or unknown state. This applies to existing code you touch.
- When live credentials exist (Supabase, Anthropic), run the live check. A typecheck around a live
  dependency is not the same claim.
- Don't add a dependency when an existing one solves the problem. Don't add a persistence layer
  without recording why in `docs/BACKEND-ROADMAP.md`.
- Pure domain modules (`src/lib/mastery/`, content catalogues) use relative imports ending in `.ts`
  and `import type`, so `npm test` runs them with Node's type stripping.

## Animation architecture (the "clear path forward")

- Everything visual that will move is already an SVG `motion.path`/`motion.div`: islands, orca, waves,
  trail, nodes. Target parts via `data-part` attributes.
- Presets in `src/lib/motion.ts`: `spring`, `fadeUp`, `popIn`, `stagger`, `page`, `floatIsland(seed)`,
  `driftWave(seed)`, `swimOrca`, `pulseHalo`, `drawTrail`. Add new ones there, never inline.
- Buttons/chips/cards press via CSS (`pressable`), not JS, so they stay cheap.
- Lists use `stagger()` parents with `fadeUp` children; modals/result cards use `popIn` + `AnimatePresence`.
- Next steps when ready: orca follows a path on the map (`offsetPath`), islands animate between their
  four mastery looks (trees sprout from `r` 0 when a level is reached), trail segments fill as topics
  complete, confetti on quiz end.

## Conventions

- Keep screens thin: data from `useOrca()`, visuals from components, timing from `motion.ts`.
- Pixel values from Figma are fine inline (`text-[22px]`, `rounded-[20px]`); colors must be tokens.
- Before committing: `npx tsc --noEmit`, `npm run lint`, `npm test`, and `npm run test:e2e` when a
  screen or the store changed. A behaviour you would check by hand in the browser belongs in `e2e/`.
  `npm run dev` for the preview.
