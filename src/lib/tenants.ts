/**
 * Row-level tenant scoping for CRM list routes (FIX 3).
 *
 * GET /api/tickets, GET /api/crm/contacts and the calendar events list used to
 * return whole-DB rows. Task/CalendarEvent carry stable owner paths
 * (Task.creatorId/assigneeId/TaskAssignee.userId, CalendarEvent.creatorId,
 * Project.ownerId); Contact now carries workspaceId (the owning user's id,
 * backfilled from unambiguous deal/lead owners, see the
 * contact_workspace_id migration), with the deal/lead links kept as the
 * fallback for rows whose owner path was ambiguous or absent.
 *
 * The tenant model here is the one the harness bridge already uses
 * (plugins/cyraops-crm/lib/bridge.mjs): a workspace's rows are the rows its
 * owner-user created or owns. The schema has no WorkspaceMember table, so a
 * member's workspace is expressed the same way the calendar route already
 * scopes tasks for members — through project membership:
 *
 * - OWNER/ADMIN: every workspace's rows (the app's existing admin pattern:
 *   calendar tasks, search and assistant/today all give admins the whole DB).
 * - MEMBER: their own rows plus rows inside projects they belong to (calendar
 *   member pattern). Project owners/co-members supply the workspace-wide rows
 *   for events, which have no project link.
 *
 * All helpers are Prisma `where` fragments; they never mutate.
 */

import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";

export interface TenantViewer {
  id: string;
  role: string;
}

/** OWNER/ADMIN are workspace-spanning throughout the app (calendar, search, today). */
export function isTenantAdmin(role: string): boolean {
  return role === "OWNER" || role === "ADMIN";
}

/** Projects the viewer can see: owned by them, or with them as a member. */
async function viewerProjectIds(userId: string): Promise<string[]> {
  const projects = await db.project.findMany({
    where: { OR: [{ ownerId: userId }, { members: { some: { userId } } }] },
    select: { id: true },
  });
  return projects.map((project) => project.id);
}

/**
 * The member task scope, mirroring the calendar route's member pattern
 * (`projectId: { in: projectIds }` for tasks the member's projects contain)
 * plus the member's own rows: created, assigned, or in the authoritative
 * TaskAssignee set. An empty project list fail-closed: only the member's own
 * rows remain.
 */
export async function memberTaskWhere(userId: string): Promise<Prisma.TaskWhereInput> {
  const projectIds = await viewerProjectIds(userId);
  return {
    OR: [
      { creatorId: userId },
      { assigneeId: userId },
      { assignees: { some: { userId } } },
      { projectId: { in: projectIds } },
    ],
  };
}

/**
 * The user ids whose calendar events a viewer can see: themselves, the owners
 * of their projects, and every member of those projects. CalendarEvent has no
 * project link, so project co-membership is the only schema-grounded
 * definition of "my workspace's events" for a member (and keeps the owner's
 * team calendar intact: the owner sees events their project members create).
 */
export async function sharedProjectUserIds(userId: string): Promise<string[]> {
  const projects = await db.project.findMany({
    where: { OR: [{ ownerId: userId }, { members: { some: { userId } } }] },
    select: { ownerId: true, members: { select: { userId: true } } },
  });
  const ids = new Set<string>([userId]);
  for (const project of projects) {
    ids.add(project.ownerId);
    for (const member of project.members) ids.add(member.userId);
  }
  return [...ids];
}

/**
 * The member contact scope. `workspaceId` (the owning user's id, the same
 * workspace key the harness bridge uses) is authoritative when present; the
 * deal/lead links (Deal.ownerId / Lead.assignedToId) are only the fallback
 * for rows whose workspaceId is null — rows that predate the column or whose
 * owner path was ambiguous at backfill, so the pre-migration visibility is
 * preserved exactly for them. A link can never reach into a row that another
 * workspace owns. Standalone contacts with neither signal are invisible to
 * members (fail-closed).
 */
export function memberContactWhere(userId: string): Prisma.ContactWhereInput {
  return {
    OR: [
      { workspaceId: userId },
      { workspaceId: null, deals: { some: { ownerId: userId } } },
      { workspaceId: null, leads: { some: { assignedToId: userId } } },
    ],
  };
}
