import test from "node:test";
import assert from "node:assert/strict";
import { CLEANUP, type UploadRow, staleUploads } from "../../src/lib/material/cleanup.ts";

const NOW = new Date("2026-10-05T12:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const HOUR = 60 * 60_000;
const row = (id: string, status: string, createdAgo: number, extra: Partial<UploadRow> = {}): UploadRow => ({ id, owner_id: "owner-a", status, created_at: ago(createdAgo), reading_since: null, storage_path: `owner-a/${id}/deck.pdf`, ...extra });

test("abandoned uploads and old failed reads are removed; recent ones, ready material and anything being built never are", () => {
  const rows = [
    row("m1", "uploaded", CLEANUP.abandonedMs + HOUR),
    row("m2", "uploaded", CLEANUP.abandonedMs - HOUR),
    row("m3", "failed", CLEANUP.failedMs + HOUR, { storage_path: null }),
    row("m4", "failed", CLEANUP.failedMs - HOUR),
    row("m5", "ready", 365 * 24 * HOUR),
    row("m6", "processing", 365 * 24 * HOUR),
    // A read that died: old row, the claim long ago.
    row("m7", "reading", 3 * CLEANUP.abandonedMs, { reading_since: ago(CLEANUP.abandonedMs + HOUR) }),
    // An old row whose read was taken over recently is still in flight.
    row("m8", "reading", 3 * CLEANUP.abandonedMs, { reading_since: ago(HOUR) }),
    // Garbage dates are left alone rather than guessed at.
    row("m9", "uploaded", 0, { created_at: "not a date" }),
  ];
  assert.deepEqual(staleUploads(rows, NOW), [
    { id: "m1", ownerId: "owner-a", path: "owner-a/m1/deck.pdf", why: "abandoned" },
    { id: "m3", ownerId: "owner-a", path: null, why: "failed" },
    { id: "m7", ownerId: "owner-a", path: "owner-a/m7/deck.pdf", why: "abandoned" },
  ]);
});
