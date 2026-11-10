import test from "node:test";
import assert from "node:assert/strict";
import { addMaterial, uploadLink } from "../../src/lib/server/connector/add-material.ts";
import { fakeDb } from "../support/fake-db.ts";

const OWNER = "owner-1";
const COURSE = "c0000000-0000-4000-8000-000000000001";
const db = () => fakeDb({ courses: [{ id: COURSE, owner_id: OWNER, slug: "ald", deleted_at: null }] });

async function withSiteUrl<T>(value: string | undefined, run: () => Promise<T>): Promise<T> {
  const before = process.env.SITE_URL;
  if (value === undefined) delete process.env.SITE_URL;
  else process.env.SITE_URL = value;
  try {
    return await run();
  } finally {
    if (before === undefined) delete process.env.SITE_URL;
    else process.env.SITE_URL = before;
  }
}

test("the upload link is the add-material page under the site's origin with the course, type and hold-back preset", () => {
  assert.equal(uploadLink("https://orca.example", "ald", "Past exam", true), "https://orca.example/add-material?course=ald&type=Past+exam&holdBack=1");
  assert.equal(uploadLink("https://orca.example", "ald", "Lecture", false), "https://orca.example/add-material?course=ald&type=Lecture", "not held back: the page's own default for the type applies");
  const link = new URL(uploadLink("https://orca.example", "ald", "Practice exam", true));
  assert.deepEqual([link.searchParams.get("course"), link.searchParams.get("type"), link.searchParams.get("holdBack")], ["ald", "Practice exam", "1"]);
});

test("add_material with file true hands back the link from SITE_URL (its origin only), or says why it can't", async () => {
  await withSiteUrl("https://orca.example/some/path", async () => {
    assert.deepEqual(await addMaterial(db() as never, OWNER, COURSE, { type: "Past exam", holdBack: true, file: true }), { uploadLink: "https://orca.example/add-material?course=ald&type=Past+exam&holdBack=1" });
    assert.deepEqual(await addMaterial(db() as never, "someone-else", COURSE, { type: "Past exam", holdBack: true, file: true }), { error: "No such course." });
  });
  await withSiteUrl(undefined, async () => {
    const before = process.env.NODE_ENV;
    (process.env as Record<string, string>).NODE_ENV = "production";
    try {
      const got = await addMaterial(db() as never, OWNER, COURSE, { type: "Lecture", holdBack: false, file: true });
      assert.ok("error" in got);
      assert.match(got.error, /SITE_URL isn't set/);
    } finally {
      (process.env as Record<string, string>).NODE_ENV = before ?? "test";
    }
  });
});
