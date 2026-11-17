/**
 * J7 — the teammate boundary.
 *
 * The contract under test, exercised through the real route handlers with a
 * real NextRequest, a real session cookie and real Postgres writes:
 *
 *   MEMBER  → sees the whole shared pipeline (leads, deals) so the team works
 *             from one board, and sees their own tasks and projects;
 *             may only create or edit leads and deals assigned to themselves;
 *             cannot delete a project, archive a lead/contact/deal, or manage
 *             the team.
 *   OWNER   → sees and does everything.
 *
 * Read visibility and write authority are separate on purpose: widening who can
 * see a record must not widen who can change it.
 *
 * Every assertion is a business outcome read back from Postgres, never an echo
 * of the response body. `isDenied` accepts 403 or 404 on purpose: an
 * inaccessible record must look absent as well as forbidden, and both are a
 * correct boundary outcome. A 200 here is a leak; a 200 that also mutated the
 * row is a worse leak.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { resetDb, seedUsers, invoke, db } from "../helpers";

import { GET as listProjects, POST as createProject } from "../../src/app/api/projects/route";
import { GET as getProject, PATCH as patchProject, DELETE as deleteProject } from "../../src/app/api/projects/[id]/route";

import { GET as listLeads, POST as createLead } from "../../src/app/api/crm/leads/route";
import { GET as getLead, PATCH as patchLead, DELETE as deleteLead } from "../../src/app/api/crm/leads/[id]/route";

import { GET as listDeals, POST as createDeal } from "../../src/app/api/crm/deals/route";
import { GET as getDeal, PATCH as patchDeal, DELETE as deleteDeal } from "../../src/app/api/crm/deals/[id]/route";

import { POST as createContact } from "../../src/app/api/crm/contacts/route";
import { PATCH as patchContact, DELETE as deleteContact } from "../../src/app/api/crm/contacts/[id]/route";

import { GET as listTasks, POST as createTask } from "../../src/app/api/tasks/route";
import { GET as getTask, PATCH as patchTask, DELETE as deleteTask } from "../../src/app/api/tasks/[id]/route";

import { GET as listTeam, POST as createTeammate } from "../../src/app/api/team/route";
import { PATCH as patchTeammate } from "../../src/app/api/team/[id]/route";
import { POST as inviteTeammate } from "../../src/app/api/team/[id]/invite/route";

// ---------------------------------------------------------------------------
// small local helpers
// ---------------------------------------------------------------------------

const isOk = (status: number) => status >= 200 && status < 300;
/** An out-of-boundary request must be refused, however the API chooses to say it. */
const isDenied = (status: number) => status === 403 || status === 404;

const ids = (rows: { id: string }[]) => rows.map((row) => row.id).sort();

