import { test } from "node:test";
import assert from "node:assert/strict";
import { resetDb, seedUsers, invoke, db } from "../helpers";
import { POST as createLead, GET as listLeads } from "../../src/app/api/crm/leads/route";
import { PATCH as updateLead } from "../../src/app/api/crm/leads/[id]/route";

// J1 — capture and qualify a lead, and enforce the owner boundary.

test("a lead can be created, listed and qualified through the real routes", async () => {
  await resetDb();
  const { owner, member } = await seedUsers();

  const created = await invoke(createLead, "/api/crm/leads", {
    method: "POST",
    userId: owner.id,
    body: { title: "Acme Corp", companyName: "Acme Corp", email: "buyer@acme.com", source: "LinkedIn", status: "NEW" },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const leadId = (created.body as any)?.lead?.id;
  assert.ok(leadId, "expected a lead id back");

  const list = await invoke(listLeads, "/api/crm/leads", { userId: owner.id });
  const leads = (list.body as any)?.leads ?? [];
  assert.ok(leads.some((lead: any) => lead.id === leadId), "lead should appear in the list");

  const qualified = await invoke(updateLead, `/api/crm/leads/${leadId}`, {
    method: "PATCH",
    userId: owner.id,
    params: { id: leadId },
    body: { status: "QUALIFIED" },
  });
  assert.equal(qualified.status, 200, JSON.stringify(qualified.body));

  const row = await db.lead.findUnique({ where: { id: leadId } });
  assert.equal(row?.status, "QUALIFIED");
});

test("a member sees the shared lead pipeline but cannot edit another owner's lead", async () => {
  await resetDb();
  const { owner, member } = await seedUsers();
  const ownerLead = await db.lead.create({
    data: { title: "Shared Corp", companyName: "Shared", assignedToId: owner.id, email: "x@shared.com" },
  });

  const list = await invoke(listLeads, "/api/crm/leads", { userId: member.id });
  const leads = (list.body as any)?.leads ?? [];
  assert.equal(leads.length, 1, "a member works from the same pipeline as everyone else");
  assert.equal(leads[0].id, ownerLead.id);

  // Visibility did not become authority.
  const patch = await invoke(updateLead, `/api/crm/leads/${ownerLead.id}`, {
    method: "PATCH",
    userId: member.id,
    params: { id: ownerLead.id },
    body: { notes: "member edit attempt" },
  });
  assert.ok(patch.status === 403 || patch.status === 404, `a member must not edit another owner's lead, got ${patch.status}`);
  const row = await db.lead.findUnique({ where: { id: ownerLead.id } });
  assert.ok(!String(row?.notes ?? "").includes("member edit attempt"), "the refused edit must not be written");
});
