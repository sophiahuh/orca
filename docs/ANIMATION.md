# Orca animation architecture

Orca should feel like water: soft, springy, never snappy. Everything that moves
pulls its timing from one file so the whole product shares a personality, and
every visual that will ever move is already a `motion.*` element so new
animations are additive, not a restructure.

## Where things live

| Layer | File | What it owns |
|---|---|---|
| Presets | `src/lib/motion.ts` | Every spring, easing, variant and ambient loop. **Add new timing here, never inline.** |
| Global config | `src/app/providers.tsx` | `MotionConfig reducedMotion="user"` so transforms are skipped for people who ask the OS for less motion. |
| Route transitions | `src/app/template.tsx` | Wraps each page in a `motion.div` using the `page` variants. Templates remount per route, so the enter plays on every navigation. |
| CSS press | `globals.css` `pressable` | Buttons, chips, cards sink into their lip shadow on `:active`. Pure CSS, so it is free. |
| Brand SVGs | `src/components/brand/*` | Islands, orca, waves, bubbles. Every body part / blob is a tagged `motion.path` (`data-part`). |
| UI kit | `src/components/ui/*` | ProgressBar fill, Toggle knob, PathNode halo, AnswerOption rows and Stat tiles are `motion.*` with variants. |

## The presets

```
spring / springSoft / springBouncy   – the three springs; everything interactive uses one of them
easeOrca                             – cubic-bezier(0.22, 1, 0.36, 1) for durations
fadeUp, popIn                        – entrance variants (hidden / show / exit)
stagger(delay, gap)                  – parent variant that staggers fadeUp/popIn children
page                                 – route enter/exit (template.tsx)
floatIsland(seed), driftWave(seed)   – ambient loops; the seed desynchronises neighbours
swimOrca, pulseHalo                  – mascot loop, current-node halo
drawTrail                            – pathLength draw-on for solid paths
revealDown(height)                   – clip-rect reveal for dotted paths (pathLength would override the dash)
```

## Patterns used in the screens

- **Lists**: a `stagger()` parent with `fadeUp` children (sidebar due cards, config rows, quiz
  options, calendar cells with a very short gap).
- **Modals and result cards**: `popIn` inside `AnimatePresence` (class config modal, quiz end).
- **State changes**: animate the property, not the component. The progress bar animates `width`;
  the toggle animates the knob's `x`; answer rows animate their colour via CSS transitions and
  only use `layout` for reflow.
- **Ambient**: islands bob, waves drift, the orca swims. All loops are `repeat: Infinity` with
  seeds so nothing moves in lockstep. Pass `float` / `swim` / `drift` props to turn them on.
- **Canvases**: the map and path are a fixed 854×834 canvas scaled with `useFitScale`, so
  positions from Figma are used verbatim and animations are in design pixels.

## Adding a new animation

1. Write the preset in `motion.ts` (a `Variants` object or a `(seed) => target` function).
2. Target an existing `motion.*` element, ideally by `data-part` so the SVG does not change.
3. Respect reduced motion: transforms are already suppressed by `MotionConfig`; if you add
   opacity-only loops that feel busy, gate them on `useReducedMotion()`.

## Next steps when ready

- Orca follows a path across the map (`offsetPath` on the `OrcaLogo` wrapper).
- Islands grow trees as topics complete: animate tree `r` / `height` from 0 inside `Island`.
- Trail segments fill between nodes as they complete (second path, `pathLength` per segment).
- Confetti / bubble burst on a perfect quiz.
