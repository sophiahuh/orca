import type { Page } from "@playwright/test";
import { type Objective, type QuizQuestion, type Topic, defaultTopicPositions } from "../src/lib/data";

/** Must match STORAGE_KEY in src/lib/store.tsx. */
export const STORAGE_KEY = "orca:v8";

/**
 * A tiny course as if a student had created it and uploaded one deck: two topics, three
 * objectives, exact-answer questions. Only the e2e suite uses it; the app ships no courses.
 */
const COURSE_ID = "logic-e2e";
const DECK = "L01_Fixture.pdf";

export const short = (id: string, topic: string, objectiveId: string, prompt: string, exact: string[]): QuizQuestion => ({
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

export const objective = (id: string, topicId: string, name: string, extra: Partial<Objective> = {}): Objective => ({
  id,
  topicId,
  name,
  description: "",
  aliases: [],
  origin: "material",
  review: "confirmed",
  materialId: "fixture-material",
  runId: "fixture-run",
  signals: [],
  ...extra,
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
      topics: laidOut([
        { id: "boolean-algebra", name: "Boolean Algebra", aliases: [], review: "confirmed", pos: { x: 0, y: 0 }, source: { filename: DECK, slideStart: 1, slideEnd: 5 } },
        { id: "twos-complement", name: "Two's Complement", aliases: [], review: "confirmed", pos: { x: 0, y: 0 }, source: { filename: DECK, slideStart: 6, slideEnd: 9 } },
      ] satisfies Topic[]),
    },
  ],
  configs: { [COURSE_ID]: { quick: { duration: "10 min", cadence: "Daily" }, deep: { duration: "3 hours", cadence: "Weekly" }, exam: { duration: "10 hours", cadence: "1 wk before exam" } } },
  weights: { [COURSE_ID]: { homework: 25, practiceExams: 25, practiceProblems: 25, lectures: 25 } },
  objectives: {
    [COURSE_ID]: {
      "boolean-algebra/simplify": objective("boolean-algebra/simplify", "boolean-algebra", "Simplify an expression"),
      "twos-complement/convert": objective("twos-complement/convert", "twos-complement", "Convert to 2's complement"),
      "twos-complement/sign-extend": objective("twos-complement/sign-extend", "twos-complement", "Sign-extend a number"),
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

/** Seed app state before the app loads. Only the first load seeds, so changes persist across navigations. */
/** Lay seeded topics out the way the store does after an upload. */
export function laidOut<T extends { pos: Topic["pos"] }>(topics: T[]): T[] {
  const positions = defaultTopicPositions(topics.length);
  return topics.map((t, i) => ({ ...t, pos: positions[i] }));
}

export async function seedState(page: Page, state: object) {
  await page.addInitScript(
    ([key, json]) => {
      if (!window.localStorage.getItem(key)) window.localStorage.setItem(key, json);
    },
    [STORAGE_KEY, JSON.stringify(state)] as const,
  );
}

export async function seedFixtureCourse(page: Page) {
  await seedState(page, FIXTURE_STATE);
}
