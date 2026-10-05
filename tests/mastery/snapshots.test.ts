/**
 * The server's snapshot path against an in-memory double of the database: recording answers keeps
 * each objective's snapshot equal to a full replay, a version conflict retries from the log, and
 * stale or old-rules snapshots are rebuilt on read.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { attribution, eventsCountingFor } from "../../src/lib/mastery/attribution.ts";
import type { QuestionRef } from "../../src/lib/mastery/catalogue.ts";
import { RULES_VERSION, type ObjectiveAccumulator, replayObjective } from "../../src/lib/mastery/objective-state.ts";
import { type Snapshot, type SnapshotStore, VersionConflictError, readCourseState, recordEvent } from "../../src/lib/mastery/snapshots.ts";
import type { AnswerEvent, ConfusionEvent, EvidenceEvent, ObjectiveInfo } from "../../src/lib/mastery/types.ts";

const utcDay = (iso: string) => iso.slice(0, 10);
const day = (n: number, hour = 12) => new Date(Date.UTC(2026, 9, n, hour)).toISOString();

class MemoryStore implements SnapshotStore {
  catalogue: Record<string, ObjectiveInfo> = {
    a: { id: "a", topicId: "t", name: "A", review: "confirmed" },
    b: { id: "b", topicId: "t", name: "B", review: "confirmed" },
  };
  bank: Record<string, QuestionRef[]> = {
    t: [
      { id: "qa1", objectiveId: "a" },
      { id: "qa2", objectiveId: "a" },
      { id: "qa3", objectiveId: "a", tier: "mechanism" },
      { id: "qb1", objectiveId: "b" },
      { id: "qb2", objectiveId: "b" },
    ],
  };
  events: EvidenceEvent[] = [];
  rows = new Map<string, Snapshot>();
  writes = 0;
  /** Runs once, just before the next record() checks its version: another tab writing in between. */
  beforeRecord: (() => void) | null = null;

  async view() {
    return { attribution: attribution({ topicIds: ["t"], bank: this.bank, catalogue: this.catalogue }), dayKey: utcDay };
  }
  async snapshot(objectiveId: string) {
    const row = this.rows.get(objectiveId);
    return row ? structuredClone(row) : null;
  }
  async snapshots() {
    return [...this.rows.values()].map((r) => structuredClone(r));
  }
  async log() {
    return structuredClone(this.events);
  }
  async record(event: EvidenceEvent, write: { objectiveId: string; accumulator: ObjectiveAccumulator; expectedVersion: number } | null) {
    const interloper = this.beforeRecord;
    this.beforeRecord = null;
    interloper?.();
    if (write) {
      const row = this.rows.get(write.objectiveId);
      if ((row?.version ?? 0) !== write.expectedVersion) return false;
      this.rows.set(write.objectiveId, {
        objectiveId: write.objectiveId,
        // Stored as JSON, as jsonb would.
        accumulator: JSON.parse(JSON.stringify(write.accumulator)),
        rulesVersion: RULES_VERSION,
        stale: false,
        version: write.expectedVersion + 1,
      });
    }
    this.events.push(event);
    this.writes += 1;
    return true;
  }
  async save(objectiveId: string, accumulator: ObjectiveAccumulator, expectedVersion: number) {
    const row = this.rows.get(objectiveId);
    if (!row || row.version !== expectedVersion) return false;
    this.rows.set(objectiveId, { objectiveId, accumulator: JSON.parse(JSON.stringify(accumulator)), rulesVersion: RULES_VERSION, stale: false, version: expectedVersion + 1 });
    return true;
  }
  markStale(objectiveId: string) {
    const row = this.rows.get(objectiveId);
    if (row) this.rows.set(objectiveId, { ...row, stale: true, version: row.version + 1 });
    else this.rows.set(objectiveId, { objectiveId, accumulator: null, rulesVersion: null, stale: true, version: 1 });
  }
  /** What a full replay of the log gives for one objective. */
  async replay(objectiveId: string) {
    const view = await this.view();
    const o = view.attribution.objectives.get(objectiveId)!;
    return replayObjective(objectiveId, eventsCountingFor(objectiveId, this.events, view.attribution), { hasMechanismQuestions: o.hasMechanismQuestions, dayKey: utcDay });
  }
}