function created<T = any>(res: { status: number; body: unknown }, what: string): T {
  assert.ok(isOk(res.status), `${what} should succeed, got ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body as T;
}

/** A third teammate — needed to prove leaks between two MEMBERs, not only member→owner. */
async function extraMember(name: string) {
  return db.user.create({
    data: { name, email: `${name.toLowerCase()}@test.cyraops.com`, role: "MEMBER", passwordHash: "x" },
  });
}

async function makeProject(userId: string, name: string, memberIds: string[] = []) {
  const res = await invoke(createProject, "/api/projects", { method: "POST", userId, body: { name, memberIds } });
  return created<{ project: { id: string } }>(res, `create project "${name}"`).project;
}

async function makeLead(userId: string, title: string, assignedToId?: string) {
  const res = await invoke(createLead, "/api/crm/leads", {
    method: "POST",
    userId,
    body: assignedToId ? { title, assignedToId } : { title },
  });
  return created<{ lead: { id: string } }>(res, `create lead "${title}"`).lead;
}

async function makeDeal(userId: string, title: string, value = 1000, ownerId?: string) {
  const res = await invoke(createDeal, "/api/crm/deals", {
    method: "POST",
    userId,
    body: ownerId ? { title, value, ownerId } : { title, value },
  });
  return created<{ deal: { id: string } }>(res, `create deal "${title}"`).deal;
}

async function makeContact(userId: string, firstName: string) {
  const res = await invoke(createContact, "/api/crm/contacts", {
    method: "POST",
    userId,
    body: { firstName, lastName: "Boundary", title: "CTO" },
  });
  return created<{ contact: { id: string } }>(res, `create contact "${firstName}"`).contact;
}

async function makeTask(userId: string, projectId: string, title: string) {
  const res = await invoke(createTask, "/api/tasks", { method: "POST", userId, body: { title, projectId } });
  return created<{ task: { id: string } }>(res, `create task "${title}"`).task;
}

// ---------------------------------------------------------------------------
// PROJECTS
// ---------------------------------------------------------------------------

test("j7: a MEMBER lists only their own projects, an OWNER lists everything", async () => {
  await resetDb();
  const { owner, member } = await seedUsers();
  const other = await extraMember("rahul");

  const ownerProject = await makeProject(owner.id, "Owner Led Rollout");
  const memberProject = await makeProject(member.id, "Member Led Microsite");
  const otherProject = await makeProject(other.id, "Rahul Led Retainer");

  const memberList = await invoke(listProjects, "/api/projects", { userId: member.id });
  const memberProjects = created<{ projects: { id: string }[] }>(memberList, "member project list").projects;
  assert.deepEqual(ids(memberProjects), [memberProject.id], "a MEMBER must not see projects led by other people");

  // Read back from Postgres: the project really does exist, it is simply not the member's.
  assert.equal(await db.project.count(), 3, "all three projects must exist in the database");

  const ownerRes = await invoke(listProjects, "/api/projects", { userId: owner.id });
  const ownerProjects = created<{ projects: { id: string }[] }>(ownerRes, "owner project list").projects;
  assert.deepEqual(
    ids(ownerProjects),
    [ownerProject.id, memberProject.id, otherProject.id].sort(),
    "an OWNER must see every project"
  );
});

test("j7: a MEMBER cannot open a project they are not a member of", async () => {
  await resetDb();
  const { owner, member } = await seedUsers();
  const ownerProject = await makeProject(owner.id, "Owner Only Project");
  const memberProject = await makeProject(member.id, "Member Only Project");

  const denied = await invoke(getProject, `/api/projects/${ownerProject.id}`, { userId: member.id, params: { id: ownerProject.id } });
  assert.ok(isDenied(denied.status), `opening someone else's project must be refused, got ${denied.status}: ${JSON.stringify(denied.body)}`);
  assert.equal((denied.body as any)?.project, undefined, "a refused project read must not carry project data");

  const own = await invoke(getProject, `/api/projects/${memberProject.id}`, { userId: member.id, params: { id: memberProject.id } });
  assert.equal(own.status, 200, `a MEMBER must still open their own project: ${JSON.stringify(own.body)}`);
});

test("j7: a MEMBER cannot delete a project; an OWNER can", async () => {
  await resetDb();
  const { owner, member } = await seedUsers();
  const memberProject = await makeProject(member.id, "Member Owned Project");
  const ownerProject = await makeProject(owner.id, "Owner Owned Project");

  const deleteOwn = await invoke(deleteProject, `/api/projects/${memberProject.id}`, {
    method: "DELETE",
    userId: member.id,
    params: { id: memberProject.id },
  });
  assert.ok(isDenied(deleteOwn.status), `a MEMBER must not delete a project (even one they lead), got ${deleteOwn.status}`);
  assert.ok(await db.project.findUnique({ where: { id: memberProject.id } }), "the member's project must still exist after a refused delete");

  const deleteForeign = await invoke(deleteProject, `/api/projects/${ownerProject.id}`, {
    method: "DELETE",
    userId: member.id,
    params: { id: ownerProject.id },
  });
  assert.ok(isDenied(deleteForeign.status), `a MEMBER must not delete the owner's project, got ${deleteForeign.status}`);
  assert.ok(await db.project.findUnique({ where: { id: ownerProject.id } }), "the owner's project must survive a member's delete attempt");

  const deleteAsOwner = await invoke(deleteProject, `/api/projects/${ownerProject.id}`, {
    method: "DELETE",
    userId: owner.id,
    params: { id: ownerProject.id },
  });
  assert.equal(deleteAsOwner.status, 200, `an OWNER must be able to delete a project: ${JSON.stringify(deleteAsOwner.body)}`);
  assert.equal(await db.project.findUnique({ where: { id: ownerProject.id } }), null, "the deleted project must be gone from the database");
});

