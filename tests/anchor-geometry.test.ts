import test from "node:test";
import assert from "node:assert/strict";
import { ARROW_INSET, GAP, MARGIN, arrowOffset, placeBubble, spotlightClip } from "../src/lib/anchor-geometry.ts";

const viewport = { width: 1194, height: 834 };
const bubble = { width: 340, height: 160 };

test("the bubble goes below its target, centred on it, when there is room", () => {
  const p = placeBubble({ left: 400, top: 100, width: 100, height: 40 }, bubble, viewport);
  assert.deepEqual(p, { side: "below", left: 400 + 50 - 170, top: 100 + 40 + GAP });
});

test("near the right edge it stays on screen", () => {
  const p = placeBubble({ left: 1050, top: 28, width: 120, height: 44 }, bubble, viewport);
  assert.equal(p.side, "below");
  assert.equal(p.left, viewport.width - bubble.width - MARGIN);
});

test("at the bottom of the screen it goes above", () => {
  const p = placeBubble({ left: 900, top: 770, width: 48, height: 48 }, bubble, viewport);
  assert.equal(p.side, "above");
  assert.equal(p.top, 770 - GAP - bubble.height);
});

test("beside a target as tall as the screen it goes to the side with room", () => {
  const p = placeBubble({ left: 854, top: 0, width: 340, height: 834 }, bubble, viewport);
  assert.equal(p.side, "left");
  assert.equal(p.left, 854 - GAP - bubble.width);
});

test("with no room anywhere it is clamped onto the screen", () => {
  const p = placeBubble({ left: 0, top: 0, width: 1194, height: 834 }, bubble, viewport);
  assert.ok(p.left >= MARGIN && p.left + bubble.width <= viewport.width - MARGIN);
  assert.ok(p.top >= MARGIN && p.top + bubble.height <= viewport.height - MARGIN);
});

test("the spotlight is the whole screen with a padded, rounded hole at the target", () => {
  assert.equal(
    spotlightClip({ left: 100.4, top: 50, width: 80, height: 30 }, viewport, 6, 10),
    'path(evenodd, "M0 0H1194V834H0Z M104 44H176A10 10 0 0 1 186 54V76A10 10 0 0 1 176 86H104A10 10 0 0 1 94 76V54A10 10 0 0 1 104 44Z")',
  );
});

test("a hole smaller than its radius has its corners cut down to fit", () => {
  assert.match(spotlightClip({ left: 0, top: 0, width: 4, height: 4 }, viewport, 0, 14), /A2 2 /);
});

test("the pointer arrow aims at the target's centre, kept off the bubble's corners", () => {
  const target = { left: 400, top: 100, width: 100, height: 40 };
  assert.equal(arrowOffset(target, bubble, { side: "below", left: 300, top: 154 }), 150);
  assert.equal(arrowOffset({ ...target, left: 0, width: 20 }, bubble, { side: "below", left: 12, top: 154 }), ARROW_INSET);
  assert.equal(arrowOffset({ left: 900, top: 400, width: 40, height: 40 }, bubble, { side: "left", left: 546, top: 340 }), 80);
});
