import { db } from "@/lib/db";

/**
 * Whether a user may touch a project's delivery data. Used by the milestone
 * routes, which previously had no membership check at all — any signed-in user
 * could read, create, edit and delete milestones on any project.
 */
export async function canAccessProject(userId: string, role: string, projectId: string): Promise<boolean> {
  if (role === "OWNER" || role === "ADMIN") return true;
  return Boolean(
    await db.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId } },
      select: { projectId: true },
    })
  );
}
