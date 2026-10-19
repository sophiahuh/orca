"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "@/app/auth/actions";
import { Avatar } from "@/components/brand/Avatar";
import { useAvatarPreview } from "@/components/brand/avatar-preview";
import { OrcaLogo } from "@/components/brand/OrcaLogo";
import { IconLogOut, IconSettings } from "@/components/icons";
import { isPublicPath } from "@/lib/auth/paths";
import { useOrca } from "@/lib/store";

/**
 * Figma: Header/Top Bar (117:193) on every screen, Header/Top Bar Compact (117:194) under 640 px.
 * The lockup on the left (Logo/Orca Waves + "Orca"), Settings, Log out and the student's avatar on
 * the right. Account screens show only the avatar (13 · Sign up: the one being picked). Height
 * is `--topbar-h` (globals.css), which every full-height screen subtracts.
 */
const ICON_BUTTON = "pressable inline-flex h-[48px] w-[48px] items-center justify-center rounded-[16px] border-2 border-line bg-card text-ink lip-2 lip-alice";

export function TopBar() {
  const pathname = usePathname();
  const { status, avatar } = useOrca();
  const { preview } = useAvatarPreview();
  const guest = isPublicPath(pathname) || status === "signed-out";
  const creature = guest ? preview : avatar;

  return (
    <header data-part="top-bar" className="flex h-[var(--topbar-h)] shrink-0 items-center justify-between border-b-2 border-line bg-page px-[20px] sm:px-[28px]">
      <Link href="/" aria-label="Orca home" className="flex items-center gap-[12px]">
        <OrcaLogo waves shadow={false} width={60} />
        <span className="hidden text-[34px] font-bold leading-none text-ink sm:inline">Orca</span>
      </Link>
      <div className="flex items-center gap-[8px] sm:gap-[12px]" data-part="top-bar-actions">
        {!guest && (
          <>
            <Link href="/settings" aria-label="Settings" title="Settings" className={ICON_BUTTON}>
              <IconSettings size={24} />
            </Link>
            <form action={signOut}>
              <button type="submit" aria-label="Log out" title="Log out" className={ICON_BUTTON}>
                <IconLogOut size={24} />
              </button>
            </form>
          </>
        )}
        {guest ? (
          <Avatar creature={creature} size={44} className="sm:h-[48px] sm:w-[48px]" />
        ) : (
          <Link href="/settings" aria-label="Account" title="Account" className="pressable rounded-pill lip-2 lip-alice">
            <Avatar creature={creature} size={44} className="sm:h-[48px] sm:w-[48px]" />
          </Link>
        )}
      </div>
    </header>
  );
}
