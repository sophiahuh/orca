/**
 * A fake Anthropic Messages API for the browser tests (Phase 4 plan, decision 12). Playwright starts
 * it on port 3101 and starts the app with ANTHROPIC_BASE_URL pointing here, so the server's real
 * code path (the SDK, structured outputs, the jobs) runs while nothing reaches Anthropic or costs
 * anything. It recognises each pipeline step by its system prompt and answers with canned output:
 *
 * - extract: the scenario's `extract` (default: nothing found);
 * - reconcile: "new"; grade: correct;
 * - generate: for every objective in the prompt's data block, short answers "<objective name>: case
 *   <i>?" with the exact answer "<i>" (as many as asked for, or `perObjective`);
 * - deep: the same for a deep review, "<objective name>: deep case <i>?", tier application;
 * - transcribe: each page named in the prompt as "Handwritten page <n>: x + xy = x by absorption.";
 * - describe: each slide named in the prompt gets "A figure on slide <n>.";
 * - link: the scenario's `links`, by topic name (default: none), each with a reason;
 * - reflect: the scenario's `reflect` matches, by objective name.
 *
 * Control (tests run one at a time): POST /__scenario { extract?, perObjective?, fail?, reflect?,
 * delayMs? } replaces the scenario and clears the call log; GET /__calls lists the steps called.
 * Run: node --experimental-strip-types e2e/fake-anthropic.ts [port]
 */
import { createServer } from "node:http";

export interface Scenario {
  extract?: unknown;
  /** At most this many questions per objective (default: what the prompt asks for). */
  perObjective?: number;
  /**
   * Answer this step with an error (400 by default: the SDK doesn't retry it). `type: "spend-limit"`
   * answers as the real API does when the organization's monthly spend cap is reached: 429,
   * rate_limit_error, error_code enforced_spend_limit_reached, no retry-after.
   */
  fail?: { step: string; status?: number; message?: string; type?: "spend-limit" | "rate-limit" };
  reflect?: { matches: Array<{ name: string; sure: boolean; reasoning: string }> };
  /** What the link step finds, by topic name. */
  links?: Array<{ from: string; to: string; type: string; reason?: string }>;
  /** What the grade step answers (default: correct). */
  grade?: { outcome: "correct" | "partial" | "incorrect"; satisfied?: string[]; misconception?: string | null; feedback?: string };
  /** Wait this long before answering each call (to watch progress). */
  delayMs?: number;
}

const STEPS: Array<[string, string]> = [
  ["You map one piece of college course material", "extract"],
  ["You decide whether a newly extracted course item", "reconcile"],
  ["You write quick-review quiz questions", "generate"],
  ["You write deep-review questions", "deep"],
  ["You connect the topics of one college course", "link"],
  ["You match a student's reflection", "reflect"],
  ["You grade one short student answer", "grade"],
  ["You transcribe pages of a college student's", "transcribe"],
  ["You describe the figures on slides of college course material", "describe"],
];

let scenario: Scenario = {};
let calls: Array<{ step: string }> = [];

const text = (content: unknown): string =>
  typeof content === "string" ? content : Array.isArray(content) ? content.map((b: { text?: string }) => b.text ?? "").join("\n") : "";

/**
 * The data blocks in a prompt (decision 13): one JSON object per line, `{"source":…,"content":…}`.
 * The fake reads its inputs from them the way the real model would, so a prompt whose text leaked
 * out of its block (a payload breaking out) wouldn't be understood either.
 */
function blocks(prompt: string, source: string): unknown[] {
  const out: unknown[] = [];
  for (const line of prompt.split("\n")) {
    if (!line.startsWith(`{"source":"${source}"`)) continue;
    const parsed = JSON.parse(line) as { source: string; content: unknown };
    out.push(parsed.content);
  }
  return out;
}

