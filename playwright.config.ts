import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests in a real browser against the dev server. Each test gets a fresh browser
 * context, so localStorage (the app's whole state for now) starts empty every time.
 * Run with `npm run test:e2e` (Node ≥ 22.6; see .nvmrc).
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
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1194, height: 834 } } }],
  webServer: {
    command: `npm run dev -- --port ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
