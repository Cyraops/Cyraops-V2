import { test } from "node:test";
import assert from "node:assert/strict";
import { resetDb, seedUsers, invoke, db } from "../helpers";

import { POST as createDeal } from "../../src/app/api/crm/deals/route";
import { GET as getDeal, PATCH as updateDeal } from "../../src/app/api/crm/deals/[id]/route";
import { POST as convertDeal } from "../../src/app/api/crm/deals/[id]/convert/route";
import { POST as createCompany } from "../../src/app/api/crm/companies/route";
import { POST as createContact } from "../../src/app/api/crm/contacts/route";
import { GET as listProjects } from "../../src/app/api/projects/route";
import { GET as getProject, PATCH as updateProject } from "../../src/app/api/projects/[id]/route";
import {
  GET as listMilestones,
  POST as createMilestone,
} from "../../src/app/api/projects/[id]/milestones/route";
import {
  PATCH as updateMilestone,
  DELETE as deleteMilestone,
} from "../../src/app/api/projects/[id]/milestones/[milestoneId]/route";
import { GET as listTasks, POST as createTask } from "../../src/app/api/tasks/route";
import { GET as getTask, PATCH as updateTask } from "../../src/app/api/tasks/[id]/route";
import { GET as listNotifications, PATCH as markNotifications } from "../../src/app/api/notifications/route";

// J3 — turn a won deal into a delivered project.
// Every assertion is a business outcome read back from Postgres, not an echo of
// the response body.

const iso = (d: Date) => d.toISOString();

async function newDealId(userId: string, title: string) {
  const created = await invoke(createDeal, "/api/crm/deals", {
    method: "POST",
    userId,
    body: { title, value: 2500000, sourcePlatform: "REFERRAL", notes: "anchor client" },
  });
  assert.equal(created.status, 201, `deal creation failed: ${JSON.stringify(created.body)}`);
  const id = (created.body as any)?.deal?.id;
  assert.ok(id, "expected the create response to carry the new deal id");
  return id as string;
}

async function advance(userId: string, dealId: string, stage: string) {
  return invoke(updateDeal, `/api/crm/deals/${dealId}`, {
    method: "PATCH",
    userId,
    params: { id: dealId },
    body: { stage },
  });
}

/** Walks the pipeline DISCOVERY -> PROPOSAL -> NEGOTIATION -> CLOSED_WON. */
async function wonDeal(userId: string, title: string) {
  const dealId = await newDealId(userId, title);
  for (const stage of ["PROPOSAL", "NEGOTIATION", "CLOSED_WON"]) {
    const moved = await advance(userId, dealId, stage);
    assert.equal(moved.status, 200, `moving to ${stage} failed: ${JSON.stringify(moved.body)}`);
  }
  const row = await db.deal.findUnique({ where: { id: dealId } });
  assert.equal(row!.stage, "CLOSED_WON", "the fixture must be a genuinely won deal");
  assert.equal(row!.probability, 100);
  return dealId;
}

async function convert(userId: string, dealId: string, body: Record<string, unknown> = {}) {
  return invoke(convertDeal, `/api/crm/deals/${dealId}/convert`, {
    method: "POST",
    userId,
    params: { id: dealId },
    body: { confirm: true, ...body },
  });
}

