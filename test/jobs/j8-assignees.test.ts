/**
 * J8 — shared ownership, and handing work to an AI agent.
 *
 * Two things are under test, both exercised through the real route handlers with
 * a real session cookie and real Postgres writes:
 *
 *  1. A task can belong to several people at once, and to an agent.
 *  2. A teammate (MEMBER) can hand work to an agent, but the run waits in the
 *     owner's approval queue. Approving it dispatches the work with the
 *     requester's identity; rejecting it runs nothing and writes nothing.
 *
 * The second is the whole point of the feature: Akshat stops sending a message
 * and waiting, without gaining the ability to spend money or change data through
 * an agent unsupervised.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { resetDb, seedUsers, invoke, db } from "../helpers";

import { POST as createProject } from "../../src/app/api/projects/route";
import { GET as listTasks, POST as createTask } from "../../src/app/api/tasks/route";
import { PATCH as patchTask, GET as getTask } from "../../src/app/api/tasks/[id]/route";
import { POST as reviewApproval, GET as listApprovals } from "../../src/app/api/ai/approvals/route";

function created<T>(response: { status: number; body: unknown }, what: string): T {
  assert.ok(
    response.status >= 200 && response.status < 300,
    `${what} failed: ${response.status} ${JSON.stringify(response.body).slice(0, 300)}`
  );
  return response.body as T;
}

async function extraMember(name: string) {
  return db.user.create({
    data: { name, email: `${name.toLowerCase()}@test.cyraops.com`, role: "MEMBER", passwordHash: "x" },
  });
}

async function makeProject(userId: string, memberIds: string[] = []) {
  const res = await invoke(createProject, "/api/projects", {
    method: "POST",
    userId,
    body: { name: "Delivery", memberIds },
  });
  return created<{ project: { id: string } }>(res, "create project").project;
}

const ownersOf = (taskId: string) =>
  db.taskAssignee.findMany({ where: { taskId }, select: { userId: true, agentSlug: true } });

test("J8: a task can be owned by several teammates at once", async () => {
  await resetDb();
  const { owner, member } = await seedUsers();
  const third = await extraMember("rahul");
  const project = await makeProject(owner.id, [member.id, third.id]);

  const res = await invoke(createTask, "/api/tasks", {
    method: "POST",
    userId: owner.id,
    body: {
      title: "Draft the Northwind proposal",
      projectId: project.id,
      assigneeIds: [member.id, third.id],
    },
  });
  const body = created<{ task: { id: string; assignees: any[] } }>(res, "create multi-owner task");

  const owners = (await ownersOf(body.task.id)).map((row) => row.userId).sort();
  assert.deepEqual(owners, [member.id, third.id].sort(), "both teammates must own the task");

  // The legacy single-assignee field still points somewhere sensible for the
  // older readers (calendar, digests).
  const row = await db.task.findUniqueOrThrow({ where: { id: body.task.id } });
  assert.equal(row.assigneeId, member.id, "assigneeId mirrors the first human owner");

  // Both were told, the creator was not.
  assert.equal(await db.notification.count({ where: { userId: member.id, type: "TASK_ASSIGNED" } }), 1);
  assert.equal(await db.notification.count({ where: { userId: third.id, type: "TASK_ASSIGNED" } }), 1);
  assert.equal(await db.notification.count({ where: { userId: owner.id, type: "TASK_ASSIGNED" } }), 0);
});

test("J8: the board shows every owner, and the owner set can be replaced", async () => {
  await resetDb();
  const { owner, member } = await seedUsers();
  const third = await extraMember("rahul");
  const project = await makeProject(owner.id, [member.id, third.id]);

  const made = created<{ task: { id: string } }>(
    await invoke(createTask, "/api/tasks", {
      method: "POST",
      userId: owner.id,
      body: { title: "Shared work", projectId: project.id, assigneeIds: [member.id] },
    }),
    "create task"
  );

  // Handing it to a different person replaces the set rather than adding to it.
  const patched = await invoke(patchTask, `/api/tasks/${made.task.id}`, {
    method: "PATCH",
    userId: owner.id,
    params: { id: made.task.id },
    body: { assigneeIds: [third.id] },
  });
  const patchedBody = created<{ task: { assignees: Array<{ id: string; kind: string }> } }>(patched, "patch owners");

  assert.deepEqual(
    patchedBody.task.assignees.map((a) => a.id),
    [third.id],
    "the new owner set replaces the old one"
  );
  assert.deepEqual((await ownersOf(made.task.id)).map((r) => r.userId), [third.id]);

  // The list endpoint carries the owners so the board can render them without N+1.
  const list = await invoke(listTasks, `/api/tasks?projectId=${project.id}`, { userId: member.id });
  const listBody = created<{ tasks: Array<{ id: string; assignees: any[] }> }>(list, "list tasks");
  const found = listBody.tasks.find((task) => task.id === made.task.id);
  assert.ok(found, "the task is on the board");
  assert.deepEqual(found!.assignees.map((a: any) => a.id), [third.id]);

  // The person who lost the task is told about it in the activity log, and the
  // one who gained it gets a notification.
  assert.equal(await db.notification.count({ where: { userId: third.id, type: "TASK_ASSIGNED" } }), 1);
});

test("J8: a member's agent request waits for the owner instead of running", async () => {
  await resetDb();
  const { owner, member } = await seedUsers();
  const project = await makeProject(owner.id, [member.id]);

  const res = await invoke(createTask, "/api/tasks", {
    method: "POST",
    userId: member.id,
    body: {
      title: "Research Northwind before the call",
      projectId: project.id,
      agentSlugs: ["research"],
    },
  });
  const body = created<{ task: { id: string; assignees: any[] }; delegations: any[] }>(res, "member creates agent task");

  assert.equal(body.delegations.length, 1);
  assert.equal(body.delegations[0].mode, "pending_approval", "a member's request must not dispatch");
  assert.equal(body.task.assignees[0].kind, "agent", "the agent is one of the task's owners");

  // Nothing ran: there is a request task, and it is parked, not planned.
  const requestTask = await db.aiTask.findFirstOrThrow({ where: { requestingUserId: member.id } });
  assert.equal(requestTask.status, "AWAITING_APPROVAL");
  assert.equal(await db.aiTaskStep.count({ where: { taskId: requestTask.id } }), 0, "no plan was made, so nothing can run");

  // The owner was told there is something to decide.
  assert.ok(await db.notification.count({ where: { userId: owner.id } }) >= 1);

  // And a member cannot approve their own request.
  const approval = await db.aiApproval.findFirstOrThrow({ where: { status: "PENDING" } });
  const asMember = await invoke(reviewApproval, "/api/ai/approvals", {
    method: "POST",
    userId: member.id,
    body: { approvalId: approval.id, action: "APPROVED" },
  });
  assert.equal(asMember.status, 403);
  assert.equal(
    (await db.aiApproval.findUniqueOrThrow({ where: { id: approval.id } })).status,
    "PENDING",
    "the request must still be pending after a member tried to approve it"
  );

  const ownerQueue = await invoke(listApprovals, "/api/ai/approvals", { userId: owner.id });
  const queue = created<{ approvals: any[] }>(ownerQueue, "owner approval queue").approvals;
  assert.ok(queue.some((entry) => entry.id === approval.id), "the owner sees the request in the queue");
});

test("J8: approving dispatches the work under the requester's identity", async () => {
  await resetDb();
  const { owner, member } = await seedUsers();
  const project = await makeProject(owner.id, [member.id]);

  await invoke(createTask, "/api/tasks", {
    method: "POST",
    userId: member.id,
    body: { title: "Summarise our open deals", projectId: project.id, agentSlugs: ["research"] },
  });
  const approval = await db.aiApproval.findFirstOrThrow({ where: { status: "PENDING" } });

  const approved = await invoke(reviewApproval, "/api/ai/approvals", {
    method: "POST",
    userId: owner.id,
    body: { approvalId: approval.id, action: "APPROVED" },
  });
  const approvedBody = created<{ dispatched: { taskId: string } }>(approved, "owner approves");

  // The dispatched task is a *real* agent task, attributed to the teammate who
  // asked — not to the owner who approved.
  const dispatched = await db.aiTask.findUniqueOrThrow({ where: { id: approvedBody.dispatched.taskId } });
  assert.equal(dispatched.requestingUserId, member.id, "the work stays attributed to the requester");
  assert.notEqual(dispatched.id, approval.taskId, "the run is a new task, not the parked request");

  // The parked request is closed with a pointer to the run that fulfilled it.
  const request = await db.aiTask.findUniqueOrThrow({ where: { id: approval.taskId } });
  assert.equal(request.status, "COMPLETED");
  assert.match(String(request.result), new RegExp(approvedBody.dispatched.taskId));

  // The requester learns it is running.
  assert.ok(await db.notification.count({ where: { userId: member.id } }) >= 1);
});

test("J8: rejecting a request dispatches nothing", async () => {
  await resetDb();
  const { owner, member } = await seedUsers();
  const project = await makeProject(owner.id, [member.id]);

  await invoke(createTask, "/api/tasks", {
    method: "POST",
    userId: member.id,
    body: { title: "Email every stale lead", projectId: project.id, agentSlugs: ["communication"] },
  });
  const approval = await db.aiApproval.findFirstOrThrow({ where: { status: "PENDING" } });

  const rejected = await invoke(reviewApproval, "/api/ai/approvals", {
    method: "POST",
    userId: owner.id,
    body: { approvalId: approval.id, action: "REJECTED", reviewNotes: "not now" },
  });
  created(rejected, "owner rejects");

  assert.equal(await db.aiTask.count({ where: { status: "COMPLETED" } }), 0, "nothing ran");
  const request = await db.aiTask.findUniqueOrThrow({ where: { id: approval.taskId } });
  assert.equal(request.status, "CANCELLED");
});

test("J8: an owner's own agent task runs without a queue", async () => {
  await resetDb();
  const { owner } = await seedUsers();
  const project = await makeProject(owner.id);

  const res = await invoke(createTask, "/api/tasks", {
    method: "POST",
    userId: owner.id,
    body: { title: "Draft the weekly pipeline summary", projectId: project.id, agentSlugs: ["research"] },
  });
  const body = created<{ delegations: any[] }>(res, "owner creates agent task");

  assert.equal(body.delegations[0].mode, "dispatched", "an owner is not put in their own queue");
  assert.equal(await db.aiApproval.count(), 0, "no approval was created for the owner");
});

test("J8: an unknown agent is refused instead of silently creating a task nobody runs", async () => {
  await resetDb();
  const { owner } = await seedUsers();
  const project = await makeProject(owner.id);

  const res = await invoke(createTask, "/api/tasks", {
    method: "POST",
    userId: owner.id,
    body: { title: "Do something", projectId: project.id, agentSlugs: ["ghost_agent"] },
  });
  assert.equal(res.status, 400);
  assert.equal(await db.task.count(), 0, "a refused assignment must not leave a task behind");
});
