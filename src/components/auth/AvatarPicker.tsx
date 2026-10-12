"use client";

import { Avatar } from "@/components/brand/Avatar";
import { LabelPill } from "@/components/map/LabelPill";
import { AVATARS, AVATAR_LABEL, type AvatarId } from "@/lib/avatars";
import { cn } from "@/lib/cn";

/**
 * Figma: Avatar picker (13 · Sign up, 153:756): the chosen creature large in a ring, its name in
 * an island label, "Pick your sea buddy", and the five choices. `compact` is the Settings version
 * (choices only, the current one ringed).
 */
export function AvatarPicker({ value, onChange, compact = false, className }: { value: AvatarId; onChange: (a: AvatarId) => void; compact?: boolean; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center gap-[22px]", className)} data-part="avatar-picker">
      {!compact && (
        <>
          <div className="relative rounded-pill lip-6 lip-periwinkle" data-part="avatar-selected">
            <Avatar creature={value} size={210} selected />
          </div>
          <LabelPill interactive={false} className="text-[18px]">
            {AVATAR_LABEL[value]}
          </LabelPill>
          <p className="text-[16px] font-semibold text-wisteria-deep">Pick your sea buddy</p>
        </>
      )}
      <div role="radiogroup" aria-label="Avatar" className="flex items-center gap-[14px]">
        {AVATARS.map((a) => (
          <button
            key={a}
            type="button"
            role="radio"
            aria-checked={a === value}
            aria-label={AVATAR_LABEL[a]}
            title={AVATAR_LABEL[a]}
            onClick={() => onChange(a)}
            className={cn("pressable rounded-pill lip-2 lip-alice", a === value && "lip-3 lip-wisteria")}
          >
            <Avatar creature={a} size={compact ? 48 : 64} selected={a === value} />
          </button>
        ))}
      </div>
    </div>
  );
}
