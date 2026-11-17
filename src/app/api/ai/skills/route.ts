import { NextRequest, NextResponse } from "next/server";
import { userFromRequest } from "@/lib/auth";
import { jsonError } from "@/lib/validators";
import { listSkills, listRoutines, executeRoutine } from "@/lib/ai/automation/routines";
import { db } from "@/lib/db";

export async function GET(request: NextRequest) {
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);

  const [skills, routines] = await Promise.all([
    listSkills(),
    listRoutines(),
  ]);

  return NextResponse.json({ skills, routines });
}

export async function POST(request: NextRequest) {
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);

  const body = await request.json().catch(() => ({}));
  const { action, routineId, name, slug, description, instructions } = body;

  if (action === "create_skill" && name) {
    try {
      const skill = await db.aiSkill.create({
        data: {
          name,
          slug: slug || name.toLowerCase().replace(/[^a-z0-9]/g, "_"),
          description: description || "",
          instructions: instructions || "",
          createdById: user.id,
        },
      });
      return NextResponse.json({ success: true, skill });
    } catch (err: any) {
      return jsonError(err?.message || "Failed to create skill", 500);
    }
  }

  if (!routineId) return jsonError("routineId or valid skill creation payload is required", 400);

  try {
    const task = await executeRoutine(routineId, user.id);
    return NextResponse.json({ success: true, task });
  } catch (err: any) {
    return jsonError(err?.message || "Failed to execute routine", 500);
  }
}

