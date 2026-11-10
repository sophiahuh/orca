"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence } from "motion/react";
import { usePathname } from "next/navigation";
import { Spotlight } from "@/components/ui/Spotlight";
import { useElementBox, visibleElement } from "@/hooks/useElementBox";
import { isPublicPath } from "@/lib/auth/paths";
import { TIPS, eligibleTips } from "@/lib/onboarding/tips";
import { useOrca } from "@/lib/store";
import { setActiveTip } from "./active-tip";
import { TipBubble } from "./TipBubble";

/** How often the page is checked for tips to show, or for the showing tip's target leaving. */
const POLL_MS = 400;
/** Controls that use the arrow keys or Esc themselves: the tips leave the keys to them. */
const KEYS_BUSY = 'input, textarea, select, [contenteditable="true"], [role="textbox"], [role="radio"], [role="slider"], [role="listbox"], [role="option"], [role="combobox"]';

const byId = new Map(TIPS.map((t) => [t.id, t]));
const targetShown = (id: string | undefined) => !!id && visibleElement(byId.get(id)?.target ?? "") !== null;

/** The tips on one page shown one after another: their ids, fixed when the first one opened. */
interface Run {
  pathname: string;
  ids: string[];
  index: number;
}

/**
 * The onboarding tips (owner, 2026-11-10; src/lib/onboarding/tips.ts lists them). Mounted once for
 * the whole app: when unseen tips have their targets on screen it shows them one at a time, the
 * orca speaking, with everything but the target muted. Next (→), the X (Esc) and doing what the tip
 * points at mark it seen; Back (←) shows the one before. "Skip all tips" turns them off for good.
 * A tip whose target leaves the page before it was seen waits for another time.
 */
export function OnboardingTips() {
  const { onboarding, courses, results, markTipsSeen, skipTips } = useOrca();
  const pathname = usePathname();
  const [stored, setRun] = useState<Run | null>(null);
  const off = onboarding.skipped || isPublicPath(pathname);
  // A run belongs to the page it started on: leaving the page ends it.
  const run = !off && stored?.pathname === pathname ? stored : null;
  const tip = run ? (byId.get(run.ids[run.index]) ?? null) : null;
  const box = useElementBox(tip?.target ?? null);
  const seen = useMemo(() => new Set(onboarding.seen), [onboarding.seen]);
  const sessions = results.length;
  const courseCount = courses.length;

  // Start a run when unseen tips' targets are on the page; end it when the showing tip's target goes.
  useEffect(() => {
    if (off) return;
    const timer = window.setInterval(() => {
      if (tip) {
        if (!visibleElement(tip.target)) setRun(null);
        return;
      }
      const found = eligibleTips({ pathname, courses: courseCount, sessions }, seen, (selector) => visibleElement(selector) !== null);
      if (!found.length) return;
      visibleElement(found[0].target)?.scrollIntoView({ block: "nearest", inline: "nearest" });
      setRun({ pathname, ids: found.map((t) => t.id), index: 0 });
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [off, tip, pathname, courseCount, sessions, seen]);

  /** To the run's nearest tip in that direction whose target is still on the page; past the last, the run ends. */
  const move = useCallback(
    (step: 1 | -1) => {
      if (!run) return;
      let i = run.index + step;
      while (i >= 0 && i < run.ids.length && !targetShown(run.ids[i])) i += step;
      if (i < 0) return; // nothing before it: Back does nothing
      setRun(i < run.ids.length ? { ...run, index: i } : null);
    },
    [run],
  );
  const next = useCallback(() => {
    if (!tip) return;
    markTipsSeen([tip.id]);
    move(1);
  }, [tip, markTipsSeen, move]);
  const back = useCallback(() => move(-1), [move]);

  useEffect(() => {
    if (!tip) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target instanceof Element && e.target.closest(KEYS_BUSY)) return;
      if (e.key === "ArrowRight" || e.key === "Escape") next();
      else if (e.key === "ArrowLeft") back();
      else return;
      // The tip took the key: the page doesn't scroll, and a modal under the tip doesn't close on Esc.
      e.preventDefault();
      e.stopPropagation();
    };
    // Doing what the tip points at (clicking its target) counts as having seen it.
    const onClick = (e: MouseEvent) => {
      const el = visibleElement(tip.target);
      if (el && e.target instanceof Node && el.contains(e.target)) next();
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("click", onClick, true);
    };
  }, [tip, next, back]);

  const showing = tip && box ? tip.id : null;
  useEffect(() => {
    setActiveTip(showing);
    return () => setActiveTip(null);
  }, [showing]);

  if (!run || !tip || !box) return null;
  return (
    <>
      <Spotlight target={box} />
      <AnimatePresence mode="wait">
        <TipBubble key={tip.id} tip={tip} target={box} index={run.index} total={run.ids.length} onBack={back} onNext={next} onSkip={skipTips} />
      </AnimatePresence>
    </>
  );
}
