import { execFileSync } from "node:child_process";
import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests in a real browser against the dev server. Each test gets a fresh browser
 * context, so localStorage (the app's whole state for now) starts empty every time.
 * Run with `npm run test:e2e` (Node ≥ 22.6; see .nvmrc). First time: `npx playwright install chromium`.
 * Where a Chromium is already installed (e.g. a cloud container whose build doesn't match this
 * Playwright version), point at it with PLAYWRIGHT_CHROMIUM_PATH instead of downloading.
 */
const PORT = 3100;

/**
 * Tests never spend money on a model: the dev server starts with every model key blanked (an empty
 * value also beats `.env.local`), and `e2e/global-setup.ts` refuses to run against a server that
 * says a model is connected (e.g. a reused local dev server started with a key).
 */
const NO_MODEL_KEYS = { ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "" };

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
  webServer: {
    command: `npm run dev -- --port ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    env: { ...NO_MODEL_KEYS, ...SUPABASE },
    timeout: 120_000,
  },
});
