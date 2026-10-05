#!/usr/bin/env node
/**
 * Scores the upload pipeline's structure against Sophia's authored ALD objectives.
 *
 * Uploads docs/samples/ald L02–L04 in order through the production pipeline (runUpload with the
 * same prompts, schemas, budgets and completeJson as /api/pipeline; each deck sees the structure the
 * previous ones built), then compares the objectives each deck created or covered with that
 * lecture's rows in docs/OBJECTIVES-ALD.md: exact name or alias first, then the production
 * reconcile call. Reports recall and precision per deck and overall.
 *
 * There is no target number to justify yet, so this guards against regressions: it fails only when
 * overall recall or precision drops more than 0.05 below scripts/extraction-baseline.json.
 *
 *   ANTHROPIC_API_KEY=… npm run score:extraction                 # score (calls the model)
 *   ANTHROPIC_API_KEY=… npm run score:extraction -- --update-baseline
 *   npm run score:extraction -- --dry                            # read decks + benchmark only, no model
 */
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { z } from "zod";
import type { Material, Objective, Topic } from "../src/lib/data.ts";
import type { LlmConfig } from "../src/lib/llm.ts";
import { completeJson } from "../src/lib/llm-server.ts";
import { type Named, exactMatch, shortlist } from "../src/lib/course/match.ts";
import { pageText } from "../src/lib/material/page-text.ts";
import { STEP_BUDGET } from "../src/lib/pipeline/budget.ts";
import { parseLooseJson } from "../src/lib/pipeline/parse.ts";
import { buildPrompt } from "../src/lib/pipeline/prompts.ts";
import { type CallStep, runUpload } from "../src/lib/pipeline/run.ts";
import { applyUploadPlan, type CourseStructureWithRelations } from "../src/lib/pipeline/apply.ts";
import { STEPS, type StepName } from "../src/lib/pipeline/schemas.ts";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const DECKS_DIR = path.join(ROOT, "docs/samples/ald");
const BENCHMARK = path.join(ROOT, "docs/OBJECTIVES-ALD.md");
const BASELINE = path.join(ROOT, "scripts/extraction-baseline.json");
const LECTURES = [2, 3, 4];
const TOLERANCE = 0.05;

interface Expected {
  id: string;
  lecture: number;
  topic: string;
  name: string;
}

/** The objective rows of docs/OBJECTIVES-ALD.md, by lecture ("## Lecture 2 · …", "### topic", "| objective | type | conf |"). */
export function parseBenchmark(md: string): Expected[] {
  const out: Expected[] = [];
  let lecture: number | null = null;
  let topic = "";
  for (const line of md.split("\n")) {
    const l = /^## Lecture (\d+)/.exec(line);
    if (l) {
      lecture = Number(l[1]);
      continue;
    }
    if (/^## /.test(line)) lecture = null;
    const t = /^### (.+)/.exec(line);
    if (t) topic = t[1].trim();
    const row = /^\|\s*([^|]+?)\s*\|/.exec(line);
    if (lecture !== null && row && row[1] !== "Objective" && !/^-+$/.test(row[1])) {
      out.push({ id: `L${lecture}-${out.length + 1}`, lecture, topic, name: row[1] });
    }
  }
  return out;
}

async function readDeck(file: string) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({ data: new Uint8Array(await readFile(file)) });
  const doc = await task.promise;
  const pages: Array<{ n: number; text: string }> = [];
  for (let n = 1; n <= doc.numPages; n++) pages.push({ n, text: pageText((await (await doc.getPage(n)).getTextContent()).items) });
  await task.destroy();
  return pages;
}

function modelCaller(config: LlmConfig): CallStep {
  return (async (step: StepName, input: unknown) => {
    const built = buildPrompt(step, input as never);
    const schema: z.ZodType<unknown> = STEPS[step].output;
    return completeJson(config, built.system, built.prompt, schema, (text) => schema.parse(parseLooseJson(text)), { ...STEP_BUDGET[step], context: built.context });
  }) as CallStep;
}

interface DeckScore {
  deck: string;
  expected: number;
  extracted: number;
  matchedExpected: number;
  matchedExtracted: number;
  topicsCreated: number;
  inferred: number;
  dropped: number;
  misses: string[];
  extras: string[];
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const benchmark = parseBenchmark(await readFile(BENCHMARK, "utf8"));
  const files = await readdir(DECKS_DIR);
  const deckFor = (lecture: number) => {
    const f = files.find((x) => x.startsWith(`L0${lecture}_`) && x.endsWith(".pdf"));
    if (!f) throw new Error(`No deck for lecture ${lecture} in ${DECKS_DIR}`);
    return path.join(DECKS_DIR, f);
  };

