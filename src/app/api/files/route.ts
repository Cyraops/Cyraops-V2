import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { userFromRequest } from "@/lib/auth";
import { jsonError } from "@/lib/validators";

export async function GET(request: NextRequest) {
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);
  const projectId = request.nextUrl.searchParams.get("projectId");
  if (!projectId) return jsonError("Choose a project to view its files", 400);
  const project = await db.project.findFirst({
    where: { id: projectId, ...(user.role === "OWNER" || user.role === "ADMIN" ? {} : { members: { some: { userId: user.id } } }) },
    select: { id: true },
  });
  if (!project) return jsonError("Project not found", 404);
  const files = await db.driveFile.findMany({
    where: { projectId, deletedAt: null },
    select: { id: true, name: true, mimeType: true, size: true, projectId: true, uploaderId: true, deletedAt: true, createdAt: true, uploader: { select: { id: true, name: true, avatarUrl: true } } },
    orderBy: { createdAt: "desc" },
  });
  return Response.json({ files: files.map((file) => ({ ...file, permission: file.uploaderId === user.id || user.role === "OWNER" || user.role === "ADMIN" ? "EDITOR" : "VIEWER" })) });
}
