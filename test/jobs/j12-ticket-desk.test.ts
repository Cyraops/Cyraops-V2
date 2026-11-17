/**
 * J12 — a task worked as a ticket.
 *
 * The user's ticket format has properties a service desk shows: requester,
 * source, type, group, category, a number, and a resolution kept apart from the
 * description. These tests hold that shape in place, and the two behaviours that
 * are easy to get wrong: the number is unique, and closing records when.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { resetDb, seedUsers, invoke, db } from "../helpers";
import { POST as createTask } from "../../src/app/api/tasks/route";
import { PATCH as patchTask } from "../../src/app/api/tasks/[id]/route";
import { GET as listTickets } from "../../src/app/api/tickets/route";
import { POST as createTicket } from "../../src/app/api/tickets/route";

async function project(userId: string) {
  return db.project.create({ data: { name: "Desk", ownerId: userId } });
}

test("J12: a ticket stores requester, source, type, group and category", async () => {
  await resetDb();
  const { owner } = await seedUsers();
  const p = await project(owner.id);

  const res = await invoke(createTask, "/api/tasks", {
    method: "POST",
    userId: owner.id,
    body: {
      title: "ALARM: S3 bucket policy changes in Asia Pacific",
      projectId: p.id,
      source: "EMAIL",
      type: "INCIDENT",
      groupName: "ANZ_Wintel",
      category: "Cloud alarm",
      requesterName: "cis-alarm",
      requesterEmail: "healthrfidsrq@itcinfotech.com",
      priority: "LOW",
    },
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const stored = await db.task.findUniqueOrThrow({ where: { id: (res.body as any).task.id } });
  assert.equal(stored.source, "EMAIL");
  assert.equal(stored.type, "INCIDENT");
  assert.equal(stored.groupName, "ANZ_Wintel");
  assert.equal(stored.category, "Cloud alarm");
  assert.equal(stored.requesterName, "cis-alarm");
  assert.equal(stored.requesterEmail, "healthrfidsrq@itcinfotech.com");
  assert.equal(stored.priority, "LOW");
});

test("J12: every ticket gets its own number", async () => {
  await resetDb();
  const { owner } = await seedUsers();
  const p = await project(owner.id);

  const numbers: number[] = [];
  for (let i = 0; i < 3; i += 1) {
    const res = await invoke(createTask, "/api/tasks", {
      method: "POST",
      userId: owner.id,
      body: { title: `Ticket ${i}`, projectId: p.id },
    });
    assert.equal(res.status, 201);
    numbers.push((await db.task.findUniqueOrThrow({ where: { id: (res.body as any).task.id } })).number);
  }
  assert.equal(new Set(numbers).size, 3, "numbers must not collide");
  assert.ok(numbers.every((n) => Number.isInteger(n) && n > 0));
});

test("J12: closing records the time, reopening clears it", async () => {
  await resetDb();
  const { owner } = await seedUsers();
  const p = await project(owner.id);
  const created = await invoke(createTask, "/api/tasks", {
    method: "POST",
    userId: owner.id,
    body: { title: "Broken alarm", projectId: p.id, resolution: "Rotated the bucket policy." },
  });
  const id = (created.body as any).task.id;

  const closed = await invoke(patchTask, `/api/tasks/${id}`, { method: "PATCH", userId: owner.id, params: { id }, body: { status: "DONE" } });
  assert.equal(closed.status, 200, JSON.stringify(closed.body));
  const closedRow = await db.task.findUniqueOrThrow({ where: { id } });
  assert.equal(closedRow.status, "DONE");
  assert.ok(closedRow.closedAt instanceof Date, "closedAt must be stamped");
  assert.equal(closedRow.resolution, "Rotated the bucket policy.");

  const reopened = await invoke(patchTask, `/api/tasks/${id}`, { method: "PATCH", userId: owner.id, params: { id }, body: { status: "IN_PROGRESS" } });
  assert.equal(reopened.status, 200);
  assert.equal((await db.task.findUniqueOrThrow({ where: { id } })).closedAt, null);
});

test("J12: the ticket list carries the properties the desk shows", async () => {
  await resetDb();
  const { owner } = await seedUsers();
  await invoke(createTicket, "/api/tickets", {
    method: "POST",
    userId: owner.id,
    body: { text: "@tasks Check the renewal date" },
  });

  const res = await invoke(listTickets, "/api/tickets", { method: "GET", userId: owner.id });
  assert.equal(res.status, 200);
  const row = (res.body as any).tickets[0];
  assert.ok(row, "a ticket should be listed");
  assert.equal(typeof row.number, "number");
  assert.equal(row.source, "CHAT", "a ticket written in chat records its source");
  assert.equal(row.type, "SERVICE_REQUEST");
  assert.equal(typeof row.resolution, "string");
});

test("J12: an invalid source or type is refused, not stored", async () => {
  await resetDb();
  const { owner } = await seedUsers();
  const p = await project(owner.id);

  const badSource = await invoke(createTask, "/api/tasks", {
    method: "POST",
    userId: owner.id,
    body: { title: "x", projectId: p.id, source: "CARRIER_PIGEON" },
  });
  assert.equal(badSource.status, 400);

  const badType = await invoke(createTask, "/api/tasks", {
    method: "POST",
    userId: owner.id,
    body: { title: "x", projectId: p.id, type: "QUESTION" },
  });
  assert.equal(badType.status, 400);
});

test("J12: an empty requester email is stored as absent, not as an empty string", async () => {
  await resetDb();
  const { owner } = await seedUsers();
  const p = await project(owner.id);
  const res = await invoke(createTask, "/api/tasks", {
    method: "POST",
    userId: owner.id,
    body: { title: "No email", projectId: p.id, requesterEmail: "" },
  });
  assert.equal(res.status, 201);
  assert.equal((await db.task.findUniqueOrThrow({ where: { id: (res.body as any).task.id } })).requesterEmail, null);
});
