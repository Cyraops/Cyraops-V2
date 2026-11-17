/**
 * J13 — triage is a desk permission, not a project permission.
 *
 * The bug this locks down: a member saw a ticket in the queue and every action
 * on it returned 404 "Task not found", because PATCH /api/tasks/:id is scoped to
 * project membership while the queue lists every ticket. A shared queue where
 * only some rows can be touched is worse than no queue.
 *
 * The desk endpoint owns triage. Structural edits stay on the project-scoped
 * route, so this must not become a way to rename or move someone's task.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { resetDb, seedUsers, invoke, db } from "../helpers";
import { PATCH as triage, GET as readTicket } from "../../src/app/api/tickets/[id]/route";
import { POST as addNote } from "../../src/app/api/tickets/[id]/comments/route";
import { PATCH as patchTask } from "../../src/app/api/tasks/[id]/route";

/** A ticket in a project the member does not belong to — the exact reproduction. */
async function foreignTicket() {
  const { owner, member } = await seedUsers();
  const project = await db.project.create({ data: { name: "Not hers", ownerId: owner.id } });
  const ticket = await db.task.create({
    data: { title: "ALARM: S3 bucket policy changes", projectId: project.id, creatorId: owner.id, status: "TODO", priority: "LOW" },
  });
  return { owner, member, project, ticket };
}

test("J13: a member can triage a ticket outside their projects", async () => {
  await resetDb();
  const { member, ticket } = await foreignTicket();

  const res = await invoke(triage, `/api/tickets/${ticket.id}`, {
    method: "PATCH",
    userId: member.id,
    params: { id: ticket.id },
    body: { status: "IN_PROGRESS", priority: "HIGH", type: "INCIDENT", source: "EMAIL", groupName: "ANZ_Wintel", category: "Cloud alarm" },
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));

  const stored = await db.task.findUniqueOrThrow({ where: { id: ticket.id } });
  assert.equal(stored.status, "IN_PROGRESS");
  assert.equal(stored.priority, "HIGH");
  assert.equal(stored.type, "INCIDENT");
  assert.equal(stored.source, "EMAIL");
  assert.equal(stored.groupName, "ANZ_Wintel");
  assert.equal(stored.category, "Cloud alarm");
});

test("J13: a member can assign a ticket to any active teammate", async () => {
  await resetDb();
  const { owner, member, ticket } = await foreignTicket();

  const res = await invoke(triage, `/api/tickets/${ticket.id}`, {
    method: "PATCH",
    userId: member.id,
    params: { id: ticket.id },
    body: { assigneeIds: [owner.id] },
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));

  const assignees = await db.taskAssignee.findMany({ where: { taskId: ticket.id } });
  assert.ok(assignees.some((a) => a.userId === owner.id), "the owner should be an assignee");
});

test("J13: an unknown teammate cannot be assigned", async () => {
  await resetDb();
  const { member, ticket } = await foreignTicket();

  const res = await invoke(triage, `/api/tickets/${ticket.id}`, {
    method: "PATCH",
    userId: member.id,
    params: { id: ticket.id },
    body: { assigneeIds: ["not-a-real-user"] },
  });
  assert.equal(res.status, 400);
});

test("J13: closing stamps the time, reopening clears it", async () => {
  await resetDb();
  const { member, ticket } = await foreignTicket();

  await invoke(triage, `/api/tickets/${ticket.id}`, {
    method: "PATCH",
    userId: member.id,
    params: { id: ticket.id },
    body: { status: "DONE", resolution: "Rotated the bucket policy." },
  });
  const closed = await db.task.findUniqueOrThrow({ where: { id: ticket.id } });
  assert.equal(closed.status, "DONE");
  assert.ok(closed.closedAt instanceof Date);
  assert.equal(closed.resolution, "Rotated the bucket policy.");

  await invoke(triage, `/api/tickets/${ticket.id}`, {
    method: "PATCH",
    userId: member.id,
    params: { id: ticket.id },
    body: { status: "TODO" },
  });
  assert.equal((await db.task.findUniqueOrThrow({ where: { id: ticket.id } })).closedAt, null);
});

test("J13: the desk can correct the subject and description", async () => {
  await resetDb();
  const { member, ticket } = await foreignTicket();

  const res = await invoke(triage, `/api/tickets/${ticket.id}`, {
    method: "PATCH",
    userId: member.id,
    params: { id: ticket.id },
    body: { title: "ALARM: S3 bucket policy changes (Sydney)", description: "Requester pasted the CloudWatch email." },
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));

  const stored = await db.task.findUniqueOrThrow({ where: { id: ticket.id } });
  assert.equal(stored.title, "ALARM: S3 bucket policy changes (Sydney)");
  assert.equal(stored.description, "Requester pasted the CloudWatch email.");
});

