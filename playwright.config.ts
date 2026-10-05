import { execFileSync } from "node:child_process";
import { defineConfig, devices } from "@playwright/test";
import { FAKE_MODEL_PORT } from "./e2e/fake-model";

/**
 * End-to-end tests in a real browser against the dev server and local Supabase. Each test gets a
 * fresh browser context and a fresh throwaway student (e2e/fixture.ts), so every test starts empty.
 * Run with `npm run test:e2e` (Node ≥ 22.6; see .nvmrc). First time: `npx playwright install chromium`.
 * Where a Chromium is already installed (e.g. a cloud container whose build doesn't match this
 * Playwright version), point at it with PLAYWRIGHT_CHROMIUM_PATH instead of downloading.
 */
const PORT = 3100;

/**
 * Tests never spend money on a model: the app's model calls go to a fake Messages API on this
 * machine (`e2e/fake-anthropic.ts`, started below) with a fake key, model keys from `.env.local`
 * are overridden, and `e2e/global-setup.ts` refuses to run against a server whose model calls
 * aren't local (e.g. a reused dev server started with a real key). Jobs run inline.
 */
const FAKE_MODEL = {
  ANTHROPIC_API_KEY: "e2e-fake-key",
  ANTHROPIC_BASE_URL: `http://127.0.0.1:${FAKE_MODEL_PORT}`,
  OPENAI_API_KEY: "",
  ORCA_JOBS: "inline",
};

/**
 * Supabase for the browser tests: the local stack's values from `supabase status` (so a stale
 * `.env` can't point the tests at the wrong stack), unless SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY and
 * SUPABASE_SECRET_KEY are set (a hosted or other project). Both the dev server and the test fixture
 * (which creates and signs in a throwaway student per test) read the same three values.
 */
function supabaseEnv() {
  let url = process.env.SUPABASE_URL;
  let publishable = process.env.SUPABASE_PUBLISHABLE_KEY;
  let secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !publishable || !secret) {
    let out: string;
    try {
      out = execFileSync("npx", ["supabase", "status", "-o", "env"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    } catch {
      throw new Error("The browser tests need Supabase: run `npm run db:start` (or set SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY).");
    }
    const vars = Object.fromEntries(out.split("\n").flatMap((l) => {
      const m = /^([A-Z_]+)="?(.*?)"?$/.exec(l.trim());
      return m ? [[m[1], m[2]]] : [];
    }));
    url = vars.API_URL;
    publishable = vars.PUBLISHABLE_KEY;
    secret = vars.SECRET_KEY;
  }
  if (!url || !publishable || !secret) throw new Error("Couldn't find the Supabase URL and keys for the browser tests.");
  return { NEXT_PUBLIC_SUPABASE_URL: url, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publishable, SUPABASE_SECRET_KEY: secret };
}
const SUPABASE = supabaseEnv();
Object.assign(process.env, SUPABASE); // the fixture reads these in the test workers

export default defineConfig({
  testDir: "e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1194, height: 834 },
    trace: "retain-on-failure",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {},
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1194, height: 834 } } }],
  webServer: [
    {
      command: `node --experimental-strip-types --no-warnings e2e/fake-anthropic.ts ${FAKE_MODEL_PORT}`,
      url: `http://127.0.0.1:${FAKE_MODEL_PORT}/__health`,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command: `npm run dev -- --port ${PORT}`,
      url: `http://localhost:${PORT}`,
      reuseExistingServer: !process.env.CI,
      env: { ...FAKE_MODEL, ...SUPABASE },
      timeout: 120_000,
    },
  ],
});