test("a won deal converts into exactly one delivery project linked both ways", async () => {
  await resetDb();
  const { owner, member } = await seedUsers();

  const company = await invoke(createCompany, "/api/crm/companies", {
    method: "POST",
    userId: owner.id,
    body: { name: "Nimbus Logistics", industry: "Logistics" },
  });
  assert.equal(company.status, 201, JSON.stringify(company.body));
  const companyId = (company.body as any).company.id as string;

  const contact = await invoke(createContact, "/api/crm/contacts", {
    method: "POST",
    userId: owner.id,
    body: { firstName: "Priya", lastName: "Nair", email: "priya@nimbus.example", companyId },
  });
  assert.equal(contact.status, 201, JSON.stringify(contact.body));
  const contactId = (contact.body as any).contact.id as string;

  const dealId = await newDealId(owner.id, "Nimbus cloud migration");
  // attach the client company/contact to the won deal
  const linked = await invoke(updateDeal, `/api/crm/deals/${dealId}`, {
    method: "PATCH",
    userId: owner.id,
    params: { id: dealId },
    body: { companyId, contactId },
  });
  assert.equal(linked.status, 200, JSON.stringify(linked.body));
  for (const stage of ["PROPOSAL", "NEGOTIATION", "CLOSED_WON"]) {
    assert.equal((await advance(owner.id, dealId, stage)).status, 200, `stage ${stage} failed`);
  }

  const deadline = new Date(Date.now() + 45 * 24 * 3600 * 1000);
  const converted = await convert(owner.id, dealId, {
    confirm: true,
    projectName: "Nimbus cloud migration — delivery",
    description: "Kickoff approved by client",
    priority: "HIGH",
    deadline: iso(deadline),
    memberIds: [member.id],
  });
  assert.equal(converted.status, 201, `conversion failed: ${JSON.stringify(converted.body)}`);

  const projectId = (converted.body as any)?.project?.id as string;
  assert.ok(projectId, "conversion must return the new project");
  assert.equal((converted.body as any)?.success, true);

  // 1) The project row is real and carries the delivery brief.
  const project = await db.project.findUnique({
    where: { id: projectId },
    include: { members: true },
  });
  assert.ok(project, "the converted project must exist in the database");
  assert.equal(project!.name, "Nimbus cloud migration — delivery");
  assert.equal(project!.dealId, dealId, "the project must point back at the won deal");
  assert.equal(project!.ownerId, owner.id, "the deal owner leads the project by default");
  assert.equal(project!.status, "PLANNING", "a freshly converted project starts in PLANNING");
  assert.equal(project!.priority, "HIGH");
  assert.equal(project!.archivedAt, null);
  assert.ok(project!.deadline, "the requested deadline must persist");
  assert.equal(project!.deadline!.getTime(), deadline.getTime());
  assert.match(project!.description, /Kickoff approved by client/, "explicit description must be kept");
  assert.match(project!.description, /Nimbus Logistics/, "the brief must name the client");
  assert.match(project!.description, /Priya Nair/, "the brief must name the key contact");
  assert.match(project!.description, /INR/, "the brief must carry the deal value and currency");

  // 2) The delivery team: the owner leads, the requested teammate is a member.
  const roles = Object.fromEntries(project!.members.map((m) => [m.userId, m.role]));
  assert.deepEqual(
    Object.keys(roles).sort(),
    [owner.id, member.id].sort(),
    "the conversion actor, the owner and the requested members must all be on the project"
  );
  assert.equal(roles[owner.id], "lead");
  assert.equal(roles[member.id], "member");

  // 3) The deal now knows its project and is locked at won.
  const deal = await db.deal.findUnique({ where: { id: dealId } });
  assert.equal(deal!.convertedProjectId, projectId);
  assert.equal(deal!.stage, "CLOSED_WON");
  assert.equal(deal!.probability, 100);

  // 4) Both halves of the story are audited.
  const dealConverted = await db.activity.findMany({
    where: { entity: "deal", entityId: dealId, action: "converted" },
  });
  assert.equal(dealConverted.length, 1, "converting must write exactly one deal activity");
  assert.equal(dealConverted[0].userId, owner.id);
  assert.equal(dealConverted[0].projectId, projectId);
  assert.match(dealConverted[0].summary, /Nimbus cloud migration/);
  assert.match(dealConverted[0].summary, /Nimbus cloud migration — delivery/);

  const projectCreated = await db.activity.findMany({
    where: { entity: "project", entityId: projectId, action: "created" },
  });
  assert.equal(projectCreated.length, 1, "converting must write exactly one project activity");
  assert.equal(projectCreated[0].userId, owner.id);
  assert.equal(projectCreated[0].projectId, projectId);

  // 5) Both people can reach the delivered project through the API.
  for (const viewer of [owner, member]) {
    const detail = await invoke(getProject, `/api/projects/${projectId}`, {
      userId: viewer.id,
      params: { id: projectId },
    });
    assert.equal(detail.status, 200, `${viewer.name} must be able to open the project: ${JSON.stringify(detail.body)}`);
    assert.equal((detail.body as any)?.project?.id, projectId);
    assert.equal((detail.body as any)?.project?.dealId, dealId);
  }

  const dealDetail = await invoke(getDeal, `/api/crm/deals/${dealId}`, {
    userId: owner.id,
    params: { id: dealId },
  });
  assert.equal(dealDetail.status, 200, JSON.stringify(dealDetail.body));
  assert.equal((dealDetail.body as any)?.deal?.convertedProject?.id, projectId, "deal detail must surface the project");

  const listed = await invoke(listProjects, "/api/projects", { userId: member.id });
  assert.equal(listed.status, 200, JSON.stringify(listed.body));
  assert.ok(
    ((listed.body as any)?.projects ?? []).some((p: any) => p.id === projectId),
    "the project must appear in the new member's project list"
  );
});

