import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { publicUserSelect, userFromRequest } from "@/lib/auth";
import { jsonError } from "@/lib/validators";

export async function GET(request: NextRequest) {
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);

  const entity = request.nextUrl.searchParams.get("entity");
  const entityId = request.nextUrl.searchParams.get("entityId");
  if (entity && entityId) {
    const activities = await db.activity.findMany({
      where: { entity, entityId },
      include: { user: { select: publicUserSelect } },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return Response.json({ activities });
  }

  const projectIds = (await db.projectMember.findMany({ where: { userId: user.id }, select: { projectId: true } })).map((entry) => entry.projectId);
  const projectId = request.nextUrl.searchParams.get("projectId");
  if (projectId && !projectIds.includes(projectId) && user.role === "MEMBER") return jsonError("Project not found", 404);
  const activities = await db.activity.findMany({ where: projectId ? { projectId } : user.role === "OWNER" || user.role === "ADMIN" ? {} : { OR: [{ userId: user.id }, { projectId: { in: projectIds } }] }, include: { user: { select: publicUserSelect }, project: { select: { id: true, name: true } } }, orderBy: { createdAt: "desc" }, take: 100 });
  return Response.json({ activities });
}
