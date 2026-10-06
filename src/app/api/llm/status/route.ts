import { modelIsLocal, serverModel } from "@/lib/server/model";
import { forStudent, reply } from "@/lib/server/student";

/**
 * GET → { serverModel, local }: the model Orca's server uses (null: no key, nothing is generated),
 * and whether its calls go to this machine (the tests' fake API), which the browser tests require.
 * Needs a signed-in student (401 otherwise): what Orca runs on isn't public.
 */
export function GET(request: Request) {
  return forStudent(request, async () => reply(200, { serverModel: serverModel(), local: modelIsLocal() }));
}
