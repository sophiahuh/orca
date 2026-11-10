import test from "node:test";
import assert from "node:assert/strict";
import { type UserRow, barWidths, dayKey, fillDays, sortUsers } from "../../src/lib/admin/stats.ts";

const user = (id: string, extra: Partial<UserRow>): UserRow => ({
  id,
  name: null,
  email: `${id}@example.test`,
  joined: "2026-11-01T00:00:00Z",
  lastActive: null,
  isAdmin: false,
  courses: 0,
  uploads: 0,
  pages: 0,
  answers: 0,
  thumbsDown: 0,
  spend: 0,
  connector: false,
  canvas: false,
  ...extra,
});

test("the users table sorts by spend and by last active, with never-active accounts last", () => {
  const rows = [
    user("a", { spend: 0.5, lastActive: "2026-11-09T10:00:00Z", joined: "2026-10-01T00:00:00Z" }),
    user("b", { spend: 2, lastActive: null, joined: "2026-11-05T00:00:00Z" }),
    user("c", { spend: 0.5, lastActive: "2026-11-10T08:00:00Z", joined: "2026-11-02T00:00:00Z" }),
  ];
  assert.deepEqual(sortUsers(rows, "spend").map((r) => r.id), ["b", "c", "a"], "equal spend falls back to newest joined");
  assert.deepEqual(sortUsers(rows, "active").map((r) => r.id), ["c", "a", "b"]);
  assert.deepEqual(sortUsers(rows, "joined").map((r) => r.id), ["b", "c", "a"]);
  assert.deepEqual(rows.map((r) => r.id), ["a", "b", "c"], "the input is left alone");
});

test("day keys are UTC days, and a run of days is filled with zeros, newest first", () => {
  assert.equal(dayKey(new Date("2026-11-10T23:30:00-05:00")), "2026-11-11");
  const filled = fillDays([{ day: "2026-11-09", calls: 3, usd: 0.25, tokens: 1200 }], 3, new Date("2026-11-10T15:00:00Z"));
  assert.deepEqual(filled, [
    { day: "2026-11-10", calls: 0, usd: 0, tokens: 0 },
    { day: "2026-11-09", calls: 3, usd: 0.25, tokens: 1200 },
    { day: "2026-11-08", calls: 0, usd: 0, tokens: 0 },
  ]);
  assert.deepEqual(fillDays([], 0, new Date()), []);
});

test("bar widths are in proportion to the biggest day, and all zero when nothing was spent", () => {
  assert.deepEqual(barWidths([{ day: "d1", calls: 1, usd: 1, tokens: 0 }, { day: "d2", calls: 1, usd: 0.25, tokens: 0 }]), [1, 0.25]);
  assert.deepEqual(barWidths([{ day: "d1", calls: 0, usd: 0, tokens: 0 }]), [0]);
});
