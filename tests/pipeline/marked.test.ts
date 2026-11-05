import test from "node:test";
import assert from "node:assert/strict";
import { markedSpans, struggledItemOk } from "../../src/lib/pipeline/marked.ts";

const page = (n: number, text: string, source = "vision") => ({ n, text, source });

test("markedSpans finds each tagged passage, normalised", () => {
  assert.deepEqual(markedSpans("a [marked: ★] Carry  save adders [/marked] b [marked: ?]why[/marked]"), ["carry save adders", "why"]);
  assert.deepEqual(markedSpans("no tags here"), []);
});

test("a quote counts only inside a marked span on that page, read from its image", () => {
  const pages = [page(3, "x [marked: ★] Carry-save keeps “carries” [/marked] y"), page(4, "[marked: ★] typed trap [/marked]", "pdf")];
  assert.equal(struggledItemOk({ page: 3, quote: "carry-save  keeps carries" }, pages), true);
  assert.equal(struggledItemOk({ page: 3, quote: "x" }, pages), false, "outside the span");
  assert.equal(struggledItemOk({ page: 5, quote: "carry-save" }, pages), false, "not a page sent");
  assert.equal(struggledItemOk({ page: 4, quote: "typed trap" }, pages), false, "typed pages carry no markers");
  assert.equal(struggledItemOk({ page: 3, quote: " " }, pages), false, "an empty quote matches nothing");
});
