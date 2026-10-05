import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests in a real browser against the dev server. Each test gets a fresh browser
 * context, so localStorage (the app's whole state for now) starts empty every time.
 * Run with `npm run test:e2e` (Node ≥ 22.6; see .nvmrc). First time: `npx playwright install chromium`.
 * Where a Chromium is already installed (e.g. a cloud container whose build doesn't match this
 * Playwright version), point at it with PLAYWRIGHT_CHROMIUM_PATH instead of downloading.
 */
const PORT = 3100;

export default defineConfig({
  testDir: "e2e",
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
    timeout: 120_000,
  },
});