let seq = 0;
const answer = (questionId: string, objectiveId: string, at: string, over: Partial<AnswerEvent> = {}): AnswerEvent => ({
  kind: "answer",
  id: `e${++seq}`,
  at,
  courseId: "c",
  topicId: "t",
  objectiveId,
  questionId,
  tier: null,
  outcome: "correct",
  grader: "choice",
  source: "quiz",
  sessionId: at.slice(0, 10),
  ...over,
});
const confusion = (objectiveId: string, at: string): ConfusionEvent => ({
  kind: "confusion",
  id: `e${++seq}`,
  at,
  courseId: "c",
  topicId: "t",
  objectiveId,
  materialId: "m",
  note: "lost",
});

test("each answer updates its objective's snapshot, which always equals a full replay", async () => {
  const store = new MemoryStore();
  const log = [
    answer("qa1", "a", day(1), { outcome: "incorrect" }),
    answer("qa2", "a", day(1), { outcome: "incorrect" }),
    answer("qb1", "b", day(1)),
    answer("qa3", "a", day(1), { tier: "mechanism" }),
    answer("qa1", "a", day(2)),
    confusion("b", day(2, 13)),
    answer("qa2", "a", day(3)),
  ];
  for (const e of log) {
    const r = await recordEvent(store, e);
    assert.equal(r.retried, false);
    for (const id of ["a", "b"]) if (store.rows.has(id)) assert.deepEqual(store.rows.get(id)!.accumulator, await store.replay(id), `${id} after ${e.id}`);
  }
  assert.equal(store.events.length, log.length);
  assert.equal(store.rows.get("a")!.version, 5);
  assert.equal(store.rows.get("a")!.accumulator!.mixedUp, false, "the mechanism question cleared the mix-up");
});

test("the first answer for an objective with no snapshot folds the log, not an empty state", async () => {
  const store = new MemoryStore();
  // An earlier answer that counted for nothing then (b was archived), and counts for b now.
  store.events.push(answer("qb1", "b", day(1)));
  const r = await recordEvent(store, answer("qb2", "b", day(2)));
  assert.equal(r.rebuilt, true);
  assert.equal(store.rows.get("b")!.accumulator!.answered, 2);
  assert.deepEqual(store.rows.get("b")!.accumulator, await store.replay("b"));
});

test("an event that counts for nothing is recorded without a snapshot", async () => {
  const store = new MemoryStore();
  store.catalogue.b = { ...store.catalogue.b, review: "archived" };
  const r = await recordEvent(store, answer("qb1", "b", day(1)));
  assert.equal(r.objectiveId, null);
  assert.equal(store.events.length, 1);
  assert.equal(store.rows.size, 0);
});

test("answers are filed under the question's current objective after a merge", async () => {
  const store = new MemoryStore();
  store.catalogue.b = { ...store.catalogue.b, review: "archived", mergedInto: "a" };
  const r = await recordEvent(store, answer("qb1", "b", day(1)));
  assert.equal(r.objectiveId, "a");
  assert.equal(store.events[0].objectiveId, "b", "the log keeps what was recorded");
  assert.equal(store.rows.get("a")!.accumulator!.attempted[0], "qb1");
});

test("a version conflict (another tab wrote first) rebuilds from the log and retries once", async () => {
  const store = new MemoryStore();
  await recordEvent(store, answer("qa1", "a", day(1)));
  const other = answer("qa2", "a", day(1, 13));
  store.beforeRecord = () => {
    // The other tab's whole write lands between this request's read and its write.
    store.events.push(other);
    const row = store.rows.get("a")!;
    store.rows.set("a", { ...row, version: row.version + 1 });
  };
  const mine = answer("qa3", "a", day(1, 14), { tier: "mechanism" });
  const r = await recordEvent(store, mine);
  assert.equal(r.retried, true);
  assert.equal(store.rows.get("a")!.accumulator!.answered, 3, "both tabs' answers are in the snapshot");
  assert.deepEqual(store.rows.get("a")!.accumulator, await store.replay("a"));
  assert.equal(store.rows.get("a")!.version, 3, "1, the other tab's 2, then the retry's 3");
});

test("a second conflict gives up without writing anything", async () => {
  const store = new MemoryStore();
  await recordEvent(store, answer("qa1", "a", day(1)));
  const bump = () => {
    const row = store.rows.get("a")!;
    store.rows.set("a", { ...row, version: row.version + 1 });
  };
  store.beforeRecord = () => {
    bump();
    store.beforeRecord = bump;
  };
  await assert.rejects(recordEvent(store, answer("qa2", "a", day(2))), VersionConflictError);
  assert.equal(store.events.length, 1);
});