test("j7: a MEMBER cannot edit a project led by someone else; an OWNER can", async () => {
  await resetDb();
  const { owner, member } = await seedUsers();
  const project = await makeProject(owner.id, "Owner Led Delivery");

  const attempt = await invoke(patchProject, `/api/projects/${project.id}`, {
    method: "PATCH",
    userId: member.id,
    params: { id: project.id },
    body: { name: "Hijacked Name" },
  });
  assert.ok(isDenied(attempt.status), `a MEMBER must not edit another person's project, got ${attempt.status}: ${JSON.stringify(attempt.body)}`);

  const after = await db.project.findUniqueOrThrow({ where: { id: project.id } });
  assert.equal(after.name, "Owner Led Delivery", "the project name must be untouched in the database");

  const asOwner = await invoke(patchProject, `/api/projects/${project.id}`, {
    method: "PATCH",
    userId: owner.id,
    params: { id: project.id },
    body: { name: "Owner Renamed Delivery" },
  });
  assert.equal(asOwner.status, 200, `an OWNER must be able to edit the project: ${JSON.stringify(asOwner.body)}`);
  assert.equal((await db.project.findUniqueOrThrow({ where: { id: project.id } })).name, "Owner Renamed Delivery");
});

// ---------------------------------------------------------------------------
// LEADS
// ---------------------------------------------------------------------------

test("j7: the whole team sees every lead, and can filter by assignee", async () => {
  await resetDb();
  const { owner, member } = await seedUsers();
  const other = await extraMember("rahul");

  const ownerLead = await makeLead(owner.id, "Owner Enterprise Lead", owner.id);
  const memberLead = await makeLead(member.id, "Member SMB Lead");
  const otherLead = await makeLead(other.id, "Rahul Channel Lead");

  // The pipeline is shared: a MEMBER sees every lead, not only their own. Four
  // private notebooks is not a pipeline.
  const list = await invoke(listLeads, "/api/crm/leads", { userId: member.id });
  const body = created<{ leads: { id: string }[]; total: number }>(list, "member lead list");
  assert.equal(body.total, 3, `a MEMBER must see the whole pipeline, saw ${body.total}`);
  assert.deepEqual(ids(body.leads), [ownerLead.id, memberLead.id, otherLead.id].sort());

  // Filtering still works and still narrows.
  const filtered = await invoke(listLeads, `/api/crm/leads?assignedToId=${owner.id}`, { userId: member.id });
  const filteredBody = created<{ leads: { id: string }[] }>(filtered, "member lead list filtered by assignee");
  assert.deepEqual(ids(filteredBody.leads), [ownerLead.id], "?assignedToId must filter, not widen");

  const ownerList = await invoke(listLeads, "/api/crm/leads", { userId: owner.id });
  const ownerBody = created<{ leads: { id: string }[]; total: number }>(ownerList, "owner lead list");
  assert.equal(ownerBody.total, 3, `an OWNER must see every lead, saw ${ownerBody.total}`);
  assert.deepEqual(ids(ownerBody.leads), [ownerLead.id, memberLead.id, otherLead.id].sort());
});

test("j7: a MEMBER can open any lead but may only edit their own", async () => {
  await resetDb();
  const { owner, member } = await seedUsers();
  const memberLead = await makeLead(member.id, "Member SMB Lead");
  const ownerLead = await makeLead(owner.id, "Owner Enterprise Lead", owner.id);

  // A lead visible in the pipeline must be openable, or the list is a dead end.
  const visible = await invoke(getLead, `/api/crm/leads/${ownerLead.id}`, { userId: member.id, params: { id: ownerLead.id } });
  assert.equal(visible.status, 200, `a MEMBER must be able to open a teammate's lead: ${JSON.stringify(visible.body).slice(0, 200)}`);
  assert.equal((visible.body as any)?.lead?.id, ownerLead.id);

  // Authority did not widen with visibility.
  const edit = await invoke(patchLead, `/api/crm/leads/${ownerLead.id}`, {
    method: "PATCH",
    userId: member.id,
    params: { id: ownerLead.id },
    body: { notes: "member was here" },
  });
  assert.ok(isDenied(edit.status), `a MEMBER must not edit a teammate's lead, got ${edit.status}`);
  const untouched = await db.lead.findUniqueOrThrow({ where: { id: ownerLead.id } });
  assert.ok(!String(untouched.notes ?? "").includes("member was here"), "the refused edit must not have been written");

  const own = await invoke(getLead, `/api/crm/leads/${memberLead.id}`, { userId: member.id, params: { id: memberLead.id } });
  assert.equal(own.status, 200, `a MEMBER must still read their own lead: ${JSON.stringify(own.body).slice(0, 200)}`);
});

