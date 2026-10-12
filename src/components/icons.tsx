/**
 * Orca icon set, traced from the Figma file. All icons use `currentColor`
 * so they inherit the text color of their parent; set `size` in px.
 */
import type { SVGProps } from "react";

export interface IconProps extends SVGProps<SVGSVGElement> {
  size?: number;
}

const base = (size: number, props: IconProps) => ({
  width: size,
  height: size,
  fill: "none",
  stroke: "currentColor",
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  xmlns: "http://www.w3.org/2000/svg",
  "aria-hidden": true,
  ...props,
});

export function IconPlay({ size = 20, ...props }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" {...base(size, props)} strokeWidth={1.67}>
      <path d="M6.67 4.17v11.66L15.83 10 6.67 4.17Z" fill="currentColor" />
    </svg>
  );
}

export function IconCheck({ size = 32, ...props }: IconProps) {
  return (
    <svg viewBox="0 0 32 32" {...base(size, props)} strokeWidth={4}>
      <path d="M6.65 16.63l6 6L25.3 10" />
    </svg>
  );
}

export function IconBack({ size = 26, ...props }: IconProps) {
  return (
    <svg viewBox="0 0 26 26" {...base(size, props)} strokeWidth={3.25}>
      <path d="M16.25 5.42 8.67 13l7.58 7.58" />
    </svg>
  );
}

export function IconNext({ size = 26, ...props }: IconProps) {
  return (
    <svg viewBox="0 0 26 26" {...base(size, props)} strokeWidth={3.25}>
      <path d="M9.75 5.42 17.33 13l-7.58 7.58" />
    </svg>
  );
}

export function IconClose({ size = 25, ...props }: IconProps) {
  return (
    <svg viewBox="0 0 25 25" {...base(size, props)} strokeWidth={3.12}>
      <path d="M6.24 6.24l12.48 12.48M18.72 6.24 6.24 18.72" />
    </svg>
  );
}

export function IconPlus({ size = 20, ...props }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" {...base(size, props)} strokeWidth={2.5}>
      <path d="M10 4.17v11.66M4.17 10h11.66" />
    </svg>
  );
}

export function IconDown({ size = 18, ...props }: IconProps) {
  return (
    <svg viewBox="0 0 18 18" {...base(size, props)} strokeWidth={2.25}>
      <path d="M4.5 6.75 9 11.25l4.5-4.5" />
    </svg>
  );
}

export function IconArrowRight({ size = 20, ...props }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" {...base(size, props)} strokeWidth={2.5}>
      <path d="M4.17 10h11.66M10.83 15l5-5-5-5" />
    </svg>
  );
}

export function IconCalendar({ size = 26, ...props }: IconProps) {
  return (
    <svg viewBox="0 0 26 26" {...base(size, props)} strokeWidth={2.71}>
      <rect x="3.25" y="5.42" width="19.5" height="17.33" rx="4.33" />
      <path d="M3.25 10.83h19.5M8.67 3.25v4.33M17.33 3.25v4.33" />
    </svg>
  );
}

export function IconUpload({ size = 26, ...props }: IconProps) {
  return (
    <svg viewBox="0 0 26 26" {...base(size, props)} strokeWidth={2.71}>
      <path d="M13 17.33V4.33M19.5 10.83 13 4.33l-6.5 6.5" />
      <path d="M4.33 17.33v3.25a2.17 2.17 0 0 0 2.17 2.17h13a2.17 2.17 0 0 0 2.17-2.17v-3.25" />
    </svg>
  );
}

export function IconGear({ size = 26, ...props }: IconProps) {
  return (
    <svg viewBox="0 0 26 26" {...base(size, props)} strokeWidth={2.71}>
      <circle cx="13" cy="13" r="3.79" />
      <path d="M13 2.71v3.25M13 20.04v3.25M2.71 13h3.25M20.04 13h3.25M5.74 5.74l2.28 2.28M17.98 17.98l2.28 2.28M5.74 20.26l2.28-2.28M17.98 8.02l2.28-2.28" />
    </svg>
  );
}

/** Figma: Icon/Settings (Header & Nav Assets; 24 px grid, 2.2 px round stroke). */
export function IconSettings({ size = 24, ...props }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...base(size, props)} strokeWidth={2.2}>
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

/** Figma: Icon/Log out (Header & Nav Assets). */
export function IconLogOut({ size = 24, ...props }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...base(size, props)} strokeWidth={2.2}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="M16 17l5-5-5-5" />
      <path d="M21 12H9" />
    </svg>
  );
}

export function IconBell({ size = 20, ...props }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" {...base(size, props)} strokeWidth={2.08}>
      <path d="M5 13.33V9.17a5 5 0 0 1 10 0v4.16L16.67 15H3.33L5 13.33Z" />
      <path d="M8.33 17.5h3.34" />
    </svg>
  );
}
