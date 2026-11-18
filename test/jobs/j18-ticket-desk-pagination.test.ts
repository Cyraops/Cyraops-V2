/**
 * J18 — the ticket desk at scale.
 *
 * The desk grew beyond one screen: the list is paged server-side (page/pageSize,
 * clamped, with a total), filters and search moved to the API so they keep
 * meaning across pages, archived tickets get their own view, and restore clears
 * archivedAt under exactly the permission path archiving already uses —
 * OWNER/ADMIN, or a member of the ticket's project (/api/tasks/:id's gate).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { resetDb, seedUsers, invoke, db } from "../helpers";
import { GET as listTickets } from "../../src/app/api/tickets/route";
import { PATCH as patchTask } from "../../src/app/api/tasks/[id]/route";
import type { Priority, TaskStatus } from "@prisma/client";

/** Tickets with staggered createdAt, newest last, so "newest first" is checkable. */
async function seedTickets(
  projectId: string,
  creatorId: string,
  count: number,
  options: { titlePrefix?: string; priority?: Priority; status?: TaskStatus; groupName?: string | null; requesterName?: string | null } = {}
) {
  const base = Date.parse("2026-01-01T00:00:00Z");
  const ids: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const row = await db.task.create({
      data: {
        title: `${options.titlePrefix ?? "Ticket"} ${i + 1}`,
        projectId,
        creatorId,
        priority: options.priority ?? "MEDIUM",
        status: options.status ?? "TODO",
        groupName: options.groupName,
        requesterName: options.requesterName,
        createdAt: new Date(base + (i + 1) * 60_000),
      },
    });
    ids.push(row.id);
  }
  return ids;
}

async function seedProject(ownerId: string, name = "Desk") {
  return db.project.create({ data: { name, ownerId } });
}

test("J18: the list is paged server-side and reports the total", async () => {
  await resetDb();
  const { owner } = await seedUsers();
  const project = await seedProject(owner.id);
  const ids = await seedTickets(project.id, owner.id, 45);

  const page1 = await invoke(listTickets, "/api/tickets?page=1&pageSize=20", { userId: owner.id });
  assert.equal(page1.status, 200, JSON.stringify(page1.body));
  const body1 = page1.body as any;
  assert.equal(body1.tickets.length, 20);
  assert.equal(body1.total, 45);
  assert.equal(body1.page, 1);
  assert.equal(body1.pageSize, 20);
  assert.equal(body1.open, 45, "open is the non-closed, non-archived count");
  assert.equal(body1.tickets[0].id, ids[44], "newest first");
  assert.equal(body1.tickets[19].id, ids[25]);

  const page2 = await invoke(listTickets, "/api/tickets?page=2&pageSize=20", { userId: owner.id });
  const body2 = page2.body as any;
  assert.equal(body2.tickets.length, 20);
  assert.equal(body2.tickets[0].id, ids[24]);
  assert.equal(body2.tickets[19].id, ids[5]);

  const page3 = await invoke(listTickets, "/api/tickets?page=3&pageSize=20", { userId: owner.id });
  const body3 = page3.body as any;
  assert.equal(body3.tickets.length, 5, "the last page holds the remainder");
  assert.equal(body3.tickets[0].id, ids[4]);
  assert.equal(body3.tickets[4].id, ids[0]);

  const seen = new Set([...(body1.tickets as any[]), ...(body2.tickets as any[])].map((t) => t.id));
  assert.equal(seen.size, 40, "pages never repeat a row");

  const beyond = await invoke(listTickets, "/api/tickets?page=9", { userId: owner.id });
  assert.equal((beyond.body as any).tickets.length, 0);
  assert.equal((beyond.body as any).total, 45);
});

test("J18: page and pageSize are clamped, and junk falls back to defaults", async () => {
  await resetDb();
  const { owner } = await seedUsers();
  const project = await seedProject(owner.id);
  await seedTickets(project.id, owner.id, 7);

  const zeroPage = await invoke(listTickets, "/api/tickets?page=0", { userId: owner.id });
  assert.equal((zeroPage.body as any).page, 1, "page 0 is clamped to 1");

  const negative = await invoke(listTickets, "/api/tickets?page=-4", { userId: owner.id });
  assert.equal((negative.body as any).page, 1);

  const huge = await invoke(listTickets, "/api/tickets?pageSize=100000", { userId: owner.id });
  assert.equal((huge.body as any).pageSize, 100, "pageSize is clamped to 100");
  assert.equal((huge.body as any).total, 7);

  const tiny = await invoke(listTickets, "/api/tickets?pageSize=1", { userId: owner.id });
  assert.equal((tiny.body as any).tickets.length, 1, "pageSize 1 is honoured");

  const junk = await invoke(listTickets, "/api/tickets?page=abc&pageSize=xyz", { userId: owner.id });
  assert.equal((junk.body as any).page, 1);
  assert.equal((junk.body as any).pageSize, 20, "unparseable pageSize falls back to 20");
});