test("j7: a MEMBER cannot archive a lead (DELETE or PATCH archive), an OWNER can", async () => {
  await resetDb();
  const { owner, member } = await seedUsers();
  const ownerLead = await makeLead(owner.id, "Owner Lead To Protect", owner.id);
  const memberLead = await makeLead(member.id, "Member Lead To Protect");

  const viaDelete = await invoke(deleteLead, `/api/crm/leads/${memberLead.id}`, {
    method: "DELETE",
    userId: member.id,
    params: { id: memberLead.id },
  });
  assert.ok(isDenied(viaDelete.status), `a MEMBER must not archive their lead with DELETE, got ${viaDelete.status}`);
  assert.equal(
    (await db.lead.findUniqueOrThrow({ where: { id: memberLead.id } })).archivedAt,
    null,
    "the lead must remain active in the database after a refused archive"
  );

  const viaPatch = await invoke(patchLead, `/api/crm/leads/${memberLead.id}`, {
    method: "PATCH",
    userId: member.id,
    params: { id: memberLead.id },
    body: { archive: true },
  });
  assert.ok(isDenied(viaPatch.status), `a MEMBER must not archive their lead with PATCH archive, got ${viaPatch.status}`);
  assert.equal(
    (await db.lead.findUniqueOrThrow({ where: { id: memberLead.id } })).archivedAt,
    null,
    "the lead must still be active after a refused PATCH archive"
  );

  const foreignArchive = await invoke(deleteLead, `/api/crm/leads/${ownerLead.id}`, {
    method: "DELETE",
    userId: member.id,
    params: { id: ownerLead.id },
  });
  assert.ok(isDenied(foreignArchive.status), `a MEMBER must not archive the owner's lead, got ${foreignArchive.status}`);
  assert.equal((await db.lead.findUniqueOrThrow({ where: { id: ownerLead.id } })).archivedAt, null);

  // Positive control: the member may still update the working fields of their own lead.
  const statusUpdate = await invoke(patchLead, `/api/crm/leads/${memberLead.id}`, {
    method: "PATCH",
    userId: member.id,
    params: { id: memberLead.id },
    body: { status: "CONTACTED" },
  });
  assert.equal(statusUpdate.status, 200, `a MEMBER must be able to work their own lead: ${JSON.stringify(statusUpdate.body)}`);
  assert.equal((await db.lead.findUniqueOrThrow({ where: { id: memberLead.id } })).status, "CONTACTED");

  const ownerArchive = await invoke(deleteLead, `/api/crm/leads/${ownerLead.id}`, {
    method: "DELETE",
    userId: owner.id,
    params: { id: ownerLead.id },
  });
  assert.equal(ownerArchive.status, 200, `an OWNER must be able to archive a lead: ${JSON.stringify(ownerArchive.body)}`);
  assert.notEqual(
    (await db.lead.findUniqueOrThrow({ where: { id: ownerLead.id } })).archivedAt,
    null,
    "the archived lead must carry an archivedAt timestamp"
  );
});

test("j7: a MEMBER cannot modify a lead owned by a teammate", async () => {
  await resetDb();
  const { owner, member } = await seedUsers();
  const ownerLead = await makeLead(owner.id, "Owner Working Lead", owner.id);

  const attempt = await invoke(patchLead, `/api/crm/leads/${ownerLead.id}`, {
    method: "PATCH",
    userId: member.id,
    params: { id: ownerLead.id },
    body: { status: "UNQUALIFIED", score: 0 },
  });
  assert.ok(
    isDenied(attempt.status),
    `a MEMBER must not rewrite a teammate's lead, got ${attempt.status}: ${JSON.stringify(attempt.body).slice(0, 200)}`
  );
  const after = await db.lead.findUniqueOrThrow({ where: { id: ownerLead.id } });
  assert.equal(after.status, "NEW", "the teammate's lead status must be unchanged in the database");
});

// ---------------------------------------------------------------------------
// DEALS
// ---------------------------------------------------------------------------

