import { COURSE_SLUG, F, FIXTURE_STATE, admin, daysAgo, expect, ids, objective, seedFixtureCourse, seedPages, seedState, stored, struggled, test } from "./fixture";

/** Weak points first (docs/superpowers/specs/2026-11-04-weak-points-first-design.md): only flagged or missed objectives come due. */

test("nothing flagged: no quick review is due, the island and the course say so", async ({ page, student }) => {
  await seedFixtureCourse(student);
  await page.goto("/");
  await expect(page.locator('[data-part="island-note"]')).toHaveText("No weak spots flagged yet");
  await expect(page.getByText("Quick review ·")).toHaveCount(0);
  await page.goto(`/course/${COURSE_SLUG}`);
  // The trail shows only topics with weak spots: none yet.
  await expect(page.locator("[data-part=path-no-weak-spots]")).toContainText("No weak spots flagged yet.");
  await expect(page.locator('[data-part="topic-ring"]')).toHaveCount(0);
});

test("This is hard on an objective makes it due, and its topic shows a ring", async ({ page, student }) => {
  await seedFixtureCourse(student);
  await page.goto(`/course/${COURSE_SLUG}/objectives`);
  const flag = page.locator('[data-part="flag-hard"]').first();
  await flag.getByRole("button", { name: "This is hard" }).click();
  await expect(flag).toHaveText("In review");
  await page.goto(`/course/${COURSE_SLUG}`);
  await expect(page.locator('[data-part="topic-ring"]')).toHaveCount(1);
  await expect(page.getByText("0 of 1 weak spots mastered")).toBeVisible();
  await expect(page.getByText("Quick review ·")).toBeVisible();
  const after = await stored(page, student);
  expect(after.evidence.filter((e) => e.kind === "confusion" && e.flagSource === "manual")).toHaveLength(1);
});

test("This topic is hard flags every objective in the topic", async ({ page, student }) => {
  await seedFixtureCourse(student);
  await page.goto(`/course/${COURSE_SLUG}`);
  await page.locator("[data-part=path-show-all]").click();
  await page.locator('[data-part="node"]').nth(1).click();
  await page.locator('[data-part="flag-topic"]').click();
  await expect(page.locator('[data-part="topic-ring"]')).toHaveCount(1);
  await expect(page.getByText("0 of 2 weak spots mastered")).toBeVisible();
});

test("caught up: Practice other topics opens a dive over objectives nobody flagged", async ({ page, student }) => {
  // No questions yet: nothing to warm up with (that card would come first), so the course is caught up.
  await seedState(student, { ...FIXTURE_STATE, questionBank: { [F.course]: {} } });
  await page.goto(`/course/${COURSE_SLUG}`);
  await expect(page.locator('[data-part="caught-up"]')).toContainText("You're caught up");
  await page.locator('[data-part="practice-other"]').click();
  await expect(page).toHaveURL(/kind=deep&scope=practice/);
  await expect(page.getByText("Practice other topics")).toBeVisible();
});

test("with a weak point due, the course isn't caught up", async ({ page, student }) => {
  await seedFixtureCourse(student);
  await page.goto(`/course/${COURSE_SLUG}/objectives`);
  await page.locator('[data-part="flag-hard"]').first().getByRole("button", { name: "This is hard" }).click();
  await page.goto(`/course/${COURSE_SLUG}`);
  await expect(page.locator('[data-part="caught-up"]')).toHaveCount(0);
});

test("a flag on an objective with no questions writes them, and the quick review picks it up without a reload", async ({ page, student }) => {
  test.setTimeout(90_000);
  const X = ids("bare");
  const fixture = FIXTURE_STATE.objectives[F.course];
  // One more objective in Two's Complement, with no questions yet. Taught on slide 2: the fake model anchors every question there.
  const bare = objective(X.bare, F.twosComplement, "Detect overflow in 2's complement addition", { signals: [{ materialId: F.material, materialType: "Lecture", places: [{ locator: "slide 2", excerpt: "overflow" }] }] });
  await seedState(student, { ...FIXTURE_STATE, objectives: { [F.course]: { ...fixture, [X.bare]: bare } } });
  await seedPages(student, { [F.material]: Array.from({ length: 9 }, (_, i) => ({ n: i + 1, text: i === 1 ? "Overflow: adding two positives gives a negative." : `Slide ${i + 1} of the fixture deck.` })) });
  await page.goto(`/course/${COURSE_SLUG}`);
  await page.locator("[data-part=path-show-all]").click();
  await page.locator('[data-part="node"]').nth(1).click();
  await page.locator('[data-part="flag-topic"]').click();
  await expect(page.getByText("0 of 3 weak spots mastered")).toBeVisible();
  // Two of the three have questions now; the third gets its own from the top-up the flags started.
  await expect(page.getByText("Covers 3 objectives")).toBeVisible({ timeout: 60_000 });
  const after = await stored(page, student);
  expect(Object.values(after.questionBank[F.course] ?? {}).flat().filter((q) => q.objectiveId === X.bare).length).toBeGreaterThan(0);
});

