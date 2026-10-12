import { type AvatarId, AVATAR_LABEL } from "@/lib/avatars";
import { cn } from "@/lib/cn";

/**
 * The sea-buddy avatars (Figma: Avatar component, Creature=Orca | Dolphin | Octopus | Turtle |
 * Jellyfish; 96 px circles that scale). Drawn here as chunky, rounded shapes in the Orca palette
 * after the Figma renders: the Figma SVG exports couldn't be fetched from the build environment,
 * so these are hand-traced approximations (docs/figma/README, "Assets to export").
 */
export interface AvatarProps {
  creature: AvatarId;
  size?: number;
  className?: string;
  /** A thicker wisteria ring (the picker's selected state). */
  selected?: boolean;
}

/** Each creature's circle: the pale disc and the ring around it. */
const DISC: Record<AvatarId, { fill: string; ring: string }> = {
  orca: { fill: "#E1ECFA", ring: "#B4C8E6" },
  dolphin: { fill: "#D3F1EA", ring: "#9ED8CB" },
  octopus: { fill: "#FCE6DF", ring: "#F2BFB1" },
  turtle: { fill: "#DDF3E4", ring: "#A6DDBB" },
  jellyfish: { fill: "#E8E4FB", ring: "#C5BFF2" },
};

function Creature({ creature }: { creature: AvatarId }) {
  switch (creature) {
    case "orca":
      return (
        <g data-part="orca">
          <path d="M22 50c6-14 22-24 40-20l-6-12c6-2 12 2 16 10 10 4 10 14 8 20-6 10-18 14-34 14l-8 8c-2-4-2-8 0-12-8-2-13-5-16-8Z" fill="#151D3A" />
          <path d="M30 56c8 6 24 8 36 2 2-2 2-5 0-6-10 4-24 3-34-2-2 1-3 4-2 6Z" fill="#FCF7F4" />
          <ellipse cx="62" cy="46" rx="6.5" ry="4" fill="#FCF7F4" transform="rotate(-12 62 46)" />
          <circle cx="63.5" cy="45.5" r="1.7" fill="#151D3A" />
          <path d="M20 46c-5-2-9-6-9-11 4 1 8 4 10 8-1-5 0-9 3-12 3 4 4 9 3 14-3 2-5 2-7 1Z" fill="#151D3A" />
        </g>
      );
    case "dolphin":
      return (
        <g data-part="dolphin">
          <path d="M18 52c8-12 26-20 46-16l-4-9c7 0 12 4 15 11 9 5 9 13 6 18-8 8-22 10-38 8l-10 8c-1-4 0-8 2-11-8-1-13-5-17-9Z" fill="#839BEC" />
          <path d="M28 56c10 5 24 6 36 1 1-2 0-4-2-5-10 3-22 3-32-1-2 1-3 3-2 5Z" fill="#E1ECFA" />
          <path d="M40 40l6-10 3 10Z" fill="#5B78D8" />
          <circle cx="66" cy="45" r="2.2" fill="#151D3A" />
          <path d="M16 46c-5-1-9-5-9-10 4 1 7 3 9 7 0-4 1-8 4-10 2 4 3 9 1 13-2 1-4 1-5 0Z" fill="#839BEC" />
        </g>
      );
    case "octopus":
      return (
        <g data-part="octopus">
          <path d="M28 46c0-14 9-24 20-24s20 10 20 24c0 7-3 12-8 15H36c-5-3-8-8-8-15Z" fill="#F4A58F" />
          <path d="M33 58c-4 6-10 10-16 10 3 3 8 3 12 0-1 4-4 8-8 10 5 1 10-2 13-6l5-7Z" fill="#F4A58F" />
          <path d="M63 58c4 6 10 10 16 10-3 3-8 3-12 0 1 4 4 8 8 10-5 1-10-2-13-6l-5-7Z" fill="#F4A58F" />
          <path d="M42 62c-1 6-4 10-8 12 4 2 9 0 11-4 0 4 2 8 5 10 2-4 2-8 1-12Z" fill="#F4A58F" />
          <path d="M54 62c1 6 4 10 8 12-4 2-9 0-11-4 0 4-2 8-5 10-2-4-2-8-1-12Z" fill="#F4A58F" />
          <circle cx="41" cy="44" r="4.5" fill="#FCF7F4" />
          <circle cx="55" cy="44" r="4.5" fill="#FCF7F4" />
          <circle cx="42" cy="45" r="2" fill="#151D3A" />
          <circle cx="56" cy="45" r="2" fill="#151D3A" />
          <path d="M44 53c2 2 6 2 8 0" stroke="#C7715C" strokeWidth="2" strokeLinecap="round" fill="none" />
        </g>
      );
    case "turtle":
      return (
        <g data-part="turtle">
          <ellipse cx="46" cy="50" rx="24" ry="17" fill="#5BBFB0" />
          <path d="M46 36l10 6v12l-10 6-10-6V42Z" fill="#8ED9CC" />
          <path d="M26 42l-8-6c-2 3-2 7 0 10Zm40 0l8-6c2 3 2 7 0 10Zm-40 16l-8 6c-2-3-2-7 0-10Zm40 0l8 6c2-3 2-7 0-10Z" fill="#F2D28A" />
          <path d="M70 50c0-5 4-9 9-9s9 4 9 9-4 8-9 8-9-3-9-8Z" fill="#F2D28A" />
          <circle cx="82" cy="48" r="1.8" fill="#151D3A" />
        </g>
      );
    case "jellyfish":
      return (
        <g data-part="jellyfish">
          <path d="M26 46c0-13 9-22 22-22s22 9 22 22c0 3-2 5-5 5H31c-3 0-5-2-5-5Z" fill="#AFB5F2" />
          <path d="M31 51h34c0 3-3 5-6 5H37c-3 0-6-2-6-5Z" fill="#8C93DE" />
          <path d="M34 56c-1 8 2 14 0 20M43 56c1 7-1 14 1 20M53 56c-1 7 1 14-1 20M62 56c1 8-2 14 0 20" stroke="#8C93DE" strokeWidth="3" strokeLinecap="round" fill="none" />
          <circle cx="42" cy="40" r="2" fill="#151D3A" />
          <circle cx="54" cy="40" r="2" fill="#151D3A" />
        </g>
      );
  }
}

export function Avatar({ creature, size = 48, className, selected = false }: AvatarProps) {
  const disc = DISC[creature];
  return (
    <svg
      viewBox="0 0 96 96"
      width={size}
      height={size}
      role="img"
      aria-label={AVATAR_LABEL[creature]}
      data-avatar={creature}
      className={cn("shrink-0", className)}
    >
      <circle cx="48" cy="48" r="46" fill={disc.fill} stroke={selected ? "var(--color-wisteria-deep)" : disc.ring} strokeWidth={selected ? 5 : 3} />
      <Creature creature={creature} />
    </svg>
  );
}