test("j7: the whole team sees the deal pipeline, and can filter by owner", async () => {
  await resetDb();
  const { owner, member } = await seedUsers();
  const other = await extraMember("rahul");

  const ownerDeal = await makeDeal(owner.id, "Owner Enterprise Deal", 900000, owner.id);
  const memberDeal = await makeDeal(member.id, "Member SMB Deal", 50000);
  const otherDeal = await makeDeal(other.id, "Rahul Channel Deal", 20000);

  const list = await invoke(listDeals, "/api/crm/deals", { userId: member.id });
  const body = created<{ deals: { id: string }[]; total: number }>(list, "member deal list");
  assert.equal(body.total, 3, `a MEMBER must see the whole pipeline, saw ${body.total}`);
  assert.deepEqual(ids(body.deals), [ownerDeal.id, memberDeal.id, otherDeal.id].sort());

  const filtered = await invoke(listDeals, `/api/crm/deals?ownerId=${owner.id}`, { userId: member.id });
  const filteredBody = created<{ deals: { id: string }[] }>(filtered, "member deal list filtered by owner");
  assert.deepEqual(ids(filteredBody.deals), [ownerDeal.id], "?ownerId must filter, not widen");

  const pipeline = await invoke(listDeals, "/api/crm/deals?view=pipeline", { userId: member.id });
  const pipelineBody = created<{ deals: { id: string }[] }>(pipeline, "member pipeline view");
  assert.equal(pipelineBody.deals.length, 3, "the pipeline view shows the same shared pipeline");

  const ownerList = await invoke(listDeals, "/api/crm/deals", { userId: owner.id });
  const ownerBody = created<{ deals: { id: string }[]; total: number }>(ownerList, "owner deal list");
  assert.equal(ownerBody.total, 3, `an OWNER must see every deal, saw ${ownerBody.total}`);
  assert.deepEqual(ids(ownerBody.deals), [ownerDeal.id, memberDeal.id, otherDeal.id].sort());
});

test("j7: a MEMBER can open any deal but may only change their own", async () => {
  await resetDb();
  const { owner, member } = await seedUsers();
  const memberDeal = await makeDeal(member.id, "Member SMB Deal", 50000);
  const ownerDeal = await makeDeal(owner.id, "Owner Enterprise Deal", 900000, owner.id);

  const visible = await invoke(getDeal, `/api/crm/deals/${ownerDeal.id}`, { userId: member.id, params: { id: ownerDeal.id } });
  assert.equal(visible.status, 200, `a MEMBER must be able to open a teammate's deal: ${JSON.stringify(visible.body).slice(0, 200)}`);
  assert.equal((visible.body as any)?.deal?.id, ownerDeal.id);

  const edit = await invoke(patchDeal, `/api/crm/deals/${ownerDeal.id}`, {
    method: "PATCH",
    userId: member.id,
    params: { id: ownerDeal.id },
    body: { notes: "member touched this" },
  });
  assert.ok(isDenied(edit.status), `a MEMBER must not modify a teammate's deal, got ${edit.status}`);
  const untouched = await db.deal.findUniqueOrThrow({ where: { id: ownerDeal.id } });
  assert.ok(!String(untouched.notes ?? "").includes("member touched this"), "the refused edit must not be written");

  const own = await invoke(getDeal, `/api/crm/deals/${memberDeal.id}`, { userId: member.id, params: { id: memberDeal.id } });
  assert.equal(own.status, 200, `a MEMBER must still read their own deal: ${JSON.stringify(own.body).slice(0, 200)}`);
});

test("j7: a MEMBER cannot archive a deal or touch a teammate's deal, an OWNER can", async () => {
  await resetDb();
  const { owner, member } = await seedUsers();
  const ownerDeal = await makeDeal(owner.id, "Owner Deal To Protect", 900000, owner.id);
  const memberDeal = await makeDeal(member.id, "Member Deal To Protect", 40000);

  const viaDelete = await invoke(deleteDeal, `/api/crm/deals/${memberDeal.id}`, {
    method: "DELETE",
    userId: member.id,
    params: { id: memberDeal.id },
  });
  assert.ok(isDenied(viaDelete.status), `a MEMBER must not archive their deal with DELETE, got ${viaDelete.status}`);
  assert.equal(
    (await db.deal.findUniqueOrThrow({ where: { id: memberDeal.id } })).archivedAt,
    null,
    "the deal must remain active after a refused archive"
  );

  const viaPatch = await invoke(patchDeal, `/api/crm/deals/${memberDeal.id}`, {
    method: "PATCH",
    userId: member.id,
    params: { id: memberDeal.id },
    body: { archive: true },
  });
  assert.ok(isDenied(viaPatch.status), `a MEMBER must not archive their deal with PATCH archive, got ${viaPatch.status}`);
  assert.equal((await db.deal.findUniqueOrThrow({ where: { id: memberDeal.id } })).archivedAt, null);

  const foreignEdit = await invoke(patchDeal, `/api/crm/deals/${ownerDeal.id}`, {
    method: "PATCH",
    userId: member.id,
    params: { id: ownerDeal.id },
    body: { value: 1, stage: "CLOSED_LOST" },
  });
  assert.ok(isDenied(foreignEdit.status), `a MEMBER must not edit a teammate's deal, got ${foreignEdit.status}`);
  const afterForeign = await db.deal.findUniqueOrThrow({ where: { id: ownerDeal.id } });
  assert.equal(afterForeign.value, 900000, "the teammate's deal value must be unchanged");
  assert.equal(afterForeign.stage, "DISCOVERY", "the teammate's deal stage must be unchanged");

  // Positive control: the member can still move their own deal forward.
  const ownMove = await invoke(patchDeal, `/api/crm/deals/${memberDeal.id}`, {
    method: "PATCH",
    userId: member.id,
    params: { id: memberDeal.id },
    body: { stage: "PROPOSAL" },
  });
  assert.equal(ownMove.status, 200, `a MEMBER must be able to move their own deal: ${JSON.stringify(ownMove.body)}`);
  assert.equal((await db.deal.findUniqueOrThrow({ where: { id: memberDeal.id } })).stage, "PROPOSAL");

  const ownerArchive = await invoke(deleteDeal, `/api/crm/deals/${ownerDeal.id}`, {
    method: "DELETE",
    userId: owner.id,
    params: { id: ownerDeal.id },
  });
  assert.equal(ownerArchive.status, 200, `an OWNER must be able to archive a deal: ${JSON.stringify(ownerArchive.body)}`);
  assert.notEqual((await db.deal.findUniqueOrThrow({ where: { id: ownerDeal.id } })).archivedAt, null);
});

