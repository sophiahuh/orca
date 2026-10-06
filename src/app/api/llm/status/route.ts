import { gradingMode } from "@/lib/server/grade";
import { modelIsLocal, serverModel } from "@/lib/server/model";
import { forStudent, reply } from "@/lib/server/student";

/**
 * GET → { serverModel, local, grading }: the model Orca's server uses (null: no key, nothing is
 * generated), whether its calls go to this machine (the tests' fake API), which the browser tests
 * require, and whether this student's prose answers are graded by the model or self-marked
 * ("self" without a key, or while model grading is turned off for them; decision 13).
 * Needs a signed-in student (401 otherwise): what Orca runs on isn't public.
 */
export function GET(request: Request) {
  return forStudent(request, async (student, db) => reply(200, { serverModel: serverModel(), local: modelIsLocal(), grading: await gradingMode(db, student.id) }));
}
