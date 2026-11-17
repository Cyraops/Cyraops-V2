/**
 * J16 — meetings, archiving, deletion, and routines that fire on mail.
 *
 * The last three things the bot could not do. Deletion is the one destructive
 * path in the toolbox, so it is tested hardest: it must demand a confirmation
 * and it must be irreversible only when a person said so.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { resetDb, seedUsers, db } from "../helpers";
import { toolRegistry } from "../../src/lib/ai/tools/registry";
import "../../src/lib/ai/tools/crm-tools";
import { createRoutine } from "../../src/lib/ai/automation/routine-create";

const run = (id: string, input: any, userId: string) => toolRegistry.getTool(id)!.execute(input, { userId, userRole: "OWNER" });

test("J16: a meeting can be scheduled with a length, place and attendees", async () => {
  await resetDb();
  const { owner } = await seedUsers();

  const result = await run("create_event", {
    title: "Migration call with Adil",
    startsAt: "2026-11-19T15:00:00Z",
    minutes: 45,
    attendees: "adil@example.com",
    location: "Teams",
    notes: "Walk through the cutover plan.",
  }, owner.id);

  assert.equal(result.success, true, JSON.stringify(result));
  const meeting = await db.calendarEvent.findFirstOrThrow();
  assert.equal(meeting.title, "Migration call with Adil");
  assert.equal(meeting.endsAt.getTime() - meeting.startsAt.getTime(), 45 * 60_000);
  assert.equal(meeting.location, "Teams");
  assert.equal(meeting.attendees, "adil@example.com");
});

test("J16: an unreadable start time is refused, not guessed", async () => {
  await resetDb();
  const { owner } = await seedUsers();
  const result = await run("create_event", { title: "Call", startsAt: "next thursday" }, owner.id);
  assert.equal(result.success, false);
  assert.match(result.error ?? "", /ISO time/i);
  assert.equal(await db.calendarEvent.count(), 0);
});

test("J16: archiving takes a ticket off the queue but keeps the record", async () => {
  await resetDb();
  const { owner } = await seedUsers();
  const project = await db.project.create({ data: { name: "Ops", ownerId: owner.id } });
  const task = await db.task.create({ data: { title: "Duplicate alarm", projectId: project.id, creatorId: owner.id } });

  const result = await run("archive_task", { task: `#SR-${task.number}` }, owner.id);
  assert.equal(result.success, true, JSON.stringify(result));

  const stored = await db.task.findUniqueOrThrow({ where: { id: task.id } });
  assert.ok(stored.archivedAt instanceof Date, "archived, not deleted");
  assert.equal(stored.title, "Duplicate alarm");
});

test("J16: a contact cannot be deleted without repeating its email", async () => {
  await resetDb();
  const { owner } = await seedUsers();
  const contact = await db.contact.create({ data: { firstName: "Adil", lastName: "Khan", email: "khanadiluddin@gmail.com", ownerId: owner.id } }).catch(async () => {
    return db.contact.create({ data: { firstName: "Adil", lastName: "Khan", email: "khanadiluddin@gmail.com" } });
  });

  const refused = await run("delete_contact", { contactId: contact.id }, owner.id);
  assert.equal(refused.success, false);
  assert.match(refused.error ?? "", /confirm/i);
  assert.equal(await db.contact.count(), 1, "nothing deleted without confirmation");

  const wrong = await run("delete_contact", { contactId: contact.id, confirmEmail: "someone@else.com" }, owner.id);
  assert.equal(wrong.success, false);
  assert.equal(await db.contact.count(), 1);

  const deleted = await run("delete_contact", { contactId: contact.id, confirmEmail: "khanadiluddin@gmail.com" }, owner.id);
  assert.equal(deleted.success, true, JSON.stringify(deleted));
  assert.equal(await db.contact.count(), 0);
});

test("J16: deletion is a CLASS_C action that always needs a person", () => {
  const tool = toolRegistry.getTool("delete_contact")!;
  assert.equal(tool.riskClass, "CLASS_C");
  assert.equal(tool.explicitApproval, true);
  assert.equal(tool.requiresApproval, true);
});

test("J16: a routine can fire on incoming mail instead of a clock", async () => {
  await resetDb();
  const { owner } = await seedUsers();
  await db.aiAgent.create({ data: { slug: "communication", name: "Communication Agent", role: "Comms", description: "d", systemPrompt: "p", status: "ACTIVE" } });

  const result = await createRoutine({
    name: "Answer client alarms",
    agentSlug: "communication",
    instructions: "Read the alarm and log a ticket.",
    triggerType: "EMAIL",
    emailSenders: "cis-alarm@itcinfotech.com",
    userId: owner.id,
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  const routine = await db.aiRoutine.findFirstOrThrow();
  assert.equal(routine.triggerType, "EMAIL");
  assert.equal(routine.emailSenders, "cis-alarm@itcinfotech.com");
  assert.equal(routine.nextRunAt, null, "an email trigger has no clock");
});

test("J16: an email routine without senders is refused", async () => {
  await resetDb();
  const { owner } = await seedUsers();
  await db.aiAgent.create({ data: { slug: "communication", name: "Communication Agent", role: "Comms", description: "d", systemPrompt: "p", status: "ACTIVE" } });

  const result = await createRoutine({ name: "x", agentSlug: "communication", triggerType: "EMAIL", userId: owner.id });
  assert.equal(result.ok, false);
  assert.match((result as any).error, /sender/i);
});
