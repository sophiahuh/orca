import type { Page } from "@playwright/test";

/** Must match STORAGE_KEY in src/lib/store.tsx. */
export const STORAGE_KEY = "orca:v6";

/**
 * A tiny course as if a student had created it and uploaded one deck: two topics, three
 * objectives, exact-answer questions. Only the e2e suite uses it; the app ships no courses.
 */
const COURSE_ID = "logic-e2e";
const DECK = "L01_Fixture.pdf";

const short = (id: string, topic: string, objectiveId: string, prompt: string, exact: string[]) => ({
  id,
  kind: "Short answer",
  tier: "retrieval",
  topic,
  prompt,
  options: [],
  answer: -1,
  exact,
  explanation: "Fixture question.",
  anchor: { locator: "slide 1", excerpt: "fixture" },
  objectiveId,
});

export const FIXTURE_STATE = {
  courses: [
    {
      id: COURSE_ID,
      slug: COURSE_ID,
      name: "Logic Fixture",
      short: "LOG",
      variant: "circuit",
      pos: { x: 70, y: 110 },
      topics: [
        { id: "boolean-algebra", name: "Boolean Algebra", pos: { x: 0, y: 0 }, source: { filename: DECK, slideStart: 1, slideEnd: 5 } },
        { id: "twos-complement", name: "Two's Complement", pos: { x: 0, y: 0 }, source: { filename: DECK, slideStart: 6, slideEnd: 9 } },
      ],
    },
  ],
  configs: { [COURSE_ID]: { quick: { duration: "10 min", cadence: "Daily" }, deep: { duration: "3 hours", cadence: "Weekly" }, exam: { duration: "10 hours", cadence: "1 wk before exam" } } },
  weights: { [COURSE_ID]: { homework: 30, practiceExams: 35, practiceProblems: 25, lectures: 10 } },
  objectives: {
    [COURSE_ID]: {
      "boolean-algebra/simplify": { id: "boolean-algebra/simplify", topicId: "boolean-algebra", name: "Simplify an expression" },
      "twos-complement/convert": { id: "twos-complement/convert", topicId: "twos-complement", name: "Convert to 2's complement" },
      "twos-complement/sign-extend": { id: "twos-complement/sign-extend", topicId: "twos-complement", name: "Sign-extend a number" },
    },
  },
  questionBank: {
    [COURSE_ID]: {
      "boolean-algebra": [
        short("ba-1", "Boolean Algebra", "boolean-algebra/simplify", "Simplify x + xy.", ["x"]),
        short("ba-2", "Boolean Algebra", "boolean-algebra/simplify", "Simplify a + a'c.", ["a + c"]),
      ],
      "twos-complement": [
        short("tc-1", "Two's Complement", "twos-complement/convert", "Write −6 as a 4-bit 2's complement number.", ["1010"]),
        short("tc-2", "Two's Complement", "twos-complement/convert", "What value is the 4-bit pattern 1011?", ["-5"]),
        short("tc-3", "Two's Complement", "twos-complement/convert", "Write −1 as a 4-bit 2's complement number.", ["1111"]),
        short("tc-4", "Two's Complement", "twos-complement/sign-extend", "Sign-extend 1010 to 8 bits.", ["11111010"]),
      ],
    },
  },
  evidence: [],
};

/** Seed the fixture course before the app loads. Only the first load seeds, so answers persist across navigations. */
export async function seedFixtureCourse(page: Page) {
  await page.addInitScript(
    ([key, state]) => {
      if (!window.localStorage.getItem(key)) window.localStorage.setItem(key, state);
    },
    [STORAGE_KEY, JSON.stringify(FIXTURE_STATE)] as const,
  );
}