test("a flagged objective with no questions and no job: opening the course asks for them, and the sidebar says it's writing until the review is ready", async ({ page, student }) => {
  test.setTimeout(90_000);
  const X = ids("bare");
  const fixture = FIXTURE_STATE.objectives[F.course];
  const bare = objective(X.bare, F.twosComplement, "Detect overflow in 2's complement addition", { signals: [{ materialId: F.material, materialType: "Lecture", places: [{ locator: "slide 2", excerpt: "overflow" }] }] });
  // Flagged yesterday (the sidebar earlier said "writing" with nothing behind it, owner 2026-11-10); no questions, no runs.
  await seedState(student, { ...FIXTURE_STATE, objectives: { [F.course]: { ...fixture, [X.bare]: bare } }, evidence: [struggled(F.course, F.twosComplement, X.bare, daysAgo(1))] });
  await seedPages(student, { [F.material]: Array.from({ length: 9 }, (_, i) => ({ n: i + 1, text: i === 1 ? "Overflow: adding two positives gives a negative." : `Slide ${i + 1} of the fixture deck.` })) });
  await page.goto(`/course/${COURSE_SLUG}`);
  // Opening the course asks for the top-up; while it runs the sidebar says so (the fake model can finish before the first look), then the review is ready.
  await expect(page.locator("[data-part=writing-questions]").or(page.getByText("Covers 1 objective"))).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Covers 1 objective")).toBeVisible({ timeout: 60_000 });
  const after = await stored(page, student);
  expect(Object.values(after.questionBank[F.course] ?? {}).flat().filter((q) => q.objectiveId === X.bare).length).toBeGreaterThan(0);
});

test("a flagged objective with no questions in a course with no material: the sidebar says to add material instead of \"writing\"", async ({ page, student }) => {
  const X = ids("bare");
  const fixture = FIXTURE_STATE.objectives[F.course];
  const bare = objective(X.bare, F.twosComplement, "Detect overflow in 2's complement addition", { signals: [] });
  await seedState(student, { ...FIXTURE_STATE, objectives: { [F.course]: { ...fixture, [X.bare]: bare } }, evidence: [struggled(F.course, F.twosComplement, X.bare, daysAgo(1))] });
  // The course's only file was removed (its row stays, status removed, and isn't loaded).
  const removed = await admin().from("materials").update({ status: "removed" }).eq("owner_id", student.id).eq("id", F.material);
  expect(removed.error).toBeNull();
  await page.goto(`/course/${COURSE_SLUG}`);
  await expect(page.locator("[data-part=no-questions][data-reason=no-material]")).toContainText("no material to write them from");
});

test("a flag ends in questions even when the browser never asks: the server asks after recording it", async ({ page, student }) => {
  test.setTimeout(90_000);
  const X = ids("bare");
  const fixture = FIXTURE_STATE.objectives[F.course];
  const bare = objective(X.bare, F.twosComplement, "Detect overflow in 2's complement addition", { signals: [{ materialId: F.material, materialType: "Lecture", places: [{ locator: "slide 2", excerpt: "overflow" }] }] });
  await seedState(student, { ...FIXTURE_STATE, objectives: { [F.course]: { ...fixture, [X.bare]: bare } } });
  await seedPages(student, { [F.material]: Array.from({ length: 9 }, (_, i) => ({ n: i + 1, text: i === 1 ? "Overflow: adding two positives gives a negative." : `Slide ${i + 1} of the fixture deck.` })) });
  // The browser's own request for questions never arrives (a closed tab, a dropped connection).
  await page.route("**/api/top-up", (route) => route.abort());
  await page.goto(`/course/${COURSE_SLUG}`);
  await page.locator("[data-part=path-show-all]").click();
  await page.locator('[data-part="node"]').nth(1).click();
  await page.locator('[data-part="flag-topic"]').click();
  await expect(page.getByText("0 of 3 weak spots mastered")).toBeVisible();
  // POST /api/evidence asked for the top-up itself (owner, 2026-11-10).
  await expect.poll(async () => Object.values((await stored(page, student)).questionBank[F.course] ?? {}).flat().filter((q) => q.objectiveId === X.bare).length, { timeout: 60_000 }).toBeGreaterThan(0);
});

test("the daily sweep asks for questions for flagged objectives that still have none", async ({ page, student }) => {
  test.setTimeout(90_000);
  const X = ids("bare");
  const fixture = FIXTURE_STATE.objectives[F.course];
  const bare = objective(X.bare, F.twosComplement, "Detect overflow in 2's complement addition", { signals: [{ materialId: F.material, materialType: "Lecture", places: [{ locator: "slide 2", excerpt: "overflow" }] }] });
  await seedState(student, { ...FIXTURE_STATE, objectives: { [F.course]: { ...fixture, [X.bare]: bare } }, evidence: [struggled(F.course, F.twosComplement, X.bare, daysAgo(2))] });
  await seedPages(student, { [F.material]: Array.from({ length: 9 }, (_, i) => ({ n: i + 1, text: i === 1 ? "Overflow: adding two positives gives a negative." : `Slide ${i + 1} of the fixture deck.` })) });
  const sweep = await page.request.get("/api/cron/runs", { headers: { authorization: "Bearer e2e-cron-secret" } });
  expect(sweep.status()).toBe(200);
  const body = (await sweep.json()) as { flaggedCourses: number; topUps: number };
  expect(body.flaggedCourses).toBeGreaterThanOrEqual(1);
  expect(body.topUps).toBeGreaterThanOrEqual(1);
  await expect.poll(async () => Object.values((await stored(page, student)).questionBank[F.course] ?? {}).flat().filter((q) => q.objectiveId === X.bare).length, { timeout: 60_000 }).toBeGreaterThan(0);
});
