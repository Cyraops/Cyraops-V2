import { db } from "@/lib/db";
import type { Role } from "@prisma/client";
import { resolve } from "node:path";

export async function fileAccess(file: { id: string; uploaderId: string; projectId: string }, userId: string, role: Role) {
  if (role === "OWNER" || role === "ADMIN") return "EDITOR" as const;
  const membership = await db.projectMember.findUnique({ where: { projectId_userId: { projectId: file.projectId, userId } }, select: { userId: true } });
  if (!membership) return null;
  return file.uploaderId === userId ? "EDITOR" as const : "VIEWER" as const;
}

export function storageDirectory() {
  const path = process.env.STORAGE_PATH ?? "./uploads";
  return resolve(/* turbopackIgnore: true */ process.cwd(), path);
}
