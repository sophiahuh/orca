import type { Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { type Student, admin, expect, test, stored } from "./fixture";
import { lines, makePdf } from "../tests/fixtures/pdf";
import { fakeCalls, fakeModel } from "./fake-model";
import { LIMITS } from "../src/lib/limits";
import { DEFAULT_CONFIG } from "../src/lib/data";

/**
 * The cost guard (Phase 4, Task 7c; plan decision 10) end to end, against the fake Anthropic API:
 * an upload past the student's daily token budget waits instead of running; a second upload queues
 * behind the first and runs when it finishes; a spend-limit answer from the API fails the job once
 * with the budget message and is never retried; and uploads are rate-limited per student.
 */
const anchor = { locator: "slide 1", excerpt: "x + xy = x" };
const ONE_TOPIC = {
  topics: [{ localId: "t1", existingId: null, name: "Boolean Algebra", summary: "", slideStart: 1, slideEnd: 2 }],
  objectives: [{ localId: "o1", existingId: null, topicRef: "t1", name: "Simplify with absorption", description: "", origin: "material", places: [anchor], emphasis: null }],
  relations: [],
};

async function newCourse(student: Student): Promise<string> {
  const id = crypto.randomUUID();
  const { error } = await student.db.from("courses").insert({ id, slug: `c-${id.slice(0, 8)}`, name: "Logic", short: "LOG", variant: "circuit", pos_x: 0, pos_y: 0, review_config: DEFAULT_CONFIG });
  if (error) throw new Error(error.message);
  return id;
}

const details = (courseId: string, bytes: Uint8Array, filename: string) => ({
  courseId,
  filename,
  size: bytes.byteLength,
  mime: "application/pdf",
  hash: createHash("sha256").update(bytes).digest("hex"),
  type: "Lecture",
  assigned: null,
  due: null,
  reflect: false,
});

/** Upload a small deck through the routes, as the browser does, and return the generation the server reported. */
async function sendDeck(page: Page, student: Student, courseId: string, filename: string, text: string) {
  const bytes = makePdf([lines(text, "x + xy = x"), lines("Second slide")]);
  const started = await page.request.post("/api/materials", { data: details(courseId, bytes, filename) });
  expect(started.status()).toBe(201);
  const { material, upload } = (await started.json()) as { material: { id: string }; upload: { path: string; token: string } };
  const sent = await student.db.storage.from("materials").uploadToSignedUrl(upload.path, upload.token, new Blob([bytes as BlobPart], { type: "application/pdf" }));
  expect(sent.error).toBeNull();
  const processed = await page.request.post(`/api/materials/${material.id}/process`);
  expect(processed.status()).toBe(200);
  const body = (await processed.json()) as { generation: { state: string; runId?: string } };
  return { materialId: material.id, generation: body.generation };
}

const runStatus = async (runId: string) => (await admin().from("pipeline_runs").select("status, progress").eq("id", runId).single()).data!;

test("an upload past the student's daily token budget is saved and waits, the model isn't called, and the screen says why", async ({ page, student }) => {
  await fakeModel({ extract: ONE_TOPIC, perObjective: 2 });
  const courseId = await newCourse(student);
  // Today's calls already used the day's tokens (as the server records them).
  const spent = await admin().from("model_usage").insert({ owner_id: student.id, kind: "upload", model: "claude-opus-5-5", input_tokens: LIMITS.tokensPerDay, output_tokens: 0, cost_usd: 8 });
  expect(spent.error).toBeNull();
  const { generation } = await sendDeck(page, student, courseId, "deck.pdf", "Absorption");
  expect(generation.state).toBe("started");
  await expect.poll(async () => (await runStatus(generation.runId!)).status, { timeout: 20_000 }).toBe("waiting");
  expect((await runStatus(generation.runId!)).progress).toEqual({ stage: "waiting", reason: "daily-tokens", message: "Daily limit reached: processing resumes tomorrow." });
  expect(await fakeCalls()).toEqual([]);

  const course = (await student.db.from("courses").select("slug").eq("id", courseId).single()).data!;
  await page.goto(`/course/${course.slug}/review?run=${generation.runId}`);
  await expect(page.locator("[data-part=run-waiting]")).toContainText("Daily limit reached: processing resumes tomorrow.");
  await expect(page.locator("[data-part=run-progress]")).toHaveCount(0);
  // The file and its pages are kept: nothing to redo tomorrow.
  const { count } = await student.db.from("material_pages").select("n", { count: "exact", head: true });
  expect(count).toBe(2);
});

test("a second upload queues behind the first and runs when it finishes; one job at a time", async ({ page, student }) => {
  await fakeModel({ extract: ONE_TOPIC, perObjective: 1, delayMs: 1500 });
  const courseId = await newCourse(student);
  const first = await sendDeck(page, student, courseId, "first.pdf", "Absorption");
  expect(first.generation.state).toBe("started");
  const second = await sendDeck(page, student, courseId, "second.pdf", "Consensus");
  expect(second.generation.state).toBe("queued");
  expect((await runStatus(second.generation.runId!)).status).toBe("queued");
  // The first finishes, the second starts on its own, and both land.
  await expect.poll(async () => (await runStatus(first.generation.runId!)).status, { timeout: 60_000 }).toBe("done");
  await expect.poll(async () => (await runStatus(second.generation.runId!)).status, { timeout: 60_000 }).toBe("done");
  const { data: runs } = await admin().from("pipeline_runs").select("status").eq("owner_id", student.id);
  expect(runs!.map((r) => r.status)).toEqual(["done", "done"]);
  // Every call was metered for this student, with a cost.
  const { data: usage } = await admin().from("model_usage").select("kind, run_id, model, input_tokens, output_tokens, cost_usd").eq("owner_id", student.id);
  expect(usage!.length).toBeGreaterThanOrEqual(4);
  expect(new Set(usage!.map((u) => u.run_id))).toEqual(new Set([first.generation.runId, second.generation.runId]));
  expect(usage!.every((u) => u.kind === "upload" && u.model === "claude-opus-5-5" && u.input_tokens === 100 && u.output_tokens === 100 && Number(u.cost_usd) > 0)).toBe(true);
});

test("a spend-limit answer from the API fails the job once with the budget message, with no retry", async ({ page, student }) => {
  await fakeModel({ extract: ONE_TOPIC, fail: { step: "map", type: "spend-limit" } });
  const courseId = await newCourse(student);
  const { generation } = await sendDeck(page, student, courseId, "deck.pdf", "Absorption");
  await expect.poll(async () => (await runStatus(generation.runId!)).status, { timeout: 30_000 }).toBe("failed");
  const { data } = await admin().from("pipeline_runs").select("error").eq("id", generation.runId!).single();
  expect(data!.error).toContain("Orca's model budget is used up for this month");
  expect(await fakeCalls()).toEqual(["map"]);
});

test("starting more uploads than the daily rate limit allows answers 429 with retry-after", async ({ page, student }) => {
  const courseId = await newCourse(student);
  const bytes = makePdf([lines("Rate")]);
  let last: { status: number; retryAfter: string | null; body: { error?: string } } | null = null;
  for (let i = 0; i < LIMITS.rate.upload.max + 1; i++) {
    const res = await page.request.post("/api/materials", { data: details(courseId, bytes, `deck-${i}.pdf`) });
    last = { status: res.status(), retryAfter: res.headers()["retry-after"] ?? null, body: (await res.json()) as { error?: string } };
    if (i < LIMITS.rate.upload.max) expect(res.status()).toBe(201);
  }
  expect(last!.status).toBe(429);
  expect(Number(last!.retryAfter)).toBeGreaterThan(0);
  expect(last!.body.error).toMatch(/20 uploads in 24 hours, the most Orca allows/);
  const s = await stored(page, student);
  expect(s.materials).toEqual([]); // the 20 were only started, never read
});
