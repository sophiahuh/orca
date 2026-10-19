/**
 * A zod schema as the JSON Schema OpenAI's strict Structured Outputs accept (the Anthropic path gets
 * the same from the SDK's `betaZodOutputFormat`). Strict mode takes a subset: a root object, every
 * property required, `additionalProperties: false`, and of the constraints only `pattern`/`format`
 * on strings, `minimum`/`maximum`/`multipleOf` on numbers and `minItems`/`maxItems` on arrays
 * (developers.openai.com/api/docs/guides/structured-outputs, read 2026-10-06). Other constraints
 * (string lengths) are dropped here and still enforced by the zod parse of the reply. An optional
 * field throws: Orca's output schemas say "or null" with `.nullable()` instead. Pure.
 */
import { z } from "zod";

const STRING_FORMATS = new Set(["date-time", "time", "date", "duration", "email", "hostname", "ipv4", "ipv6", "uuid"]);
const DROPPED = new Set(["$schema", "minLength", "maxLength", "default", "examples", "title"]);

type Json = { [key: string]: unknown };

function strictify(node: unknown, path: string): unknown {
  if (Array.isArray(node)) return node.map((n, i) => strictify(n, `${path}[${i}]`));
  if (!node || typeof node !== "object") return node;
  const out: Json = {};
  for (const [key, value] of Object.entries(node as Json)) {
    if (DROPPED.has(key)) continue;
    if (key === "format" && !STRING_FORMATS.has(String(value))) continue;
    // zod's int() bounds (±2^53−1) say nothing to the model.
    if ((key === "minimum" || key === "maximum") && Math.abs(Number(value)) >= Number.MAX_SAFE_INTEGER) continue;
    if (key === "properties" && value && typeof value === "object") {
      out.properties = Object.fromEntries(Object.entries(value as Json).map(([k, v]) => [k, strictify(v, `${path}.${k}`)]));
      continue;
    }
    out[key] = strictify(value, `${path}.${key}`);
  }
  if (out.type === "object") {
    const props = Object.keys((out.properties as Json | undefined) ?? {});
    const required = new Set((out.required as string[] | undefined) ?? []);
    const optional = props.filter((p) => !required.has(p));
    if (optional.length) throw new Error(`OpenAI strict outputs need every field required; ${path} has optional ${optional.join(", ")} (use .nullable())`);
    out.required = props;
    out.additionalProperties = false;
  }
  return out;
}

/** `schema` as a strict OpenAI `json_schema` body. Throws for a schema strict mode can't express. */
export function openAiJsonSchema(schema: z.ZodType<unknown>): Json {
  const json = strictify(z.toJSONSchema(schema, { target: "draft-7", io: "output" }), "$") as Json;
  if (json.type !== "object") throw new Error("OpenAI strict outputs need an object at the root");
  return json;
}