test("converting a deal twice is refused and never forks a second project", async () => {
  await resetDb();
  const { owner } = await seedUsers();
  const dealId = await wonDeal(owner.id, "One-delivery-per-deal");

  const first = await convert(owner.id, dealId, { projectName: "Original delivery" });
  assert.equal(first.status, 201, JSON.stringify(first.body));
  const projectId = (first.body as any).project.id as string;

  const projectsAfterFirst = await db.project.count();
  const activitiesAfterFirst = await db.activity.count();

  // A retried request (double click, network replay) must not spawn a clone.
  const second = await convert(owner.id, dealId, { projectName: "Clone delivery" });
  assert.equal(second.status, 400, `a second conversion must be refused: ${JSON.stringify(second.body)}`);
  assert.match(
    String((second.body as any)?.error ?? ""),
    /already been converted/i,
    "the refusal must explain that the deal already has a project"
  );

  assert.equal(await db.project.count(), projectsAfterFirst, "no second project row may be created");
  assert.equal(await db.project.count({ where: { dealId } }), 1, "a deal may back one project only");
  assert.equal(await db.activity.count(), activitiesAfterFirst, "a refused conversion writes no audit rows");

  const deal = await db.deal.findUnique({ where: { id: dealId } });
  assert.equal(deal!.convertedProjectId, projectId, "the original project link must survive");
  const project = await db.project.findUnique({ where: { id: projectId } });
  assert.equal(project!.name, "Original delivery", "the original project must not be renamed");
});

test("conversion is refused for a deal that is not won, and for a member who does not own it", async () => {
  await resetDb();
  const { owner, member } = await seedUsers();
  const dealId = await newDealId(owner.id, "Still in flight");

  // Not won yet: DISCOVERY and NEGOTIATION must both be refused.
  for (const stage of [null, "PROPOSAL", "NEGOTIATION"]) {
    if (stage) assert.equal((await advance(owner.id, dealId, stage)).status, 200);
    const refused = await convert(owner.id, dealId);
    assert.equal(refused.status, 400, `${stage ?? "DISCOVERY"} must not convert: ${JSON.stringify(refused.body)}`);
    assert.match(String((refused.body as any)?.error ?? ""), /CLOSED_WON/);
  }
  assert.equal(await db.project.count(), 0, "no project may be created from an open deal");
  assert.equal((await db.deal.findUnique({ where: { id: dealId } }))!.convertedProjectId, null);

  // Now win it, and try to convert it as somebody who does not own it.
  const won = await advance(owner.id, dealId, "CLOSED_WON");
  assert.equal(won.status, 200, JSON.stringify(won.body));

  const stolen = await convert(member.id, dealId, { projectName: "Hijack delivery" });
  assert.equal(stolen.status, 403, `a member must not convert a deal they do not own: ${JSON.stringify(stolen.body)}`);
  assert.equal(await db.project.count(), 0, "the refused conversion must not create a project");
  assert.equal(
    (await db.deal.findUnique({ where: { id: dealId } }))!.convertedProjectId,
    null,
    "the refused conversion must not link a project"
  );

  const anon = await invoke(convertDeal, `/api/crm/deals/${dealId}/convert`, {
    method: "POST",
    params: { id: dealId },
    body: { confirm: true },
  });
  assert.equal(anon.status, 401, JSON.stringify(anon.body));

  // The owner can still deliver it afterwards.
  const delivered = await convert(owner.id, dealId);
  assert.equal(delivered.status, 201, JSON.stringify(delivered.body));
  assert.equal((delivered.body as any).project.name, "Still in flight", "the project defaults to the deal title");
});