  if (args.has("--dry")) {
    for (const lecture of LECTURES) {
      const pages = await readDeck(deckFor(lecture));
      const chars = pages.reduce((n, p) => n + p.text.length, 0);
      console.log(`Lecture ${lecture}: ${path.basename(deckFor(lecture))}, ${pages.length} slides, ${chars} characters of text; ${benchmark.filter((b) => b.lecture === lecture).length} expected objectives`);
    }
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("ANTHROPIC_API_KEY is not set: can't run the pipeline against the ALD decks. Use --dry to check the decks and benchmark without a model.");
    process.exitCode = 1;
    return;
  }
  const config: LlmConfig = { provider: "anthropic", model: process.env.ORCA_MODEL ?? "claude-opus-5-5", apiKey };
  const call = modelCaller(config);

  let course: CourseStructureWithRelations = { topics: [], objectives: {}, bank: {}, relations: [] };
  const scores: DeckScore[] = [];
  for (const lecture of LECTURES) {
    const file = deckFor(lecture);
    const material: Material = { id: `deck-${lecture}`, courseId: "ald", filename: path.basename(file), type: "Lecture", assigned: null, due: null, reflect: false };
    console.log(`Uploading ${material.filename}…`);
    const plan = await runUpload(
      {
        course: { id: "ald", name: "Advanced Logic Design", short: "ALD", topics: course.topics },
        objectives: course.objectives,
        bank: course.bank,
        relations: course.relations,
        material,
        pages: await readDeck(file),
        runId: `run-${lecture}`,
        model: config.model,
        now: new Date().toISOString(),
      },
      { call, newId: () => crypto.randomUUID(), structureOnly: true },
    );
    course = applyUploadPlan(course, plan);
    // Students confirm what they're shown; later decks then see confirmed topics.
    course = { ...course, topics: course.topics.map((t: Topic) => (t.review === "proposed" ? { ...t, review: "confirmed" } : t)) };

    const touched: Objective[] = [...plan.newObjectives, ...Object.keys(plan.objectiveUpdates).map((id) => course.objectives[id])];
    const expected = benchmark.filter((b) => b.lecture === lecture);
    const expectedNamed: Named[] = expected.map((e) => ({ id: e.id, name: e.name, aliases: [], review: "confirmed", description: e.topic }));
    const matchedExpected = new Set<string>();
    const extras: string[] = [];
    for (const o of touched) {
      let hit = exactMatch([o.name, ...o.aliases], expectedNamed)?.id ?? null;
      if (!hit) {
        const close = shortlist({ name: o.name, aliases: o.aliases, description: o.description }, expectedNamed);
        if (close.length) {
          const r = await call("reconcile", {
            kind: "objective",
            candidate: { name: o.name, aliases: o.aliases, description: o.description },
            existing: close.map((c) => ({ id: c.id, name: c.name, aliases: [], description: c.description ?? "", rejected: false })),
          });
          if (r.decision === "same" && r.matchId && expected.some((e) => e.id === r.matchId)) hit = r.matchId;
        }
      }
      if (hit) matchedExpected.add(hit);
      else extras.push(o.name);
    }
    scores.push({
      deck: material.filename,
      expected: expected.length,
      extracted: touched.length,
      matchedExpected: matchedExpected.size,
      matchedExtracted: touched.length - extras.length,
      topicsCreated: plan.newTopics.length,
      inferred: plan.newObjectives.filter((o) => o.origin === "inferred").length,
      dropped: plan.run.dropped.length,
      misses: expected.filter((e) => !matchedExpected.has(e.id)).map((e) => e.name),
      extras,
    });
  }

  const sum = (k: keyof DeckScore) => scores.reduce((n, s) => n + (s[k] as number), 0);
  const recall = sum("matchedExpected") / Math.max(1, sum("expected"));
  const precision = sum("matchedExtracted") / Math.max(1, sum("extracted"));
  for (const s of scores) {
    console.log(`\n${s.deck}: recall ${s.matchedExpected}/${s.expected}, precision ${s.matchedExtracted}/${s.extracted}; ${s.topicsCreated} topics, ${s.inferred} inferred, ${s.dropped} dropped`);
    if (s.misses.length) console.log(`  missed: ${s.misses.join("; ")}`);
    if (s.extras.length) console.log(`  not in the authored set: ${s.extras.join("; ")}`);
  }
  console.log(`\nOverall recall ${recall.toFixed(3)}, precision ${precision.toFixed(3)} (model ${config.model})`);

  const result = { recall: Number(recall.toFixed(3)), precision: Number(precision.toFixed(3)), model: config.model, at: new Date().toISOString() };
  if (args.has("--update-baseline")) {
    await writeFile(BASELINE, `${JSON.stringify(result, null, 2)}\n`);
    console.log(`Baseline written to ${path.relative(ROOT, BASELINE)}.`);
    return;
  }
  const baseline = await readFile(BASELINE, "utf8").then((t) => JSON.parse(t) as typeof result).catch(() => null);
  if (!baseline) {
    console.log("No baseline yet; run again with --update-baseline to record one.");
    return;
  }
  if (recall < baseline.recall - TOLERANCE || precision < baseline.precision - TOLERANCE) {
    console.error(`Regression against the baseline (recall ${baseline.recall}, precision ${baseline.precision}).`);
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
