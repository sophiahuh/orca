import { modelIsLocal, serverModel } from "@/lib/server/model";

/**
 * GET → { serverModel, local }: the model Orca's server uses (null: no key, nothing is generated),
 * and whether its calls go to this machine (the tests' fake API), which the browser tests require.
 */
export function GET() {
  return Response.json({ serverModel: serverModel(), local: modelIsLocal() }, { headers: { "cache-control": "no-store" } });
}
