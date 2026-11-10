"use client";

import { useViewportSize } from "@/hooks/useViewportSize";
import { type Box, PAD, SPOT_RADIUS, spotlightClip } from "@/lib/anchor-geometry";

/**
 * Draws the eye to one element: a light mask over everything else (a little desaturated and
 * dimmed) with a rounded hole at the element, outlined. It never takes clicks, so the page stays
 * usable. Above the app's modals and toasts (z-50), below a popover pointing at the element
 * (AnchoredBubble, z-61).
 */
export function Spotlight({ target, pad = PAD }: { target: Box; pad?: number }) {
  const viewport = useViewportSize();
  return (
    <>
      <div
        aria-hidden
        data-part="spotlight-dim"
        className="pointer-events-none fixed inset-0 z-[60] bg-prussian/[.06] backdrop-saturate-[.7]"
        style={{ clipPath: spotlightClip(target, viewport, pad) }}
      />
      <div
        aria-hidden
        data-part="spotlight-ring"
        className="pointer-events-none fixed z-[60] border-[3px] border-wisteria-deep"
        style={{ left: target.left - pad, top: target.top - pad, width: target.width + 2 * pad, height: target.height + 2 * pad, borderRadius: SPOT_RADIUS }}
      />
    </>
  );
}
