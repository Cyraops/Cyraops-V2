/**
 * J5 — the unattended injection barrier.
 *
 * These tests drive the real dispatcher against a real database with real
 * registered tools. No planner and no language model are involved: the task and
 * its steps are inserted exactly as the planner would leave them, then
 * `executeTaskSteps` is called the same way the worker calls it.
 *
 * The case that matters: step 1 reads something written outside the CRM, and
 * step 2 would write to the CRM. Before the barrier, step 2 ran silently — which
 * is precisely how an injected web page turns into a poisoned lead record.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { db, resetDb, seedUsers } from "../helpers";
import { executeTaskSteps } from "@/lib/ai/orchestrator/dispatcher";
import { reviewApproval } from "@/lib/ai/orchestrator/approval";

/** An agent allowed to use exactly the tools a test names. */
async function makeAgent(slug: string, tools: string[]) {
  return db.aiAgent.create({
    data: {
      slug,
      name: `Test Agent ${slug}`,
      role: "Tester",
      description: "Fixture agent",
      systemPrompt: "You are a fixture.",
      status: "ACTIVE",
      tools: JSON.stringify(tools),
    },
  });
}

/**
 * Builds a task with one step per entry, shaped like a planned task.
 * Steps are inserted READY because the planner hands the dispatcher ready work.
 */
async function makeTask(input: {
  agentSlug: string;
  userId: string;
  steps: Array<{ toolId: string; title: string; args?: Record<string, unknown> }>;
}) {
  const agent = await db.aiAgent.findUniqueOrThrow({ where: { slug: input.agentSlug } });
  const task = await db.aiTask.create({
    data: {
      objective: "Fixture objective",
      prompt: "Fixture prompt",
      assignedAgentId: agent.id,
      requestingUserId: input.userId,
      status: "RUNNING",
    },
  });
  for (const [index, step] of input.steps.entries()) {
    await db.aiTaskStep.create({
      data: {
        taskId: task.id,
        stepIndex: index,
        title: step.title,
        description: step.title,
        assignedAgentSlug: input.agentSlug,
        status: "READY",
        input: JSON.stringify({ toolId: step.toolId, arguments: step.args ?? {} }),
      },
    });
  }
  return task;
}

const leadCount = () => db.lead.count();

test("J5: a write after an untrusted read parks for approval instead of running", async () => {
  await resetDb();
  const { owner } = await seedUsers();
  await makeAgent("taint_reader", ["search_documents", "create_lead"]);

  const task = await makeTask({
    agentSlug: "taint_reader",
    userId: owner.id,
    steps: [
      // search_documents is a real tool that returns document text — the kind of
      // content an outsider controls.
      { toolId: "search_documents", title: "Search workspace documents", args: { query: "invoice" } },
      {
        toolId: "create_lead",
        title: "Create lead from findings",
        args: { title: "Injected Person", companyName: "Injected Co" },
      },
    ],
  });

  const finished = await executeTaskSteps(task.id, owner.id);

  assert.equal(finished?.status, "AWAITING_APPROVAL", "the task must wait for a person");
  const steps = await db.aiTaskStep.findMany({ where: { taskId: task.id }, orderBy: { stepIndex: "asc" } });
  assert.equal(steps[0].status, "COMPLETED", "the read itself is allowed");
  assert.equal(steps[1].status, "AWAITING_APPROVAL", "the write must not run unattended");
  assert.ok(steps[1].approvalId, "the write must be attached to an approval request");

  const approval = await db.aiApproval.findUniqueOrThrow({ where: { id: steps[1].approvalId! } });
  assert.equal(approval.status, "PENDING");
  assert.match(approval.proposedAction, /AwaitingApproval/);
  assert.match(approval.description, /outside the CRM/i);

  // The point of the barrier: nothing was written.
  assert.equal(await leadCount(), 0, "no lead may be created while the step waits");
});

test("J5: a clean task is not slowed down by the barrier", async () => {
  await resetDb();
  const { owner } = await seedUsers();
  await makeAgent("clean_writer", ["create_lead"]);

  const task = await makeTask({
    agentSlug: "clean_writer",
    userId: owner.id,
    steps: [{ toolId: "create_lead", title: "Create a lead", args: { title: "Real Person", companyName: "Real Co", email: "real@real.co" } }],
  });

  const finished = await executeTaskSteps(task.id, owner.id);
  assert.equal(finished?.status, "COMPLETED");
  assert.equal(await leadCount(), 1);
});

test("J5: approving the parked step lets exactly that step run once", async () => {
  await resetDb();
  const { owner } = await seedUsers();
  await makeAgent("taint_approve", ["search_documents", "create_lead"]);

  const task = await makeTask({
    agentSlug: "taint_approve",
    userId: owner.id,
    steps: [
      { toolId: "search_documents", title: "Search documents", args: { query: "note" } },
      { toolId: "create_lead", title: "Create lead", args: { title: "Approved Person", email: "approved@real.co" } },
    ],
  });

  const parked = await executeTaskSteps(task.id, owner.id);
  assert.equal(parked?.status, "AWAITING_APPROVAL");
  const step = await db.aiTaskStep.findFirstOrThrow({ where: { taskId: task.id, stepIndex: 1 } });

  await reviewApproval(step.approvalId!, owner.id, "APPROVED");

  const resumed = await executeTaskSteps(task.id, owner.id);
  assert.equal(resumed?.status, "COMPLETED", "the approved step must finish the task");
  assert.equal(await leadCount(), 1, "the approved write happens exactly once");

  // Re-running the finished task must not duplicate the write.
  await executeTaskSteps(task.id, owner.id);
  assert.equal(await leadCount(), 1, "an idempotent re-run must not double-write");
});

