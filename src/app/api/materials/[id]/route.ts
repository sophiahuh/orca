import { NextResponse } from "next/server";
import { removeMaterial } from "@/lib/server/materials";
import { forStudent } from "@/lib/server/student";

/**
 * DELETE → remove the signed-in student's material from its course: file, pages and calendar entry
 * go, the row stays marked `removed`, the objectives only it taught are archived
 * (`removeMaterial`). 200 { removed: true, archivedObjectives }, 404, or 409 while a job is
 * building from it (stop it first).
 */
export const runtime = "nodejs";

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return forStudent(request, async (student, db) => {
    const out = await removeMaterial(db, student.id, id);
    return NextResponse.json(out.body, { status: out.status });
  });
}
