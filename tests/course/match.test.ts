import test from "node:test";
import assert from "node:assert/strict";
import { type Named, exactMatch, normaliseName, shortlist } from "../../src/lib/course/match.ts";

const item = (id: string, name: string, extra: Partial<Named> = {}): Named => ({ id, name, review: "confirmed", ...extra });

test("names normalise case, punctuation, '&' and plurals", () => {
  assert.equal(normaliseName("K-Maps"), "k map");
  assert.equal(normaliseName("Logic Circuits & Switches"), normaliseName("logic circuit and switches"));
  assert.equal(normaliseName("Two's Complement"), normaliseName("twos complement"));
  assert.equal(normaliseName("Class"), "class");
});

test("an exact name match finds the existing item", () => {
  const items = [item("t1", "Karnaugh Maps"), item("t2", "Boolean Algebra")];
  assert.deepEqual(exactMatch(["karnaugh map"], items), { kind: "live", id: "t1" });
  assert.deepEqual(exactMatch(["Boolean algebra", "Switching algebra"], items), { kind: "live", id: "t2" });
  assert.equal(exactMatch(["Gray code"], items), null);
});

test("a merged-away item stands for its survivor", () => {
  const items = [item("old", "K-Maps", { review: "archived", mergedInto: "new" }), item("new", "Karnaugh Maps")];
  assert.deepEqual(exactMatch(["K-Maps"], items), { kind: "live", id: "new" });
});

test("a rejected match says don't propose it again, unless a live item also matches", () => {
  const rejected = item("r", "Course logistics", { review: "archived" });
  assert.deepEqual(exactMatch(["Course Logistics"], [rejected]), { kind: "rejected", id: "r" });
  assert.deepEqual(exactMatch(["Course Logistics"], [rejected, item("l", "Course logistics")]), { kind: "live", id: "l" });
});

test("the shortlist ranks by shared words, keeps rejected items and drops merged-away ones", () => {
  const items = [
    item("a", "Group ones on a Karnaugh map", { description: "Cover minterms with groups" }),
    item("b", "Convert to two's complement"),
    item("c", "Use don't-cares in Karnaugh map groups", { review: "archived" }),
    item("d", "Karnaugh map grouping", { review: "archived", mergedInto: "a" }),
  ];
  const list = shortlist({ name: "Form groups on a Karnaugh map", description: "" }, items);
  assert.deepEqual(list.map((i) => i.id).sort(), ["a", "c"]);
  assert.equal(shortlist({ name: "Two's complement overflow" }, items)[0].id, "b");
  assert.equal(shortlist({ name: "Fourier series" }, items).length, 0);
});
