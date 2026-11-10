import test from "node:test";
import assert from "node:assert/strict";
import { NEW_ONBOARDING, TIPS_OFF, onboardingFromProfile, withSeen } from "../../src/lib/onboarding/state.ts";

test("a seen tip is added once, in the order seen", () => {
  const a = withSeen(NEW_ONBOARDING, ["add-course"]);
  assert.deepEqual(a, { seen: ["add-course"], skipped: false });
  assert.deepEqual(withSeen(a, ["island", "add-course"]).seen, ["add-course", "island"]);
});

test("nothing new returns the same object, so callers can tell there is nothing to save", () => {
  const a = withSeen(NEW_ONBOARDING, ["add-course"]);
  assert.equal(withSeen(a, ["add-course"]), a);
  assert.equal(withSeen(a, []), a);
});

test("a profile's value is read as stored; a malformed one throws", () => {
  assert.deepEqual(onboardingFromProfile({ seen: ["x"], skipped: true }), { seen: ["x"], skipped: true });
  assert.throws(() => onboardingFromProfile({ seen: "all" }));
  assert.throws(() => onboardingFromProfile(null));
});

test("a database from before the column has the tips off", () => {
  assert.deepEqual(onboardingFromProfile(undefined), TIPS_OFF);
  assert.equal(TIPS_OFF.skipped, true);
});
