import Link from "next/link";
import type { UserRow, UserSort } from "@/lib/admin/stats";
import { cn } from "@/lib/cn";
import { Table } from "./AdminPage";
import { int, money, when, yesNo } from "./format";

/** One row per profile; the Spend and Last active headers link to the users page sorted by them. */
export function UsersTable({ rows, sort }: { rows: readonly UserRow[]; sort: UserSort }) {
  const sortLink = (key: UserSort, label: string) => (
    <Link href={`/admin/users?sort=${key}`} aria-current={sort === key ? "true" : undefined} className={cn("underline-offset-2 hover:underline", sort === key && "underline")}>
      {label}
      {sort === key ? " ↓" : ""}
    </Link>
  );
  return (
    <Table
      part="admin-users"
      rows={rows}
      rowKey={(u) => u.id}
      empty="No accounts yet."
      columns={[
        {
          key: "who",
          label: "Account",
          cell: (u) => (
            <Link href={`/admin/users/${u.id}`} className="font-semibold underline-offset-2 hover:underline">
              {u.name ?? "(no name)"}
              {u.isAdmin && <span className="ml-[6px] rounded-[6px] bg-wisteria px-[6px] text-[11px] font-semibold uppercase text-parchment">admin</span>}
            </Link>
          ),
        },
        { key: "email", label: "Email", cell: (u) => u.email ?? "—" },
        { key: "joined", label: sortLink("joined", "Joined"), cell: (u) => when(u.joined) },
        { key: "active", label: sortLink("active", "Last active"), cell: (u) => when(u.lastActive, "never") },
        { key: "courses", label: "Courses", num: true, cell: (u) => int(u.courses) },
        { key: "uploads", label: "Uploads", num: true, cell: (u) => int(u.uploads) },
        { key: "pages", label: "Pages read", num: true, cell: (u) => int(u.pages) },
        { key: "answers", label: "Answers", num: true, cell: (u) => int(u.answers) },
        { key: "downs", label: "Thumbs down", num: true, cell: (u) => int(u.thumbsDown) },
        { key: "spend", label: sortLink("spend", "Spend"), num: true, cell: (u) => money(u.spend) },
        { key: "connector", label: "Connector", cell: (u) => yesNo(u.connector) },
        { key: "canvas", label: "Canvas", cell: (u) => yesNo(u.canvas) },
      ]}
    />
  );
}
