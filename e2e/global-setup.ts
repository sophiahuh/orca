import type { FullConfig } from "@playwright/test";

/**
 * Stops the run before any test unless the app's model calls go to this machine (the fake API in
 * `e2e/fake-anthropic.ts`): a test must never call a real model. The usual cause is a local dev
 * server on the test port that was started with a real key; stop it and rerun.
 */
export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0]?.use.baseURL;
  if (!baseURL) throw new Error("No baseURL in playwright.config.ts");
  const res = await fetch(`${baseURL}/api/llm/status`);
  if (!res.ok) throw new Error(`Couldn't ask ${baseURL} whether a model is connected (HTTP ${res.status})`);
  const { serverModel, local } = (await res.json()) as { serverModel: string | null; local?: boolean };
  if (serverModel !== null && local !== true) {
    throw new Error(
      `The server at ${baseURL} calls a real model (${serverModel}); browser tests must only reach the fake API. ` +
        "Stop the dev server on that port (it was started with a key) and run the tests again.",
    );
  }
  if (serverModel === null) throw new Error(`The server at ${baseURL} has no model: it wasn't started with the fake API's settings (playwright.config.ts). Stop it and rerun.`);
}
