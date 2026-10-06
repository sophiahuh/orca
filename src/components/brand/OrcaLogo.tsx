"use client";

import { motion, type HTMLMotionProps } from "motion/react";
import { swimOrca } from "@/lib/motion";

/**
 * The Orca mascot (Figma: Logo/Orca, master component 9:5), and with `waves` the header mark
 * (Figma: Logo/Orca Waves, 128:547: the same orca plus two sound-wave arcs, 178 × 124).
 * Natural aspect ratio is 150 × 123.85 (178 × 123.85 with waves). Pass `width`; height follows.
 *
 * Each body part is its own <path>, so later you can animate the tail,
 * blink the eye patch, etc. by targeting the data-part attributes.
 */
export interface OrcaLogoProps extends Omit<HTMLMotionProps<"div">, "children"> {
  width?: number;
  /** Ambient swim loop. */
  swim?: boolean;
  /** Drop the pale ground-shadow underneath. */
  shadow?: boolean;
  /** Dark-on-light (default) or pale periwinkle body for dark surfaces. */
  tone?: "dark" | "pale";
  /** The listening arcs to the right of the head (the header mark). */
  waves?: boolean;
}

/** The arcs of Logo/Orca Waves: two concentric strokes centred near the orca's ear, in Wisteria Blue. */
const WAVE_ARCS = [
  { r: 19, width: 4.5 },
  { r: 33, width: 5 },
] as const;
const WAVE_CENTRE = { x: 142, y: 37 };
const WAVE_HALF_ANGLE = (56 * Math.PI) / 180;

function arcPath(r: number): string {
  const a = WAVE_HALF_ANGLE;
  const x1 = WAVE_CENTRE.x + r * Math.cos(-a);
  const y1 = WAVE_CENTRE.y + r * Math.sin(-a);
  const x2 = WAVE_CENTRE.x + r * Math.cos(a);
  const y2 = WAVE_CENTRE.y + r * Math.sin(a);
  return `M${x1.toFixed(2)} ${y1.toFixed(2)} A${r} ${r} 0 0 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

export function OrcaLogo({ width = 150, swim = false, shadow = true, tone = "dark", waves = false, className, ...rest }: OrcaLogoProps) {
  const boxWidth = waves ? 178 : 150;
  const height = (width * 123.853) / boxWidth;
  const body = tone === "dark" ? "var(--color-prussian)" : "var(--color-periwinkle)";
  const belly = tone === "dark" ? "var(--color-parchment)" : "var(--color-alice)";

  return (
    <motion.div
      className={className}
      style={{ width, height, display: "inline-block", lineHeight: 0 }}
      animate={swim ? swimOrca : undefined}
      {...rest}
    >
      <svg viewBox={`0 0 ${boxWidth} 123.853`} width={width} height={height} fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="Orca">
        {shadow && (
          <path
            data-part="shadow"
            d="M18.5 83.9266C26.7569 94.9358 47.6147 104.45 72.3853 104.45C91.6514 104.45 116.422 97.9817 131.56 84.2202C141.881 75.1376 145.45 63.8716 146 54.9266L24 71.4266L18.5 83.9266Z"
            fill="var(--color-orca-shadow)"
          />
        )}
        <path
          data-part="belly"
          d="M18.5 83.4266C26.676 94.0933 47.6159 102.927 72.1438 102.927C91.221 102.927 115.749 96.6599 130.738 83.3266C140.958 74.5266 145.455 65.5933 146 56.9266L33 54.9266L18.5 83.4266Z"
          fill={belly}
        />
        <path
          data-part="body"
          d="M18.578 83.945C27.5229 56.422 37.156 44.0367 45.4128 36.4679V8.25688C45.6881 3.85321 48.4404 3.02752 51.6055 5.50459C57.1101 9.63303 62.6147 16.5138 66.7431 20.6422C88.0734 11.0092 109.61 12.5413 127.5 24.9266C135.757 31.8073 144.771 45.4128 145.872 55.3211C134.862 56.422 118.349 61.9266 110.367 73.211L77.0642 90.1376C68.8073 94.9541 56.422 92.8899 49.5413 86.6972C46.1009 83.2569 44.0367 78.4404 39.9083 74.3119C33.0275 69.4954 23.3945 72.9358 18.578 83.945Z"
          fill={body}
        />
        <path
          data-part="eye-patch"
          d="M106.718 64.0294C115.537 61.1641 121.238 54.388 119.454 48.8945C117.669 43.401 109.073 41.2704 100.254 44.1357C91.4358 47.001 85.734 53.7772 87.519 59.2707C89.3039 64.7641 97.8997 66.8947 106.718 64.0294Z"
          fill={belly}
        />
        <path
          data-part="tail"
          d="M3.44037 104.587C4.12844 97.7064 15.1376 88.0734 27.5229 81.8807C37.156 79.8165 48.1651 89.4495 51.6055 107.339C52.2936 116.972 44.0367 121.101 37.156 119.037C33.0275 117.661 30.2752 114.22 27.5229 110.367C19.2661 113.532 11.0092 114.22 6.19266 110.78C4.12844 108.991 3.44037 106.651 3.44037 104.587Z"
          fill={body}
        />
        <path
          data-part="fin"
          d="M77.0642 90.1376C75.6881 100.459 77.0642 111.468 82.5688 116.697C88.0734 117.661 100.459 107.339 108.716 94.9541C112.844 86.6972 112.844 79.8165 110.367 73.211L77.0642 90.1376Z"
          fill={body}
        />
        {waves &&
          WAVE_ARCS.map((arc) => (
            <path key={arc.r} data-part="wave" d={arcPath(arc.r)} stroke="var(--color-wisteria)" strokeWidth={arc.width} strokeLinecap="round" fill="none" />
          ))}
      </svg>
    </motion.div>
  );
}
