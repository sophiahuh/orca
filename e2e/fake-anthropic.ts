/**
 * A fake Anthropic Messages API for the browser tests (Phase 4 plan, decision 12). Playwright starts
 * it on port 3101 and starts the app with ANTHROPIC_BASE_URL pointing here, so the server's real
 * code path (the SDK, structured outputs, the jobs) runs while nothing reaches Anthropic or costs
 * anything. It recognises each pipeline step by its system prompt and answers with canned output:
 *
 * - extract: the scenario's `extract` (default: nothing found);
 * - reconcile: "new"; ambiguity: never ambiguous; agreement: agrees; grade: correct;
 * - generate: for every objective in the prompt, short answers "<objective name>: case <i>?" with
 *   the exact answer "<i>" (as many as asked for, or `perObjective`);
 * - solve: answers those correctly (the number after "case"), and choice questions with option 0;
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
  /** Answer this step with an error (400 by default: the SDK doesn't retry it). */
  fail?: { step: string; status?: number; message?: string };
  reflect?: { matches: Array<{ name: string; sure: boolean; reasoning: string }> };
  /** What the grade step answers (default: correct). */
  grade?: { outcome: "correct" | "partial" | "incorrect"; satisfied?: string[]; misconception?: string | null; feedback?: string };
  /** Wait this long before answering each call (to watch progress). */
  delayMs?: number;
}

const STEPS: Array<[string, string]> = [
  ["You map one piece of college course material", "extract"],
  ["You decide whether a newly extracted course item", "reconcile"],
  ["You write quick-review quiz questions", "generate"],
  ["You answer quiz questions yourself", "solve"],
  ["You review quiz questions for ambiguity", "ambiguity"],
  ["You check whether an independently written answer", "agreement"],
  ["You match a student's reflection", "reflect"],
  ["You grade one short student answer", "grade"],
];

let scenario: Scenario = {};
let calls: Array<{ step: string }> = [];

const text = (content: unknown): string =>
  typeof content === "string" ? content : Array.isArray(content) ? content.map((b: { text?: string }) => b.text ?? "").join("\n") : "";

function answer(step: string, prompt: string): unknown {
  switch (step) {
    case "extract":
      return scenario.extract ?? { topics: [], objectives: [], relations: [] };
    case "reconcile":
      return { decision: "new", matchId: null, reasoning: "The fake API keeps them separate." };
    case "generate": {
      const out: unknown[] = [];
      const lines = prompt.split("\n");
      lines.forEach((line, i) => {
        const m = /^- ([0-9a-f-]{36}): (.*)$/.exec(line);
        const need = /write (\d+) question/.exec(lines[i + 1] ?? "");
        if (!m || !need) return;
        const name = m[2].split(" — ")[0];
        const inferred = /INFERRED/.test(lines[i + 1]);
        const n = Math.min(Number(need[1]), scenario.perObjective ?? Infinity);
        for (let k = 1; k <= n; k++) {
          out.push({
            objectiveId: m[1],
            kind: "Short answer",
            tier: "retrieval",
            prompt: `${name}: case ${k}?`,
            options: [],
            answer: -1,
            exact: [String(k)],
            rubric: null,
            explanation: "The fake API's answer.",
            anchor: inferred ? null : { locator: "slide 2", excerpt: "x + xy = x" },
            figureSlide: null,
          });
        }
      });
      return { questions: out };
    }
    case "solve": {
      const answers = [...prompt.matchAll(/^\[([^\]]+)\] \(([^)]+)\) (.*)$/gm)].map(([, id, kind, q]) =>
        kind === "Short answer" ? { id, choice: null, text: /case (\d+)\?$/.exec(q)?.[1] ?? "?" } : { id, choice: 0, text: null },
      );
      return { answers };
    }
    case "ambiguity":
      return { results: [...prompt.matchAll(/^\[([^\]]+)\]/gm)].map(([, id]) => ({ id, ambiguous: false, reasoning: "Clear." })) };
    case "agreement":
      return { results: [...prompt.matchAll(/^\[([^\]]+)\]/gm)].map(([, id]) => ({ id, agrees: true, reasoning: "Agrees." })) };
    case "reflect": {
      const ids = new Map([...prompt.matchAll(/^- (\S+) \([^)]*\): (.*?)(?: — .*)?$/gm)].map(([, id, name]) => [name, id]));
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
    return send(scenario.fail.status ?? 400, { type: "error", error: { type: "invalid_request_error", message: scenario.fail.message ?? `The fake API refused the ${step} step.` } });
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
