import { db } from "@/lib/db";
import { createAndDispatchTask } from "@/lib/ai/orchestrator/dispatcher";
import { createApprovalRequest } from "@/lib/ai/orchestrator/approval";
import { transitionTaskStatus } from "@/lib/ai/agents/lifecycle";
import { agentRegistry } from "@/lib/ai/agents/agent-registry";

/**
 * Handing a task to an AI agent.
 *
 * Two audiences, two behaviours, and the difference is deliberate:
 *
 *  - An owner or admin asking an agent to do something is the same act as sending
 *    it a message, so it runs now.
 *  - A member asking an agent to do something becomes a request in the owner's
 *    approval queue. An agent can read the whole CRM and act on it, which is a
 *    different level of trust from "assign a task to a person" — a member is
 *    unblocked, but the owner still decides what runs.
 *
 * In both cases the requester is the actor, so tool calls, audit rows and any
 * records the agent creates are attributed to the person who asked, not to the
 * owner who approved.
 */

export interface DelegationRequest {
  objective: string;
  prompt?: string;
  agentSlug: string;
  requestedById: string;
  requestedByRole: string;
  /** The task this delegation came from, when it came from the task board. */
  sourceTaskId?: string;
}

export type DelegationResult =
  | { mode: "dispatched"; taskId: string; agentSlug: string }
  | { mode: "pending_approval"; approvalId: string; requestId: string; agentSlug: string };

function isAdmin(role: string): boolean {
  return role === "OWNER" || role === "ADMIN";
}

/** Agents that exist and are switched on. Unknown slugs are a caller error. */
export async function assertAgentAvailable(agentSlug: string): Promise<void> {
  await agentRegistry.ensureDefaultAgents();
  const agent = await agentRegistry.getAgentBySlug(agentSlug);
  if (!agent) throw new Error(`Unknown agent "${agentSlug}"`);
  if (agent.status !== "ACTIVE") throw new Error(`Agent "${agentSlug}" is not active`);
}

export async function delegateAgentWork(request: DelegationRequest): Promise<DelegationResult> {
  await assertAgentAvailable(request.agentSlug);

  const objective = request.objective.trim();
  if (!objective) throw new Error("Say what the agent should do");
  const prompt = (request.prompt ?? objective).trim();

  if (isAdmin(request.requestedByRole)) {
    const task = await createAndDispatchTask({
      objective,
      prompt,
      requestingUserId: request.requestedById,
      requestingUserRole: request.requestedByRole,
      assignedAgentSlug: request.agentSlug,
    });
    if (!task) throw new Error("The agent task could not be created");
    return { mode: "dispatched", taskId: task.id, agentSlug: request.agentSlug };
  }

  // A member's request waits for an owner. The placeholder task is created — not
  // planned — so nothing can execute before the decision is made.
  const agent = await agentRegistry.getAgentBySlug(request.agentSlug);
  const request_task = await db.aiTask.create({
    data: {
      objective,
      prompt,
      assignedAgentId: agent!.id,
      requestingUserId: request.requestedById,
      status: "CREATED",
    },
    select: { id: true },
  });

  const approval = await createApprovalRequest({
    taskId: request_task.id,
    proposedAction: `Agent task: ${objective.slice(0, 120)}`,
    description:
      `A teammate asked the ${request.agentSlug} agent to run this. Approving hands it to the agent with the requester's identity, so anything it changes is attributed to them.`,
    payload: {
      kind: "agent_delegation",
      objective,
      prompt,
      agentSlug: request.agentSlug,
      sourceTaskId: request.sourceTaskId ?? null,
    },
    requestedById: request.requestedById,
    riskClass: "CLASS_B",
  });

  // Tell the people who can actually approve it.
  const approvers = await db.user.findMany({
    where: { role: { in: ["OWNER", "ADMIN"] }, disabledAt: null },
    select: { id: true },
  });
  const requester = await db.user.findUnique({ where: { id: request.requestedById }, select: { name: true } });
  await Promise.all(
    approvers.map((approver) =>
      db.notification.create({
        data: {
          userId: approver.id,
          type: "SYSTEM",
          title: `${requester?.name ?? "A teammate"} wants the ${request.agentSlug} agent to run a task`,
          body: objective.slice(0, 200),
          href: "/ai/approvals",
          dedupeKey: `delegation:${approval.id}:${approver.id}`,
        },
      })
    )
  );

  return {
    mode: "pending_approval",
    approvalId: approval.id,
    requestId: request_task.id,
    agentSlug: request.agentSlug,
  };
}

/**
 * Runs a delegation that an owner just approved.
 *
 * The placeholder task exists only to hold the request, so it is closed with a
 * pointer to the real run instead of being executed itself — running it would
 * dispatch a task with no plan.
 */
export async function dispatchApprovedDelegation(params: {
  approvalId: string;
  requestTaskId: string;
  payload: { objective?: string; prompt?: string; agentSlug?: string };
  requestedById: string;
}): Promise<{ taskId: string }> {
  const objective = (params.payload.objective ?? "").trim();
  const agentSlug = (params.payload.agentSlug ?? "").trim();
  if (!objective || !agentSlug) throw new Error("This approval is missing its delegation details");

  const requester = await db.user.findUnique({
    where: { id: params.requestedById },
    select: { role: true },
  });

  const task = await createAndDispatchTask({
    objective,
    prompt: (params.payload.prompt ?? objective).trim(),
    // Attribution stays with the teammate who asked.
    requestingUserId: params.requestedById,
    requestingUserRole: requester?.role ?? "MEMBER",
    assignedAgentSlug: agentSlug,
    idempotencyKey: `delegation:${params.approvalId}`,
  });
  if (!task) throw new Error("The agent task could not be created");

  // READY (set by the approval) -> RUNNING -> COMPLETED: the request itself is
  // fulfilled, and the row that did the work is the dispatched task.
  await transitionTaskStatus(params.requestTaskId, "RUNNING");
  await transitionTaskStatus(params.requestTaskId, "COMPLETED", {
    result: JSON.stringify({ delegatedToTaskId: task.id, agentSlug }),
  });

  return { taskId: task.id };
}
