/** Driving the fake Anthropic API (e2e/fake-anthropic.ts) from a test. */
import type { Scenario } from "./fake-anthropic";

/** Where Playwright starts the fake API (playwright.config.ts points the app at it). */
export const FAKE_MODEL_PORT = 3101;
const base = `http://127.0.0.1:${FAKE_MODEL_PORT}`;

/** Set what the fake model answers for this test (and clear its call log). */
export async function fakeModel(scenario: Scenario = {}): Promise<void> {
  const res = await fetch(`${base}/__scenario`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(scenario) });
  if (!res.ok) throw new Error(`The fake model refused the scenario (${res.status})`);
}

/** The steps the app called since the scenario was set, in order. */
export async function fakeCalls(): Promise<string[]> {
  const res = await fetch(`${base}/__calls`);
  return ((await res.json()) as Array<{ step: string }>).map((c) => c.step);
}