// ---------------------------------------------------------------------------
// CONTACTS  (shared records — but archiving is an OWNER-only action)
// ---------------------------------------------------------------------------

test("j7: a MEMBER cannot archive a contact; an OWNER can", async () => {
  await resetDb();
  const { owner, member } = await seedUsers();
  const contact = await makeContact(owner.id, "Priya");

  const viaDelete = await invoke(deleteContact, `/api/crm/contacts/${contact.id}`, {
    method: "DELETE",
    userId: member.id,
    params: { id: contact.id },
  });
  assert.ok(isDenied(viaDelete.status), `a MEMBER must not archive a contact with DELETE, got ${viaDelete.status}`);
  assert.equal(
    (await db.contact.findUniqueOrThrow({ where: { id: contact.id } })).archivedAt,
    null,
    "the contact must remain active after a refused archive"
  );

  const viaPatch = await invoke(patchContact, `/api/crm/contacts/${contact.id}`, {
    method: "PATCH",
    userId: member.id,
    params: { id: contact.id },
    body: { archive: true },
  });
  assert.ok(isDenied(viaPatch.status), `a MEMBER must not archive a contact with PATCH archive, got ${viaPatch.status}`);
  assert.equal((await db.contact.findUniqueOrThrow({ where: { id: contact.id } })).archivedAt, null);

  // Positive control: the member may still edit the working fields of the contact.
  const edit = await invoke(patchContact, `/api/crm/contacts/${contact.id}`, {
    method: "PATCH",
    userId: member.id,
    params: { id: contact.id },
    body: { title: "Head of Ops" },
  });
  assert.equal(edit.status, 200, `a MEMBER must be able to edit a shared contact: ${JSON.stringify(edit.body)}`);
  assert.equal((await db.contact.findUniqueOrThrow({ where: { id: contact.id } })).title, "Head of Ops");

  const ownerArchive = await invoke(deleteContact, `/api/crm/contacts/${contact.id}`, {
    method: "DELETE",
    userId: owner.id,
    params: { id: contact.id },
  });
  assert.equal(ownerArchive.status, 200, `an OWNER must be able to archive a contact: ${JSON.stringify(ownerArchive.body)}`);
  assert.notEqual((await db.contact.findUniqueOrThrow({ where: { id: contact.id } })).archivedAt, null);
});

// ---------------------------------------------------------------------------
// TASKS  (scoped by project membership)
// ---------------------------------------------------------------------------

