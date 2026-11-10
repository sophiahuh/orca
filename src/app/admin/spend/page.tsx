import { AdminPage, Bar, Section, Table, Tiles } from "@/components/admin/AdminPage";
import { int, money } from "@/components/admin/format";
import { barWidths } from "@/lib/admin/stats";
import { requireAdmin } from "@/lib/server/admin";
import { spend } from "@/lib/server/admin-queries";

/**
 * /admin/spend: everyone's model spend by day (the last 30, UTC), by step and by model, from
 * `model_usage`, grouped as the cost log's query groups it (docs/COST-LOG.md). Admins only.
 */
export const dynamic = "force-dynamic";

export default async function AdminSpendPage() {
  const { db } = await requireAdmin("/admin/spend");
  const s = await spend(db);
  const widths = barWidths(s.byDay);
  const total = s.byKind.reduce((sum, k) => sum + k.usd, 0);
  const calls = s.byKind.reduce((sum, k) => sum + k.calls, 0);
  const window = s.byDay.reduce((sum, d) => sum + d.usd, 0);

  return (
    <AdminPage title="Spend" current="/admin/spend">
      <Tiles
        tiles={[
          { label: `Last ${s.days} days`, value: money(window) },
          { label: "All time", value: money(total) },
          { label: "Calls, all time", value: int(calls) },
        ]}
      />
      <Section title="By day" aside={`last ${s.days} days, UTC, newest first`}>
        <Table
          part="admin-spend-days"
          rows={s.byDay.map((r, i) => ({ ...r, share: widths[i] }))}
          rowKey={(r) => r.day}
          empty="No days to show."
          columns={[
            { key: "day", label: "Day", cell: (r) => r.day },
            { key: "calls", label: "Calls", num: true, cell: (r) => int(r.calls) },
            { key: "tokens", label: "Tokens", num: true, cell: (r) => int(r.tokens) },
            { key: "usd", label: "USD", num: true, cell: (r) => money(r.usd) },
            { key: "bar", label: "", cell: (r) => <Bar share={r.share} /> },
          ]}
        />
      </Section>
      <Section title="By step" aside="all time">
        <Table
          part="admin-spend-kinds"
          rows={s.byKind}
          rowKey={(k) => k.kind}
          empty="No model calls yet."
          columns={[
            { key: "kind", label: "Step", cell: (k) => k.kind },
            { key: "calls", label: "Calls", num: true, cell: (k) => int(k.calls) },
            { key: "tokens", label: "Tokens", num: true, cell: (k) => int(k.tokens) },
            { key: "usd", label: "USD", num: true, cell: (k) => money(k.usd) },
          ]}
        />
      </Section>
      <Section title="By model" aside="all time">
        <Table
          part="admin-spend-models"
          rows={s.byModel}
          rowKey={(m) => m.model}
          empty="No model calls yet."
          columns={[
            { key: "model", label: "Model", cell: (m) => m.model },
            { key: "calls", label: "Calls", num: true, cell: (m) => int(m.calls) },
            { key: "tokens", label: "Tokens", num: true, cell: (m) => int(m.tokens) },
            { key: "usd", label: "USD", num: true, cell: (m) => money(m.usd) },
          ]}
        />
      </Section>
    </AdminPage>
  );
}
