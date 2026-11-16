import test from "node:test";
import assert from "node:assert/strict";
import { concurrent, PipelineDeferred } from "../../../src/lib/jobs/staged/types.ts";

test("a folder keeps admission order while two transfers overlap", async () => {
  let release!: () => void;
  const first = new Promise<void>((resolve) => { release = resolve; });
  const started: number[] = [];
  let active = 0; let peak = 0;
  const work = concurrent([0, 1, 2, 3], 2, async (n) => {
    started.push(n); peak = Math.max(peak, ++active);
    if (n === 0) await first;
    else if (n === 3) release();
    active--; return `file${n}`;
  });
  assert.deepEqual(await work, ["file0", "file1", "file2", "file3"]);
  assert.deepEqual(started, [0, 1, 2, 3]);
  assert.equal(peak, 2);
});
test("capacity errors remain distinguishable from failed model output", () => {
  const error = new PipelineDeferred("capacity", "Wait for model capacity");
  assert.equal(error.reason, "capacity");
  assert.equal(error.name, "PipelineDeferred");
});
test("invalid concurrency fails instead of silently skipping files", async () => {
  await assert.rejects(concurrent([1], 0, async (n) => n), /positive integer/);
});
