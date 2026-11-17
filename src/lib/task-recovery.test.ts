import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { db } from "./db";
import { canTransition } from "./ai/agents/lifecycle";
import { taskRunner } from "./ai/automation/task-runner";
import { agentRegistry } from "./ai/agents/agent-registry";
import { toolRegistry } from "./ai/tools/registry";
import "./ai/tools/crm-tools";

describe("Durable Task Recovery & State Machine (Fix 3)", () => {
  let testUserId: string;
  let masterAgentId: string;
  const createdTaskIds: string[] = [];

  before(async () => {
    await agentRegistry.ensureDefaultAgents();
    const user = await db.user.findFirst();
    if (!user) throw new Error("No user found in dev database");
    testUserId = user.id;

    const agent = await agentRegistry.getMasterAgent();
    if (!agent) throw new Error("No master agent found");
    masterAgentId = agent.id;
  });

  after(async () => {
    // Clean up test tasks
    for (const taskId of createdTaskIds) {
      await db.aiToolCall.deleteMany({ where: { taskId } }).catch(() => {});
      await db.aiTaskStep.deleteMany({ where: { taskId } }).catch(() => {});
      await db.aiApproval.deleteMany({ where: { taskId } }).catch(() => {});
      await db.aiTask.delete({ where: { id: taskId } }).catch(() => {});
    }
  });

  it("supports RECOVERING state in task lifecycle state machine", () => {
    // From RUNNING into RECOVERING
    assert.equal(canTransition("RUNNING", "RECOVERING"), true);
    // From RECOVERING into RUNNING (resuming execution)
    assert.equal(canTransition("RECOVERING", "RUNNING"), true);
    // From RECOVERING into FAILED (exhausted retries)
    assert.equal(canTransition("RECOVERING", "FAILED"), true);
    // Terminal states cannot transition to RECOVERING
    assert.equal(canTransition("COMPLETED", "RECOVERING"), false);
    assert.equal(canTransition("CANCELLED", "RECOVERING"), false);
  });

  it("detects expired worker leases and transitions tasks to RECOVERING", async () => {
    // Create task simulating a crashed worker with an expired lease
    const expiredTask = await db.aiTask.create({
      data: {
        objective: "Test orphan recovery sweep",
        prompt: "Recover after simulated crash",
        assignedAgentId: masterAgentId,
        requestingUserId: testUserId,
        status: "RUNNING",
        workerId: "crashed-worker-pid-9999",
        leaseExpiresAt: new Date(Date.now() - 60000), // Expired 1 min ago
        lastHeartbeat: new Date(Date.now() - 60000),
        currentStepIndex: 2,
        retryCount: 0,
        maxRetries: 3,
      },
    });
    createdTaskIds.push(expiredTask.id);

    // Create steps
    await db.aiTaskStep.create({
      data: {
        taskId: expiredTask.id,
        stepIndex: 1,
        title: "Step 1 - Completed",
        status: "COMPLETED",
        output: JSON.stringify({ done: true }),
      },
    });

    await db.aiTaskStep.create({
      data: {
        taskId: expiredTask.id,
        stepIndex: 2,
        title: "Step 2 - In Flight",
        status: "RUNNING",
      },
    });

    // Run startup recovery sweep
    const recoveredCount = await taskRunner.recoverOrphanedTasks();
    assert.ok(recoveredCount >= 1, "Should recover at least 1 orphaned task");

    // Re-check task status
    const updated = await db.aiTask.findUnique({ where: { id: expiredTask.id } });
    assert.ok(updated);
    assert.equal(updated.retryCount, 1);
    assert.ok(updated.recoveryMetadata, "Should populate recovery metadata");

    const metadata = JSON.parse(updated.recoveryMetadata || "{}");
    assert.equal(metadata.resumedStepIndex, 2);
    assert.match(metadata.reason, /durable recovery/i);
  });

  it("preserves AWAITING_APPROVAL state across restart and recovery sweep", async () => {
    // Create task awaiting approval
    const approvalTask = await db.aiTask.create({
      data: {
        objective: "Test approval state preservation",
        prompt: "Approval test",
        assignedAgentId: masterAgentId,
        requestingUserId: testUserId,
        status: "AWAITING_APPROVAL",
        leaseExpiresAt: new Date(Date.now() - 60000),
      },
    });
    createdTaskIds.push(approvalTask.id);

    // Create approval record
    const approval = await db.aiApproval.create({
      data: {
        taskId: approvalTask.id,
        riskClass: "CLASS_C",
        proposedAction: "Delete records",
        description: "Test deletion approval",
        status: "PENDING",
        requestedById: testUserId,
      },
    });

    // Run recovery sweep
    await taskRunner.recoverOrphanedTasks();

    // Check task remains in AWAITING_APPROVAL
    const reloaded = await db.aiTask.findUnique({
      where: { id: approvalTask.id },
      include: { approvals: true },
    });
    assert.ok(reloaded);
    assert.equal(reloaded.status, "AWAITING_APPROVAL");
    assert.equal(reloaded.approvals[0].status, "PENDING");
  });

  it("enforces idempotency and prevents duplicate tool execution during recovery", async () => {
    const parentTask = await db.aiTask.create({
      data: {
        objective: "Test idempotency",
        prompt: "Run lead creation once",
        assignedAgentId: masterAgentId,
        requestingUserId: testUserId,
        status: "RUNNING",
      },
    });
    createdTaskIds.push(parentTask.id);

    const taskId = parentTask.id;
    const idempotencyKey = `${taskId}-step-1-create_lead`;

    // Simulate pre-existing completed tool execution
    await db.aiToolCall.create({
      data: {
        taskId,
        toolId: "create_lead",
        toolName: "Create Lead Record",
        idempotencyKey,
        input: JSON.stringify({ name: "Acme Corp", email: "test@acme.com" }),
        output: JSON.stringify({ leadId: "lead-abc-123", created: true }),
        status: "SUCCESS",
      },
    });

    // Attempt second execution with same idempotencyKey
    const secondExecution = await toolRegistry.executeTool(
      "create_lead",
      { name: "Acme Corp", email: "test@acme.com" },
      {
        taskId,
        userId: testUserId,
        idempotencyKey,
      }
    );

    assert.equal(secondExecution.success, true);
    // Should reuse the cached output rather than generating duplicate lead
    assert.deepEqual(secondExecution.data, { leadId: "lead-abc-123", created: true });

    // Verify only ONE tool call record exists in DB
    const calls = await db.aiToolCall.findMany({
      where: { taskId, idempotencyKey },
    });
    assert.equal(calls.length, 1, "Must not create duplicate tool calls");

    // Clean up
    await db.aiToolCall.deleteMany({ where: { taskId } });
  });

  it("marks task FAILED when max retries are exceeded during recovery", async () => {
    const maxRetryTask = await db.aiTask.create({
      data: {
        objective: "Test max retries guard",
        prompt: "Exhausted retries",
        assignedAgentId: masterAgentId,
        requestingUserId: testUserId,
        status: "RUNNING",
        leaseExpiresAt: new Date(Date.now() - 60000),
        lastHeartbeat: new Date(Date.now() - 60000),
        retryCount: 3,
        maxRetries: 3, // Already at max
      },
    });
    createdTaskIds.push(maxRetryTask.id);

    await taskRunner.recoverOrphanedTasks();

    const failed = await db.aiTask.findUnique({ where: { id: maxRetryTask.id } });
    assert.ok(failed);
    assert.equal(failed.status, "FAILED");
    assert.match(failed.error || "", /Exceeded max retries/i);
  });
});
