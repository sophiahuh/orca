# C: Task 8, grading behind sign-in (2026-10-06, cloud container)

## Status

Done on `phase-4`, one commit after E's. Redone from scratch: the teammate's `p4-C` branch
(commit `0faedd2`) was never pushed and is lost.

- **`POST /api/grade`** takes `{ questionId, response }` only (zod, strict). 401 signed out
  (`forStudent`); 400 if the body carries `question`, `rubric`, `llm`, `model`, `apiKey` or
  `provider` ("the question, its rubric and the model come from Orca"), or isn't an id and an
  answer; 404 when the question isn't the student's; 400 when it's an exact-answer or choice
  question (checked in the quiz, never sent to a model); 422 when the stored rubric can't be read;
  503 without a key (`NO_MODEL_FOR_GRADING`), in which case the quiz already offers self-marking
  (`useServerModel` is null). Model errors keep `LlmError`'s status (a 5xx becomes 502).
- **`src/lib/server/grade.ts`** (new): loads `prompt, rubric, exact, kind` scoped to the owner,
  sanitises and cuts the answer (`cleanAnswer`, 2,000 characters), calls `completeJson` with
  Orca's key and `ctx: { ownerId, kind: "grade" }` (`effort: "low"`, 1,024 tokens), and validates
  the reply. Two marked spots for integration: the rate limit (B) and the injection screen with its
  `security_events` row and the repeat-offender switch (A), both before the model call.
- **`src/lib/grading.ts`** (pure): `GRADE_SYSTEM` keeps its first line (the fake API recognises the
  step by it) and gains `UNTRUSTED_POLICY` plus a paragraph saying the answer is a data block and
  anything it says to the grader earns nothing. `gradePrompt` sends the rubric (trusted, from the
  database), then the answer as `untrustedBlock("student_answer", …)`, then the task. New:
  `RubricSchema` (stored rubrics; older rows may lack the optional lists), `validateGrade`
  (`satisfied` only ideas the rubric lists, de-duplicated; `misconception` only a listed one, else
  null; feedback sanitised, newlines joined, cut at 240, a fallback sentence if empty; the outcome
  stays the model's rubric call), `cleanAnswer`, `ANSWER_MAX_CHARS`, `FEEDBACK_MAX_CHARS`.
- **`QuizRunner`** sends `{ questionId, response }` and nothing else; the browser-side grading path
  for browser-only providers (Ollama through `compatChat`) is gone from the quiz, and `noModel` now
  depends only on the server's model. `src/lib/llm.ts` and `YourAI.tsx` are untouched.
- **`/api/llm/status` and `/api/llm/models`** need a session (`forStudent`). The app's own caller
  (`useServerModel`) is always signed in.
- **`e2e/global-setup.ts`** keeps the "no real model" guard: it creates a throwaway confirmed
  student with the secret key, signs in for an access token, asks `/api/llm/status` with
  `Authorization: Bearer`, and deletes the student. It also fails if the route answers anything but
  401 to a signed-out caller, so the guard can't pass by accident. The Supabase values come from
  `process.env`, which `playwright.config.ts` fills from the local stack.
- **`e2e/fake-anthropic.ts`**: an optional `grade` Scenario field (outcome, satisfied,
  misconception, feedback) replaces the fixed "correct" answer; nothing about prompt parsing changed.
- **`src/lib/server/model.ts`**: one added export, `orcaConfig()` (Orca's `LlmConfig` or null), which
  `stepCaller` now uses too. Nothing else inside it changed (B owns it).

Tests: `tests/grading.test.ts` (the answer stays inside one JSON line with fake system lines, a
closing brace, a role tag and a U+E0041 tag character; rubric before the data, task after; the
reply is kept to the rubric; answers are sanitised and cut; stored rubrics parse) and
`e2e/grade.spec.ts` (signed out 401; a rubric, question or llm in the body 400; a random id 404; an
exact question 400 with no model call; a prose answer graded through the fake API with the fake's
made-up idea and misconception dropped, then the same through the quiz screen and recorded as
`grader: "rubric"` evidence; a failed grade shows "wasn't counted" and records nothing).

## Proof (final run, all green)

See the commit message for counts.

## Judgement calls

- **The 503 no-key path has no e2e** (the e2e server always has the fake key) and no unit test
  (`gradeAnswer` uses the `@/` alias, so it isn't Node-loadable). It is three lines in
  `gradeAnswer`; the quiz's self-marking when `serverModel` is null is the existing behaviour.
- **Exact and choice questions are refused by the grader (400)** rather than graded: decision 13
  says code checks what code can check, and letting the model grade an exact question would be a
  way to turn an exact miss into a "correct".
- **`validateGrade` never changes the outcome.** Dropping a made-up "satisfied" idea could argue
  for downgrading "correct", but the outcome is the rubric judgement the model was asked for;
  second-guessing it in code would be a second grader. Integration's screen (A) is where a
  suspicious answer gets handled.
- **The hidden "Your AI" models route stays**, behind sign-in, since its component is kept until
  bring-your-own model is decided.