test("J5: a rejected taint approval cancels the task and writes nothing", async () => {
  await resetDb();
  const { owner } = await seedUsers();
  await makeAgent("taint_reject", ["search_documents", "create_lead"]);

  const task = await makeTask({
    agentSlug: "taint_reject",
    userId: owner.id,
    steps: [
      { toolId: "search_documents", title: "Search documents", args: { query: "x" } },
      { toolId: "create_lead", title: "Create lead", args: { title: "Should Not Exist", email: "nope@real.co" } },
    ],
  });

  await executeTaskSteps(task.id, owner.id);
  const step = await db.aiTaskStep.findFirstOrThrow({ where: { taskId: task.id, stepIndex: 1 } });
  await reviewApproval(step.approvalId!, owner.id, "REJECTED", "injected content");

  const after = await db.aiTask.findUniqueOrThrow({ where: { id: task.id } });
  assert.equal(after.status, "CANCELLED");
  assert.equal(await leadCount(), 0);
});

test("J5: a deny rule blocks the step outright instead of offering a card", async () => {
  await resetDb();
  const { owner } = await seedUsers();
  await makeAgent("taint_deny", ["search_documents", "create_lead"]);

  const assistant = await db.assistant.create({
    data: { userId: owner.id, name: "Owner Assistant", approvalMode: "ASK" },
  });
  await db.assistantApprovalRule.create({
    data: { assistantId: assistant.id, toolName: "create_lead", effect: "DENY" },
  });

  const task = await makeTask({
    agentSlug: "taint_deny",
    userId: owner.id,
    steps: [
      { toolId: "search_documents", title: "Search documents", args: { query: "y" } },
      { toolId: "create_lead", title: "Create lead", args: { title: "Blocked Person", email: "blocked@real.co" } },
    ],
  });

  const finished = await executeTaskSteps(task.id, owner.id);
  assert.equal(finished?.status, "FAILED", "a blocked tool must fail the step, not wait");
  assert.match(finished?.error ?? "", /blocked/i);
  assert.equal(await db.aiApproval.count({ where: { taskId: task.id } }), 0, "a block is not a card");
  assert.equal(await leadCount(), 0);
});

test("J5: taint survives a worker restart because it is rebuilt from tool calls", async () => {
  await resetDb();
  const { owner } = await seedUsers();
  const agent = await makeAgent("taint_restart", ["search_documents", "create_lead"]);

  const task = await db.aiTask.create({
    data: {
      objective: "Restart fixture",
      prompt: "x",
      assignedAgentId: agent.id,
      requestingUserId: owner.id,
      status: "RUNNING",
    },
  });
  // Step 0 already ran in a previous worker lifetime; only the write is left.
  await db.aiTaskStep.create({
    data: {
      taskId: task.id,
      stepIndex: 0,
      title: "Search documents",
      assignedAgentSlug: "taint_restart",
      status: "COMPLETED",
      input: JSON.stringify({ toolId: "search_documents", arguments: { query: "z" } }),
    },
  });
  await db.aiTaskStep.create({
    data: {
      taskId: task.id,
      stepIndex: 1,
      title: "Create lead",
      assignedAgentSlug: "taint_restart",
      status: "READY",
      input: JSON.stringify({ toolId: "create_lead", arguments: { title: "Restart Person", email: "restart@real.co" } }),
    },
  });
  // The durable record of the read: an in-process flag would have been lost when
  // the container restarted, and the write below would have run unattended.
  await db.aiToolCall.create({
    data: {
      taskId: task.id,
      stepId: (await db.aiTaskStep.findFirstOrThrow({ where: { taskId: task.id, stepIndex: 0 } })).id,
      toolId: "search_documents",
      toolName: "Search Workspace Documents",
      input: "{}",
      output: "{}",
      status: "SUCCESS",
    },
  });

  const finished = await executeTaskSteps(task.id, owner.id);
  assert.equal(finished?.status, "AWAITING_APPROVAL");
  assert.equal(await leadCount(), 0);
});

test("J5: an owner's background task can read revenue reports", async () => {
  await resetDb();
  const { owner, member } = await seedUsers();
  await makeAgent("report_reader", ["get_sales_report"]);

  // The dispatcher must supply the requester's role. It used to omit it, so the
  // owner's own agent was told "Owners and Admins only".
  const ownerTask = await makeTask({
    agentSlug: "report_reader",
    userId: owner.id,
    steps: [{ toolId: "get_sales_report", title: "Read revenue" }],
  });
  const ownerRun = await executeTaskSteps(ownerTask.id, owner.id);
  assert.equal(ownerRun?.status, "COMPLETED", ownerRun?.error ?? "owner task should read revenue");

  const memberTask = await makeTask({
    agentSlug: "report_reader",
    userId: member.id,
    steps: [{ toolId: "get_sales_report", title: "Read revenue" }],
  });
  const memberRun = await executeTaskSteps(memberTask.id, member.id);
  assert.equal(memberRun?.status, "FAILED", "a member's task must not read revenue");
});
