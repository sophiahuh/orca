"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { IconCalendar, IconGear, IconUpload } from "@/components/icons";
import { useOrca } from "@/lib/store";
import { cn } from "@/lib/cn";

const ITEMS = [
  { href: "/calendar", label: "Calendar", Icon: IconCalendar },
  { href: "/add-material", label: "Add material", Icon: IconUpload },
  { href: "/settings", label: "Settings", Icon: IconGear },
] as const;

const BUTTON = "pressable inline-flex h-[48px] w-[48px] items-center justify-center rounded-[18px] border-2 lip-4";
const IDLE = "border-alice-deep bg-parchment text-prussian lip-alice";

/**
 * Three-icon nav pinned to the bottom of the sidebar. A course's settings button goes to that
 * course's separate override page; elsewhere it goes to master Settings.
 */
export function NavBar({ className }: { className?: string }) {
  const pathname = usePathname();
  const { courses } = useOrca();
  // From a course's pages (or its quizzes and sessions), Add material opens on that course.
  const slug = /^\/(?:course|quiz|session)\/([^/?#]+)/.exec(pathname)?.[1];
  const course = pathname.startsWith("/course/") ? courses.find((c) => c.slug === slug) : undefined;
  return (
    <nav aria-label="Primary" className={cn("flex items-center justify-end gap-[12px]", className)}>
      {ITEMS.map(({ href, label, Icon }) => {
        // Home keeps its island canvas focused; Settings remains available from the top bar.
        if (href === "/settings" && pathname === "/home") return null;
        if (href === "/settings" && course) {
          return (
            <Link key={href} href={`/course/${course.slug}/settings`} aria-label={`${course.short} settings`} title={`${course.short} settings`} className={cn(BUTTON, IDLE)}>
              <Icon size={24} />
            </Link>
          );
        }
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href === "/add-material" && slug ? `${href}?course=${slug}` : href}
            aria-label={label}
            title={label}
            aria-current={active ? "page" : undefined}
            className={cn(BUTTON, active ? "border-wisteria-deep bg-wisteria text-parchment lip-wisteria" : IDLE)}
          >
            <Icon size={24} />
          </Link>
        );
      })}
    </nav>
  );
}
