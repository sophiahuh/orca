"use client";

import { type ReactNode, useCallback, useState } from "react";
import { motion } from "motion/react";
import { IconClose } from "@/components/icons";
import { type Box, type Side, type Size, arrowOffset, placeBubble } from "@/lib/anchor-geometry";
import { cn } from "@/lib/cn";
import { popIn } from "@/lib/motion";

/** The pointer arrow: a rotated square half outside the edge facing the target. */
const ARROW: Record<Side, string> = {
  below: "top-[-7px] -translate-x-1/2",
  above: "bottom-[-7px] -translate-x-1/2",
  right: "left-[-7px] -translate-y-1/2",
  left: "right-[-7px] -translate-y-1/2",
};

/** How far along the card's edge its speech tail sits, pointing at the speaker. */
const TAIL_AT = 40;

/**
 * A popover beside an element on screen (`target`, e.g. from useElementBox): a soft-shadowed card,
 * placed where it fits and kept on screen (src/lib/anchor-geometry.ts), measured as it renders.
 * `arrow` points it at the element. With a `speaker` (a figure, e.g. the orca) the card is that
 * figure's speech bubble: the figure sits outside it, on the edge away from the element, and the
 * card's tail points at it. An X in its corner when `onClose` is given. Fixed position, above a
 * Spotlight on the same target. Use it inside AnimatePresence for its exit.
 */
export function AnchoredBubble({
  target,
  width = 360,
  arrow = true,
  speaker,
  onClose,
  closeLabel = "Close",
  closePart = "bubble-close",
  role = "dialog",
  label,
  className,
  children,
  ...data
}: {
  target: Box;
  width?: number;
  /** Point at the target (default). */
  arrow?: boolean;
  /** Who is speaking: drawn outside the card, which becomes their speech bubble. */
  speaker?: ReactNode;
  onClose?: () => void;
  closeLabel?: string;
  closePart?: string;
  role?: "dialog" | "tooltip" | "status";
  label?: string;
  className?: string;
  children: ReactNode;
} & { [attribute: `data-${string}`]: string | undefined }) {
  const [size, setSize] = useState<Size>({ width, height: 160 });
  // Its real size, for placing it (a ref callback: React 19 runs the returned cleanup).
  const measure = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    const read = () => setSize((s) => (s.width === el.offsetWidth && s.height === el.offsetHeight ? s : { width: el.offsetWidth, height: el.offsetHeight }));
    const observer = new ResizeObserver(read);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const place = placeBubble(target, size, { width: window.innerWidth, height: window.innerHeight });
  const along = arrowOffset(target, size, place);
  const vertical = place.side === "below" || place.side === "above";
  // The speaker goes on the edge away from the target: above the card when the card is above it.
  const speakerOnTop = place.side === "above";
  const speakerRow = speaker && (
    <div className={cn("flex px-[6px]", speakerOnTop ? "mb-[6px] items-end" : "mt-[6px] items-start")} data-part="bubble-speaker">
      {speaker}
    </div>
  );
  return (
    <motion.div
      ref={measure}
      variants={popIn}
      initial="hidden"
      animate="show"
      exit="exit"
      role={role}
      aria-label={label}
      data-side={place.side}
      className="fixed z-[61] max-w-[calc(100vw-24px)]"
      style={{ left: place.left, top: place.top, width }}
      {...data}
    >
      {speakerOnTop && speakerRow}
      <div className={cn("relative rounded-[24px] bg-parchment px-[22px] pb-[18px] pt-[20px] shadow-[0_12px_32px_-6px_rgb(21_29_58/0.35)]", className)}>
        {arrow && (
          <div
            aria-hidden
            data-part="bubble-arrow"
            className={cn("absolute h-[16px] w-[16px] rotate-45 rounded-[3px] bg-parchment", ARROW[place.side])}
            style={vertical ? { left: along } : { top: along }}
          />
        )}
        {speaker && (
          <div
            aria-hidden
            data-part="bubble-tail"
            className={cn("absolute h-[18px] w-[18px] -translate-x-1/2 rotate-45 rounded-[3px] bg-parchment", speakerOnTop ? "top-[-8px]" : "bottom-[-8px]")}
            style={{ left: TAIL_AT }}
          />
        )}
        {onClose && (
          <button type="button" onClick={onClose} aria-label={closeLabel} data-part={closePart} className="absolute right-[14px] top-[14px] cursor-pointer rounded-full p-[4px] text-prussian/50 hover:text-prussian">
            <IconClose size={18} />
          </button>
        )}
        {children}
      </div>
      {!speakerOnTop && speakerRow}
    </motion.div>
  );
}
