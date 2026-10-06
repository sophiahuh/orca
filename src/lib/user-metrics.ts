export interface MetricsSession {
  courseId: string;
  topicId: string | null;
  seconds: number;
  finishedAt: string;
}

export interface MetricsAnswer {
  courseId: string;
  topicId: string;
  at: string;
  outcome: "correct" | "partial" | "incorrect";
}

export interface TopicMetric {
  topicId: string;
  name: string;
  seconds: number;
  solved: number;
}

export interface CourseMetric {
  courseId: string;
  name: string;
  seconds: number;
  solved: number;
  topics: TopicMetric[];
}

export interface UserMetrics {
  seconds: number;
  solved: number;
  longestStreak: number;
  courses: CourseMetric[];
}

function dayKey(iso: string, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(iso));
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function longestRun(days: Set<string>) {
  const sorted = [...days].sort();
  let best = 0;
  let run = 0;
  let previous = "";
  for (const day of sorted) {
    const yesterday = new Date(`${day}T00:00:00Z`);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const expected = yesterday.toISOString().slice(0, 10);
    run = previous === expected ? run + 1 : 1;
    best = Math.max(best, run);
    previous = day;
  }
  return best;
}

/** Server-derived metrics from append-only activity. Sessions own time; answer evidence owns solved counts. */
export function userMetrics(input: {
  courses: ReadonlyArray<{ id: string; name: string }>;
  topics: ReadonlyArray<{ id: string; courseId: string; name: string }>;
  sessions: ReadonlyArray<MetricsSession>;
  answers: ReadonlyArray<MetricsAnswer>;
  timezone: string;
}): UserMetrics {
  const courses = new Map(input.courses.map((course) => [course.id, { courseId: course.id, name: course.name, seconds: 0, solved: 0, topics: new Map<string, TopicMetric>() }]));
  const topicInfo = new Map(input.topics.map((topic) => [topic.id, topic]));
  const days = new Set<string>();
  for (const session of input.sessions) {
    const course = courses.get(session.courseId);
    if (!course) continue;
    course.seconds += session.seconds;
    days.add(dayKey(session.finishedAt, input.timezone));
    if (session.topicId) {
      const topic = topicInfo.get(session.topicId);
      if (topic) {
        const metric = course.topics.get(topic.id) ?? { topicId: topic.id, name: topic.name, seconds: 0, solved: 0 };
        metric.seconds += session.seconds;
        course.topics.set(topic.id, metric);
      }
    }
  }
  for (const answer of input.answers) {
    const course = courses.get(answer.courseId);
    if (!course) continue;
    days.add(dayKey(answer.at, input.timezone));
    if (answer.outcome !== "correct") continue;
    course.solved += 1;
    const topic = topicInfo.get(answer.topicId);
    if (topic) {
      const metric = course.topics.get(topic.id) ?? { topicId: topic.id, name: topic.name, seconds: 0, solved: 0 };
      metric.solved += 1;
      course.topics.set(topic.id, metric);
    }
  }
  const result = [...courses.values()]
    .map((course) => ({ ...course, topics: [...course.topics.values()].sort((a, b) => b.seconds - a.seconds || b.solved - a.solved || a.name.localeCompare(b.name)).slice(0, 3) }))
    .filter((course) => course.seconds > 0 || course.solved > 0)
    .sort((a, b) => b.seconds - a.seconds || b.solved - a.solved || a.name.localeCompare(b.name));
  return { seconds: result.reduce((total, course) => total + course.seconds, 0), solved: result.reduce((total, course) => total + course.solved, 0), longestStreak: longestRun(days), courses: result };
}
