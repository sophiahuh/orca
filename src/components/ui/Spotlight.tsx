"use client";

import { type Box, PAD, spotlightClip } from "@/lib/anchor-geometry";

/**
 * Draws the eye to one element: a full-screen layer that mutes everything else (lower saturation,
 * a light prussian wash) with a hole at the element, and a ring around the hole. It never takes
 * clicks, so the page stays usable. Above the app's modals and toasts (z-50), below a popover
 * pointing at the element (AnchoredBubble, z-61).
 */
export function Spotlight({ target, pad = PAD }: { target: Box; pad?: number }) {
  return (
    <>
      <div aria-hidden data-part="spotlight-dim" className="pointer-events-none fixed inset-0 z-[60] bg-prussian/10 backdrop-saturate-[.35]" style={{ clipPath: spotlightClip(target, pad) }} />
      <div
        aria-hidden
        data-part="spotlight-ring"
        className="pointer-events-none fixed z-[60] rounded-[16px] ring-[3px] ring-wisteria"
        style={{ left: target.left - pad, top: target.top - pad, width: target.width + 2 * pad, height: target.height + 2 * pad }}
      />
    </>
  );
}
