/**
 * Orca motion presets.
 *
 * Every animated element in the app pulls its timing from here so the whole
 * product moves with one personality: soft, springy, never snappy.
 *
 * Usage:
 *   import { motion } from "motion/react";
 *   import { spring, fadeUp, floatIsland } from "@/lib/motion";
 *   <motion.div variants={fadeUp} initial="hidden" animate="show" />
 */
import type { Transition, Variants } from "motion/react";

/* ── Springs ─────────────────────────────────────────────────────────── */
export const spring: Transition = { type: "spring", stiffness: 420, damping: 32, mass: 0.9 };
export const springSoft: Transition = { type: "spring", stiffness: 260, damping: 28 };
export const springBouncy: Transition = { type: "spring", stiffness: 520, damping: 22 };

/* ── Easing curves ───────────────────────────────────────────────────── */
export const easeOrca = [0.22, 1, 0.36, 1] as const;

/* ── Entrance variants ───────────────────────────────────────────────── */
export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: spring },
  exit: { opacity: 0, y: -8, transition: { duration: 0.18 } },
};

export const popIn: Variants = {
  hidden: { opacity: 0, scale: 0.86 },
  show: { opacity: 1, scale: 1, transition: springBouncy },
  exit: { opacity: 0, scale: 0.92, transition: { duration: 0.15 } },
};

/** Parent that staggers its children's `fadeUp` / `popIn` variants. */
export const stagger = (delayChildren = 0.05, staggerChildren = 0.06): Variants => ({
  hidden: {},
  show: { transition: { delayChildren, staggerChildren } },
});

/* ── Page transition (used by app/template.tsx) ──────────────────────── */
export const page: Variants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.32, ease: easeOrca } },
  exit: { opacity: 0, y: -6, transition: { duration: 0.16, ease: "easeIn" } },
};

/* ── Ambient loops ───────────────────────────────────────────────────── */
/** Islands bob gently on the water. `seed` desynchronizes neighbours. */
export const floatIsland = (seed = 0) => ({
  y: [0, -6, 0],
  rotate: [0, seed % 2 === 0 ? 0.6 : -0.6, 0],
  transition: {
    duration: 5.5 + (seed % 3) * 0.7,
    repeat: Infinity,
    ease: "easeInOut" as const,
    delay: (seed * 0.37) % 2,
  },
});

/** Waves drift sideways and fade. */
export const driftWave = (seed = 0) => ({
  x: [0, 8, 0],
  opacity: [0.8, 1, 0.8],
  transition: {
    duration: 4 + (seed % 4) * 0.5,
    repeat: Infinity,
    ease: "easeInOut" as const,
    delay: (seed * 0.53) % 3,
  },
});

/** The orca mascot swims: a lazy figure-eight with a little roll. */
export const swimOrca = {
  x: [0, 14, 0, -14, 0],
  y: [0, -8, 0, 8, 0],
  rotate: [0, -4, 0, 4, 0],
  transition: { duration: 7, repeat: Infinity, ease: "easeInOut" as const },
};

/** Halo pulse behind the current path node. */
export const pulseHalo = {
  scale: [1, 1.12, 1],
  opacity: [0.55, 0.3, 0.55],
  transition: { duration: 2.4, repeat: Infinity, ease: "easeInOut" as const },
};

/** Quick crossfade for swapped text (calendar month heading). */
export const fadeSwap: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: 0.18 } },
  exit: { opacity: 0, y: -8, transition: { duration: 0.18 } },
};

/** Dim overlay behind modals. */
export const overlayFade: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: 0.2 } },
  exit: { opacity: 0, transition: { duration: 0.2 } },
};

/** One of the three "Orca is typing" dots; `i` staggers them. */
export const typingDot = (i: number) => ({
  y: [0, -5, 0],
  transition: { duration: 0.9, repeat: Infinity, delay: i * 0.15, ease: "easeInOut" as const },
});

/* ── Trail draw-on ───────────────────────────────────────────────────── */
/** Solid paths: animate pathLength. (Overrides stroke-dasharray, so not for dotted trails.) */
export const drawTrail: Variants = {
  hidden: { pathLength: 0, opacity: 0 },
  show: { pathLength: 1, opacity: 1, transition: { duration: 1.4, ease: easeOrca } },
};

/** Dotted paths: reveal top-to-bottom by growing a clip rect's `height` to `full`. */
export const revealDown = (full: number): Variants => ({
  hidden: { height: 0 },
  show: { height: full, transition: { duration: 1.4, ease: easeOrca } },
});
