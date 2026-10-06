import test from "node:test";
import assert from "node:assert/strict";
import { ATLAS_CENTRE, RING_MAX, RING_MIN, atlasLayout, conceptMastery, connectedConcepts, ringRadii } from "../../src/lib/course/atlas.ts";
import type { Objective, Relation, Topic } from "../../src/lib/data.ts";
import type { ObjectiveState } from "../../src/lib/mastery/types.ts";

const topic = (id: string, name: string): Topic => ({ id, name, aliases: [], review: "confirmed", pos: { x: 0, y: 0 } });
const objective = (id: string, topicId: string, name: string, extra: Partial<Objective> = {}): Objective => ({ id, topicId, name, description: "", aliases: [], origin: "material", review: "confirmed", materialId: null, runId: null, ...extra } as Objective);
const state = (objectiveId: string, status: ObjectiveState["status"]): ObjectiveState => ({ objectiveId, status, credit: 0, creditDays: 0, stabilityDays: null, dueAt: null, spacedChecks: 0, recall: null, lastEvidenceAt: null });
const relation = (id: string, from: string, to: string, type: Relation["type"]): Relation => ({ id, from, to, type, anchor: null, review: "confirmed", materialId: "m" });

test("rings: one unit sits mid-way, several spread from the innermost to the outermost radius", () => {
  assert.deepEqual(ringRadii(0), []);
  assert.deepEqual(ringRadii(1), [Math.round((RING_MIN + RING_MAX) / 2)]);
  assert.deepEqual(ringRadii(4), [120, 195, 270, 345]);
});

test("concepts sit on their unit's ring, archived and merged objectives and relations are left out, and links need both ends", () => {
  const topics = [topic("t1", "Combinational"), topic("t2", "Sequential")];
  const objectives = {
    a: objective("a", "t1", "Boolean Algebra"),
    b: objective("b", "t1", "K-Maps"),
    gone: objective("gone", "t1", "Old", { review: "archived" }),
    merged: objective("merged", "t1", "Dup", { mergedInto: "a" }),
    c: objective("c", "t2", "Flip-Flops"),
    orphan: objective("orphan", "t9", "No topic"),
  };
  const relations = [relation("r1", "a", "b", "used-in"), relation("r2", "b", "c", "related"), relation("r3", "a", "gone", "has-a-kind"), relation("r4", "a", "a", "related"), { ...relation("r5", "a", "c", "alternative-to"), review: "archived" as const }];
  const states = new Map([["a", state("a", "mastered")], ["b", state("b", "learning")], ["c", state("c", "fading")]]);
  const layout = atlasLayout({ topics, objectives, relations, states });
  assert.deepEqual(layout.units.map((u) => [u.topic.id, u.index, u.radius]), [["t1", 1, 120], ["t2", 2, 345]]);
  assert.deepEqual(layout.concepts.map((c) => c.objective.id).sort(), ["a", "b", "c"]);
  for (const c of layout.concepts) {
    const r = layout.units[c.unit - 1].radius;
    const d = Math.hypot(c.x - ATLAS_CENTRE.x, c.y - ATLAS_CENTRE.y);
    assert.ok(Math.abs(d - r) < 1.5, `${c.objective.id} is on ring ${c.unit}`);
  }
  assert.deepEqual(layout.concepts.map((c) => [c.objective.id, c.mastery]).sort(), [["a", "mastered"], ["b", "building"], ["c", "review"]]);
  assert.deepEqual(layout.links.map((l) => [l.id, l.kind]), [["r1", "prerequisite"], ["r2", "related"]]);
  assert.deepEqual(connectedConcepts("b", layout).map((x) => [x.concept.objective.id, x.kind, x.direction]), [["a", "prerequisite", "from"], ["c", "related", "to"]]);
});

test("mastery labels: unseen is not started, learning is building, anything past mastery is review", () => {
  assert.equal(conceptMastery(undefined), "not-started");
  assert.equal(conceptMastery(state("o", "unseen")), "not-started");
  assert.equal(conceptMastery(state("o", "learning")), "building");
  assert.equal(conceptMastery(state("o", "mixed-up")), "review");
  assert.equal(conceptMastery(state("o", "mastered")), "mastered");
  assert.equal(conceptMastery(state("o", "retired")), "review");
});
