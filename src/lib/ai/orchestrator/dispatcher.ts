import { db } from "@/lib/db";
import { Priority } from "@prisma/client";
import { agentRegistry } from "../agents/agent-registry";
import { generateExecutionPlan } from "./planner";
import { transitionTaskStatus, transitionStepStatus } from "../agents/lifecycle";
import { createApprovalRequest } from "./approval";
import { normalizeApprovalMode, type PolicyRule } from "../policy/resolve-action";
import { gateDispatchStep } from "../policy/dispatch-gate";
import { toolRegistry } from "../tools/registry";
import "../tools/crm-tools"; // Ensure tools are registered

export interface DispatchTaskParams {
  objective: string;
  prompt: string;
  requestingUserId: string;
  priority?: Priority;
  assignedAgentSlug?: string;
  requestingUserRole?: string;
  idempotencyKey?: string;
  conversationId?: string;
  /** The objective this task contributes to, when dispatched by a goal. */
  goalId?: string;
}

function parseAgentToolIds(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((id): id is string => typeof id === "string");
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

/**
 * The standing safety answers the requesting user's assistant has collected
 * (its approval mode and its allow/deny/ask rules). Background work used to
 * ignore these entirely: a tool the user had explicitly blocked, or a run that
 * had just swallowed a web page, executed exactly like the safest possible
 * read. Loading them here lets the dispatch path ask the same question the
 * chat path asks.
 */
async function loadDispatchPolicy(requestingUserId: string): Promise<{
  mode: ReturnType<typeof normalizeApprovalMode>;
  rules: PolicyRule[];
}> {
  try {
    const assistant = await db.assistant.findUnique({
      where: { userId: requestingUserId },
      select: { id: true, approvalMode: true },
    });
    if (!assistant) return { mode: normalizeApprovalMode(undefined), rules: [] };
    const stored = await db.assistantApprovalRule.findMany({
      where: { assistantId: assistant.id },
      select: { toolName: true, effect: true },
    });
    return {
      mode: normalizeApprovalMode(assistant.approvalMode),
      rules: stored.map((rule) => ({
        toolName: rule.toolName,
        effect: rule.effect as PolicyRule["effect"],
      })),
    };
  } catch (err) {
    // Never let a policy lookup failure make background work *less* safe: an
    // unreadable assistant profile falls back to the strictest defaults.
    console.error("[Dispatcher] Could not load assistant policy:", err);
    return { mode: normalizeApprovalMode(undefined), rules: [] };
  }
}

export async function createAndDispatchTask(params: DispatchTaskParams) {
  await agentRegistry.ensureDefaultAgents();

  // Deduplication check
  if (params.idempotencyKey) {
    const existing = await db.aiTask.findUnique({
      where: { idempotencyKey: params.idempotencyKey },
    });
    if (existing) return existing;
  }

  const assignedAgent = params.assignedAgentSlug
    ? await agentRegistry.getAgentBySlug(params.assignedAgentSlug)
    : await agentRegistry.getMasterAgent();

  if (!assignedAgent) {
    throw new Error("No agent available to assign task.");
  }
  if (assignedAgent.status !== "ACTIVE") {
    throw new Error(`Agent "${assignedAgent.name}" is not active.`);
  }

  // 1. Create Task in PLANNING status
  const task = await db.aiTask.create({
    data: {
      objective: params.objective,
      prompt: params.prompt,
      assignedAgentId: assignedAgent.id,
      requestingUserId: params.requestingUserId,
      conversationId: params.conversationId || null,
      goalId: params.goalId ?? null,
      status: "PLANNING",
      priority: params.priority || "MEDIUM",
      idempotencyKey: params.idempotencyKey,
      currentStepIndex: 1,
    },
  });

  try {
    // 2. Generate Plan
    const activeAgents = await agentRegistry.listAgents();
    const plan = await generateExecutionPlan(params.prompt || params.objective, {
      role: params.requestingUserRole || "MEMBER",
      userId: params.requestingUserId,
      selectedAgentSlug: assignedAgent.slug,
      agents: activeAgents,
    });

    // 3. Persist steps
    for (const step of plan.steps) {
      await db.aiTaskStep.create({
        data: {
          taskId: task.id,
          stepIndex: step.stepIndex,
          title: step.title,
          description: step.description,
          assignedAgentSlug: step.assignedAgentSlug,
          requiresApproval: step.requiresApproval,
          input: JSON.stringify({ toolId: step.toolId, arguments: step.input || {} }),
          status: "CREATED",
        },
      });
    }

    await db.aiTask.update({
      where: { id: task.id },
      data: {
        plan: JSON.stringify(plan),
        status: "RUNNING",
        startedAt: new Date(),
      },
    });

    // 4. Run Steps with worker leasing and durable step execution
    return await executeTaskSteps(task.id, params.requestingUserId);
  } catch (err: any) {
    console.error("[Dispatcher] Task planning or execution failed:", err);
    return await transitionTaskStatus(task.id, "FAILED", {
      error: err?.message || "Execution failed",
    });
  }
}

export async function executeTaskSteps(taskId: string, requestingUserId: string) {
  // Load the parent task once: its goal lets agents message their teammates in
  // the same thread while they work.
  const parentTask = await db.aiTask.findUnique({ where: { id: taskId }, select: { goalId: true } });
  const taskGoalId = parentTask?.goalId ?? undefined;

  const steps = await db.aiTaskStep.findMany({
    where: { taskId },
    orderBy: { stepIndex: "asc" },
  });

  // Taint is a property of the run, not of a process: a task that read a web
  // page in step 1 is still steered when step 4 runs after a worker restart.
  // Rebuilding it from durable tool calls makes the barrier survive redeploys
  // (containers scale to zero here) instead of living only in memory.
  const { mode: approvalMode, rules: policyRules } = await loadDispatchPolicy(requestingUserId);
  // Tools that gate on role (revenue reports) only work if the context carries
  // one. Chat always passed it; this path never did, so an owner's own agent was
  // refused owner-only data. Read it from the database rather than trusting a
  // caller-supplied claim.
  const requestor = await db.user.findUnique({
    where: { id: requestingUserId },
    select: { role: true },
  });
  const requestingUserRole = requestor?.role ?? undefined;
  const priorCalls = await db.aiToolCall.findMany({
    where: { taskId, status: "SUCCESS" },
    select: { toolId: true },
  });
  // Look up by toolId: AiToolCall.toolName stores the display name ("Search
  // Workspace Documents"), which never matches a registry key.
  let runTainted = priorCalls.some((call) => Boolean(toolRegistry.getTool(call.toolId)?.taintsRun));

  const workerId = `worker-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  const leaseDurationMs = 30000; // 30 seconds worker lease
  const now = new Date();
  const leaseExpiresAt = new Date(now.getTime() + leaseDurationMs);

  // Atomic lease claim: only succeeds if unassigned, lease expired, or already owned by this worker
  const claim = await db.aiTask.updateMany({
    where: {
      id: taskId,
      OR: [
        { workerId: null },
        { leaseExpiresAt: { lt: now } },
        { workerId },
      ],
    },
    data: {
      workerId,
      leaseExpiresAt,
      lastHeartbeat: now,
      status: "RUNNING",
    },
  });

  if (claim.count === 0) {
    console.log(`[Dispatcher] Worker ${workerId} could not claim task ${taskId}: already leased by an active worker.`);
    return await db.aiTask.findUnique({
      where: { id: taskId },
      include: { steps: true, approvals: true, toolCalls: true },
    });
  }

  // Background heartbeat interval while executing steps (scoped to this workerId)
  const heartbeatTimer = setInterval(async () => {
    try {
      await db.aiTask.updateMany({
        where: { id: taskId, workerId },
        data: {
          lastHeartbeat: new Date(),
          leaseExpiresAt: new Date(Date.now() + leaseDurationMs),
        },
      });
    } catch {
      // Task may be completed or transitioning
    }
  }, 10000);

  const stepOutputs: Record<number, any> = {};

  try {
    for (const step of steps) {
      // Verify worker still owns the lease before continuing
      const taskCheck = await db.aiTask.findUnique({
        where: { id: taskId },
        select: { workerId: true, leaseExpiresAt: true, status: true },
      });
      if (taskCheck?.workerId !== workerId) {
        console.warn(`[Dispatcher] Worker ${workerId} lost lease on task ${taskId} (now held by ${taskCheck?.workerId}). Halting execution.`);
        return;
      }

      if (step.status === "COMPLETED") {
        stepOutputs[step.stepIndex] = step.output ? JSON.parse(step.output) : null;
        continue;
      }

      // Checkpoint current step index & renew heartbeat
      await db.aiTask.updateMany({
        where: { id: taskId, workerId },
        data: {
          currentStepIndex: step.stepIndex,
          lastHeartbeat: new Date(),
          leaseExpiresAt: new Date(Date.now() + leaseDurationMs),
        },
      });

      try {
        const stepInput = JSON.parse(step.input || "{}");
        const agentSlug = step.assignedAgentSlug || "chief_of_staff";
        const toolId = typeof stepInput.toolId === "string" ? stepInput.toolId : "";
        const toolArgs = stepInput.arguments && typeof stepInput.arguments === "object" && !Array.isArray(stepInput.arguments)
          ? stepInput.arguments
          : {};
        const agent = await agentRegistry.getAgentBySlug(agentSlug);
        const tool = toolRegistry.getTool(toolId);
        if (!agent || agent.status !== "ACTIVE") throw new Error(`Assigned agent "${agentSlug}" is not active.`);
        // Collaboration is always available: an agent that cannot tell its
        // teammates anything is not really part of the team.
        const allowedToolIds = new Set([...parseAgentToolIds(agent.tools), "message_team"]);
        if (!tool || !allowedToolIds.has(toolId)) {
          throw new Error(`Tool "${toolId || "(missing)"}" is not registered for agent "${agentSlug}".`);
        }

        // Step idempotency: use a completed tool result before re-asking for approval.
        const stepIdempotencyKey = `${taskId}-step-${step.stepIndex}`;
        const existingCall = await db.aiToolCall.findFirst({
          where: { taskId, idempotencyKey: stepIdempotencyKey, status: "SUCCESS" },
        });
        if (existingCall) {
          let cachedData: any = null;
          try {
            cachedData = existingCall.output ? JSON.parse(existingCall.output) : null;
          } catch {
            cachedData = existingCall.output;
          }
          await transitionStepStatus(step.id, "COMPLETED", { output: JSON.stringify(cachedData) });
          stepOutputs[step.stepIndex] = cachedData;
          continue;
        }

        // Risk is taken from the registered tool as well as the planner, so a
        // model cannot downgrade a consequential tool to an unapproved action.
        const approvalRequired = step.requiresApproval || tool.requiresApproval || tool.riskClass === "CLASS_C";
        const existingApproval = step.approvalId
          ? await db.aiApproval.findUnique({ where: { id: step.approvalId } })
          : null;
        if (approvalRequired && existingApproval?.status !== "APPROVED") {
          if (!existingApproval) {
            await createApprovalRequest({
              taskId,
              stepId: step.id,
              stepIndex: step.stepIndex,
              proposedAction: `${tool.name}: ${step.title}`,
              description: step.description || "Human approval is required before this action can run.",
              payload: { toolId, arguments: toolArgs },
              requestedById: requestingUserId,
              riskClass: tool.riskClass,
            });
          } else if (existingApproval.status !== "PENDING") {
            throw new Error(`Approval for step ${step.stepIndex} is ${existingApproval.status.toLowerCase()}.`);
          }

          await db.aiTask.update({
            where: { id: taskId },
            data: { workerId: null, leaseExpiresAt: null, status: "AWAITING_APPROVAL" },
          });
          return await db.aiTask.findUnique({
            where: { id: taskId },
            include: { steps: true, approvals: true, toolCalls: true },
          });
        }

        // Injection barrier for unattended work.
        //
        // The chat path has always refused to act on text an outsider wrote;
        // this path had no such check, so a page read in step 1 could steer a
        // write in step 4 with nobody watching. Once the run is tainted, any
        // step the policy wants a person to see is parked as an approval card
        // instead of executed. An explicit block (a DENY rule, or "never ask"
        // meeting tainted content) fails the step outright, because a card
        // would imply that approving it could lift a decision the user made.
        const { gate, reason: gateReason } = gateDispatchStep({
          tool,
          rules: policyRules,
          mode: approvalMode,
          runTainted,
          unattended: true,
        });
        if (gate === "block") {
          throw new Error(gateReason);
        }
        if (gate === "park" && existingApproval?.status !== "APPROVED") {
          if (!existingApproval) {
            await createApprovalRequest({
              taskId,
              stepId: step.id,
              stepIndex: step.stepIndex,
              proposedAction: `AwaitingApproval: ${tool.name}: ${step.title}`,
              description: `${gateReason} This task already read something written outside the CRM, so this step waits for you.`,
              payload: { toolId, arguments: toolArgs, taint: true },
              requestedById: requestingUserId,
              riskClass: tool.riskClass,
            });
          } else if (existingApproval.status !== "PENDING") {
            throw new Error(`Approval for step ${step.stepIndex} is ${existingApproval.status.toLowerCase()}.`);
          }

          await db.aiTask.update({
            where: { id: taskId },
            data: { workerId: null, leaseExpiresAt: null, status: "AWAITING_APPROVAL" },
          });
          return await db.aiTask.findUnique({
            where: { id: taskId },
            include: { steps: true, approvals: true, toolCalls: true },
          });
        }

        await transitionStepStatus(step.id, "RUNNING");
        const toolResult = await toolRegistry.executeTool(toolId, toolArgs, {
          taskId,
          stepId: step.id,
          userId: requestingUserId,
          userRole: requestingUserRole,
          agentSlug,
          idempotencyKey: stepIdempotencyKey,
          goalId: taskGoalId,
        });

        if (toolResult.requiresApproval) {
          await createApprovalRequest({
            taskId,
            stepId: step.id,
            stepIndex: step.stepIndex,
            proposedAction: `${tool.name}: ${step.title}`,
            description: toolResult.error || "The tool requested human verification before continuing.",
            payload: { toolId, arguments: toolArgs },
            requestedById: requestingUserId,
            riskClass: tool.riskClass,
          });
          await db.aiTask.update({
            where: { id: taskId },
            data: { workerId: null, leaseExpiresAt: null, status: "AWAITING_APPROVAL" },
          });
          return await db.aiTask.findUnique({
            where: { id: taskId },
            include: { steps: true, approvals: true, toolCalls: true },
          });
        }
        if (!toolResult.success) throw new Error(toolResult.error || `Tool "${toolId}" failed.`);

        // From here on this task carries text an outsider wrote, so later steps
        // are held to the stricter standard above.
        if (tool.taintsRun) runTainted = true;

        const stepResultData = { toolId, toolName: tool.name, data: toolResult.data };

        // Mark step COMPLETED
        await transitionStepStatus(step.id, "COMPLETED", {
          output: JSON.stringify(stepResultData),
        });

        stepOutputs[step.stepIndex] = stepResultData;
      } catch (stepErr: any) {
        console.error(`[Dispatcher] Step ${step.stepIndex} failed:`, stepErr);
        await transitionStepStatus(step.id, "FAILED", {
          error: stepErr?.message || "Step execution failed",
        });

        await db.aiTask.update({
          where: { id: taskId },
          data: { workerId: null, leaseExpiresAt: null },
        });

        return await transitionTaskStatus(taskId, "FAILED", {
          error: `Step ${step.stepIndex} failed: ${stepErr?.message}`,
        });
      }
    }

    // All steps completed: synthesize final result
    const currentTask = await db.aiTask.findUnique({ where: { id: taskId } });
    const isRecovered = Boolean(currentTask?.recoveryMetadata);

    const finalResult = {
      summary: `Completed ${steps.length} tool-backed step${steps.length === 1 ? "" : "s"} for: "${currentTask?.objective}".`,
      accomplished: steps.map((step) => step.title),
      wasRecovered: isRecovered,
      recoveredFromStep: isRecovered ? currentTask?.currentStepIndex : undefined,
      stepOutputs,
      completedAt: new Date().toISOString(),
    };

    // Clear worker lease and complete task
    await db.aiTask.update({
      where: { id: taskId },
      data: {
        workerId: null,
        leaseExpiresAt: null,
        completedAt: new Date(),
      },
    });

    return await transitionTaskStatus(taskId, "COMPLETED", {
      result: JSON.stringify(finalResult),
    });
  } finally {
    clearInterval(heartbeatTimer);
  }
}
