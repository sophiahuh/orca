/** Pull the first JSON object out of a model reply (handles code fences and chatter). */
export function parseLooseJson(text: string): unknown {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end < 0) throw new Error("The model did not return JSON.");
  return JSON.parse(cleaned.slice(start, end + 1));
}
