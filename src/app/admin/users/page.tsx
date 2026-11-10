import { UsersTable } from "@/components/admin/UsersTable";
import { AdminPage, Section } from "@/components/admin/AdminPage";
import { int } from "@/components/admin/format";
import { isUserSort } from "@/lib/admin/stats";
import { requireAdmin } from "@/lib/server/admin";
import { users } from "@/lib/server/admin-queries";

/** /admin/users?sort=joined|spend|active: one row per profile. Admins only. */
export const dynamic = "force-dynamic";

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function AdminUsersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = await searchParams;
  const sort = first(q.sort);
  const by = isUserSort(sort) ? sort : "joined";
  const { db } = await requireAdmin(`/admin/users?sort=${by}`);
  const rows = await users(db, by);
  const order = { joined: "newest first", spend: "most spent first", active: "most recently active first" }[by];
  return (
    <AdminPage title="Users" current="/admin/users">
      <Section title="Accounts" aside={`${int(rows.length)} · ${order}`}>
        <UsersTable rows={rows} sort={by} />
      </Section>
    </AdminPage>
  );
}
