/**
 * Where a bubble anchored to an element goes, and the clip-path that leaves that element out of a
 * full-screen layer, from the element's box on screen. Used by the onboarding tips; any popover
 * pointing at something can use it. Pure.
 */

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}
export interface Size {
  width: number;
  height: number;
}
export type Side = "below" | "above" | "right" | "left";

/** Between the target and the bubble: room for the spotlight's outline and the bubble's arrow. */
export const GAP = 18;
/** Between the bubble and the edge of the screen. */
export const MARGIN = 12;
/** How far the spotlight reaches past the target. */
export const PAD = 6;

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));

/**
 * The bubble's top-left corner: below the target when it fits, else above, right, left; centred on
 * the target along the other axis and kept on screen. With no room on any side it sits below,
 * clamped onto the screen (over the target, which then fills the screen anyway).
 */
export function placeBubble(target: Box, bubble: Size, viewport: Size): { left: number; top: number; side: Side } {
  const maxLeft = viewport.width - bubble.width - MARGIN;
  const maxTop = viewport.height - bubble.height - MARGIN;
  const x = clamp(target.left + target.width / 2 - bubble.width / 2, MARGIN, maxLeft);
  const y = clamp(target.top + target.height / 2 - bubble.height / 2, MARGIN, maxTop);
  const options: Array<{ side: Side; left: number; top: number }> = [
    { side: "below", left: x, top: target.top + target.height + GAP },
    { side: "above", left: x, top: target.top - GAP - bubble.height },
    { side: "right", left: target.left + target.width + GAP, top: y },
    { side: "left", left: target.left - GAP - bubble.width, top: y },
  ];
  const fits = (o: { left: number; top: number }) => o.left >= MARGIN && o.top >= MARGIN && o.left <= maxLeft && o.top <= maxTop;
  return options.find(fits) ?? { side: "below", left: x, top: clamp(target.top + target.height + GAP, MARGIN, maxTop) };
}

/** A CSS clip-path covering the whole screen except the target (padded): the layer that mutes everything else. */
export function spotlightClip(target: Box, pad: number = PAD): string {
  const l = Math.round(target.left - pad);
  const t = Math.round(target.top - pad);
  const r = Math.round(target.left + target.width + pad);
  const b = Math.round(target.top + target.height + pad);
  return `polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${l}px ${t}px, ${l}px ${b}px, ${r}px ${b}px, ${r}px ${t}px, ${l}px ${t}px)`;
}

/** How far a bubble's pointer arrow sits from the bubble's corner (keeps clear of its rounded corners). */
export const ARROW_INSET = 22;

/**
 * Where the bubble's pointer arrow goes along the edge facing the target: the distance from the
 * bubble's left edge (above/below) or top edge (left/right) to the arrow's centre, aimed at the
 * target's centre and kept off the bubble's rounded corners.
 */
export function arrowOffset(target: Box, bubble: Size, place: { left: number; top: number; side: Side }): number {
  const vertical = place.side === "below" || place.side === "above";
  const aim = vertical ? target.left + target.width / 2 - place.left : target.top + target.height / 2 - place.top;
  const length = vertical ? bubble.width : bubble.height;
  return clamp(aim, ARROW_INSET, length - ARROW_INSET);
}
