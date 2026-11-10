import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * The admin view's frame (2026-11-10): a section rail across the top and a dense parchment page.
 * Server components; the pages pass what they read. Plain and dense on purpose: tables over cards.
 */
const SECTIONS = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/questions", label: "Questions" },
  { href: "/admin/spend", label: "Spend" },
] as const;

export type AdminSection = (typeof SECTIONS)[number]["href"];

export function AdminPage({ title, current, children }: { title: string; current: AdminSection; children: ReactNode }) {
  return (
    <div data-part="admin" className="min-h-screen-below-bar w-full bg-parchment px-[24px] pb-[48px] pt-[20px] text-prussian">
      <header className="mb-[20px] flex flex-wrap items-end justify-between gap-[12px]">
        <div>
          <p className="eyebrow text-wisteria-deep">Admin</p>
          <h1 className="text-[34px] font-bold leading-none">{title}</h1>
        </div>
        <nav aria-label="Admin sections" className="flex gap-[8px]">
          {SECTIONS.map((s) => (
            <Link
              key={s.href}
              href={s.href}
              aria-current={s.href === current ? "page" : undefined}
              className={cn("rounded-[12px] border-2 px-[12px] py-[6px] text-[15px] font-semibold", s.href === current ? "border-prussian bg-prussian text-parchment" : "border-alice-deep bg-alice text-prussian")}
            >
              {s.label}
            </Link>
          ))}
        </nav>
      </header>
      <div className="flex flex-col gap-[28px]">{children}</div>
    </div>
  );
}

/** A section heading with an optional count or note on the right. */
export function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-[10px]">
      <div className="flex items-baseline justify-between gap-[12px]">
        <h2 className="text-[20px] font-semibold">{title}</h2>
        {aside && <span className="text-[14px] text-wisteria-deep">{aside}</span>}
      </div>
      {children}
    </section>
  );
}

/** One row of small figures. */
export function Tiles({ tiles }: { tiles: Array<{ label: string; value: string }> }) {
  return (
    <div data-part="admin-tiles" className="flex flex-wrap gap-[10px]">
      {tiles.map((t) => (
        <div key={t.label} className="flex min-w-[120px] flex-col gap-[2px] rounded-[14px] border-2 border-alice-deep bg-alice px-[14px] py-[10px]">
          <span className="text-[22px] font-bold leading-none">{t.value}</span>
          <span className="text-[13px] font-medium text-wisteria-deep">{t.label}</span>
        </div>
      ))}
    </div>
  );
}

export interface Column<T> {
  key: string;
  label: ReactNode;
  /** Right-aligned (numbers). */
  num?: boolean;
  cell: (row: T) => ReactNode;
}

/** A dense table. `empty` is shown instead of a table with no rows: never a blank space. */
export function Table<T>({ columns, rows, rowKey, empty, part }: { columns: Column<T>[]; rows: readonly T[]; rowKey: (row: T) => string; empty: string; part?: string }) {
  if (!rows.length) return <p className="text-[15px] text-wisteria-deep">{empty}</p>;
  return (
    <div className="overflow-x-auto rounded-[14px] border-2 border-alice-deep bg-card">
      <table data-part={part} className="w-full border-collapse text-[14px]">
        <thead>
          <tr className="bg-alice text-left">
            {columns.map((c) => (
              <th key={c.key} scope="col" className={cn("whitespace-nowrap px-[10px] py-[8px] text-[12px] font-semibold uppercase tracking-[1px] text-wisteria-deep", c.num && "text-right")}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={rowKey(r)} className="border-t border-line align-top">
              {columns.map((c) => (
                <td key={c.key} className={cn("px-[10px] py-[6px]", c.num && "text-right tabular-nums")}>
                  {c.cell(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A figure Orca doesn't record, said so instead of shown as a number. */
export function NotRecorded({ what }: { what: string }) {
  return <span className="text-[14px] text-wisteria-deep">{what}: not recorded</span>;
}

/** A bar whose width is a share of the widest, for a spend-by-day table. */
export function Bar({ share }: { share: number }) {
  return (
    <span className="inline-block h-[10px] w-[160px] rounded-[4px] bg-alice align-middle">
      <span className="block h-full rounded-[4px] bg-wisteria" style={{ width: `${Math.round(Math.min(Math.max(share, 0), 1) * 100)}%` }} />
    </span>
  );
}
