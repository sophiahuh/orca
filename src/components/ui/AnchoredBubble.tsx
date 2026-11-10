"use client";

import { type ReactNode, useCallback, useState } from "react";
import { motion } from "motion/react";
import { IconClose } from "@/components/icons";
import { Card } from "@/components/ui/Card";
import { type Box, type Size, placeBubble } from "@/lib/anchor-geometry";
import { cn } from "@/lib/cn";
import { popIn } from "@/lib/motion";

/**
 * A popover card pointing at an element on screen (`target`, e.g. from useElementBox): placed beside
 * it where it fits and kept on screen (src/lib/anchor-geometry.ts), measured as it renders. An X in
 * its corner when `onClose` is given. Fixed position, above a Spotlight on the same target. Use it
 * inside AnimatePresence for its exit.
 */
export function AnchoredBubble({
  target,
  width = 340,
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
      <Card radius={20} lip={4} className={cn("relative px-[16px] pb-[14px] pt-[16px]", className)}>
        {onClose && (
          <button type="button" onClick={onClose} aria-label={closeLabel} data-part={closePart} className="absolute right-[10px] top-[10px] cursor-pointer rounded-full p-[4px] text-prussian/70 hover:text-prussian">
            <IconClose size={16} />
          </button>
        )}
        {children}
      </Card>
    </motion.div>
  );
}
