import type { FullConfig } from "@playwright/test";

/**
 * Stops the run before any test if the app's server reports a connected model: browser tests stub
 * every model call they expect, and one they don't expect must fail, not spend. The usual cause is
 * a local dev server on the test port that was started with a model key; stop it and rerun.
 */
export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0]?.use.baseURL;
  if (!baseURL) throw new Error("No baseURL in playwright.config.ts");
  const res = await fetch(`${baseURL}/api/llm/status`);
  if (!res.ok) throw new Error(`Couldn't ask ${baseURL} whether a model is connected (HTTP ${res.status})`);
  const { serverModel } = (await res.json()) as { serverModel: string | null };
  if (serverModel !== null) {
    throw new Error(
      `The server at ${baseURL} has a model key (${serverModel}); browser tests must never call a real model. ` +
        "Stop the dev server on that port (it was started with a key) and run the tests again.",
    );
  }
}