test("j7: a MEMBER cannot see or touch tasks in a project they are not on", async () => {
  await resetDb();
  const { owner, member } = await seedUsers();
  const ownerProject = await makeProject(owner.id, "Owner Confidential Project");
  const ownerTask = await makeTask(owner.id, ownerProject.id, "Owner Confidential Task");

  const list = await invoke(listTasks, `/api/tasks?projectId=${ownerProject.id}`, { userId: member.id });
  assert.ok(isDenied(list.status), `a MEMBER must not list tasks of a foreign project, got ${list.status}: ${JSON.stringify(list.body).slice(0, 200)}`);
  assert.equal((list.body as any)?.tasks, undefined, "a refused task list must not carry task data");

  const read = await invoke(getTask, `/api/tasks/${ownerTask.id}`, { userId: member.id, params: { id: ownerTask.id } });
  assert.ok(isDenied(read.status), `a MEMBER must not read a foreign task, got ${read.status}: ${JSON.stringify(read.body).slice(0, 200)}`);

  const patch = await invoke(patchTask, `/api/tasks/${ownerTask.id}`, {
    method: "PATCH",
    userId: member.id,
    params: { id: ownerTask.id },
    body: { status: "DONE" },
  });
  assert.ok(isDenied(patch.status), `a MEMBER must not edit a foreign task, got ${patch.status}: ${JSON.stringify(patch.body).slice(0, 200)}`);
  assert.equal((await db.task.findUniqueOrThrow({ where: { id: ownerTask.id } })).status, "TODO", "the foreign task status must be unchanged");

  const remove = await invoke(deleteTask, `/api/tasks/${ownerTask.id}`, {
    method: "DELETE",
    userId: member.id,
    params: { id: ownerTask.id },
  });
  assert.ok(isDenied(remove.status), `a MEMBER must not archive a foreign task, got ${remove.status}: ${JSON.stringify(remove.body).slice(0, 200)}`);
  assert.equal((await db.task.findUniqueOrThrow({ where: { id: ownerTask.id } })).archivedAt, null, "the foreign task must stay active");

  const create = await invoke(createTask, "/api/tasks", {
    method: "POST",
    userId: member.id,
    body: { title: "Injected Task", projectId: ownerProject.id },
  });
  assert.ok(isDenied(create.status), `a MEMBER must not add a task to a foreign project, got ${create.status}: ${JSON.stringify(create.body).slice(0, 200)}`);
  assert.equal(await db.task.count({ where: { projectId: ownerProject.id } }), 1, "no extra task may land in the foreign project");

  // The OWNER still reaches the task.
  const ownerRead = await invoke(getTask, `/api/tasks/${ownerTask.id}`, { userId: owner.id, params: { id: ownerTask.id } });
  assert.equal(ownerRead.status, 200, `an OWNER must read the task: ${JSON.stringify(ownerRead.body).slice(0, 200)}`);
});

test("j7: a MEMBER works tasks freely inside a project they belong to", async () => {
  await resetDb();
  const { owner, member } = await seedUsers();
  const project = await makeProject(owner.id, "Shared Delivery Project", [member.id]);

  // Adding the member must actually place them on the project in the database.
  assert.ok(
    await db.projectMember.findUnique({ where: { projectId_userId: { projectId: project.id, userId: member.id } } }),
    "the member must be a project member in the database"
  );

  const task = await makeTask(member.id, project.id, "Member Owned Task");

  const list = await invoke(listTasks, `/api/tasks?projectId=${project.id}`, { userId: member.id });
  const body = created<{ tasks: { id: string }[] }>(list, "member task list for own project");
  assert.deepEqual(ids(body.tasks), [task.id], "a project member must see the project's tasks");

  const move = await invoke(patchTask, `/api/tasks/${task.id}`, {
    method: "PATCH",
    userId: member.id,
    params: { id: task.id },
    body: { status: "IN_PROGRESS" },
  });
  assert.equal(move.status, 200, `a project member must be able to work the task: ${JSON.stringify(move.body)}`);
  assert.equal((await db.task.findUniqueOrThrow({ where: { id: task.id } })).status, "IN_PROGRESS");
});

// ---------------------------------------------------------------------------
// TEAM
// ---------------------------------------------------------------------------