test("J18: the queue's filters and search work server-side", async () => {
  await resetDb();
  const { owner, member } = await seedUsers();
  const project = await seedProject(owner.id);

  const openUrgent = await db.task.create({
    data: { title: "Alarm in Sydney", projectId: project.id, creatorId: owner.id, priority: "URGENT", status: "TODO", groupName: "ANZ_Wintel", requesterName: "cis-alarm" },
  });
  const closedLow = await db.task.create({
    data: { title: "Renewal check", projectId: project.id, creatorId: owner.id, priority: "LOW", status: "DONE", closedAt: new Date() },
  });
  const unassigned = await db.task.create({
    data: { title: "Nobody owns this", projectId: project.id, creatorId: owner.id, priority: "MEDIUM", status: "IN_PROGRESS", requesterName: "mailbox" },
  });
  await db.taskAssignee.create({ data: { taskId: openUrgent.id, userId: member.id } });

  const closed = await invoke(listTickets, "/api/tickets?status=closed", { userId: owner.id });
  assert.deepEqual((closed.body as any).tickets.map((t: any) => t.id), [closedLow.id]);

  const open = await invoke(listTickets, "/api/tickets?status=open", { userId: owner.id });
  assert.deepEqual(
    (open.body as any).tickets.map((t: any) => t.id).sort(),
    [openUrgent.id, unassigned.id].sort()
  );

  const urgent = await invoke(listTickets, "/api/tickets?priority=URGENT", { userId: owner.id });
  assert.deepEqual((urgent.body as any).tickets.map((t: any) => t.id), [openUrgent.id]);

  const group = await invoke(listTickets, "/api/tickets?group=ANZ_Wintel", { userId: owner.id });
  assert.deepEqual((group.body as any).tickets.map((t: any) => t.id), [openUrgent.id]);

  const assigned = await invoke(listTickets, `/api/tickets?assignee=${member.id}`, { userId: owner.id });
  assert.deepEqual((assigned.body as any).tickets.map((t: any) => t.id), [openUrgent.id]);

  const nobody = await invoke(listTickets, "/api/tickets?assignee=unassigned", { userId: owner.id });
  assert.deepEqual(
    (nobody.body as any).tickets.map((t: any) => t.id).sort(),
    [closedLow.id, unassigned.id].sort(),
    "unassigned means no human owner"
  );

  const byRequester = await invoke(listTickets, "/api/tickets?q=cis-alarm", { userId: owner.id });
  assert.deepEqual((byRequester.body as any).tickets.map((t: any) => t.id), [openUrgent.id]);

  const byNumber = await invoke(listTickets, `/api/tickets?q=%23SR-${openUrgent.number}`, { userId: owner.id });
  assert.deepEqual((byNumber.body as any).tickets.map((t: any) => t.id), [openUrgent.id], "a ticket reference finds its row");

  const nothing = await invoke(listTickets, "/api/tickets?q=zzz-no-such-ticket", { userId: owner.id });
  assert.equal((nothing.body as any).tickets.length, 0);
  assert.equal((nothing.body as any).total, 0, "an empty result still reports 0, so the desk can show its empty state");
});

test("J18: groups are reported for the filter popover, per view", async () => {
  await resetDb();
  const { owner } = await seedUsers();
  const project = await seedProject(owner.id);
  const grouped = await db.task.create({ data: { title: "G", projectId: project.id, creatorId: owner.id, groupName: "ANZ_Wintel" } });
  await db.task.create({ data: { title: "H", projectId: project.id, creatorId: owner.id, groupName: "APAC_Network" } });
  await db.task.create({ data: { title: "N", projectId: project.id, creatorId: owner.id } });

  const active = await invoke(listTickets, "/api/tickets", { userId: owner.id });
  assert.deepEqual((active.body as any).groups, ["ANZ_Wintel", "APAC_Network"]);

  await invoke(patchTask, `/api/tasks/${grouped.id}`, { method: "PATCH", userId: owner.id, params: { id: grouped.id }, body: { archive: true } });
  const archived = await invoke(listTickets, "/api/tickets?archived=1", { userId: owner.id });
  assert.deepEqual((archived.body as any).groups, ["ANZ_Wintel"], "the archived view offers its own groups");
});

