"use client";

import type { CSSProperties } from "react";
import { cn } from "@/lib/cn";

/** Figma: weight slider. Uses the `orca-range` styles from globals.css. */
export interface SliderProps {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  label: string;
  className?: string;
}

export function Slider({ value, onChange, min = 0, max = 100, step = 5, label, className }: SliderProps) {
  const fill = ((value - min) / (max - min)) * 100;
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
      style={{ "--fill": `${fill}%` } as CSSProperties}
    />
  );
}
