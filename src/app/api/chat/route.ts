import Anthropic from "@anthropic-ai/sdk";

/**
 * POST /api/chat — Orca's study tutor.
 *
 * Body: { messages: {role: "user"|"assistant", content: string}[], course?: {...} }
 * Reply: { reply: string }
 *
 * Without an ANTHROPIC_API_KEY the route answers with a canned reply so the
 * prototype still demos end to end.
 */

export const runtime = "nodejs";

const MODEL = "claude-sonnet-5-5";

interface ChatBody {
  messages?: Array<{ role: "user" | "assistant"; content: string }>;
  course?: { name: string; short: string; topics: Array<{ name: string; status: string }> } | null;
}

const SYSTEM_BASE = `You are Orca, a calm, encouraging study tutor inside a spaced-repetition app for college students.
Keep answers short and concrete (usually under 120 words). Prefer one worked example over a lecture.
When asked to quiz, ask ONE question at a time and wait for the answer before revealing anything.
When explaining, start from what the student likely already knows and build up.
Never pretend to have read course files you were not given.`;

function systemFor(course: ChatBody["course"]) {
  if (!course) return SYSTEM_BASE;
  const topics = course.topics.map((t) => `${t.name} (${t.status})`).join(", ");
  return `${SYSTEM_BASE}\n\nThe student is working in "${course.name}" (${course.short}). Topics on their path: ${topics}. "current" is what they are studying now.`;
}

function canned(messages: NonNullable<ChatBody["messages"]>, course: ChatBody["course"]) {
  const last = messages.at(-1)?.content.toLowerCase() ?? "";
  const topic = course?.topics.find((t) => t.status === "current")?.name ?? "your current topic";
  if (last.includes("quiz")) {
    return `Let's warm up on ${topic}. First question: in one sentence, what problem does ${topic} solve, and when would you reach for it? Answer in your own words and I'll check it.`;
  }
  if (last.includes("plan")) {
    return `Here's a light plan for the week: two 5-minute quick reviews on ${topic} (today and Thursday), one 30-minute deep session on the weekend, and a quick pass over anything you missed the night before class. Want me to put those on your calendar?`;
  }
  if (last.includes("explain")) {
    return `Think of ${topic} as a shortcut: instead of checking every case by hand, you look for patterns that let you collapse several cases into one rule. Start with the simplest example you can, write out every case, then circle the ones that behave the same. That circling is the whole idea.`;
  }
  return `I'm running in demo mode right now (no API key on the server), but here's a nudge: pick one thing from ${topic} you'd struggle to explain to a friend, and we'll start there. Ask me to "quiz me", "explain it simply", or "plan my week".`;
}

export async function POST(request: Request) {
  let body: ChatBody;
  try {
    body = (await request.json()) as ChatBody;
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const messages = (body.messages ?? []).filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim());
  if (messages.length === 0 || messages[0].role !== "user") {
    return Response.json({ error: "Send at least one user message." }, { status: 400 });
  }

  const raw = body.course;
  const course: ChatBody["course"] =
    raw && typeof raw.name === "string" && typeof raw.short === "string"
      ? {
          name: raw.name,
          short: raw.short,
          topics: Array.isArray(raw.topics)
            ? raw.topics.filter((t) => t && typeof t.name === "string").map((t) => ({ name: t.name, status: String(t.status ?? "") }))
            : [],
        }
      : null;

  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ reply: canned(messages, course), demo: true });
  }

  const client = new Anthropic();
  try {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 2048,
      system: systemFor(course),
      output_config: { effort: "low" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    });

    if (response.stop_reason === "refusal") {
      return Response.json({ reply: "I can't help with that one, but I'm happy to keep going on your coursework." });
    }

    const text = response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    return Response.json({ reply: text || "…" });
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) {
      return Response.json({ error: "The server's API key was rejected." }, { status: 500 });
    }
    if (error instanceof Anthropic.RateLimitError) {
      return Response.json({ error: "Orca is a little busy. Try again in a moment." }, { status: 429 });
    }
    if (error instanceof Anthropic.APIError) {
      return Response.json({ error: `Claude API error (${error.status}).` }, { status: 502 });
    }
    return Response.json({ error: "Something went wrong talking to Claude." }, { status: 500 });
  }
}
