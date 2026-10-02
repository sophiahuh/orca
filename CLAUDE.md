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
- AI chat / quiz generation will use the Claude API (`claude-sonnet-5-5`). Load the `claude-api`
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

## What exists

- `src/lib/motion.ts` — every spring/variant/loop preset. All animation pulls from here.
- `src/lib/data.ts` — model + seed (5 courses, due items, calendar events, K-Maps quiz).
- `src/lib/store.tsx` — `OrcaProvider`, `useOrca()`, `useCourse(slug)`.
- `src/hooks/useFitScale.ts` — scales the fixed 854×834 map/path canvas to fit its container.
- `src/components/icons.tsx` — all icons, `currentColor`.
- `src/components/brand/OrcaLogo.tsx` — mascot, every body part is a tagged `<path>`, `swim` prop.
- `src/components/brand/Island.tsx` — 5 island variants as `motion.path`s, `float` prop, 280×230 frame.
- `src/components/brand/Decor.tsx` — `Wave` (drifts) and `Bubble`.
- `src/components/ui/` — `Button` (primary/secondary/dark/ghost), `Chip` + `ContextPill`, `RoundButton`.

## What to build next (in order)

UI kit still missing: `ProgressBar` (alice track, wisteria fill, periwinkle highlight strip),
`DueCard`, `AnswerOption` (idle/selected/correct/wrong), `Select` (native select under styled chrome),
`Toggle`, weight `Slider` (use `input.orca-range` from globals.css), `Tag` (hw/lab/rev/exam pills),
`Card` (parchment, 32px radius, 2px alice-deep border, lip-8), `Stat` tile, `PathNode` (done/current/locked).

Layout: `AppShell` = main area + 340px right `Sidebar` ("Due today" / "Due tomorrow" DueCards) with a
4-icon `NavBar` pinned at its bottom (calendar, upload, gear, chat → /calendar, /add-material,
/settings, /chat).

Routes (one per Figma frame):
1. `/` Onboarding — alice bg, bubbles, headline "Mastery Made Easy." 68px, pitch, Get started (→/home)
   + ghost "I already have an account", pager dots, floating islands on the right.
2. `/home` Knowledge Map — parchment bg, islands at `course.pos` in an 854×834 canvas (use
   `useFitScale`), label pill centred under each island at (x+140, y+196) with a due-count badge,
   orca swimming at (330,190) width 110, waves, "Add Course" dark button (→/new-course), streak chip.
   Clicking an island → `/course/[slug]`; clicking its label badge opens the Class Config modal.
3. `/course/[slug]` Knowledge Path — alice bg, dotted trail (`course.trail` or `trailFromPoints`),
   stroke wisteria-deep 8px dasharray "1 20", draw-on animation. Nodes at `topic.pos`: done = periwinkle
   + check, current = 104px wisteria + play + 150px pulsing halo + "START" bubble above, locked =
   parchment + lock. Labels to the right (name 22px bold, status 15px). Header: back, course name 34px,
   "N of M topics complete", 240px progress bar. Same sidebar. Current node → `/quiz/[slug]/[topic]`.
4. `/quiz/[slug]/[topic]` — parchment bg, close button, 880px progress bar, "n / 5", eyebrow
   "MULTIPLE CHOICE · K-MAPS", 40px prompt, optional truth table, AnswerOptions, bottom bar Skip/Check.
   After Check: reveal correct/wrong + explanation, then Continue. After last question → Quiz End.
5. Quiz End — alice bg, centred 640px result card (36px radius, lip-10): close, orca 190px, "Nice work.
   Keep going!" 42px, summary line, 3 stat tiles (accuracy, time, streak), Continue + "Review N misses".
   Call `recordQuiz` from the store.
6. `/chat` — back, "ALD" ContextPill top-right, orca 170px, "What would you like to learn today?" 46px,
   3 suggestion chips, chat input (alice, 40px radius, up-button + send-button). Messages list above
   input once a conversation starts. POST `/api/chat`.
7. Class Config modal (over /home) — 680×440 parchment card, "ALD Configurations", 3 Config Rows
   (bell icon, label, duration Select, cadence Select), "Configure weights →" link (→/settings), Done.
8. `/settings` Configurations — per-course cards (640px) with the 3 Config Rows, plus "Weights · ALD"
   panel (418px) with 4 sliders + percentages + "Add material type" ghost button.
9. `/calendar` — "September" 46px, legend tags, prev/next, 7-col grid of 148×112 day cells (18px
   radius, lip-3), events as Tag pills, today = wisteria circle on the day number, other-month days alice.
10. `/add-material` — "Add material" 44px, ContextPill, document preview card (filename + skeleton
    lines), form: type chips, assigned date + "Not assigned", due date + "No due date", reflect toggle
    row, full-width "Add to ALD". Calls `addMaterial`.
11. `/new-course` — "NEW ISLAND" eyebrow, "What are you studying?" 54px, pitch, Course Name input
    (24px, 3.5px wisteria border, 24px radius, lip-5), Create Course (→ addCourse → /home) + Cancel,
    live island preview (ALD variant at scale ~2.1) with the typed name in a label pill.

Also add `src/app/template.tsx` wrapping children in `motion.div` with the `page` variants for route
transitions, and `docs/ANIMATION.md` describing the animation architecture (see below).

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
