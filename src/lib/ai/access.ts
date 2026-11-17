/**
 * Centralized authorization rules for AI workspace data.
 *
 * These predicates are intentionally pure (no database access) so they can be
 * unit tested without touching a database and reused across route handlers.
 *
 * Policy:
 * - Owners and Admins can see organization-wide agent tasks.
 * - Members can only see and operate the agent tasks they requested themselves.
 * - AI conversations are strictly private to their owner at every role, matching
 *   the conversation list endpoint, which always filters by `userId`.
 */

export interface AiActor {
  id: string;
  role: string;
}

export interface OwnedAiTask {
  requestingUserId: string;
}

export interface OwnedAiConversation {
  userId: string;
}

export function isDepartmentAdmin(actor: AiActor): boolean {
  return actor.role === "OWNER" || actor.role === "ADMIN";
}

/** Organization-wide task visibility (Owner/Admin) vs. own tasks only (Member). */
export function canViewOrgWideAiTasks(actor: AiActor): boolean {
  return isDepartmentAdmin(actor);
}

export function canViewAiTask(actor: AiActor, task: OwnedAiTask): boolean {
  if (canViewOrgWideAiTasks(actor)) return true;
  return task.requestingUserId === actor.id;
}

/**
 * Operating (pause/resume/retry/cancel) a task follows the same rule as viewing
 * it. Expressed separately so the two can diverge later without touching call
 * sites.
 */
export function canOperateAiTask(actor: AiActor, task: OwnedAiTask): boolean {
  return canViewAiTask(actor, task);
}

/** AI conversations are private to their owner regardless of role. */
export function canViewAiConversation(actor: AiActor, conversation: OwnedAiConversation): boolean {
  return conversation.userId === actor.id;
}

/**
 * Prisma `where` fragment for listing tasks, or an empty object for admins.
 */
export function aiTaskVisibilityWhere(actor: AiActor): Record<string, unknown> {
  return canViewOrgWideAiTasks(actor) ? {} : { requestingUserId: actor.id };
}
