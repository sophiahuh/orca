import test from "node:test";
import assert from "node:assert/strict";
import { isOwnPath, safeName } from "../../src/lib/material/paths.ts";

const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";
const M = "d0000000-0000-4000-8000-00000000000a";

test("file names are reduced to letters, digits, dot, dash and underscore", () => {
  assert.equal(safeName("L01 Intro (v2).pdf"), "L01_Intro__v2_.pdf");
  assert.equal(safeName("../../etc/passwd"), ".._.._etc_passwd");
  assert.equal(safeName(".."), "file.pdf");
});

test("only the path the server made for this student and material is read", () => {
  assert.equal(isOwnPath(`${A}/${M}/L01.pdf`, A, M), true);
  assert.equal(isOwnPath(`${A}/${M}/../../${B}/${M}/L01.pdf`, A, M), false, "climbs into another student's folder");
  assert.equal(isOwnPath(`${A}/${M}/..`, A, M), false);
  assert.equal(isOwnPath(`${A}/${M}/a/b.pdf`, A, M), false);
  assert.equal(isOwnPath(`${A}/${M}/L01%2F..pdf`, A, M), false, "no encoded separators");
  assert.equal(isOwnPath(`${B}/${M}/L01.pdf`, A, M), false);
  assert.equal(isOwnPath(`${A}/${M}/`, A, M), false);
});
