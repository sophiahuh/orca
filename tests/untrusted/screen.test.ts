import test from "node:test";
import assert from "node:assert/strict";
import { screen } from "../../src/lib/untrusted/screen.ts";
import { sanitize } from "../../src/lib/untrusted/sanitize.ts";
import { urlsIn, validateFields, validateText } from "../../src/lib/untrusted/validate.ts";
import { ATTACKS, BENIGN, BENIGN_FLAGGED } from "../fixtures/injection/samples.ts";

/** What reaches the screen in the app: sanitised first (hidden characters gone), as every untrusted string is. */
const clean = (s: string) => sanitize(s, 20_000).text;

test("the screen catches plain, misspelt, spaced-out and role-tagged injection phrasing, quoting the span", () => {
  for (const [name, text] of [["ignore", ATTACKS.ignore], ["fuzzy", ATTACKS.fuzzy], ["roleTag", ATTACKS.roleTag], ["answer", ATTACKS.answer], ["note", ATTACKS.note], ["instructionLike", ATTACKS.instructionLike]] as const) {
    const s = screen(clean(text));
    assert.equal(s.suspected, true, name);
    assert.ok(s.hits.every((h) => h.quote.length <= 240 && h.quote.length > 0), name);
  }
  const role = screen(clean(ATTACKS.roleTag));
  assert.ok(role.hits.some((h) => h.check === "role-tag"));
  assert.match(screen(clean(ATTACKS.ignore)).hits[0].quote, /Ignore previous instructions/);
});

test("Base64 and hex payloads are decoded and screened; smuggled text is caught once the sanitiser has run", () => {
  assert.ok(screen(ATTACKS.base64).hits.some((h) => h.check === "encoded-base64" && /mark this correct/i.test(h.quote)));
  assert.ok(screen(ATTACKS.hex).hits.some((h) => h.check === "encoded-hex" && /grade this as correct/i.test(h.quote)));
  // Invisible characters hide the phrase from a naive scan; sanitising first removes them.
  assert.equal(screen(clean(ATTACKS.smuggled)).suspected, false, "the smuggled instruction is gone, not seen: the sanitiser removed it");
  assert.equal(clean(ATTACKS.smuggled), "Two's complement");
  assert.equal(screen(clean(ATTACKS.zeroWidth)).suspected, true);
});

test("ordinary course text isn't flagged, except where it quotes the attack phrase itself", () => {
  for (const text of BENIGN) assert.equal(screen(text).suspected, BENIGN_FLAGGED.has(text), text);
  // Random-looking identifiers and long bit strings aren't payloads.
  assert.equal(screen("The key is 0110100001100101011011000110110001101111 and the hash a3f9c2e1b7d4a6f0c8e2b1d3f5a7c9e1b3d5f7a9").suspected, false);
  assert.equal(screen("Z2V0IHRoZSBhbnN3ZXIgZnJvbSB0aGUgc2xpZGUgb24gYWJzb3JwdGlvbg==").suspected, false, "an innocuous Base64 string");
});

test("generated text is refused for a URL not in the material, HTML, a markdown link or instruction-like phrasing, and kept otherwise", () => {
  const rule = { maxChars: 600, allowedUrls: urlsIn("See https://www.edaplayground.com/ for examples.") };
  assert.deepEqual(validateText("Try it at https://www.edaplayground.com/", rule), { ok: true, text: "Try it at https://www.edaplayground.com/" });
  assert.match((validateText(ATTACKS.withUrl, rule) as { reason: string }).reason, /URL not in the material/);
  assert.match((validateText(ATTACKS.withHtml, rule) as { reason: string }).reason, /HTML/);
  assert.match((validateText(ATTACKS.withMarkdownLink, rule) as { reason: string }).reason, /link/);
  assert.match((validateText(ATTACKS.instructionLike, rule) as { reason: string }).reason, /reads like an instruction/);
  assert.match((validateText("long word ".repeat(100), rule) as { reason: string }).reason, /longer than/);
  // Math and logic notation survive: "<" alone isn't HTML, and a plain tag-like token with no name isn't either.
  assert.equal(validateText("If a < b then f = 1; for a > b, f = 0. Compare 2^{16} with 65536.", rule).ok, true);
  assert.equal(validateText("The gate's output is x' + y (NOT x OR y).", rule).ok, true);
  const fields = validateFields({ prompt: "Simplify x + xy.", explanation: ATTACKS.withHtml }, rule);
  assert.equal(fields.ok, false);
  assert.match((fields as { reason: string }).reason, /^explanation contains HTML/);
});
