import test from "node:test";
import assert from "node:assert/strict";
import { ModelConfigError, callsAreLocal, resolveServerModel } from "../src/lib/model-config.ts";
import { openAiJsonSchema } from "../src/lib/openai-schema.ts";
import { STEPS } from "../src/lib/pipeline/schemas.ts";
import { GradeSchema } from "../src/lib/grading.ts";
import { z } from "zod";

test("unset, the provider follows the keys: OpenAI first, then Anthropic, else no model", () => {
  assert.equal(resolveServerModel({}), null);
  assert.deepEqual(resolveServerModel({ ANTHROPIC_API_KEY: "a" }), { provider: "anthropic", model: "claude-opus-5-5", apiKey: "a" });
  assert.deepEqual(resolveServerModel({ ANTHROPIC_API_KEY: "a", OPENAI_API_KEY: "o" }), { provider: "openai", model: "gpt-6.1-sol", apiKey: "o" });
  assert.equal(resolveServerModel({ OPENAI_API_KEY: "", ANTHROPIC_API_KEY: "a" })?.provider, "anthropic", "an empty key is no key");
});

test("ORCA_MODEL_PROVIDER picks the provider, and its key must be set", () => {
  assert.equal(resolveServerModel({ ORCA_MODEL_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "a", OPENAI_API_KEY: "o" })?.provider, "anthropic");
  assert.equal(resolveServerModel({ ORCA_MODEL_PROVIDER: "OpenAI", OPENAI_API_KEY: "o" })?.provider, "openai");
  assert.throws(() => resolveServerModel({ ORCA_MODEL_PROVIDER: "openai", ANTHROPIC_API_KEY: "a" }), ModelConfigError);
  assert.throws(() => resolveServerModel({ ORCA_MODEL_PROVIDER: "gemini", OPENAI_API_KEY: "o" }), ModelConfigError);
  assert.equal(resolveServerModel({ ORCA_MODEL_PROVIDER: "", ANTHROPIC_API_KEY: "a" })?.provider, "anthropic", "empty is unset");
});

test("ORCA_MODEL must belong to the provider and have a price", () => {
  assert.equal(resolveServerModel({ OPENAI_API_KEY: "o", ORCA_MODEL: "gpt-6-luna" })?.model, "gpt-6-luna");
  assert.throws(() => resolveServerModel({ OPENAI_API_KEY: "o", ORCA_MODEL: "claude-opus-5-5" }), ModelConfigError);
  assert.throws(() => resolveServerModel({ ANTHROPIC_API_KEY: "a", ORCA_MODEL: "gpt-6.1-sol" }), ModelConfigError);
  assert.throws(() => resolveServerModel({ OPENAI_API_KEY: "o", ORCA_MODEL: "gpt-made-up" }), /no price/);
});

test("calls are local only when the chosen provider's base URL is this machine", () => {
  assert.equal(callsAreLocal(resolveServerModel({ ANTHROPIC_API_KEY: "a", ANTHROPIC_BASE_URL: "http://127.0.0.1:3101" })), true);
  assert.equal(callsAreLocal(resolveServerModel({ ANTHROPIC_API_KEY: "a" })), false);
  // A local Anthropic fake doesn't make a real OpenAI key local.
  assert.equal(callsAreLocal(resolveServerModel({ OPENAI_API_KEY: "o", ANTHROPIC_API_KEY: "a", ANTHROPIC_BASE_URL: "http://127.0.0.1:3101" })), false);
  assert.equal(callsAreLocal(resolveServerModel({ OPENAI_API_KEY: "o", OPENAI_BASE_URL: "http://localhost:3102/v1" })), true);
});

test("every pipeline step's output and the grade convert to OpenAI's strict schema", () => {
  for (const [step, spec] of Object.entries(STEPS)) assert.doesNotThrow(() => openAiJsonSchema(spec.output), step);
  const grade = openAiJsonSchema(GradeSchema) as { properties: Record<string, Record<string, unknown>> };
  assert.equal(grade.properties.feedback.maxLength, undefined, "string lengths are left to the zod parse");
  assert.throws(() => openAiJsonSchema(z.object({ a: z.string().optional() })), /optional a/);
});
