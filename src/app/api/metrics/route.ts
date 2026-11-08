import { userMetrics } from "@/lib/user-metrics";
import { forStudent, reply } from "@/lib/server/student";

export const runtime = "nodejs";

async function all<T>(read: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
  const rows: T[] = [];
  for (let from = 0; ; from += 500) {
    const page = await read(from, from + 499);
    if (page.error) throw new Error(page.error.message);
    rows.push(...(page.data ?? []));
    if ((page.data ?? []).length < 500) return rows;
  }
}

export async function GET(request: Request) {
  return forStudent(request, async (student, db) => {
    const [courses, topics, sessions, answers, profile] = await Promise.all([
      all((from, to) => db.from("courses").select("id,name").eq("owner_id", student.id).is("deleted_at", null).order("created_at").range(from, to)),
      all((from, to) => db.from("topics").select("id,course_id,name").eq("owner_id", student.id).neq("review", "archived").range(from, to)),
      all((from, to) => db.from("session_results").select("course_id,topic_id,seconds,finished_at").eq("owner_id", student.id).order("finished_at").range(from, to)),
      all((from, to) => db.from("evidence_events").select("course_id,topic_id,at,outcome").eq("owner_id", student.id).eq("kind", "answer").order("at").range(from, to)),
      db.from("profiles").select("timezone").eq("owner_id", student.id).maybeSingle(),
    ]);
    if (profile.error) throw new Error(`Couldn't read your timezone: ${profile.error.message}`);
    // A deleted course's topics, sessions and answers leave with it.
    const live = new Set(courses.map((c) => c.id));
    return reply(200, userMetrics({
      courses,
      topics: topics.filter((t) => live.has(t.course_id)).map((topic) => ({ id: topic.id, courseId: topic.course_id, name: topic.name })),
      sessions: sessions.filter((s) => live.has(s.course_id)).map((session) => ({ courseId: session.course_id, topicId: session.topic_id, seconds: session.seconds, finishedAt: session.finished_at })),
      answers: answers.filter((a) => live.has(a.course_id)).map((answer) => ({ courseId: answer.course_id, topicId: answer.topic_id, at: answer.at, outcome: answer.outcome as "correct" | "partial" | "incorrect" })),
      timezone: profile.data?.timezone ?? "UTC",
    }));
  });
}
