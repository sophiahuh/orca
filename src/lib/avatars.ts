/**
 * The five "sea buddy" avatars (Figma: Header & Nav Assets → Avatars; the sign-up picker). A
 * profile holds one by id; the drawings are in `src/components/brand/Avatar.tsx`. Pure.
 */
export const AVATARS = ["orca", "dolphin", "octopus", "turtle", "jellyfish"] as const;

export type AvatarId = (typeof AVATARS)[number];

export const AVATAR_LABEL: Record<AvatarId, string> = {
  orca: "Orca",
  dolphin: "Dolphin",
  octopus: "Octopus",
  turtle: "Turtle",
  jellyfish: "Jellyfish",
};

export const DEFAULT_AVATAR: AvatarId = "orca";

export function isAvatar(value: unknown): value is AvatarId {
  return typeof value === "string" && (AVATARS as readonly string[]).includes(value);
}
