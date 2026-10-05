"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { IconCalendar, IconGear, IconUpload } from "@/components/icons";
import { cn } from "@/lib/cn";

const ITEMS = [
  { href: "/calendar", label: "Calendar", Icon: IconCalendar },
  { href: "/add-material", label: "Add material", Icon: IconUpload },
  { href: "/settings", label: "Configurations", Icon: IconGear },
] as const;

/** Three-icon nav pinned to the bottom of the sidebar. */
export function NavBar({ className }: { className?: string }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Primary" className={cn("flex items-center justify-between", className)}>
      {ITEMS.map(({ href, label, Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            aria-label={label}
            title={label}
            aria-current={active ? "page" : undefined}
            className={cn(
              "pressable inline-flex h-[48px] w-[48px] items-center justify-center rounded-[18px] border-2 lip-4",
              active
                ? "border-wisteria-deep bg-wisteria text-parchment lip-wisteria"
                : "border-alice-deep bg-parchment text-prussian lip-alice",
            )}
          >
            <Icon size={24} />
          </Link>
        );
      })}
    </nav>
  );
}
