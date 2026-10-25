import test from "node:test";
import assert from "node:assert/strict";
import type { Relation, Topic } from "../../src/lib/data.ts";
import type { ObjectiveState } from "../../src/lib/mastery/types.ts";
import { GRAPH, labelBottom, topicGraph, topicStrength, topicSummary, wrapLabel } from "../../src/lib/course/topic-graph.ts";

const topic = (id: string, extra: Partial<Topic> = {}): Topic => ({ id, name: id, review: "confirmed", pos: { x: 0, y: 0 }, ...extra });
const rel = (from: string, to: string, type: Relation["type"], extra: Partial<Relation> = {}): Relation => ({ id: `${from}-${type}-${to}`, from, to, type, anchor: null, review: "proposed", materialId: "m", reason: null, ...extra });

test("foundations sit on top: a topic is a row above what it's used in and its kinds; sizes grow with use", () => {
  const live = ["recursion", "tree", "dc", "bst", "heap", "merge", "quick"].map((id) => topic(id));
  const relations = [
    rel("recursion", "dc", "used-in"),
    rel("recursion", "bst", "used-in"),
    rel("tree", "bst", "has-a-kind"),
    rel("tree", "heap", "has-a-kind"),
    rel("dc", "merge", "used-in"),
    rel("dc", "quick", "used-in"),
    rel("merge", "quick", "alternative-to"),
    rel("quick", "merge", "alternative-to"), // the same pair the other way: one edge
  ];
  const g = topicGraph({ topics: live, live, relations, strengthOf: () => "unverified" });
  const row = Object.fromEntries(g.nodes.map((n) => [n.topic.id, n.row]));
  assert.deepEqual(row, { recursion: 0, tree: 0, dc: 1, bst: 1, heap: 1, merge: 2, quick: 2 });
  const node = (id: string) => g.nodes.find((n) => n.topic.id === id)!;
  assert.equal(node("recursion").usedIn, 2);
  assert.equal(node("recursion").r, GRAPH.radius + 2 * GRAPH.radiusStep);
  assert.equal(node("heap").r, GRAPH.radius);
  assert.equal(node("tree").kinds, 2);
  assert.equal(g.edges.length, 7);
  assert.equal(g.edges.filter((e) => e.type === "alternative-to").length, 1);
  assert.ok(node("recursion").y < node("dc").y && node("dc").y < node("merge").y);
  assert.equal(topicSummary(node("tree")), "Used in 0 · has 2 kinds");
});

test("merged and rejected topics: links follow merges, and links to archived topics or itself are dropped", () => {
  const topics = [topic("a"), topic("b"), topic("old", { review: "archived", mergedInto: "b" }), topic("gone", { review: "archived" })];
  const live = topics.filter((t) => t.review !== "archived");
  const g = topicGraph({
    topics,
    live,
    relations: [rel("a", "old", "used-in"), rel("a", "gone", "used-in"), rel("a", "a", "related"), rel("a", "b", "related", { review: "archived" })],
    strengthOf: () => "strong",
  });
  assert.deepEqual(g.edges.map((e) => [e.from, e.to, e.type]), [["a", "b", "used-in"]]);
  assert.deepEqual(g.nodes.map((n) => n.topic.id), ["a", "b"]);
});

test("a cycle of used-in links can't push rows past the number of topics", () => {
  const live = [topic("a"), topic("b")];
  const g = topicGraph({ topics: live, live, relations: [rel("a", "b", "used-in"), rel("b", "a", "used-in")], strengthOf: () => "developing" });
  assert.ok(g.nodes.every((n) => n.row < live.length));
});

test("a longer cycle (frameworks → prefill → cost → frameworks) still lays out: finite positions, no empty rows, every edge drawn", () => {
  const live = ["fw", "prefill", "cost", "kv", "attn", "paged"].map((id) => topic(id));
  const relations = [
    rel("fw", "prefill", "used-in"),
    rel("kv", "prefill", "used-in"),
    rel("prefill", "cost", "used-in"),
    rel("kv", "cost", "used-in"),
    rel("cost", "fw", "used-in"),
    rel("kv", "attn", "used-in"),
    rel("kv", "paged", "used-in"),
    rel("cost", "attn", "used-in"),
    rel("attn", "paged", "related"),
  ];
  const g = topicGraph({ topics: live, live, relations, strengthOf: () => "developing" });
  assert.ok(Number.isFinite(g.width) && Number.isFinite(g.height));
  assert.ok(g.nodes.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y)));
  const rows = new Set(g.nodes.map((n) => n.row));
  assert.deepEqual([...rows].sort(), [...Array(rows.size).keys()], "rows are 0..n with none empty");
  assert.equal(g.edges.length, relations.length);
  assert.ok(g.edges.every((e) => !e.d.includes("NaN")));
});

test("strength: nothing answered is unverified; fading or mixed up is fragile; every objective held is strong", () => {
  const state = (status: ObjectiveState["status"]) => ({ status }) as ObjectiveState;
  const states = new Map([
    ["m1", state("mastered")],
    ["m2", state("retired")],
    ["l", state("learning")],
    ["f", state("fading")],
    ["u", state("unseen")],
  ]);
  assert.equal(topicStrength([], states), "unverified");
  assert.equal(topicStrength(["u"], states), "unverified");
  assert.equal(topicStrength(["m1", "m2"], states), "strong");
  assert.equal(topicStrength(["m1", "u"], states), "developing");
  assert.equal(topicStrength(["m1", "l"], states), "developing");
  assert.equal(topicStrength(["m1", "f"], states), "fragile");
});

test("long names wrap at spaces into at most three lines, and edges leave from under the name", () => {
  assert.deepEqual(wrapLabel("Big-O analysis of loops and recursive algorithms"), ["Big-O analysis of", "loops and recursive", "algorithms"]);
  assert.deepEqual(wrapLabel("Iterator-based list traversal"), ["Iterator-based list", "traversal"]);
  assert.deepEqual(wrapLabel("Heap"), ["Heap"]);
  const long = wrapLabel("Reverse-order traversal of doubly linked lists with sentinel nodes and iterators");
  assert.equal(long.length, 3);
  assert.ok(long[2].endsWith("…"));

  const live = [topic("a", { name: "Big-O analysis of loops and recursive algorithms" }), topic("b")];
  const g = topicGraph({ topics: live, live, relations: [rel("a", "b", "used-in")], strengthOf: () => "unverified" });
  const a = g.nodes[0];
  const start = Number(/^M\S+ (\S+)/.exec(g.edges[0].d)![1]);
  assert.ok(start >= labelBottom(a), "the edge starts below the wrapped name");
});

test("older data with two links between the same topics draws one: the most specific kind", () => {
  const live = [topic("kv"), topic("attn")];
  const g = topicGraph({ topics: live, live, relations: [rel("attn", "kv", "related"), rel("kv", "attn", "used-in")], strengthOf: () => "developing" });
  assert.deepEqual(g.edges.map((e) => [e.from, e.to, e.type]), [["kv", "attn", "used-in"]]);
});
