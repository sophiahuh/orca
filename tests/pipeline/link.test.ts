import test from "node:test";
import assert from "node:assert/strict";
import type { Relation, Topic } from "../../src/lib/data.ts";
import { closesLoop } from "../../src/lib/course/links.ts";
import { linkTopics } from "../../src/lib/pipeline/link.ts";
import type { CallStep } from "../../src/lib/pipeline/run.ts";

const topic = (id: string, extra: Partial<Topic> = {}): Topic => ({ id, name: id.toUpperCase(), review: "confirmed", pos: { x: 0, y: 0 }, ...extra });
const rel = (from: string, to: string, type: Relation["type"], reason: string | null = "Because the one builds directly on the other."): Relation => ({ id: `${from}-${type}-${to}`, from, to, type, anchor: null, review: "proposed", materialId: null, reason });
let n = 0;
const newId = () => `new${n++}`;
/** A link step that answers with these links (by topic id: refs are t1… in the topics' order). */
const answering = (topics: Topic[], links: Array<{ from: string; to: string; type: Relation["type"]; reason: string }>): CallStep => {
  const ref = new Map(topics.map((t, i) => [t.id, `t${i + 1}`]));
  return (async () => ({ links: links.map((l) => ({ ...l, from: ref.get(l.from)!, to: ref.get(l.to)! })) })) as unknown as CallStep;
};

test("a loop of prerequisites is caught, through any number of steps", () => {
  const kept = [rel("a", "b", "used-in"), rel("b", "c", "has-a-kind"), rel("c", "d", "related")];
  assert.equal(closesLoop(kept, "c", "a"), true, "a → b → c, so c → a closes it");
  assert.equal(closesLoop(kept, "d", "a"), false, "related links don't order topics");
  assert.equal(closesLoop(kept, "a", "c"), false);
});

test("the link step keeps links with a reason, drops one that would close a loop, and one with no reason, saying why", async () => {
  const topics = [topic("fw"), topic("prefill"), topic("cost")];
  const call = answering(topics, [
    { from: "fw", to: "prefill", type: "used-in", reason: "A runtime's API is how prefill and decode are actually run." },
    { from: "prefill", to: "cost", type: "used-in", reason: "Cost models price the prefill and decode passes separately." },
    { from: "cost", to: "fw", type: "used-in", reason: "Cost decides which runtime a team picks." },
    { from: "fw", to: "cost", type: "related", reason: "" },
  ]);
  const out = await linkTopics({ course: { name: "Networks for AI", short: "NAI" }, topics, newIds: new Set(["fw", "prefill", "cost"]), existing: [], materialId: null }, { call, newId });
  assert.deepEqual(out.links.map((l) => [l.from, l.to, l.type]), [["fw", "prefill", "used-in"], ["prefill", "cost", "used-in"]]);
  assert.equal(out.links[0].reason, "A runtime's API is how prefill and decode are actually run.");
  assert.deepEqual(out.dropped.map((d) => d.reason), ["would make a loop of prerequisites (each topic would have to come before the other)", "it came without a reason"]);
});

test("an old link with no reason gets the one the model gives when it returns it; links with reasons aren't touched", async () => {
  const topics = [topic("a"), topic("b"), topic("c")];
  const existing = [rel("a", "b", "used-in", null), rel("b", "c", "used-in")];
  const call = answering(topics, [
    { from: "a", to: "b", type: "used-in", reason: "B's procedure applies A's rules at every step." },
    { from: "b", to: "c", type: "used-in", reason: "A different reason the model came up with." },
  ]);
  const out = await linkTopics({ course: { name: "C", short: "C" }, topics, newIds: new Set(["a", "b", "c"]), existing, materialId: null }, { call, newId });
  assert.deepEqual(out.links, []);
  assert.deepEqual(out.explained, [{ id: "a-used-in-b", reason: "B's procedure applies A's rules at every step." }]);
});

test("two topics get one link: a pair the course already links is skipped; the most specific kind wins, even over this upload's own", async () => {
  const topics = [topic("kv"), topic("attn"), topic("paged")];
  const call = answering(topics, [
    { from: "attn", to: "kv", type: "related", reason: "Attention variants exist to shrink the KV cache." },
    { from: "kv", to: "attn", type: "used-in", reason: "Each variant changes a term of the KV-cache size formula." },
    { from: "kv", to: "paged", type: "used-in", reason: "Paging allocates the KV cache in fixed blocks." },
  ]);
  const existing = [rel("paged", "kv", "related")];
  const fromThisRun = [{ ...rel("attn", "kv", "related"), id: "extracted" }];
  const out = await linkTopics({ course: { name: "C", short: "C" }, topics, newIds: new Set(["kv", "attn", "paged"]), existing, fromThisRun, materialId: "m" }, { call, newId });
  assert.deepEqual(out.links.map((l) => [l.from, l.to, l.type]), [["kv", "attn", "used-in"]], "the course's paged–kv link holds its pair");
  assert.deepEqual(out.replaced, ["extracted"], "the upload's own related link gives way to used-in");
});
