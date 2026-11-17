/**
 * J15 — the tools the bot gained so it can finish a job.
 *
 * Each of these closes a request the assistant could previously only talk about:
 * triaging a ticket, finding an email, seeing what is due, scheduling recurring
 * work, and creating the contact it kept offering to add.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { resetDb, seedUsers, db } from "../helpers";
import { toolRegistry } from "../../src/lib/ai/tools/registry";
import "../../src/lib/ai/tools/crm-tools";
import { createRoutine } from "../../src/lib/ai/automation/routine-create";

const asOwner = (userId: string) => toolRegistry.getTool("update_task")!.execute as any;
const run = (id: string, input: any, userId: string) => toolRegistry.getTool(id)!.execute(input, { userId, userRole: "OWNER" });

async function ticket(title = "ALARM: bucket policy changed") {
  const { owner, member } = await seedUsers();
  const project = await db.project.create({ data: { name: "Ops", ownerId: owner.id } });
  const task = await db.task.create({ data: { title, projectId: project.id, creatorId: owner.id, status: "TODO", priority: "LOW" } });
  return { owner, member, project, task };
}

test("J15: update_task finds a ticket by its #SR number and triages it", async () => {
  await resetDb();
  const { owner, task } = await ticket();

  const result = await run("update_task", { task: `#SR-${task.number}`, status: "IN_PROGRESS", priority: "URGENT" }, owner.id);
  assert.equal(result.success, true, JSON.stringify(result));

  const stored = await db.task.findUniqueOrThrow({ where: { id: task.id } });
  assert.equal(stored.status, "IN_PROGRESS");
  assert.equal(stored.priority, "URGENT");
});

test("J15: update_task closes a ticket and records the resolution", async () => {
  await resetDb();
  const { owner, task } = await ticket();

  const result = await run("update_task", { task: task.id, status: "DONE", resolution: "Rotated the bucket policy." }, owner.id);
  assert.equal(result.success, true);
  const stored = await db.task.findUniqueOrThrow({ where: { id: task.id } });
  assert.equal(stored.status, "DONE");
  assert.ok(stored.closedAt instanceof Date);
  assert.equal(stored.resolution, "Rotated the bucket policy.");
});

test("J15: update_task assigns by email, and an unknown email is refused", async () => {
  await resetDb();
  const { owner, member, task } = await ticket();

  const ok = await run("update_task", { task: task.id, assigneeEmail: "member@test.cyraops.com" }, owner.id);
  assert.equal(ok.success, true, JSON.stringify(ok));
  assert.equal((await db.task.findUniqueOrThrow({ where: { id: task.id } })).assigneeId, member.id);

  const bad = await run("update_task", { task: task.id, assigneeEmail: "nobody@example.com" }, owner.id);
  assert.equal(bad.success, false);
  assert.match(bad.error ?? "", /No teammate/i);
});

test("J15: update_task refuses a ticket that does not exist", async () => {
  await resetDb();
  const { owner } = await seedUsers();
  const result = await run("update_task", { task: "#SR-9999", status: "DONE" }, owner.id);
  assert.equal(result.success, false);
  assert.match(result.error ?? "", /No ticket found/i);
});

test("J15: list_schedule returns what is due, with its owner and project", async () => {
  await resetDb();
  const { owner, task } = await ticket("Renew the certificate");
  await db.task.update({ where: { id: task.id }, data: { dueDate: new Date(Date.now() + 2 * 86_400_000), assigneeId: owner.id } });

  const result = await run("list_schedule", { days: 7 }, owner.id);
  assert.equal(result.success, true);
  const items = (result.data as any).items;
  assert.ok(items.length >= 1);
  assert.equal(items[0].ticket, `#SR-${task.number}`);
  assert.equal(items[0].owner, "Tanveer (Owner)");
  assert.equal(items[0].project, "Ops");
});

test("J15: create_routine schedules work for an agent", async () => {
  await resetDb();
  const { owner } = await seedUsers();
  await db.aiAgent.create({ data: { slug: "research", name: "Research Agent", role: "Research", description: "d", systemPrompt: "p", status: "ACTIVE" } });

  const result = await createRoutine({ name: "Morning pipeline check", cron: "0 9 * * 1-5", agentSlug: "research", instructions: "Summarise pipeline risk.", userId: owner.id });
  assert.equal(result.ok, true, JSON.stringify(result));
  const routines = await db.aiRoutine.findMany();
  assert.equal(routines.length, 1);
  assert.equal(routines[0].cronExpression, "0 9 * * 1-5");
  assert.ok(routines[0].nextRunAt instanceof Date);
});

test("J15: an invalid cron or unknown agent is refused", async () => {
  await resetDb();
  const { owner } = await seedUsers();
  await db.aiAgent.create({ data: { slug: "research", name: "Research Agent", role: "Research", description: "d", systemPrompt: "p", status: "ACTIVE" } });

  const badCron = await createRoutine({ name: "x", cron: "every morning", agentSlug: "research", userId: owner.id });
  assert.equal(badCron.ok, false);

  const badAgent = await createRoutine({ name: "x", cron: "0 9 * * *", agentSlug: "nope", userId: owner.id });
  assert.equal(badAgent.ok, false);
  assert.match((badAgent as any).error, /No active agent/i);
});

test("J15: email search fails honestly when the mailbox is not configured", async (t) => {
  await resetDb();
  const { owner } = await seedUsers();
  const previous = { address: process.env.GODADDY_EMAIL_ADDRESS, password: process.env.GODADDY_EMAIL_PASSWORD };
  delete process.env.GODADDY_EMAIL_ADDRESS;
  delete process.env.GODADDY_EMAIL_PASSWORD;
  t.after(() => {
    if (previous.address !== undefined) process.env.GODADDY_EMAIL_ADDRESS = previous.address;
    if (previous.password !== undefined) process.env.GODADDY_EMAIL_PASSWORD = previous.password;
  });

  const result = await run("search_emails", { query: "invoice" }, owner.id);
  assert.equal(result.success, false);
  assert.match(result.error ?? "", /not configured/i);
});

test("J15: contact and company creation are available to the assistant", async () => {
  await resetDb();
  const { owner } = await seedUsers();

  const contact = await run("create_contact", { firstName: "Adil", lastName: "Khan", email: "khanadiluddin@gmail.com" }, owner.id);
  assert.equal(contact.success, true, JSON.stringify(contact));

  const company = await run("create_company", { name: "Health-RFID" }, owner.id);
  assert.equal(company.success, true, JSON.stringify(company));
});
