import Link from "next/link";
import { AdminPage, Section, Table } from "@/components/admin/AdminPage";
import { int, when } from "@/components/admin/format";
import { cn } from "@/lib/cn";
import { requireAdmin } from "@/lib/server/admin";
import { FEEDBACK_PAGE, FEEDBACK_REASONS, feedback, feedbackCounts } from "@/lib/server/admin-queries";

/** /admin/questions?reason=…&offset=n: every thumbs down with its question, newest first, and ups/downs per course. Admins only. */
export const dynamic = "force-dynamic";

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function AdminQuestionsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = await searchParams;
  const reasonRaw = first(q.reason);
  const reason = reasonRaw && (FEEDBACK_REASONS as readonly string[]).includes(reasonRaw) ? reasonRaw : undefined;
  const offsetRaw = Number(first(q.offset) ?? 0);
  const offset = Number.isFinite(offsetRaw) ? Math.max(0, Math.floor(offsetRaw)) : 0;
  const route = `/admin/questions${reason || offset ? `?${new URLSearchParams({ ...(reason ? { reason } : {}), ...(offset ? { offset: String(offset) } : {}) })}` : ""}`;
  const { db } = await requireAdmin(route);
  const [downs, counts] = await Promise.all([feedback(db, { reason, offset }), feedbackCounts(db)]);
  const href = (r: string | undefined, o: number) => `/admin/questions${r || o ? `?${new URLSearchParams({ ...(r ? { reason: r } : {}), ...(o ? { offset: String(o) } : {}) })}` : ""}`;

  return (
    <AdminPage title="Questions" current="/admin/questions">
      <Section title="Thumbs down" aside={`from ${int(downs.offset + 1)}, newest first${reason ? ` · ${reason}` : ""}`}>
        <nav aria-label="Reason filter" className="flex flex-wrap gap-[6px] text-[14px]">
          <Link href={href(undefined, 0)} className={cn("rounded-[10px] border-2 px-[10px] py-[3px]", !reason ? "border-prussian bg-prussian text-parchment" : "border-alice-deep bg-alice")}>
            all reasons
          </Link>
          {FEEDBACK_REASONS.map((r) => (
            <Link key={r} href={href(r, 0)} className={cn("rounded-[10px] border-2 px-[10px] py-[3px]", reason === r ? "border-prussian bg-prussian text-parchment" : "border-alice-deep bg-alice")}>
              {r}
            </Link>
          ))}
        </nav>
        <Table
          part="admin-downs"
          rows={downs.rows}
          rowKey={(f) => `${f.owner_id}-${f.question_id}`}
          empty={reason ? `No thumbs down for "${reason}".` : "No thumbs down yet."}
          columns={[
            { key: "when", label: "When", cell: (f) => when(f.created_at) },
            { key: "student", label: "Student", cell: (f) => f.student ?? "—" },
            { key: "course", label: "Course", cell: (f) => f.course ?? "—" },
            { key: "objective", label: "Objective", cell: (f) => f.objective ?? "—" },
            { key: "reason", label: "Reason", cell: (f) => f.reason ?? "—" },
            { key: "note", label: "Note", cell: (f) => (f.note ? <span className="whitespace-pre-wrap">{f.note}</span> : "—") },
            { key: "kind", label: "Kind", cell: (f) => `${f.kind}${f.tier ? ` · ${f.tier}` : ""}${f.deep ? " · deep" : ""}` },
            { key: "prompt", label: "Question", cell: (f) => <span className="whitespace-pre-wrap">{f.prompt}</span> },
          ]}
        />
        <nav aria-label="Feedback pages" className="flex gap-[12px] text-[14px]">
          {downs.offset > 0 && (
            <Link href={href(reason, Math.max(0, downs.offset - FEEDBACK_PAGE))} className="underline">
              Newer
            </Link>
          )}
          {downs.more && (
            <Link href={href(reason, downs.offset + FEEDBACK_PAGE)} className="underline">
              Older
            </Link>
          )}
        </nav>
      </Section>

      <Section title="Ratings per course" aside="every student's course, most thumbs down first">
        <Table
          part="admin-feedback-counts"
          rows={counts}
          rowKey={(c) => `${c.course_id}-${c.student ?? ""}`}
          empty="No ratings yet."
          columns={[
            { key: "course", label: "Course", cell: (c) => c.course },
            { key: "student", label: "Student", cell: (c) => c.student ?? "—" },
            { key: "ups", label: "Up", num: true, cell: (c) => int(c.ups) },
            { key: "downs", label: "Down", num: true, cell: (c) => int(c.downs) },
          ]}
        />
      </Section>
    </AdminPage>
  );
}