function answer(step: string, prompt: string): unknown {
  switch (step) {
    case "extract":
      // The schema requires instructionsFound; a scenario may say what the "model" saw.
      return { instructionsFound: [], topics: [], objectives: [], relations: [], ...((scenario.extract as object | undefined) ?? {}) };
    case "reconcile":
      return { decision: "new", matchId: null, reasoning: "The fake API keeps them separate." };
    case "describe": {
      const slides = (/slides ([\d, ]+), in that order/.exec(prompt)?.[1] ?? "").split(",").map((p) => Number(p.trim())).filter(Boolean);
      return { pages: slides.map((n) => ({ n, figures: `A figure on slide ${n}.` })) };
    }
    case "transcribe": {
      // The prompt names the pages its images are, in order.
      const pages = (/pages ([\d, ]+), in that order/.exec(prompt)?.[1] ?? "").split(",").map((p) => Number(p.trim())).filter(Boolean);
      return { pages: pages.map((n) => ({ n, text: `Handwritten page ${n}: x + xy = x by absorption.` })) };
    }
    case "generate":
    case "deep": {
      const deep = step === "deep";
      const out: unknown[] = [];
      const [task] = blocks(prompt, "generated_question") as Array<{ objectives: Array<{ id: string; name: string; write: number; inferred?: boolean }> }>;
      for (const o of task?.objectives ?? []) {
        const n = Math.min(o.write, scenario.perObjective ?? Infinity);
        for (let k = 1; k <= n; k++) {
          out.push({
            objectiveId: o.id,
            kind: "Short answer",
            tier: deep ? "application" : "retrieval",
            prompt: `${o.name}: ${deep ? "deep " : ""}case ${k}?`,
            options: [],
            answer: -1,
            exact: [String(k)],
            rubric: null,
            explanation: "The fake API's answer.",
            anchor: o.inferred ? null : { locator: "slide 2", excerpt: "x + xy = x" },
            figureSlide: null,
          });
        }
      }
      return { questions: out };
    }
    case "link": {
      const [topics] = blocks(prompt, "generated_question") as Array<Array<{ ref: string; name: string }>>;
      const ref = new Map((topics ?? []).map((t) => [t.name, t.ref]));
      return { links: (scenario.links ?? []).flatMap((l) => (ref.has(l.from) && ref.has(l.to) ? [{ from: ref.get(l.from), to: ref.get(l.to), type: l.type, reason: l.reason ?? `${l.from} is part of how ${l.to} works.` }] : [])) };
    }
    case "reflect": {
      const [objectives] = blocks(prompt, "generated_question") as Array<Array<{ id: string; name: string }>>;
      const ids = new Map((objectives ?? []).map((o) => [o.name, o.id]));
      return {
        matches: (scenario.reflect?.matches ?? []).flatMap((m) => {
          const id = ids.get(m.name);
          return id ? [{ objectiveId: id, sure: m.sure, reasoning: m.reasoning }] : [];
        }),
      };
    }
    case "grade":
      return { satisfied: [], misconception: null, feedback: "The fake API graded it.", outcome: "correct", ...(scenario.grade ?? {}) };
    default:
      throw new Error(`no answer for ${step}`);
  }
}

const port = Number(process.argv[2] ?? 3101);

createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  const send = (status: number, body: unknown) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname === "/__health") return send(200, { ok: true });
  if (url.pathname === "/__scenario" && req.method === "POST") {
    scenario = raw ? (JSON.parse(raw) as Scenario) : {};
    calls = [];
    return send(200, { ok: true });
  }
  if (url.pathname === "/__calls") return send(200, calls);
  if (url.pathname !== "/v1/messages" || req.method !== "POST") return send(404, { type: "error", error: { type: "not_found_error", message: `The fake API has no ${url.pathname}` } });

  const body = JSON.parse(raw) as { model: string; stream?: boolean; system?: unknown; messages: Array<{ content: unknown }> };
  const system = text(body.system);
  const step = STEPS.find(([start]) => system.startsWith(start))?.[1];
  if (!step) return send(400, { type: "error", error: { type: "invalid_request_error", message: "The fake API doesn't know this prompt." } });
  calls.push({ step });
  if (scenario.delayMs) await new Promise((r) => setTimeout(r, scenario.delayMs));
  if (scenario.fail?.step === step) {
    const f = scenario.fail;
    if (f.type === "spend-limit") {
      return send(429, {
        type: "error",
        error: { type: "rate_limit_error", message: f.message ?? "You have reached your API usage limits: your organization has crossed its monthly API usage threshold, set based on your organization's API tier. You will regain access on 2026-11-01 at 00:00 UTC.", details: { error_code: "enforced_spend_limit_reached" } },
        request_id: "req_fake_spend",
      });
    }
    if (f.type === "rate-limit") {
      res.writeHead(429, { "content-type": "application/json", "retry-after": "1" });
      return res.end(JSON.stringify({ type: "error", error: { type: "rate_limit_error", message: f.message ?? "Rate limited by the fake API." } }));
    }
    return send(f.status ?? 400, { type: "error", error: { type: "invalid_request_error", message: f.message ?? `The fake API refused the ${step} step.` } });
  }
  const prompt = body.messages.map((m) => text(m.content)).join("\n");
  const reply = JSON.stringify(answer(step, prompt));
  const id = `msg_fake_${calls.length}`;
  const usage = { input_tokens: 100, output_tokens: 100 };
  if (!body.stream) {
    return send(200, { id, type: "message", role: "assistant", model: body.model, content: [{ type: "text", text: reply }], stop_reason: "end_turn", stop_sequence: null, usage });
  }
  // Server-sent events, as the Messages API streams (the server streams every call).
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  const event = (type: string, data: object) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  event("message_start", { message: { id, type: "message", role: "assistant", model: body.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 100, output_tokens: 1 } } });
  event("content_block_start", { index: 0, content_block: { type: "text", text: "" } });
  for (let i = 0; i < reply.length; i += 2000) event("content_block_delta", { index: 0, delta: { type: "text_delta", text: reply.slice(i, i + 2000) } });
  event("content_block_stop", { index: 0 });
  event("message_delta", { delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 100 } });
  event("message_stop", {});
  res.end();
}).listen(port, "127.0.0.1", () => console.log(`fake Anthropic API on http://127.0.0.1:${port}`));
