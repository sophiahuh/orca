import test from "node:test";
import assert from "node:assert/strict";
import { GET } from "../../src/app/api/cron/runs/route.ts";

const call = (authorization?: string) => GET(new Request("http://localhost/api/cron/runs", { headers: authorization ? { authorization } : {} }));

test("the run sweep is off without CRON_SECRET and refuses anyone without it", async () => {
  delete process.env.CRON_SECRET;
  assert.equal((await call("Bearer anything")).status, 503);
  process.env.CRON_SECRET = "s3cret-value";
  try {
    assert.equal((await call()).status, 401);
    assert.equal((await call("Bearer wrong-value")).status, 401);
    assert.equal((await call("s3cret-value")).status, 401, "the scheme is part of it");
  } finally {
    delete process.env.CRON_SECRET;
  }
});
