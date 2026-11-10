import test from "node:test";
import assert from "node:assert/strict";
import { TIPS, type Tip, eligibleTips } from "../../src/lib/onboarding/tips.ts";

const everything = () => true;
/** Every target on the page except the upload toast (whose tip can show anywhere). */
const noToast = (s: string) => s !== '[data-part="upload-toast"]';
const ids = (tips: Tip[]) => tips.map((t) => t.id);
const none = new Set<string>();

test("ids are unique, and a tip only waits for one listed before it", () => {
  assert.equal(new Set(TIPS.map((t) => t.id)).size, TIPS.length);
  TIPS.forEach((t, i) => {
    if (t.after) assert.ok(TIPS.slice(0, i).some((p) => p.id === t.after), `${t.id} waits for ${t.after}, which isn't before it`);
  });
});

test("copy stays short: a title, and a body of at most 220 characters", () => {
  for (const t of TIPS) {
    assert.ok(t.title.length > 0 && t.title.length <= 40, `${t.id}: title`);
    assert.ok(t.body.length > 0 && t.body.length <= 220, `${t.id}: body is ${t.body.length} characters`);
  }
});

test("a student with no course is pointed at Add Course; with one, at the island", () => {
  assert.deepEqual(ids(eligibleTips({ pathname: "/", courses: 0, sessions: 0 }, none, (s) => noToast(s) && !s.includes("data-todo"))), ["add-course"]);
  assert.deepEqual(ids(eligibleTips({ pathname: "/", courses: 1, sessions: 0 }, none, noToast)), ["island", "quick-review"]);
});

test("a tip shows only where its target is on the page", () => {
  const ctx = { pathname: "/course/logic", courses: 1, sessions: 0 };
  const found = eligibleTips(ctx, none, (s) => s === '[data-part="course-settings-link"]' || s === '[data-part="uncharted-add"]');
  assert.deepEqual(ids(found), ["course-settings", "uncharted-add"]);
});

test("seen tips are left out", () => {
  const ctx = { pathname: "/course/logic", courses: 1, sessions: 0 };
  const found = eligibleTips(ctx, new Set(["course-settings", "weak-count"]), everything);
  assert.ok(!ids(found).includes("course-settings") && !ids(found).includes("weak-count"));
});

test("a tip that waits for another shows after it: later in the same run, or once it was seen", () => {
  const ctx = { pathname: "/course/logic", courses: 1, sessions: 0 };
  const noQuick = (s: string) => s !== 'aside [data-todo="quick"]';
  assert.ok(!ids(eligibleTips(ctx, none, noQuick)).includes("dive"), "no quick review yet: Dive in waits");
  const all = ids(eligibleTips(ctx, none, everything));
  assert.ok(all.indexOf("dive") > all.indexOf("quick-review"), "in one run, Dive in follows the quick review");
  assert.ok(ids(eligibleTips(ctx, new Set(["quick-review"]), noQuick)).includes("dive"));
});

test("the Settings tips wait until the student has finished a session", () => {
  assert.deepEqual(eligibleTips({ pathname: "/settings", courses: 1, sessions: 0 }, none, noToast), []);
  assert.deepEqual(ids(eligibleTips({ pathname: "/settings", courses: 1, sessions: 1 }, none, noToast)), ["settings-notes", "settings-markers", "settings-canvas", "settings-claude"]);
  assert.ok(ids(eligibleTips({ pathname: "/", courses: 1, sessions: 1 }, none, noToast)).includes("more-settings"));
});

test("the toast's tip can show on any signed-in page", () => {
  const only = (s: string) => s === '[data-part="upload-toast"]';
  for (const pathname of ["/", "/calendar", "/course/logic/atlas", "/session/logic"]) {
    assert.deepEqual(ids(eligibleTips({ pathname, courses: 1, sessions: 0 }, none, only)), ["upload-toast"]);
  }
});
