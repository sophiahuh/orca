import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { AdminPage, Bar, NotRecorded, Section, Table, Tiles } from "@/components/admin/AdminPage";
import { day, duration, int, money, when, yesNo } from "@/components/admin/format";
import { barWidths } from "@/lib/admin/stats";
import { requireAdmin } from "@/lib/server/admin";
import { EVIDENCE_PAGE, userDetail } from "@/lib/server/admin-queries";

/** /admin/users/[id]?evidence=offset: one account's courses, uploads, spend, sessions, evidence, feedback and events. Admins only. */
export const dynamic = "force-dynamic";

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function AdminUserPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const id = z.uuid().safeParse((await params).id);
  const offsetRaw = Number(first((await searchParams).evidence) ?? 0);
  const offset = Number.isFinite(offsetRaw) ? Math.max(0, Math.floor(offsetRaw)) : 0;
  if (!id.success) notFound();
  const { db } = await requireAdmin(`/admin/users/${id.data}${offset ? `?evidence=${offset}` : ""}`);
  const d = await userDetail(db, id.data, { evidenceOffset: offset });
  if (!d) notFound();
  const widths = barWidths(d.spend.byDay);
  const spentDays = d.spend.byDay.filter((r) => r.calls > 0);
  const answers = d.evidence.rows.filter((e) => e.kind === "answer");
  const flags = d.evidence.rows.filter((e) => e.kind !== "answer");

  return (
    <AdminPage title={d.profile.name ?? d.profile.email ?? "Account"} current="/admin/users">
      <Tiles
        tiles={[
          { label: "Email", value: d.profile.email ?? "—" },
          { label: "Joined", value: when(d.profile.joined) },
          { label: "Last active", value: when(d.profile.lastActive, "never") },
          { label: "Timezone", value: d.profile.timezone },
          { label: "Admin", value: yesNo(d.profile.isAdmin) },
          { label: "Spend, all time", value: money(d.spend.byKind.reduce((s, k) => s + k.usd, 0)) },
        ]}
      />
      <p className="text-[13px] text-wisteria-deep">
        <NotRecorded what="Page views and time on the app" /> · time in sessions is in the sessions table.
      </p>

      <Section title="Courses" aside={`${int(d.courses.length)}`}>
        <Table
          part="admin-user-courses"
          rows={d.courses}
          rowKey={(c) => c.id}
          empty="No courses."
          columns={[
            { key: "name", label: "Course", cell: (c) => c.name },
            { key: "created", label: "Created", cell: (c) => when(c.created) },
            { key: "deleted", label: "Deleted", cell: (c) => when(c.deleted, "—") },
            { key: "topics", label: "Topics", num: true, cell: (c) => int(c.topics) },
            { key: "objectives", label: "Objectives", num: true, cell: (c) => int(c.objectives) },
            { key: "questions", label: "Questions", num: true, cell: (c) => int(c.questions) },
          ]}
        />
      </Section>

      <Section title="Uploads" aside={`${int(d.uploads.length)} · newest first`}>
        <Table
          part="admin-user-uploads"
          rows={d.uploads}
          rowKey={(u) => u.id}
          empty="No uploads."
          columns={[
            { key: "file", label: "File", cell: (u) => u.filename },
            { key: "course", label: "Course", cell: (u) => u.course },
            { key: "type", label: "Type", cell: (u) => u.type },
            { key: "pages", label: "Pages", num: true, cell: (u) => int(u.pages) },
            { key: "status", label: "Status", cell: (u) => u.status },
            { key: "run", label: "Run", cell: (u) => (u.run ? `${u.run.status}${u.run.error ? `: ${u.run.error}` : ""}` : "no run") },
            { key: "cost", label: "Run cost", num: true, cell: (u) => (u.run ? money(u.run.cost) : "—") },
            { key: "when", label: "Uploaded", cell: (u) => when(u.created) },
          ]}
        />
      </Section>

      <Section title="Model spend by step" aside="all time">
        <Table
          rows={d.spend.byKind}
          rowKey={(k) => k.kind}
          empty="No model calls."
          columns={[
            { key: "kind", label: "Step", cell: (k) => k.kind },
            { key: "calls", label: "Calls", num: true, cell: (k) => int(k.calls) },
            { key: "tokens", label: "Tokens", num: true, cell: (k) => int(k.tokens) },
            { key: "usd", label: "USD", num: true, cell: (k) => money(k.usd) },
          ]}
        />
      </Section>

      <Section title="Model spend by day" aside={`last ${d.spend.days} days, UTC`}>
        {spentDays.length ? (
          <Table
            rows={d.spend.byDay.map((r, i) => ({ ...r, share: widths[i] }))}
            rowKey={(r) => r.day}
            empty="No model calls in this window."
            columns={[
              { key: "day", label: "Day", cell: (r) => r.day },
              { key: "calls", label: "Calls", num: true, cell: (r) => int(r.calls) },
              { key: "tokens", label: "Tokens", num: true, cell: (r) => int(r.tokens) },
              { key: "usd", label: "USD", num: true, cell: (r) => money(r.usd) },
              { key: "bar", label: "", cell: (r) => <Bar share={r.share} /> },
            ]}
          />
        ) : (
          <p className="text-[15px] text-wisteria-deep">No model calls in the last {d.spend.days} days.</p>
        )}
      </Section>

      <Section title="Sessions" aside={`${int(d.sessions.length)} · newest first`}>
        <Table
          part="admin-user-sessions"
          rows={d.sessions}
          rowKey={(s) => s.id}
          empty="No finished sessions."
          columns={[
            { key: "finished", label: "Finished", cell: (s) => when(s.finishedAt) },
            { key: "course", label: "Course", cell: (s) => s.course ?? "—" },
            { key: "mode", label: "Mode", cell: (s) => s.mode },
            { key: "score", label: "Correct / total", num: true, cell: (s) => `${int(s.correct)} / ${int(s.total)}` },
            { key: "seconds", label: "Time", num: true, cell: (s) => duration(s.seconds) },
          ]}
        />
      </Section>

      <Section title="Answers" aside={`${int(answers.length)} of the ${int(d.evidence.rows.length)} events from ${int(d.evidence.offset + 1)}, newest first`}>
        <Table
          part="admin-user-answers"
          rows={answers}
          rowKey={(e) => e.id}
          empty="No answers on this page."
          columns={[
            { key: "at", label: "When", cell: (e) => when(e.at) },
            { key: "course", label: "Course", cell: (e) => e.course ?? "—" },
            { key: "objective", label: "Objective", cell: (e) => e.objective ?? "—" },
            { key: "outcome", label: "Outcome", cell: (e) => e.outcome ?? "—" },
            { key: "grader", label: "Grader", cell: (e) => e.grader ?? "—" },
            { key: "source", label: "Source", cell: (e) => e.source ?? "—" },
            { key: "response", label: "Said (connector)", cell: (e) => (e.note ? <span className="whitespace-pre-wrap">{e.note}</span> : "—") },
          ]}
        />
      </Section>

      <Section title="Flags" aside={`${int(flags.length)} on this page`}>
        <Table
          part="admin-user-flags"
          rows={flags}
          rowKey={(e) => e.id}
          empty="No flags on this page."
          columns={[
            { key: "at", label: "When", cell: (e) => when(e.at) },
            { key: "course", label: "Course", cell: (e) => e.course ?? "—" },
            { key: "objective", label: "Objective", cell: (e) => e.objective ?? "—" },
            { key: "source", label: "Source", cell: (e) => e.flag_source ?? "—" },
            { key: "page", label: "Page", num: true, cell: (e) => (e.page === null ? "—" : int(e.page)) },
            { key: "note", label: "Note", cell: (e) => (e.note ? <span className="whitespace-pre-wrap">{e.note}</span> : "—") },
          ]}
        />
      </Section>
      <nav aria-label="Evidence pages" className="flex gap-[12px] text-[14px]">
        {d.evidence.offset > 0 && (
          <Link href={`/admin/users/${id.data}?evidence=${Math.max(0, d.evidence.offset - EVIDENCE_PAGE)}`} className="underline">
            Newer
          </Link>
        )}
        {d.evidence.more && (
          <Link href={`/admin/users/${id.data}?evidence=${d.evidence.offset + EVIDENCE_PAGE}`} className="underline">
            Older
          </Link>
        )}
      </nav>

      <Section title="Question feedback" aside={`${int(d.feedback.length)} · newest first`}>
        <Table
          part="admin-user-feedback"
          rows={d.feedback}
          rowKey={(f) => `${f.question_id}`}
          empty="No ratings."
          columns={[
            { key: "when", label: "When", cell: (f) => when(f.created_at) },
            { key: "rating", label: "Rating", cell: (f) => f.rating },
            { key: "reason", label: "Reason", cell: (f) => f.reason ?? "—" },
            { key: "note", label: "Note", cell: (f) => f.note ?? "—" },
            { key: "course", label: "Course", cell: (f) => f.course ?? "—" },
            { key: "objective", label: "Objective", cell: (f) => f.objective ?? "—" },
            { key: "prompt", label: "Question", cell: (f) => <span className="whitespace-pre-wrap">{f.prompt}</span> },
          ]}
        />
      </Section>

      <Section title="Security events" aside={`${int(d.security.length)} · newest first`}>
        <Table
          part="admin-user-security"
          rows={d.security}
          rowKey={(s) => s.id}
          empty="None."
          columns={[
            { key: "at", label: "When", cell: (s) => when(s.at) },
            { key: "kind", label: "Kind", cell: (s) => s.kind },
            { key: "check", label: "Check", cell: (s) => s.check },
            { key: "severity", label: "Severity", cell: (s) => s.severity },
            { key: "quote", label: "Quote", cell: (s) => <span className="whitespace-pre-wrap">{s.quote}</span> },
          ]}
        />
      </Section>

      <Section title="Rate-limit windows" aside="current windows only; the counter drops old ones">
        <Table
          part="admin-user-rate"
          rows={d.rateLimits}
          rowKey={(r) => `${r.action}-${r.windowStart}`}
          empty="None."
          columns={[
            { key: "action", label: "Action", cell: (r) => r.action },
            { key: "window", label: "Window from", cell: (r) => when(r.windowStart) },
            { key: "count", label: "Hits", num: true, cell: (r) => int(r.count) },
            { key: "max", label: "Limit", num: true, cell: (r) => (r.max === null ? "—" : int(r.max)) },
            { key: "over", label: "Over", cell: (r) => (r.over ? <strong>over</strong> : "no") },
          ]}
        />
      </Section>
      <p className="text-[13px] text-wisteria-deep">{day(new Date().toISOString())}: figures as of this page load.</p>
    </AdminPage>
  );
}
