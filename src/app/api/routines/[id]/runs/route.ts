import { NextRequest, NextResponse } from "next/server";
import { userFromRequest } from "@/lib/auth";
import { jsonError } from "@/lib/validators";
import { db } from "@/lib/db";

type Context = { params: Promise<{ id: string }> };

/** Run history, so "did my routine actually run?" has an answer. */
export async function GET(request: NextRequest, context: Context) {
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);

  const { id } = await context.params;
  const isAdmin = user.role === "OWNER" || user.role === "ADMIN";
  const routine = await db.aiRoutine.findUnique({
    where: { id },
    // A member may only inspect runs of routines they created; the error field
    // can contain provider output no member should read from someone else's
    // automation.
    select: { id: true, createdById: true },
  });
  if (!routine || (!isAdmin && routine.createdById !== user.id)) return jsonError("Routine not found", 404);

  const runs = await db.routineRun.findMany({
    where: { routineId: id },
    orderBy: { scheduledFor: "desc" },
    take: 30,
    select: {
      id: true,
      scheduledFor: true,
      status: true,
      attempt: true,
      startedAt: true,
      finishedAt: true,
      error: true,
    },
  });
  return NextResponse.json({ runs });
}