test("an event older than the snapshot's last one is folded in order from the log", async () => {
  const store = new MemoryStore();
  await recordEvent(store, answer("qa1", "a", day(2)));
  const r = await recordEvent(store, answer("qa2", "a", day(1)));
  assert.equal(r.rebuilt, true);
  assert.deepEqual(store.rows.get("a")!.accumulator, await store.replay("a"));
});

test("a stale snapshot is rebuilt on write, not extended", async () => {
  const store = new MemoryStore();
  await recordEvent(store, answer("qa1", "a", day(1)));
  await recordEvent(store, answer("qb1", "b", day(1)));
  store.catalogue.b = { ...store.catalogue.b, review: "archived", mergedInto: "a" };
  store.markStale("a");
  store.markStale("b");
  const r = await recordEvent(store, answer("qa2", "a", day(2)));
  assert.equal(r.rebuilt, true);
  assert.equal(store.rows.get("a")!.accumulator!.answered, 3, "b's answer came with the merge");
});

test("reading state returns fresh snapshots as stored and rebuilds stale, old-rules and placeholder ones", async () => {
  const store = new MemoryStore();
  for (const e of [answer("qa1", "a", day(1)), answer("qb1", "b", day(1)), answer("qa2", "a", day(2))]) await recordEvent(store, e);
  const fresh = await readCourseState(store);
  assert.deepEqual(fresh.rebuilt, []);
  assert.deepEqual(fresh.objectives.map((o) => o.objectiveId).sort(), ["a", "b"]);

  // Merge b into a: the structure change marks both stale.
  store.catalogue.b = { ...store.catalogue.b, review: "archived", mergedInto: "a" };
  store.markStale("a");
  store.markStale("b");
  const merged = await readCourseState(store);
  assert.deepEqual(merged.rebuilt, ["a"], "b holds no state now, so it isn't read");
  assert.deepEqual(merged.objectives.map((o) => o.objectiveId), ["a"]);
  assert.equal(merged.objectives[0].accumulator.answered, 3);
  assert.deepEqual(store.rows.get("a")!.accumulator, await store.replay("a"), "the rebuild is saved");
  assert.equal(store.rows.get("a")!.stale, false);
  assert.deepEqual((await readCourseState(store)).rebuilt, [], "and the next read uses it");

  // A rules bump: snapshots folded under an older version are stale.
  const row = store.rows.get("a")!;
  store.rows.set("a", { ...row, rulesVersion: RULES_VERSION - 1, accumulator: { ...row.accumulator!, answered: 99 } });
  const bumped = await readCourseState(store);
  assert.deepEqual(bumped.rebuilt, ["a"]);
  assert.equal(bumped.objectives[0].accumulator.answered, 3);

  // A placeholder a merge created for an objective that had no snapshot.
  store.catalogue.b = { ...store.catalogue.b, review: "confirmed", mergedInto: undefined };
  store.rows.delete("b");
  store.markStale("b");
  store.markStale("a");
  const unmerged = await readCourseState(store);
  assert.deepEqual(unmerged.rebuilt.sort(), ["a", "b"]);
  assert.equal(unmerged.objectives.find((o) => o.objectiveId === "b")!.accumulator.answered, 1);
});

test("a rebuild that loses a race to a write is returned but not saved", async () => {
  const store = new MemoryStore();
  await recordEvent(store, answer("qa1", "a", day(1)));
  store.markStale("a");
  const save = store.save.bind(store);
  store.save = async (id, acc, v) => {
    store.markStale(id);
    return save(id, acc, v);
  };
  const r = await readCourseState(store);
  assert.deepEqual(r.rebuilt, ["a"]);
  assert.equal(r.objectives[0].saved, false);
  assert.equal(store.rows.get("a")!.stale, true, "still stale, so the next read tries again");
});

test("a structure change between reading the structure and the snapshot starts over with the new structure", async () => {
  const store = new MemoryStore();
  await recordEvent(store, answer("qb1", "b", day(1)));
  const read = store.snapshot.bind(store);
  let merged = false;
  store.snapshot = async (id) => {
    if (!merged) {
      merged = true;
      store.catalogue.b = { ...store.catalogue.b, review: "archived", mergedInto: "a" };
      store.markStale("a");
      store.markStale("b");
    }
    return read(id);
  };
  const r = await recordEvent(store, answer("qb2", "b", day(2)));
  assert.equal(r.objectiveId, "a");
  assert.equal(r.retried, true);
  assert.equal(store.rows.get("a")!.accumulator!.answered, 2, "b's earlier answer came with the merge");
  assert.deepEqual(store.rows.get("a")!.accumulator, await store.replay("a"));
});