test("milestones give the delivered project a billing schedule that persists", async () => {
  await resetDb();
  const { owner, member } = await seedUsers();
  const dealId = await wonDeal(owner.id, "Milestone billing deal");
  const converted = await convert(owner.id, dealId, { memberIds: [member.id] });
  assert.equal(converted.status, 201, JSON.stringify(converted.body));
  const projectId = (converted.body as any).project.id as string;

  const d1 = new Date(Date.now() + 14 * 24 * 3600 * 1000);
  const d2 = new Date(Date.now() + 40 * 24 * 3600 * 1000);

  const mk = (body: Record<string, unknown>) =>
    invoke(createMilestone, `/api/projects/${projectId}/milestones`, {
      method: "POST",
      userId: owner.id,
      params: { id: projectId },
      body,
    });

  const first = await mk({
    title: "Discovery & architecture sign-off",
    description: "Solution design approved by the client",
    dueDate: iso(d1),
    billingAmount: 750000,
    deliverables: ["Solution architecture", "Delivery plan"],
  });
  assert.equal(first.status, 201, JSON.stringify(first.body));

  const second = await mk({ title: "Production cutover", dueDate: iso(d2), billingAmount: 1750000 });
  assert.equal(second.status, 201, JSON.stringify(second.body));

  const rows = await db.projectMilestone.findMany({
    where: { projectId },
    orderBy: { dueDate: "asc" },
  });
  assert.equal(rows.length, 2, "both milestones must be persisted against the project");
  assert.equal(rows[0].title, "Discovery & architecture sign-off");
  assert.equal(rows[0].status, "PENDING");
  assert.equal(rows[0].billingAmount, 750000);
  assert.equal(rows[0].completedAt, null);
  assert.equal(rows[0].dueDate!.getTime(), d1.getTime());
  assert.deepEqual(JSON.parse(rows[0].deliverables), ["Solution architecture", "Delivery plan"]);
  assert.equal(rows[1].billingAmount, 1750000);
  assert.deepEqual(JSON.parse(rows[1].deliverables), [], "an empty deliverables list is a valid schedule entry");

  const billingTotal = rows.reduce((sum, m) => sum + m.billingAmount, 0);
  assert.equal(billingTotal, 2500000, "milestone billing should be able to cover the won deal value");

  const listed = await invoke(listMilestones, `/api/projects/${projectId}/milestones`, {
    userId: member.id,
    params: { id: projectId },
  });
  assert.equal(listed.status, 200, JSON.stringify(listed.body));
  assert.equal(((listed.body as any).milestones ?? []).length, 2, "the team must see the whole schedule");

  // Completing a milestone stamps it; reopening clears the stamp again.
  const completed = await invoke(
    updateMilestone,
    `/api/projects/${projectId}/milestones/${rows[0].id}`,
    {
      method: "PATCH",
      userId: owner.id,
      params: { id: projectId, milestoneId: rows[0].id },
      body: { status: "COMPLETED" },
    }
  );
  assert.equal(completed.status, 200, JSON.stringify(completed.body));
  const completedRow = await db.projectMilestone.findUnique({ where: { id: rows[0].id } });
  assert.equal(completedRow!.status, "COMPLETED");
  assert.ok(completedRow!.completedAt instanceof Date, "a completed milestone must be stamped");

  const reopened = await invoke(
    updateMilestone,
    `/api/projects/${projectId}/milestones/${rows[0].id}`,
    {
      method: "PATCH",
      userId: owner.id,
      params: { id: projectId, milestoneId: rows[0].id },
      body: { status: "IN_PROGRESS" },
    }
  );
  assert.equal(reopened.status, 200, JSON.stringify(reopened.body));
  assert.equal(
    (await db.projectMilestone.findUnique({ where: { id: rows[0].id } }))!.completedAt,
    null,
    "reopening a milestone must clear its completion stamp"
  );

  // A milestone cannot be smuggled onto another project's URL.
  const crossed = await invoke(
    updateMilestone,
    `/api/projects/${projectId}/milestones/${rows[1].id}`,
    {
      method: "PATCH",
      userId: owner.id,
      params: { id: "some-other-project", milestoneId: rows[1].id },
      body: { status: "COMPLETED" },
    }
  );
  assert.equal(crossed.status, 404, "a milestone must only be mutable through its own project");

  // A bogus milestone status is refused rather than persisted.
  const bogus = await invoke(
    updateMilestone,
    `/api/projects/${projectId}/milestones/${rows[1].id}`,
    {
      method: "PATCH",
      userId: owner.id,
      params: { id: projectId, milestoneId: rows[1].id },
      body: { status: "ALMOST_DONE" },
    }
  );
  assert.equal(bogus.status, 400, JSON.stringify(bogus.body));
  assert.equal((await db.projectMilestone.findUnique({ where: { id: rows[1].id } }))!.status, "PENDING");
});

