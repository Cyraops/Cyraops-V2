/**
 * J10 — task classification.
 *
 * A task is a bug, a service item, or a category grouping item. The field is
 * nullable: unclassified is a real state and must never be silently guessed,
 * because a report that says "bugs: 12" is worthless if the field defaults to
 * something.
 *
 * Driven through the real handlers with real sessions, read back from Postgres.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { resetDb, seedUsers, invoke, db } from "../helpers";
import { POST as createTask } from "../../src/app/api/tasks/route";
import { PATCH as patchTask, GET as getTask } from "../../src/app/api/tasks/[id]/route";
import { POST as createTicket, GET as listTickets } from "../../src/app/api/tickets/route";
import { inferTicketKind } from "../../src/lib/tickets";

async function project(userId: string) {
  return db.project.create({ data: { name: "Classification", ownerId: userId } });
}

test("J10: a task can be created as a bug, a service item, or a category", async () => {
  await resetDb();
  const { owner } = await seedUsers();
  const p = await project(owner.id);

  for (const kind of ["BUG", "SERVICE", "CATEGORY"] as const) {
    const res = await invoke(createTask, "/api/tasks", {
      method: "POST",
      userId: owner.id,
      body: { title: `${kind} item`, projectId: p.id, kind },
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const stored = await db.task.findUniqueOrThrow({ where: { id: (res.body as any).task.id } });
    assert.equal(stored.kind, kind, `${kind} must survive the round trip`);
  }
});

test("J10: a task with no classification stays null rather than defaulting", async () => {
  await resetDb();
  const { owner } = await seedUsers();
  const p = await project(owner.id);

  const res = await invoke(createTask, "/api/tasks", {
    method: "POST",
    userId: owner.id,
    body: { title: "Unclassified work", projectId: p.id },
  });
  assert.equal(res.status, 201);
  const stored = await db.task.findUniqueOrThrow({ where: { id: (res.body as any).task.id } });
  assert.equal(stored.kind, null);
});

test("J10: reclassifying and clearing both work", async () => {
  await resetDb();
  const { owner } = await seedUsers();
  const p = await project(owner.id);
  const created = await invoke(createTask, "/api/tasks", {
    method: "POST",
    userId: owner.id,
    body: { title: "Something broke", projectId: p.id, kind: "BUG" },
  });
  const id = (created.body as any).task.id;

  const reclassified = await invoke(patchTask, `/api/tasks/${id}`, {
    method: "PATCH",
    userId: owner.id,
    params: { id },
    body: { kind: "SERVICE" },
  });
  assert.equal(reclassified.status, 200, JSON.stringify(reclassified.body));
  assert.equal((await db.task.findUniqueOrThrow({ where: { id } })).kind, "SERVICE");

  const cleared = await invoke(patchTask, `/api/tasks/${id}`, {
    method: "PATCH",
    userId: owner.id,
    params: { id },
    body: { kind: null },
  });
  assert.equal(cleared.status, 200, JSON.stringify(cleared.body));
  assert.equal((await db.task.findUniqueOrThrow({ where: { id } })).kind, null);
});

test("J10: an unknown classification is rejected, not stored", async () => {
  await resetDb();
  const { owner } = await seedUsers();
  const p = await project(owner.id);

  const res = await invoke(createTask, "/api/tasks", {
    method: "POST",
    userId: owner.id,
    body: { title: "Sneaky", projectId: p.id, kind: "CRITICAL" },
  });
  assert.equal(res.status, 400, "unknown kinds must not reach the database");
});

test("J10: the task API returns the classification it stored", async () => {
  await resetDb();
  const { owner } = await seedUsers();
  const p = await project(owner.id);
  const created = await invoke(createTask, "/api/tasks", {
    method: "POST",
    userId: owner.id,
    body: { title: "Read it back", projectId: p.id, kind: "CATEGORY" },
  });
  const id = (created.body as any).task.id;

  const read = await invoke(getTask, `/api/tasks/${id}`, { method: "GET", userId: owner.id, params: { id } });
  assert.equal(read.status, 200);
  assert.equal((read.body as any).task.kind, "CATEGORY");
});

test("J10: a ticket written with a leading kind is filed as that kind", async () => {
  await resetDb();
  const { owner } = await seedUsers();

  const res = await invoke(createTicket, "/api/tickets", {
    method: "POST",
    userId: owner.id,
    body: { text: "@tasks bug: the invoice page crashes on save" },
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const stored = await db.task.findUniqueOrThrow({ where: { id: (res.body as any).ticket.id } });
  assert.equal(stored.kind, "BUG", "the word after @tasks is the classification");
});

test("J10: an explicit kind wins, and a plain ticket stays unclassified", async () => {
  await resetDb();
  const { owner } = await seedUsers();

  const explicit = await invoke(createTicket, "/api/tickets", {
    method: "POST",
    userId: owner.id,
    body: { text: "@tasks check the renewal date", kind: "SERVICE" },
  });
  assert.equal(explicit.status, 201);
  assert.equal((await db.task.findUniqueOrThrow({ where: { id: (explicit.body as any).ticket.id } })).kind, "SERVICE");

  const plain = await invoke(createTicket, "/api/tickets", {
    method: "POST",
    userId: owner.id,
    body: { text: "@tasks Call the supplier back" },
  });
  assert.equal(plain.status, 201);
  assert.equal((await db.task.findUniqueOrThrow({ where: { id: (plain.body as any).ticket.id } })).kind, null);
});

test("J10: the ticket list carries the classification for the board", async () => {
  await resetDb();
  const { owner } = await seedUsers();
  await invoke(createTicket, "/api/tickets", {
    method: "POST",
    userId: owner.id,
    body: { text: "@tasks bug: login fails on Safari" },
  });

  const res = await invoke(listTickets, "/api/tickets", { method: "GET", userId: owner.id });
  assert.equal(res.status, 200);
  const tickets = (res.body as any).tickets as Array<{ title: string; kind: string | null }>;
  assert.equal(tickets.length, 1);
  assert.equal(tickets[0].kind, "BUG");
});

test("J10: only whole leading words classify", () => {
  assert.equal(inferTicketKind("@tasks bug: broken"), "BUG");
  assert.equal(inferTicketKind("@tasks category: grouping"), "CATEGORY");
  assert.equal(inferTicketKind("@tasks bugfix the thing"), null, "bugfix is not bug");
  assert.equal(inferTicketKind("say @tasks bug later"), null, "the trigger must lead");
});
