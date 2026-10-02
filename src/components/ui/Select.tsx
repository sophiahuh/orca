"use client";

import type { SelectHTMLAttributes } from "react";
import { IconDown } from "@/components/icons";
import { cn } from "@/lib/cn";

/**
 * Figma: Select (Config rows). A native <select> sits invisibly on top of
 * styled chrome, so keyboard + mobile pickers work for free.
 */
export interface SelectProps<T extends string> extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "value" | "onChange" | "size"> {
  value: T;
  options: readonly T[];
  onChange: (value: T) => void;
  label: string;
  size?: "md" | "sm";
  /** Display text per option value (defaults to the value itself). */
  labels?: Partial<Record<T, string>>;
}

export function Select<T extends string>({ value, options, onChange, label, size = "md", labels, className, ...rest }: SelectProps<T>) {
  const text = (v: T) => labels?.[v] ?? v;
  return (
    <span
      className={cn(
        "pressable relative inline-flex items-center gap-2 rounded-[12px] border-2 border-periwinkle-deep bg-parchment font-bold text-prussian lip-3 lip-periwinkle",
        size === "md" ? "h-[40px] px-[14px] text-[15px]" : "h-[34px] px-[12px] text-[14px]",
        className,
      )}
    >
      <span className="whitespace-nowrap">{text(value)}</span>
      <IconDown size={16} className="text-prussian" />
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        {...rest}
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {text(o)}
          </option>
        ))}
      </select>
    </span>
  );
}