test("tasks drive delivery, and assigning one notifies and unblocks the assignee", async () => {
  await resetDb();
  const { owner, member } = await seedUsers();
  const outsider = await db.user.create({
    data: { name: "Dev (Outsider)", email: "outsider@test.cyraops.com", role: "MEMBER", passwordHash: "x" },
  });

  const dealId = await wonDeal(owner.id, "Delivery team deal");
  const converted = await convert(owner.id, dealId, { memberIds: [member.id] });
  assert.equal(converted.status, 201, JSON.stringify(converted.body));
  const projectId = (converted.body as any).project.id as string;

  const dueDate = new Date(Date.now() + 7 * 24 * 3600 * 1000);
  const created = await invoke(createTask, "/api/tasks", {
    method: "POST",
    userId: owner.id,
    body: {
      title: "Lift-and-shift the VPN gateway",
      description: "Cutover window agreed with the client",
      projectId,
      assigneeId: member.id,
      priority: "HIGH",
      dueDate: iso(dueDate),
    },
  });
  assert.equal(created.status, 201, `task creation failed: ${JSON.stringify(created.body)}`);
  const taskId = (created.body as any)?.task?.id as string;
  assert.ok(taskId, "the create response must carry the task id");

  const task = await db.task.findUnique({ where: { id: taskId } });
  assert.equal(task!.projectId, projectId);
  assert.equal(task!.assigneeId, member.id, "the teammate must really be the assignee");
  assert.equal(task!.creatorId, owner.id);
  assert.equal(task!.status, "TODO", "a new task starts in TODO");
  assert.equal(task!.priority, "HIGH");
  assert.equal(task!.archivedAt, null);

  // 1) The assignee is notified, exactly once, and the notice points at the work.
  const notices = await db.notification.findMany({ where: { userId: member.id } });
  assert.equal(notices.length, 1, `the assignee must get exactly one notification, got ${notices.length}`);
  assert.equal(notices[0].type, "TASK_ASSIGNED");
  assert.equal(notices[0].body, "Lift-and-shift the VPN gateway");
  assert.equal(notices[0].readAt, null, "a fresh notification is unread");
  assert.ok(notices[0].href, "the notification must deep-link to the task board");
  assert.match(String(notices[0].href), new RegExp(projectId), "the deep link must point at this project");

  // 2) The creator is not notified about their own assignment.
  assert.equal(
    await db.notification.count({ where: { userId: owner.id } }),
    0,
    "the person doing the assigning must not be notified"
  );

  // 3) The assignee's own notification feed shows it as unread.
  const feed = await invoke(listNotifications, "/api/notifications", { userId: member.id });
  assert.equal(feed.status, 200, JSON.stringify(feed.body));
  const feedItems = (feed.body as any)?.notifications ?? [];
  assert.equal(feedItems.length, 1);
  assert.equal(feedItems[0].type, "TASK_ASSIGNED");
  assert.equal((feed.body as any)?.unreadCount, 1);

  const ownerFeed = await invoke(listNotifications, "/api/notifications", { userId: owner.id });
  assert.equal(ownerFeed.status, 200, JSON.stringify(ownerFeed.body));
  assert.equal(((ownerFeed.body as any)?.notifications ?? []).length, 0);
  assert.equal((ownerFeed.body as any)?.unreadCount, 0);

  // 4) The assignee can actually see and pick up the task.
  const memberProject = await invoke(getProject, `/api/projects/${projectId}`, {
    userId: member.id,
    params: { id: projectId },
  });
  assert.equal(memberProject.status, 200, JSON.stringify(memberProject.body));
  const projectTasks = (memberProject.body as any)?.project?.tasks ?? [];
  assert.ok(
    projectTasks.some((t: any) => t.id === taskId && t.assignee?.id === member.id),
    "the project detail must show the task to its assignee"
  );

  const memberTasks = await invoke(listTasks, `/api/tasks?projectId=${projectId}`, { userId: member.id });
  assert.equal(memberTasks.status, 200, JSON.stringify(memberTasks.body));
  assert.ok(
    ((memberTasks.body as any)?.tasks ?? []).some((t: any) => t.id === taskId),
    "the assignee's task list must include the assigned task"
  );

  const memberTask = await invoke(getTask, `/api/tasks/${taskId}`, { userId: member.id, params: { id: taskId } });
  assert.equal(memberTask.status, 200, `the assignee must be able to open the task: ${JSON.stringify(memberTask.body)}`);
  assert.equal((memberTask.body as any)?.task?.assignee?.id, member.id);

  // 5) Delivery actually moves: the assignee works the task to DONE.
  const inProgress = await invoke(updateTask, `/api/tasks/${taskId}`, {
    method: "PATCH",
    userId: member.id,
    params: { id: taskId },
    body: { status: "IN_PROGRESS" },
  });
  assert.equal(inProgress.status, 200, JSON.stringify(inProgress.body));
  assert.equal((await db.task.findUnique({ where: { id: taskId } }))!.status, "IN_PROGRESS");

  const done = await invoke(updateTask, `/api/tasks/${taskId}`, {
    method: "PATCH",
    userId: member.id,
    params: { id: taskId },
    body: { status: "DONE" },
  });
  assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.equal((await db.task.findUnique({ where: { id: taskId } }))!.status, "DONE");

  const progressed = await invoke(getProject, `/api/projects/${projectId}`, {
    userId: owner.id,
    params: { id: projectId },
  });
  assert.equal(progressed.status, 200, JSON.stringify(progressed.body));
  assert.equal((progressed.body as any)?.project?.progress, 100, "one finished task out of one is 100% delivered");

  // 6) The notice can be cleared.
  const read = await invoke(markNotifications, "/api/notifications", {
    method: "PATCH",
    userId: member.id,
    body: { id: notices[0].id },
  });
  assert.equal(read.status, 200, JSON.stringify(read.body));
  assert.ok(
    (await db.notification.findUnique({ where: { id: notices[0].id } }))!.readAt instanceof Date,
    "marking a notification read must stamp readAt"
  );
  const afterRead = await invoke(listNotifications, "/api/notifications", { userId: member.id });
  assert.equal((afterRead.body as any)?.unreadCount, 0);

  // 7) Work cannot be dumped on someone outside the project.
  const offProject = await invoke(createTask, "/api/tasks", {
    method: "POST",
    userId: owner.id,
    body: { title: "Sneaky assignment", projectId, assigneeId: outsider.id },
  });
  assert.equal(
    offProject.status,
    400,
    `an assignee outside the project must be refused: ${JSON.stringify(offProject.body)}`
  );
  assert.equal(await db.notification.count({ where: { userId: outsider.id } }), 0);
  assert.equal(await db.task.count({ where: { title: "Sneaky assignment" } }), 0);

  // 8) Delivery goes live: the lead moves the project from PLANNING to ACTIVE.
  const handoff = await invoke(updateProject, `/api/projects/${projectId}`, {
    method: "PATCH",
    userId: owner.id,
    params: { id: projectId },
    body: { status: "ACTIVE" },
  });
  assert.equal(handoff.status, 200, JSON.stringify(handoff.body));
  assert.equal((await db.project.findUnique({ where: { id: projectId } }))!.status, "ACTIVE", "delivery is live");

  // 9) Handing the task to a second teammate on the project notifies that teammate.
  const teammate = await db.user.create({
    data: { name: "Rhea (Delivery)", email: "rhea@test.cyraops.com", role: "MEMBER", passwordHash: "x" },
  });
  const staffed = await invoke(updateProject, `/api/projects/${projectId}`, {
    method: "PATCH",
    userId: owner.id,
    params: { id: projectId },
    body: { memberIds: [owner.id, member.id, teammate.id] },
  });
  assert.equal(staffed.status, 200, JSON.stringify(staffed.body));
  assert.equal(
    await db.projectMember.count({ where: { projectId, userId: teammate.id } }),
    1,
    "the second teammate must join the project"
  );

  const second = await invoke(createTask, "/api/tasks", {
    method: "POST",
    userId: owner.id,
    body: { title: "Write the runbook", projectId, assigneeId: teammate.id },
  });
  assert.equal(second.status, 201, JSON.stringify(second.body));
  const secondTaskId = (second.body as any).task.id as string;

  const teammateNotices = await db.notification.findMany({
    where: { userId: teammate.id, type: "TASK_ASSIGNED" },
  });
  assert.equal(teammateNotices.length, 1, "the second teammate must be notified of their assignment");
  assert.equal(teammateNotices[0].body, "Write the runbook");
  assert.equal(teammateNotices[0].readAt, null);

  const teammateTasks = await invoke(listTasks, `/api/tasks?projectId=${projectId}`, { userId: teammate.id });
  assert.equal(teammateTasks.status, 200, JSON.stringify(teammateTasks.body));
  assert.ok(
    ((teammateTasks.body as any)?.tasks ?? []).some((t: any) => t.id === secondTaskId),
    "the second teammate must see their task on the board"
  );
});

