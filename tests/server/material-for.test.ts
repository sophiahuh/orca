import test from "node:test";
import assert from "node:assert/strict";
import { materialFor } from "../../src/lib/server/connector/material-for.ts";
import { fakeDb } from "../support/fake-db.ts";

const OWNER = "owner-1";
const COURSE = "c0000000-0000-4000-8000-000000000001";
const topicRow = (id: string, extra: Record<string, unknown> = {}) => ({ id, owner_id: OWNER, course_id: COURSE, name: `Topic ${id}`, review: "confirmed", merged_into: null, material_id: null, uncertain: null, pos_x: 0, pos_y: 0, summary: null, source: null, sort_order: 0, archived_with_material: false, ...extra });
const objectiveRow = (id: string, signals: unknown[], extra: Record<string, unknown> = {}) => ({ id, owner_id: OWNER, course_id: COURSE, topic_id: "t", name: `Objective ${id}`, description: "", origin: "material", review: "confirmed", merged_into: null, material_id: "L1", run_id: null, archived_with_topic: false, archived_with_material: false, uncertain: null, signals, ...extra });
const materialRow = (id: string, extra: Record<string, unknown> = {}) => ({ id, owner_id: OWNER, course_id: COURSE, filename: `${id}.pdf`, type: "Lecture", assigned: null, due: null, reflect: false, reflection: null, hidden_text: null, storage_path: null, status: "ready", held_back: false, created_at: "2026-11-01T00:00:00Z", ...extra });
const pageRows = (materialId: string, n: number) => Array.from({ length: n }, (_, i) => ({ owner_id: OWNER, material_id: materialId, n: i + 1, text: `${materialId} page ${i + 1}` }));
const place = (locator: string) => ({ locator, excerpt: "x" });

function db() {
  return fakeDb({
    courses: [{ id: COURSE, owner_id: OWNER, deleted_at: null }],
    topics: [topicRow("t")],
    objectives: [
      objectiveRow("a", [{ materialId: "L1", materialType: "Lecture", places: [place("slide 3")] }, { materialId: "exam", materialType: "Past exam", places: [place("page 1"), place("page 2")] }]),
      objectiveRow("b", [{ materialId: "gone", materialType: "Lecture", places: [place("slide 1")] }], { material_id: "gone" }),
      objectiveRow("merged", [], { merged_into: "a" }),
      objectiveRow("archived", [{ materialId: "L1", materialType: "Lecture", places: [place("slide 1")] }], { review: "archived" }),
      objectiveRow("other", [{ materialId: "L1", materialType: "Lecture", places: [place("slide 1")] }], { owner_id: "someone-else", course_id: "c0000000-0000-4000-8000-000000000002" }),
    ],
    materials: [materialRow("L1"), materialRow("exam", { type: "Past exam", held_back: true }), materialRow("gone", { status: "removed" })],
    material_pages: [...pageRows("L1", 5), ...pageRows("exam", 2), ...pageRows("gone", 2)],
  });
}

test("material_for returns each objective's anchored pages from live materials only, counts the held-back one, and reads no held-back or removed pages", async () => {
  const d = db();
  const got = await materialFor(d as never, OWNER, COURSE, ["a", "b", "merged", "archived", "other", "unknown"]);
  assert.ok(got);
  assert.equal(got.heldBack, 1);
  const byId = Object.fromEntries(got.objectives.map((o) => [o.objectiveId, o.pieces]));
  assert.deepEqual(Object.keys(byId), ["a", "b", "merged", "archived", "other", "unknown"], "every id asked for is answered, in order");
  assert.deepEqual(byId.a.map((p) => [p.materialId, p.filename, p.page, p.text]), [["L1", "L1.pdf", 2, "L1 page 2"], ["L1", "L1.pdf", 3, "L1 page 3"], ["L1", "L1.pdf", 4, "L1 page 4"]], "the past exam's pages never appear");
  assert.deepEqual(byId.b, [], "a removed material has nothing");
  assert.deepEqual(byId.merged, byId.a, "a merged objective answers with its survivor's pages");
  assert.deepEqual(byId.archived, []);
  assert.deepEqual(byId.other, [], "another student's objective is unknown here");
  assert.deepEqual(byId.unknown, []);
});

test("material_for is null for a course that isn't the student's or was deleted", async () => {
  assert.equal(await materialFor(db() as never, "someone-else", COURSE, ["a"]), null);
  const deleted = db();
  deleted.tables.courses[0].deleted_at = "2026-11-09T00:00:00Z";
  assert.equal(await materialFor(deleted as never, OWNER, COURSE, ["a"]), null);
});
