import { db } from "@/lib/db";
import { publicUserSelect } from "@/lib/auth";

/**
 * Who a task belongs to.
 *
 * Work used to have exactly one owner. Real work does not: a task like "draft the
 * Nordwind proposal" belongs to the writer and the reviewer, and plenty of tasks
 * are better handed to an agent than to a person. So a task now holds a set of
 * owners, and an AI agent can be one of them.
 *
 * `Task.assigneeId` survives as the *first human* owner because a lot of older
 * code reads it (calendar, dashboard digests, agent tools). This module is the
 * single place that keeps the two in step, so the summary field can never drift
 * away from the real set.
 */

export interface TaskAssigneeSet {
  userIds: string[];
  agentSlugs: string[];
}

export interface ResolvedAssignee {
  kind: "user" | "agent";
  id: string;
  name: string;
  /** Present for people only. */
  email?: string | null;
  avatarUrl?: string | null;
  role?: string;
}

const MAX_HUMANS = 10;
const MAX_AGENTS = 3;

export function normaliseAssigneeSet(input: {
  userIds?: (string | null | undefined)[];
  agentSlugs?: (string | null | undefined)[];
}): TaskAssigneeSet {
  const userIds = [...new Set((input.userIds ?? []).filter((id): id is string => Boolean(id)))];
  const agentSlugs = [...new Set((input.agentSlugs ?? []).filter((slug): slug is string => Boolean(slug)))];
  return {
    userIds: userIds.slice(0, MAX_HUMANS),
    agentSlugs: agentSlugs.slice(0, MAX_AGENTS),
  };
}

/** The authoritative owner list for one task, as displayable records. */
export async function listTaskAssignees(taskIds: string[]): Promise<Map<string, ResolvedAssignee[]>> {
  const result = new Map<string, ResolvedAssignee[]>();
  if (taskIds.length === 0) return result;

  const rows = await db.taskAssignee.findMany({
    where: { taskId: { in: taskIds } },
    select: {
      taskId: true,
      agentSlug: true,
      user: { select: { ...publicUserSelect, role: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  for (const row of rows) {
    const list = result.get(row.taskId) ?? [];
    if (row.agentSlug) {
      list.push({ kind: "agent", id: row.agentSlug, name: agentDisplayName(row.agentSlug) });
    } else if (row.user) {
      list.push({
        kind: "user",
        id: row.user.id,
        name: row.user.name,
        email: row.user.email,
        avatarUrl: (row.user as any).avatarUrl ?? null,
        role: (row.user as any).role,
      });
    }
    result.set(row.taskId, list);
  }
  return result;
}

/** "research" → "Research Agent" when the registry knows it. */
function agentDisplayName(slug: string): string {
  const known: Record<string, string> = {
    research: "Research Agent",
    sales: "Sales Agent",
    communication: "Communication Agent",
    business_analyst: "Business Analyst Agent",
    customer_support: "Customer Support Agent",
    workflow_automation: "Workflow Automation Agent",
    chief_of_staff: "Chief of Staff",
  };
  return known[slug] ?? `${slug.replace(/_/g, " ")} agent`;
}

/**
 * Replaces the owner set for a task.
 *
 * Replacing rather than merging on purpose: "assign these three people" must be
 * able to *remove* someone too, and a caller that has to compute a diff has two
 * chances to get it wrong. Callers pass the complete set they want.
 */
export async function setTaskAssignees(taskId: string, next: TaskAssigneeSet): Promise<TaskAssigneeSet> {
  const current = await db.taskAssignee.findMany({
    where: { taskId },
    select: { id: true, userId: true, agentSlug: true },
  });

  const wantedUsers = new Set(next.userIds);
  const wantedAgents = new Set(next.agentSlugs);

  const stale = current.filter((row) =>
    row.userId ? !wantedUsers.has(row.userId) : !wantedAgents.has(row.agentSlug ?? "")
  );
  const existingUsers = new Set(current.map((row) => row.userId).filter(Boolean) as string[]);
  const existingAgents = new Set(current.map((row) => row.agentSlug).filter(Boolean) as string[]);

  await db.$transaction([
    ...(stale.length > 0
      ? [db.taskAssignee.deleteMany({ where: { id: { in: stale.map((row) => row.id) } } })]
      : []),
    ...next.userIds
      .filter((id) => !existingUsers.has(id))
      .map((userId) => db.taskAssignee.create({ data: { taskId, userId } })),
    ...next.agentSlugs
      .filter((slug) => !existingAgents.has(slug))
      .map((agentSlug) => db.taskAssignee.create({ data: { taskId, agentSlug } })),
    // Keep the legacy single-assignee field pointing at the first human owner.
    db.task.update({ where: { id: taskId }, data: { assigneeId: next.userIds[0] ?? null } }),
  ]);

  return next;
}

/** Validates the humans exist and are active. Returns the ids that do. */
export async function validateHumanAssignees(userIds: string[]): Promise<string[]> {
  if (userIds.length === 0) return [];
  const users = await db.user.findMany({
    where: { id: { in: userIds }, disabledAt: null },
    select: { id: true },
  });
  return users.map((user) => user.id);
}

/**
 * Who is newly on the task, so notifications go to the people who were just
 * handed work rather than to everyone who already had it.
 */
export function newlyAssigned(previous: TaskAssigneeSet, next: TaskAssigneeSet): string[] {
  const before = new Set(previous.userIds);
  return next.userIds.filter((id) => !before.has(id));
}