test("J13: an empty subject is refused", async () => {
  await resetDb();
  const { member, ticket } = await foreignTicket();
  const res = await invoke(triage, `/api/tickets/${ticket.id}`, {
    method: "PATCH",
    userId: member.id,
    params: { id: ticket.id },
    body: { title: "   " },
  });
  assert.equal(res.status, 400);
  assert.equal((await db.task.findUniqueOrThrow({ where: { id: ticket.id } })).title, "ALARM: S3 bucket policy changes");
});

test("J13: the desk can file a ticket into another project", async () => {
  await resetDb();
  const { owner, member, ticket } = await foreignTicket();
  const target = await db.project.create({ data: { name: "Support inbox", ownerId: owner.id } });

  const res = await invoke(triage, `/api/tickets/${ticket.id}`, {
    method: "PATCH",
    userId: member.id,
    params: { id: ticket.id },
    body: { projectId: target.id },
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal((await db.task.findUniqueOrThrow({ where: { id: ticket.id } })).projectId, target.id);
});

test("J13: filing into a project that does not exist is refused", async () => {
  await resetDb();
  const { member, ticket } = await foreignTicket();
  const res = await invoke(triage, `/api/tickets/${ticket.id}`, {
    method: "PATCH",
    userId: member.id,
    params: { id: ticket.id },
    body: { projectId: "no-such-project" },
  });
  assert.equal(res.status, 400);
});

test("J13: the desk cannot archive a ticket", async () => {
  await resetDb();
  const { member, project, ticket } = await foreignTicket();
  const other = await db.project.create({ data: { name: "Elsewhere", ownerId: (await db.user.findFirstOrThrow({ where: { role: "OWNER" } })).id } });

  const res = await invoke(triage, `/api/tickets/${ticket.id}`, {
    method: "PATCH",
    userId: member.id,
    params: { id: ticket.id },
    body: { archive: true },
  });
  // Unknown keys are stripped: this is a no-op, not an archive.
  assert.ok([200, 400].includes(res.status));

  const stored = await db.task.findUniqueOrThrow({ where: { id: ticket.id } });
  assert.equal(stored.projectId, project.id);
  assert.equal(stored.archivedAt, null);
});

test("J13: the project route still refuses a member who is not in the project", async () => {
  await resetDb();
  const { member, ticket } = await foreignTicket();

  const res = await invoke(patchTask, `/api/tasks/${ticket.id}`, {
    method: "PATCH",
    userId: member.id,
    params: { id: ticket.id },
    body: { status: "DONE" },
  });
  assert.equal(res.status, 404, "project tasks stay project-scoped");
});

test("J13: a note can be added by any teammate, and is kept with the ticket", async () => {
  await resetDb();
  const { member, ticket } = await foreignTicket();

  const res = await invoke(addNote, `/api/tickets/${ticket.id}/comments`, {
    method: "POST",
    userId: member.id,
    params: { id: ticket.id },
    body: { body: "Checked with the client — firmware update caused it." },
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const notes = await db.taskComment.findMany({ where: { taskId: ticket.id } });
  assert.equal(notes.length, 1);
  assert.match(notes[0].body, /firmware/);
});

test("J13: an empty note is refused", async () => {
  await resetDb();
  const { member, ticket } = await foreignTicket();
  const res = await invoke(addNote, `/api/tickets/${ticket.id}/comments`, {
    method: "POST",
    userId: member.id,
    params: { id: ticket.id },
    body: { body: "   " },
  });
  assert.equal(res.status, 400);
});

test("J13: anonymous triage and notes are refused", async () => {
  await resetDb();
  const { ticket } = await foreignTicket();

  const triaged = await invoke(triage, `/api/tickets/${ticket.id}`, { method: "PATCH", params: { id: ticket.id }, body: { priority: "URGENT" } });
  assert.equal(triaged.status, 401);
  const noted = await invoke(addNote, `/api/tickets/${ticket.id}/comments`, { method: "POST", params: { id: ticket.id }, body: { body: "hi" } });
  assert.equal(noted.status, 401);
});

test("J13: a missing ticket is a 404, and an invalid value is a 400", async () => {
  await resetDb();
  const { member, ticket } = await foreignTicket();

  const missing = await invoke(triage, "/api/tickets/nope", { method: "PATCH", userId: member.id, params: { id: "nope" }, body: { priority: "LOW" } });
  assert.equal(missing.status, 404);

  const invalid = await invoke(triage, `/api/tickets/${ticket.id}`, {
    method: "PATCH",
    userId: member.id,
    params: { id: ticket.id },
    body: { priority: "WHENEVER" },
  });
  assert.equal(invalid.status, 400);
});

test("J13: reading a ticket returns it with its assignees", async () => {
  await resetDb();
  const { member, ticket } = await foreignTicket();

  const res = await invoke(readTicket, `/api/tickets/${ticket.id}`, { method: "GET", userId: member.id, params: { id: ticket.id } });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const task = (res.body as any).task;
  assert.equal(task.id, ticket.id);
  assert.ok(Array.isArray(task.assignees));
});
