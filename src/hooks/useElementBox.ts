"use client";

import { useEffect, useState } from "react";
import type { Box } from "@/lib/anchor-geometry";

/** The first element matching the selector that is actually drawn (has a size). */
export function visibleElement(selector: string): Element | null {
  for (const el of document.querySelectorAll(selector)) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return el;
  }
  return null;
}

const boxOf = (el: Element): Box => {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
};
const sameBox = (a: Box | null, b: Box | null) =>
  a === b || (!!a && !!b && Math.abs(a.left - b.left) < 0.5 && Math.abs(a.top - b.top) < 0.5 && Math.abs(a.width - b.width) < 0.5 && Math.abs(a.height - b.height) < 0.5);

/**
 * Where the element matching `selector` is on screen, followed as the page scrolls, resizes or
 * moves it (checked every `pollMs` too, for layout changes no event announces). Null while there is
 * no selector or no visible match. When the selector changes, the previous element's box is kept
 * until the new one is measured (the next frame), so whatever is drawn there doesn't blink out.
 */
export function useElementBox(selector: string | null, pollMs = 250): Box | null {
  const [state, setState] = useState<{ selector: string; box: Box | null } | null>(null);
  useEffect(() => {
    if (!selector) return;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const el = visibleElement(selector);
        const box = el ? boxOf(el) : null;
        setState((s) => (s && s.selector === selector && sameBox(s.box, box) ? s : { selector, box }));
      });
    };
    measure();
    const timer = window.setInterval(measure, pollMs);
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(frame);
      window.clearInterval(timer);
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
    };
  }, [selector, pollMs]);
  return selector ? (state?.box ?? null) : null;
}
