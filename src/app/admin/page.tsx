import { UsersTable } from "@/components/admin/UsersTable";
import { AdminPage, Section, Tiles } from "@/components/admin/AdminPage";
import { int, money } from "@/components/admin/format";
import { requireAdmin } from "@/lib/server/admin";
import { overview, users } from "@/lib/server/admin-queries";

/** /admin: the overview tiles and the users table. Admins only; anyone else sees the app's 404. */
export const dynamic = "force-dynamic";

export default async function AdminOverviewPage() {
  const { db } = await requireAdmin("/admin");
  const [o, rows] = await Promise.all([overview(db), users(db, "joined")]);
  return (
    <AdminPage title="Overview" current="/admin">
      <Tiles
        tiles={[
          { label: "Users", value: int(o.users) },
          { label: "Courses", value: int(o.courses) },
          { label: "Uploads", value: int(o.uploads) },
          { label: "Spend today", value: money(o.spendToday) },
          { label: "Spend, 7 days", value: money(o.spend7d) },
          { label: "Spend, all time", value: money(o.spendAll) },
          { label: "Answers today", value: int(o.answersToday) },
          { label: "Open runs", value: int(o.openRuns) },
          { label: "Paused runs", value: int(o.pausedRuns) },
        ]}
      />
      <Section title="Users" aside={`${int(rows.length)} accounts · newest first`}>
        <UsersTable rows={rows} sort="joined" />
      </Section>
    </AdminPage>
  );
}
