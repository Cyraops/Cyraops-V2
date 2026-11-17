import { NextRequest, NextResponse } from "next/server";
import { userFromRequest } from "@/lib/auth";
import { jsonError } from "@/lib/validators";
import { db } from "@/lib/db";
import { AiTaskStatus } from "@prisma/client";
import { aiTaskVisibilityWhere } from "@/lib/ai/access";

export async function GET(request: NextRequest) {
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status") as AiTaskStatus | null;
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "30", 10)));

  // Members only see the agent tasks they requested; Owners/Admins see all.
  const where: any = { ...aiTaskVisibilityWhere(user) };
  if (status) {
    where.status = status;
  }

  const tasks = await db.aiTask.findMany({
    where,
    include: {
      assignedAgent: true,
      requestingUser: { select: { id: true, name: true, role: true } },
      steps: { orderBy: { stepIndex: "asc" } },
      approvals: true,
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return NextResponse.json({ tasks });
}