test("a delivered project's milestone billing is scoped to its delivery team", async () => {
  await resetDb();
  const { owner, member } = await seedUsers();
  const stranger = await db.user.create({
    data: { name: "Sam (Other Team)", email: "sam@test.cyraops.com", role: "MEMBER", passwordHash: "x" },
  });

  const dealId = await wonDeal(owner.id, "Scoped delivery deal");
  const converted = await convert(owner.id, dealId, { memberIds: [member.id] });
  assert.equal(converted.status, 201, JSON.stringify(converted.body));
  const projectId = (converted.body as any).project.id as string;

  const created = await invoke(createMilestone, `/api/projects/${projectId}/milestones`, {
    method: "POST",
    userId: owner.id,
    params: { id: projectId },
    body: { title: "Signed SOW", billingAmount: 1200000 },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const milestoneId = (created.body as any).milestone.id as string;

  // The delivery team keeps its access.
  const teamView = await invoke(listMilestones, `/api/projects/${projectId}/milestones`, {
    userId: member.id,
    params: { id: projectId },
  });
  assert.equal(teamView.status, 200, JSON.stringify(teamView.body));

  // Somebody who was never staffed on the project must not read the commercial
  // schedule, add to it, or touch it — the project and task APIs already scope
  // by membership, so milestones must too.
  const denied = (status: number) => status === 403 || status === 404;
  const before = await db.projectMilestone.findMany({ where: { projectId } });

  const peek = await invoke(listMilestones, `/api/projects/${projectId}/milestones`, {
    userId: stranger.id,
    params: { id: projectId },
  });
  assert.ok(
    denied(peek.status),
    `a non-member must not read another project's milestones, got ${peek.status}: ${JSON.stringify(peek.body)}`
  );

  const inject = await invoke(createMilestone, `/api/projects/${projectId}/milestones`, {
    method: "POST",
    userId: stranger.id,
    params: { id: projectId },
    body: { title: "Inflated milestone", billingAmount: 9999999 },
  });
  assert.ok(
    denied(inject.status),
    `a non-member must not add a milestone to another project, got ${inject.status}: ${JSON.stringify(inject.body)}`
  );
  assert.equal(
    await db.projectMilestone.count({ where: { projectId } }),
    before.length,
    "the refused milestone must not be persisted"
  );

  const tamper = await invoke(
    updateMilestone,
    `/api/projects/${projectId}/milestones/${milestoneId}`,
    {
      method: "PATCH",
      userId: stranger.id,
      params: { id: projectId, milestoneId },
      body: { status: "COMPLETED", billingAmount: 1 },
    }
  );
  assert.ok(
    denied(tamper.status),
    `a non-member must not change another project's milestone, got ${tamper.status}: ${JSON.stringify(tamper.body)}`
  );

  const wipe = await invoke(
    deleteMilestone,
    `/api/projects/${projectId}/milestones/${milestoneId}`,
    {
      method: "DELETE",
      userId: stranger.id,
      params: { id: projectId, milestoneId },
    }
  );
  assert.ok(
    denied(wipe.status),
    `a non-member must not delete another project's milestone, got ${wipe.status}: ${JSON.stringify(wipe.body)}`
  );

  const after = await db.projectMilestone.findUnique({ where: { id: milestoneId } });
  assert.ok(after, "the milestone must survive every refused attempt");
  assert.equal(after!.status, "PENDING");
  assert.equal(after!.billingAmount, 1200000);
});

test("a deal that has become a delivery project cannot fall back out of CLOSED_WON", async () => {
  await resetDb();
  const { owner, member } = await seedUsers();
  const dealId = await wonDeal(owner.id, "Delivered deal integrity");
  const converted = await convert(owner.id, dealId, { memberIds: [member.id] });
  assert.equal(converted.status, 201, JSON.stringify(converted.body));
  const projectId = (converted.body as any).project.id as string;

  // Once a project exists, the deal is the source of truth for a live delivery:
  // reopening it or declaring it lost would leave the project attached to a deal
  // that is no longer won — and the deal cannot be converted again from there.
  for (const stage of ["NEGOTIATION", "DISCOVERY", "CLOSED_LOST"]) {
    const reopened = await advance(owner.id, dealId, stage);
    assert.equal(
      reopened.status,
      400,
      `a converted deal must not move to ${stage}, got ${reopened.status}: ${JSON.stringify(reopened.body)}`
    );
    const row = await db.deal.findUnique({ where: { id: dealId } });
    assert.equal(row!.stage, "CLOSED_WON", `the converted deal must stay won after a blocked ${stage} attempt`);
    assert.equal(row!.probability, 100);
    assert.equal(row!.convertedProjectId, projectId, "the delivery link must never be cut by a stage change");
  }

  // And the delivered project must still be intact and reachable.
  const project = await invoke(getProject, `/api/projects/${projectId}`, {
    userId: owner.id,
    params: { id: projectId },
  });
  assert.equal(project.status, 200, JSON.stringify(project.body));
  assert.equal((project.body as any).project.dealId, dealId);
  assert.equal(await db.project.count({ where: { dealId } }), 1);
});

test("re-saving an unchanged assignment must not notify the assignee again", async () => {
  await resetDb();
  const { owner, member } = await seedUsers();
  const dealId = await wonDeal(owner.id, "Notification hygiene deal");
  const converted = await convert(owner.id, dealId, { memberIds: [member.id] });
  assert.equal(converted.status, 201, JSON.stringify(converted.body));
  const projectId = (converted.body as any).project.id as string;

  // A genuine hand-off does notify: the task starts unassigned, then the lead
  // gives it to the teammate.
  const draft = await invoke(createTask, "/api/tasks", {
    method: "POST",
    userId: owner.id,
    body: { title: "Terraform modules review", projectId },
  });
  assert.equal(draft.status, 201, JSON.stringify(draft.body));
  const taskId = (draft.body as any).task.id as string;
  assert.equal(
    await db.notification.count({ where: { userId: member.id, type: "TASK_ASSIGNED" } }),
    0,
    "an unassigned task must not notify anybody"
  );

  const assigned = await invoke(updateTask, `/api/tasks/${taskId}`, {
    method: "PATCH",
    userId: owner.id,
    params: { id: taskId },
    body: { assigneeId: member.id },
  });
  assert.equal(assigned.status, 200, JSON.stringify(assigned.body));
  assert.equal(
    await db.notification.count({ where: { userId: member.id, type: "TASK_ASSIGNED" } }),
    1,
    "handing the task over must notify the teammate once"
  );

  // Editing the task afterwards (an edit form re-submits the same assignee) must
  // not re-announce the assignment.
  for (const body of [{ assigneeId: member.id }, { assigneeId: member.id, title: "Terraform modules review v2" }, { status: "IN_PROGRESS" }]) {
    const saved = await invoke(updateTask, `/api/tasks/${taskId}`, {
      method: "PATCH",
      userId: owner.id,
      params: { id: taskId },
      body,
    });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
  }

  const duplicates = await db.notification.findMany({
    where: { userId: member.id, type: "TASK_ASSIGNED" },
  });
  assert.equal(
    duplicates.length,
    1,
    `editing a task must not re-notify its assignee, got ${duplicates.length} TASK_ASSIGNED notifications`
  );
  assert.equal((await db.task.findUnique({ where: { id: taskId } }))!.assigneeId, member.id);
});
