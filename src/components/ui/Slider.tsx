"use client";

import type { CSSProperties } from "react";
import { cn } from "@/lib/cn";

/**
 * Figma: weight slider. Uses the `orca-range` styles from globals.css. `onChange` fires on every
 * step while dragging (the screen follows); `onCommit` fires once when the student lets go (pointer
 * up, a key released, focus leaving), which is when a save should happen.
 */
export interface SliderProps {
  value: number;
  onChange: (v: number) => void;
  /** The value settled on when the drag or key press ends. */
  onCommit?: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  label: string;
  className?: string;
}

export function Slider({ value, onChange, onCommit, min = 0, max = 100, step = 5, label, className }: SliderProps) {
  const fill = ((value - min) / (max - min)) * 100;
  const commit = (e: { currentTarget: HTMLInputElement }) => onCommit?.(Number(e.currentTarget.value));
  return (
    <input
      type="range"
      className={cn("orca-range w-full cursor-pointer", className)}
      aria-label={label}
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      onPointerUp={commit}
      onKeyUp={commit}
      onBlur={commit}
      style={{ "--fill": `${fill}%` } as CSSProperties}
    />
  );
}
