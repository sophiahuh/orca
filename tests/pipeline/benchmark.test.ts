import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseBenchmark } from "../../scripts/score-extraction.ts";

test("the ALD benchmark is read from docs/OBJECTIVES-ALD.md by lecture and topic", () => {
  const rows = parseBenchmark(readFileSync("docs/OBJECTIVES-ALD.md", "utf8"));
  assert.deepEqual([2, 3, 4].map((l) => rows.filter((r) => r.lecture === l).length > 0), [true, true, true]);
  assert.deepEqual(rows[0], { id: "L2-1", lecture: 2, topic: "Logic circuits & switches", name: "Translate a series/parallel switch network to its Boolean function and back" });
  assert.ok(rows.every((r) => r.name !== "Objective" && !/^-+$/.test(r.name)), "header and separator rows are skipped");
});
