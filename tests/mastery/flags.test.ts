import test from "node:test";
import assert from "node:assert/strict";
import { BROWSER_FLAG_SOURCES, FLAG_STRENGTH, canFlagHard, flagStrength, isInRotation } from "../../src/lib/mastery/flags.ts";
import type { ObjectiveStatus } from "../../src/lib/mastery/types.ts";

test("only the connector asks for a check; every other source is struggled", () => {
  assert.equal(flagStrength({ flagSource: "connector" }), "check");
  for (const s of ["homework", "handwritten-marker", "slide", "manual"] as const) assert.equal(flagStrength({ flagSource: s }), "struggled");
  assert.deepEqual(Object.keys(FLAG_STRENGTH).sort(), ["connector", "handwritten-marker", "homework", "manual", "slide"]);
});

test("the browser may send homework, slide and manual flags only", () => {
  assert.deepEqual([...BROWSER_FLAG_SOURCES], ["homework", "slide", "manual"]);
});

test("in rotation is every status but unseen, verified and check-due", () => {
  const all: ObjectiveStatus[] = ["unseen", "verified", "check-due", "learning", "mixed-up", "mastered", "fading", "retired"];
  assert.deepEqual(all.filter(isInRotation), ["learning", "mixed-up", "mastered", "fading", "retired"]);
});

test("This is hard is offered unless the objective is already being learned", () => {
  const all: ObjectiveStatus[] = ["unseen", "verified", "check-due", "learning", "mixed-up", "mastered", "fading", "retired"];
  assert.deepEqual(all.filter((s) => !canFlagHard(s)), ["learning", "mixed-up"]);
});