test("J18: archiving removes a ticket from the queue and the archived view lists it", async () => {
  await resetDb();
  const { owner } = await seedUsers();
  const project = await seedProject(owner.id);
  const [keep, gone] = await seedTickets(project.id, owner.id, 2);

  const archived = await invoke(patchTask, `/api/tasks/${gone}`, {
    method: "PATCH",
    userId: owner.id,
    params: { id: gone },
    body: { archive: true },
  });
  assert.equal(archived.status, 200, JSON.stringify(archived.body));

  const queue = await invoke(listTickets, "/api/tickets", { userId: owner.id });
  assert.deepEqual((queue.body as any).tickets.map((t: any) => t.id), [keep]);
  assert.equal((queue.body as any).total, 1);

  const drawer = await invoke(listTickets, "/api/tickets?archived=1", { userId: owner.id });
  assert.deepEqual((drawer.body as any).tickets.map((t: any) => t.id), [gone]);
  assert.equal((drawer.body as any).total, 1);
  assert.ok((drawer.body as any).tickets[0].archivedAt, "the archived row carries archivedAt");

  const stored = await db.task.findUniqueOrThrow({ where: { id: gone } });
  assert.ok(stored.archivedAt instanceof Date);
});

test("J18: restore clears archivedAt and the ticket rejoins the queue", async () => {
  await resetDb();
  const { owner } = await seedUsers();
  const project = await seedProject(owner.id);
  const [id] = await seedTickets(project.id, owner.id, 1);

  await invoke(patchTask, `/api/tasks/${id}`, { method: "PATCH", userId: owner.id, params: { id }, body: { archive: true } });
  const restored = await invoke(patchTask, `/api/tasks/${id}`, {
    method: "PATCH",
    userId: owner.id,
    params: { id },
    body: { archive: false },
  });
  assert.equal(restored.status, 200, JSON.stringify(restored.body));
  assert.equal((await db.task.findUniqueOrThrow({ where: { id } })).archivedAt, null);

  const queue = await invoke(listTickets, "/api/tickets", { userId: owner.id });
  assert.deepEqual((queue.body as any).tickets.map((t: any) => t.id), [id], "back in the queue");
  const drawer = await invoke(listTickets, "/api/tickets?archived=1", { userId: owner.id });
  assert.equal((drawer.body as any).total, 0, "the archived view is empty again");
});

test("J18: restore mirrors the archive gate — owner/admin or a member of the ticket's project", async () => {
  await resetDb();
  const { owner, member } = await seedUsers();
  const project = await seedProject(owner.id);
  await db.projectMember.create({ data: { projectId: project.id, userId: member.id } });
  const [id] = await seedTickets(project.id, owner.id, 1);
  await invoke(patchTask, `/api/tasks/${id}`, { method: "PATCH", userId: owner.id, params: { id }, body: { archive: true } });

  // A member of the ticket's project can restore it — the exact gate archiving uses.
  const memberRestore = await invoke(patchTask, `/api/tasks/${id}`, {
    method: "PATCH",
    userId: member.id,
    params: { id },
    body: { archive: false },
  });
  assert.equal(memberRestore.status, 200, JSON.stringify(memberRestore.body));
  assert.equal((await db.task.findUniqueOrThrow({ where: { id } })).archivedAt, null);

  // Outside that project, the same call is refused — same as archiving.
  await invoke(patchTask, `/api/tasks/${id}`, { method: "PATCH", userId: owner.id, params: { id }, body: { archive: true } });
  const stranger = await db.user.create({ data: { name: "Stranger", email: "stranger@test.cyraops.com", role: "MEMBER", passwordHash: "x" } });
  const refused = await invoke(patchTask, `/api/tasks/${id}`, {
    method: "PATCH",
    userId: stranger.id,
    params: { id },
    body: { archive: false },
  });
  assert.equal(refused.status, 404);
  assert.ok((await db.task.findUniqueOrThrow({ where: { id } })).archivedAt, "still archived");
});

test("J18: the archived view keeps the member scoping of the queue", async () => {
  await resetDb();
  const { owner, member } = await seedUsers();
  const theirs = await seedProject(owner.id, "Their desk");
  await db.projectMember.create({ data: { projectId: theirs.id, userId: member.id } });
  const foreign = await seedProject(owner.id, "Not hers");

  const [visible1, visible2] = await seedTickets(theirs.id, owner.id, 2);
  const [hidden] = await seedTickets(foreign.id, owner.id, 1);
  for (const id of [visible1, visible2, hidden]) {
    await invoke(patchTask, `/api/tasks/${id}`, { method: "PATCH", userId: owner.id, params: { id }, body: { archive: true } });
  }

  const drawer = await invoke(listTickets, "/api/tickets?archived=1", { userId: member.id });
  assert.deepEqual(
    (drawer.body as any).tickets.map((t: any) => t.id).sort(),
    [visible1, visible2].sort(),
    "a member's archived view is scoped exactly like the queue"
  );
});
