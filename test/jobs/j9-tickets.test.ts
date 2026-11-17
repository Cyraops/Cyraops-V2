/**
 * J9 — tickets from a sentence.
 *
 * The bar this feature has to clear: a teammate types one line in chat and a
 * ticket exists, on the right desk. These tests drive the real handler with a
 * real session cookie and read the result back from Postgres.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { resetDb, seedUsers, invoke, db } from "../helpers";
import { GET as listTickets, POST as createTicket } from "../../src/app/api/tickets/route";

test("J9: a mention in a message creates a ticket for that teammate", async () => {
  await resetDb();
  const { owner, member } = await seedUsers();

  const res = await invoke(createTicket, "/api/tickets", {
    method: "POST",
    userId: owner.id,
    body: { text: "@tasks Call Northwind back about the renewal @Akshat" },
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const body = res.body as any;

  assert.equal(body.ticket.title, "Call Northwind back about the renewal");
  const task = await db.task.findUniqueOrThrow({ where: { id: body.ticket.id } });
  assert.equal(task.status, "TODO");
  assert.equal(task.creatorId, owner.id);

  const owners = await db.taskAssignee.findMany({ where: { taskId: task.id }, select: { userId: true } });
  assert.deepEqual(owners.map((row) => row.userId), [member.id], "the ticket lands on the person named");

  // A ticket nobody is told about is a ticket nobody works.
  const notified = await db.notification.findFirst({
    where: { userId: member.id, type: "TASK_ASSIGNED" },
  });
  assert.ok(notified, "the assignee is notified");
  assert.match(notified!.title, /assigned you a ticket/i);

  // It lives somewhere the board can show it.
  const project = await db.project.findUniqueOrThrow({ where: { id: task.projectId } });
  assert.equal(project.name, "Tasks");
});

test("J9: one message can create a ticket for a person and an agent", async () => {
  await resetDb();
  const { owner, member } = await seedUsers();

  const res = await invoke(createTicket, "/api/tickets", {
    method: "POST",
    userId: owner.id,
    body: { text: "@tasks Prepare the Northwind pitch @Akshat @research" },
  });
  const body = res.body as any;
  assert.equal(res.status, 201, JSON.stringify(body));

  const owners = await db.taskAssignee.findMany({ where: { taskId: body.ticket.id } });
  assert.deepEqual(
    owners.map((row) => (row.userId ? `user:${row.userId}` : `agent:${row.agentSlug}`)).sort(),
    [`agent:research`, `user:${member.id}`].sort()
  );

  // The owner asked, so the agent started immediately.
  assert.equal(body.ticket.awaitingApproval.length, 0);
  const agentTask = await db.aiTask.findFirstOrThrow({ where: { requestingUserId: owner.id } });
  assert.equal(agentTask.assignedAgentId.length > 0, true);
});

test("J9: a member's agent ticket waits for approval, exactly like the board", async () => {
  await resetDb();
  const { member } = await seedUsers();

  const res = await invoke(createTicket, "/api/tickets", {
    method: "POST",
    userId: member.id,
    body: { text: "@tasks Research Northwind's tech stack @research" },
  });
  const body = res.body as any;
  assert.equal(res.status, 201, JSON.stringify(body));
  assert.deepEqual(body.ticket.awaitingApproval, ["research"], "the response says it is waiting");

  const approval = await db.aiApproval.findFirstOrThrow({ where: { status: "PENDING" } });
  assert.equal(approval.requestedById, member.id);
  assert.match(approval.proposedAction, /Northwind/);

  // The ticket itself still exists and is owned by the agent.
  const owners = await db.taskAssignee.findMany({ where: { taskId: body.ticket.id } });
  assert.deepEqual(owners.map((row) => row.agentSlug), ["research"]);
});

test("J9: an instruction with no name becomes the writer's own ticket", async () => {
  await resetDb();
  const { member } = await seedUsers();

  const res = await invoke(createTicket, "/api/tickets", {
    method: "POST",
    userId: member.id,
    body: { text: "@tasks Reorder the onboarding checklist" },
  });
  const body = res.body as any;
  assert.equal(body.ticket.id.length > 0, true);

  const owners = await db.taskAssignee.findMany({ where: { taskId: body.ticket.id } });
  assert.deepEqual(owners.map((row) => row.userId), [member.id], "it lands on the person who wrote it");
});

test("J9: a name it cannot match is reported, not silently assigned elsewhere", async () => {
  await resetDb();
  const { owner } = await seedUsers();

  const res = await invoke(createTicket, "/api/tickets", {
    method: "POST",
    userId: owner.id,
    body: { text: "@tasks Send the deck @priya" },
  });
  const body = res.body as any;

  assert.deepEqual(body.parsed.unmatched, ["@priya"]);
  const owners = await db.taskAssignee.findMany({ where: { taskId: body.ticket.id } });
  assert.deepEqual(owners.map((row) => row.userId), [owner.id], "an unknown name does not become a guess");
});

test("J9: a message without the trigger creates nothing", async () => {
  await resetDb();
  const { owner } = await seedUsers();

  const res = await invoke(createTicket, "/api/tickets", {
    method: "POST",
    userId: owner.id,
    body: { text: "what is our pipeline looking like?" },
  });
  assert.equal(res.status, 200);
  assert.equal((res.body as any).ok, false);
  assert.equal((res.body as any).reason, "no_trigger");
  assert.equal(await db.task.count(), 0, "chat is not a ticket");
});

test("J9: the Tasks list shows every ticket with its owners, newest first", async () => {
  await resetDb();
  const { owner, member } = await seedUsers();

  await invoke(createTicket, "/api/tickets", {
    method: "POST",
    userId: owner.id,
    body: { text: "@tasks First ticket @Akshat" },
  });
  await invoke(createTicket, "/api/tickets", {
    method: "POST",
    userId: owner.id,
    body: { text: "@tasks Second ticket @research" },
  });

  const list = await invoke(listTickets, "/api/tickets", { userId: member.id });
  assert.equal(list.status, 200);
  const tickets = (list.body as any).tickets as any[];
  assert.equal(tickets.length, 2);
  assert.equal(tickets[0].title, "Second ticket", "newest first");
  assert.deepEqual(tickets[0].assignees.map((a: any) => a.kind), ["agent"]);
  assert.deepEqual(tickets[1].assignees.map((a: any) => a.kind), ["user"]);
  // Members can see the shared board.
  assert.equal(tickets[1].assignees[0].name.length > 0, true);
});