test("j7: a MEMBER cannot manage the team, an OWNER can", async () => {
  await resetDb();
  const { owner, member } = await seedUsers();
  const other = await extraMember("rahul");

  const before = await db.user.count();

  const invite = await invoke(createTeammate, "/api/team", {
    method: "POST",
    userId: member.id,
    body: { name: "Ghost Teammate", email: "ghost@test.cyraops.com", role: "MEMBER" },
  });
  assert.ok(isDenied(invite.status), `a MEMBER must not add a teammate, got ${invite.status}: ${JSON.stringify(invite.body).slice(0, 200)}`);
  assert.equal(await db.user.count(), before, "no user row may be created by a member");
  assert.equal(await db.user.findFirst({ where: { email: "ghost@test.cyraops.com" } }), null);

  const promote = await invoke(patchTeammate, `/api/team/${other.id}`, {
    method: "PATCH",
    userId: member.id,
    params: { id: other.id },
    body: { role: "ADMIN" },
  });
  assert.ok(isDenied(promote.status), `a MEMBER must not change a teammate's role, got ${promote.status}: ${JSON.stringify(promote.body).slice(0, 200)}`);
  assert.equal((await db.user.findUniqueOrThrow({ where: { id: other.id } })).role, "MEMBER", "the teammate's role must be unchanged");

  const disableOwner = await invoke(patchTeammate, `/api/team/${owner.id}`, {
    method: "PATCH",
    userId: member.id,
    params: { id: owner.id },
    body: { disabled: true },
  });
  assert.ok(isDenied(disableOwner.status), `a MEMBER must not deactivate anybody, got ${disableOwner.status}: ${JSON.stringify(disableOwner.body).slice(0, 200)}`);
  assert.equal((await db.user.findUniqueOrThrow({ where: { id: owner.id } })).disabledAt, null, "the owner must stay active");

  const selfPromote = await invoke(patchTeammate, `/api/team/${member.id}`, {
    method: "PATCH",
    userId: member.id,
    params: { id: member.id },
    body: { role: "ADMIN" },
  });
  assert.ok(isDenied(selfPromote.status), `a MEMBER must not promote themselves, got ${selfPromote.status}`);
  assert.equal((await db.user.findUniqueOrThrow({ where: { id: member.id } })).role, "MEMBER", "the member must not have self-promoted");

  const setupLink = await invoke(inviteTeammate, `/api/team/${other.id}/invite`, {
    method: "POST",
    userId: member.id,
    params: { id: other.id },
  });
  assert.ok(isDenied(setupLink.status), `a MEMBER must not mint a setup link, got ${setupLink.status}: ${JSON.stringify(setupLink.body).slice(0, 200)}`);
  assert.equal((setupLink.body as any)?.setupToken, undefined, "a refused setup-link request must not leak a token");
  assert.equal(await db.passwordSetupToken.count({ where: { userId: other.id } }), 0, "no setup token row may be created by a member");

  // ---- positive controls: the OWNER holds the same powers ----
  const ownerPromote = await invoke(patchTeammate, `/api/team/${other.id}`, {
    method: "PATCH",
    userId: owner.id,
    params: { id: other.id },
    body: { role: "ADMIN" },
  });
  assert.equal(ownerPromote.status, 200, `an OWNER must be able to change roles: ${JSON.stringify(ownerPromote.body)}`);
  assert.equal((await db.user.findUniqueOrThrow({ where: { id: other.id } })).role, "ADMIN");

  const ownerDisable = await invoke(patchTeammate, `/api/team/${other.id}`, {
    method: "PATCH",
    userId: owner.id,
    params: { id: other.id },
    body: { disabled: true },
  });
  assert.equal(ownerDisable.status, 200, `an OWNER must be able to deactivate a teammate: ${JSON.stringify(ownerDisable.body)}`);
  assert.notEqual((await db.user.findUniqueOrThrow({ where: { id: other.id } })).disabledAt, null);

  // Keep the invitation test offline: an unconfigured mailbox short-circuits the send.
  const savedPassword = process.env.GODADDY_EMAIL_PASSWORD;
  process.env.GODADDY_EMAIL_PASSWORD = "";
  try {
    const ownerInvite = await invoke(createTeammate, "/api/team", {
      method: "POST",
      userId: owner.id,
      body: { name: "New Teammate", email: "new.teammate@test.cyraops.com", role: "MEMBER" },
    });
    assert.equal(ownerInvite.status, 201, `an OWNER must be able to add a teammate: ${JSON.stringify(ownerInvite.body).slice(0, 300)}`);
    const created2 = await db.user.findFirst({ where: { email: "new.teammate@test.cyraops.com" } });
    assert.ok(created2, "the invited teammate must exist in the database");
    assert.equal(created2!.role, "MEMBER");
    assert.equal(await db.user.count(), before + 1, "exactly one new user row for the owner's invite");
  } finally {
    process.env.GODADDY_EMAIL_PASSWORD = savedPassword;
  }
});

test("j7: the team list never leaks password hashes or setup tokens to a MEMBER", async () => {
  await resetDb();
  const { owner, member } = await seedUsers();
  await extraMember("rahul");

  const res = await invoke(listTeam, "/api/team", { userId: member.id });
  const body = created<{ members: Record<string, unknown>[] }>(res, "member team list");
  assert.equal(body.members.length, 3, "the roster itself is shared workspace information");
  for (const person of body.members) {
    assert.equal(person.passwordHash, undefined, "the team list must never expose password hashes");
    assert.equal(person.setupTokens, undefined, "the team list must never expose setup tokens");
  }
});
