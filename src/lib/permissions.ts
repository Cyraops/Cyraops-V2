import type { Role } from "@prisma/client";

export function canManageMember(actor: Role, target: Role, nextRole?: Role) {
  if (target === "OWNER" || actor === "MEMBER") return false;
  if (actor === "OWNER") return nextRole !== "OWNER";
  return target === "MEMBER" && nextRole !== "ADMIN" && nextRole !== "OWNER";
}

export function hasProjectAccess(role: Role, isMember: boolean) {
  return role === "OWNER" || role === "ADMIN" || isMember;
}
