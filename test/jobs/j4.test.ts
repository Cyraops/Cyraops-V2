import { test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { resetDb, seedUsers, invoke, db } from "../helpers";
import { createSession } from "../../src/lib/auth";

import { POST as createCategory } from "../../src/app/api/cost/categories/route";
import { GET as listExpenses, POST as createExpense } from "../../src/app/api/cost/expenses/route";
import { GET as getExpense, DELETE as deleteExpense } from "../../src/app/api/cost/expenses/[id]/route";
import * as costInvoicesRoute from "../../src/app/api/cost/invoices/route";
import { GET as listCostInvoices } from "../../src/app/api/cost/invoices/route";
import { POST as uploadInvoice } from "../../src/app/api/cost/invoices/upload/route";
import { POST as verifyInvoice } from "../../src/app/api/cost/invoices/verify/route";
import { POST as createBillingInvoice } from "../../src/app/api/billing/invoices/route";
import { POST as createProject } from "../../src/app/api/projects/route";

// J4 — money per project.
// Every assertion is a business outcome read back from Postgres (or from the
// route contract itself), never an echo of the response body.

const ok = (status: number) => status >= 200 && status < 300;

/** Multipart upload needs a real FormData body, so mirror `invoke` for it. */
async function invokeForm(
  handler: (request: NextRequest, context: any) => Promise<Response>,
  path: string,
  form: FormData,
  userId: string
) {
  const { token } = await createSession(userId);
  const request = new NextRequest(new URL(`https://test.local${path}`), {
    method: "POST",
    headers: { origin: "https://test.local", "sec-fetch-site": "same-origin", cookie: `company_session=${token}` },
    body: form,
  });
  const response = await handler(request, { params: Promise.resolve({}) });
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: response.status, body };
}

async function makeCategory(userId: string, name = "Software Subscriptions") {
  const res = await invoke(createCategory, "/api/cost/categories", {
    method: "POST",
    userId,
    body: { name, slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-") },
  });
  assert.ok(ok(res.status), `category creation failed: ${JSON.stringify(res.body)}`);
  const id = (res.body as any)?.category?.id as string;
  assert.ok(id, "the category response must carry the new category id");
  return id;
}

async function makeProject(userId: string, name: string, memberIds: string[] = []) {
  const res = await invoke(createProject, "/api/projects", {
    method: "POST",
    userId,
    body: { name, memberIds },
  });
  assert.equal(res.status, 201, `project creation failed: ${JSON.stringify(res.body)}`);
  return (res.body as any).project.id as string;
}

/** Uploads a receipt and returns the resulting InvoiceRecord id. */
async function upload(fileName: string, contents: string, userId: string) {
  const form = new FormData();
  form.append("file", new File([contents], fileName, { type: "application/pdf" }));
  const res = await invokeForm(uploadInvoice, "/api/cost/invoices/upload", form, userId);
  assert.ok(ok(res.status), `invoice upload failed: ${JSON.stringify(res.body)}`);
  const id = (res.body as any)?.invoice?.id as string;
  assert.ok(id, "the upload response must carry the created invoice id");
  return { id, body: res.body as any };
}

test("an expense recorded for a project is stored against that project and lists per project", async () => {
  await resetDb();
  const { owner, member } = await seedUsers();
  const categoryId = await makeCategory(owner.id);
  const alphaProject = await makeProject(owner.id, "Nimbus cloud migration", [member.id]);
  const betaProject = await makeProject(owner.id, "Internal retainer", [member.id]);

  const res = await invoke(createExpense, "/api/cost/expenses", {
    method: "POST",
    userId: owner.id,
    body: {
      title: "AWS production account — March",
      description: "Data transfer + NAT gateway",
      amount: 100,
      currency: "USD",
      categoryId,
      vendor: "Amazon Web Services",
      invoiceNumber: "AWS-2026-03",
      projectId: alphaProject,
      paymentMethod: "CREDIT_CARD",
      paymentStatus: "PAID",
    },
  });
  assert.ok(ok(res.status), `expense creation failed: ${JSON.stringify(res.body)}`);

  const row = await db.expense.findFirst({ where: { invoiceNumber: "AWS-2026-03" } });
  assert.ok(row, "the expense must be persisted");

  // The point of the job: money attributable to a project.
  assert.equal(
    (row as any).projectId,
    alphaProject,
    "an expense submitted with a projectId must be recorded against that project"
  );

  // A second expense on a different project must not bleed into the first.
  const other = await invoke(createExpense, "/api/cost/expenses", {
    method: "POST",
    userId: owner.id,
    body: {
      title: "Retainer tooling",
      amount: 5000,
      currency: "INR",
      categoryId,
      vendor: "Figma Inc",
      invoiceNumber: "FIG-2026-03",
      projectId: betaProject,
    },
  });
  assert.ok(ok(other.status), `second expense creation failed: ${JSON.stringify(other.body)}`);

  const scoped = await invoke(listExpenses, `/api/cost/expenses?projectId=${alphaProject}`, {
    userId: owner.id,
  });
  assert.equal(scoped.status, 200, JSON.stringify(scoped.body));
  const listed = ((scoped.body as any)?.expenses ?? []) as any[];
  assert.deepEqual(
    listed.map((e) => e.title),
    ["AWS production account — March"],
    `expenses must be filterable by project, got ${JSON.stringify(listed.map((e) => e.title))}`
  );

  // The verified-invoice path books cost too, and must keep the project too.
  const uploaded = await upload("aws-2026-04.pdf", "%PDF-1.4 aws april", owner.id);
  const verified = await invoke(verifyInvoice, "/api/cost/invoices/verify", {
    method: "POST",
    userId: owner.id,
    body: {
      invoiceId: uploaded.id,
      vendor: "Amazon Web Services",
      invoiceNumber: "AWS-2026-04",
      totalAmount: 220,
      currency: "USD",
      categoryId,
      projectId: alphaProject,
      createExpense: true,
    },
  });
  assert.ok(ok(verified.status), `invoice verification failed: ${JSON.stringify(verified.body)}`);

  const fromInvoice = await db.expense.findFirst({ where: { invoiceNumber: "AWS-2026-04" } });
  assert.ok(fromInvoice, "verifying an invoice must book an expense");
  assert.equal(
    (fromInvoice as any).projectId,
    alphaProject,
    "an expense booked from a project invoice must be recorded against that project"
  );
});

test("a member submits their own expense claim and cannot delete another user's expense", async () => {
  await resetDb();
  const { owner, member } = await seedUsers();
  const secondMember = await db.user.create({
    data: { name: "Rhea (Member)", email: "rhea@test.cyraops.com", role: "MEMBER", passwordHash: "x" },
  });
  const categoryId = await makeCategory(owner.id);

  // The owner books a company expense.
  const ownerExpense = await invoke(createExpense, "/api/cost/expenses", {
    method: "POST",
    userId: owner.id,
    body: {
      title: "Datadog annual plan",
      amount: 100,
      currency: "USD",
      categoryId,
      vendor: "Datadog Inc",
      paymentStatus: "PAID",
      classification: "OPEX",
    },
  });
  assert.ok(ok(ownerExpense.status), JSON.stringify(ownerExpense.body));
  const ownerExpenseId = (ownerExpense.body as any)?.expense?.id as string;
  assert.ok(ownerExpenseId);

  const ownerRow = await db.expense.findUnique({ where: { id: ownerExpenseId } });
  assert.equal(ownerRow!.userId, owner.id);
  assert.equal(ownerRow!.paymentStatus, "PAID", "an owner-recorded expense keeps its payment status");
  assert.equal(ownerRow!.amountBase, 8650, "100 USD must be booked at the 86.5 INR baseline");

  // The member files their own reimbursement claim.
  const claim = await invoke(createExpense, "/api/cost/expenses", {
    method: "POST",
    userId: member.id,
    body: {
      title: "Client visit — airport taxi",
      amount: 1450,
      currency: "INR",
      categoryId,
      vendor: "Uber India",
      paymentStatus: "PAID",
      classification: "CAPEX",
      isRecurring: true,
    },
  });
  assert.ok(ok(claim.status), `a member must be able to file a claim: ${JSON.stringify(claim.body)}`);

  const claimRow = await db.expense.findFirst({ where: { title: "Client visit — airport taxi" } });
  assert.ok(claimRow, "the member's claim must be persisted");
  assert.equal(claimRow!.userId, member.id, "the claim must be booked to the member who filed it");
  assert.equal(
    claimRow!.paymentStatus,
    "REIMBURSEMENT_PENDING",
    "a member's claim must wait for reimbursement, whatever they asked for"
  );
  assert.equal(claimRow!.classification, "OPEX", "a member cannot self-classify spend as CAPEX");
  assert.equal(claimRow!.isRecurring, false, "a member cannot create a recurring company cost");
  assert.equal(claimRow!.amountBase, 1450, "an INR claim books 1:1 into the base currency");

  // A member can read their own claim.
  const read = await invoke(getExpense, `/api/cost/expenses/${claimRow!.id}`, {
    userId: member.id,
    params: { id: claimRow!.id },
  });
  assert.equal(read.status, 200, JSON.stringify(read.body));

  // ... but not somebody else's.
  const peek = await invoke(getExpense, `/api/cost/expenses/${ownerExpenseId}`, {
    userId: member.id,
    params: { id: ownerExpenseId },
  });
  assert.equal(peek.status, 403, `a member must not read another user's expense: ${JSON.stringify(peek.body)}`);

  // The member's list is scoped to their own claims.
  const memberList = await invoke(listExpenses, "/api/cost/expenses", { userId: member.id });
  assert.equal(memberList.status, 200, JSON.stringify(memberList.body));
  assert.deepEqual(
    (((memberList.body as any)?.expenses ?? []) as any[]).map((e) => e.id),
    [claimRow!.id],
    "a member's expense list must contain only their own records"
  );

  // DELETING ANOTHER USER'S EXPENSE MUST BE REFUSED — and must not delete it.
  const stolen = await invoke(deleteExpense, `/api/cost/expenses/${ownerExpenseId}`, {
    method: "DELETE",
    userId: member.id,
    params: { id: ownerExpenseId },
  });
  assert.equal(
    stolen.status,
    403,
    `a member must not delete another user's expense: ${JSON.stringify(stolen.body)}`
  );
  assert.ok(
    await db.expense.findUnique({ where: { id: ownerExpenseId } }),
    "the refused delete must leave the owner's expense intact"
  );

  // Nor another peer member's claim.
  const peerClaim = await invoke(createExpense, "/api/cost/expenses", {
    method: "POST",
    userId: secondMember.id,
    body: { title: "Team lunch", amount: 900, currency: "INR", categoryId, vendor: "Cafe Coffee Day" },
  });
  assert.ok(ok(peerClaim.status), JSON.stringify(peerClaim.body));
  const peerClaimId = (peerClaim.body as any)?.expense?.id as string;
  const peerSteal = await invoke(deleteExpense, `/api/cost/expenses/${peerClaimId}`, {
    method: "DELETE",
    userId: member.id,
    params: { id: peerClaimId },
  });
  assert.equal(peerSteal.status, 403, `a member must not delete a peer's claim: ${JSON.stringify(peerSteal.body)}`);
  assert.ok(await db.expense.findUnique({ where: { id: peerClaimId } }), "the peer's claim must survive");

  // An anonymous request cannot delete anything at all.
  const anon = await invoke(deleteExpense, `/api/cost/expenses/${ownerExpenseId}`, {
    method: "DELETE",
    params: { id: ownerExpenseId },
  });
  assert.equal(anon.status, 401, JSON.stringify(anon.body));
  assert.ok(await db.expense.findUnique({ where: { id: ownerExpenseId } }));

  // The owner (renter of the company books) can delete, and the row really goes.
  const removed = await invoke(deleteExpense, `/api/cost/expenses/${ownerExpenseId}`, {
    method: "DELETE",
    userId: owner.id,
    params: { id: ownerExpenseId },
  });
  assert.ok(ok(removed.status), `the owner must be able to delete: ${JSON.stringify(removed.body)}`);
  assert.equal(await db.expense.findUnique({ where: { id: ownerExpenseId } }), null);
  assert.equal(await db.expense.count(), 2, "only the deleted expense may disappear");
});

test("a member can withdraw their own pending reimbursement claim", async () => {
  await resetDb();
  const { owner, member } = await seedUsers();
  const categoryId = await makeCategory(owner.id);

  const claim = await invoke(createExpense, "/api/cost/expenses", {
    method: "POST",
    userId: member.id,
    body: { title: "Conference ticket", amount: 12000, currency: "INR", categoryId, vendor: "PyCon India" },
  });
  assert.ok(ok(claim.status), JSON.stringify(claim.body));
  const claimId = (claim.body as any)?.expense?.id as string;

  const withdraw = await invoke(deleteExpense, `/api/cost/expenses/${claimId}`, {
    method: "DELETE",
    userId: member.id,
    params: { id: claimId },
  });
  assert.ok(
    ok(withdraw.status),
    `a member must be able to withdraw their own unapproved claim, got ${withdraw.status}: ${JSON.stringify(withdraw.body)}`
  );
  assert.equal(
    await db.expense.findUnique({ where: { id: claimId } }),
    null,
    "a withdrawn claim must be gone from the ledger"
  );
});

test("an invoice can be raised against a project through the cost API", async () => {
  await resetDb();
  const { owner, member } = await seedUsers();
  const categoryId = await makeCategory(owner.id);
  const projectId = await makeProject(owner.id, "Kubernetes platform build", [member.id]);

  // The documented route: POST /api/cost/invoices
  const post = (costInvoicesRoute as any).POST;
  assert.equal(
    typeof post,
    "function",
    "POST /api/cost/invoices must exist so an invoice can be raised for a project"
  );

  const raised = await invoke(post, "/api/cost/invoices", {
    method: "POST",
    userId: owner.id,
    body: {
      vendor: "Upwork Escrow Inc",
      invoiceNumber: "UPW-2026-0417",
      totalAmount: 250000,
      currency: "INR",
      categoryId,
      projectId,
      title: "Platform build — milestone 1",
      status: "ISSUED",
    },
  });
  assert.ok(ok(raised.status), `raising an invoice failed: ${JSON.stringify(raised.body)}`);

  const record = await db.invoiceRecord.findFirst({ where: { invoiceNumber: "UPW-2026-0417" } });
  assert.ok(record, "the raised invoice must be persisted as an invoice record");
  assert.equal(
    (record as any).projectId,
    projectId,
    "the invoice must be attached to the project it was raised for"
  );
});

test("invoice numbers are unique across the company", async () => {
  await resetDb();
  const { owner, member } = await seedUsers();
  const categoryId = await makeCategory(owner.id);
  const projectId = await makeProject(owner.id, "SOC 2 readiness", [member.id]);

  // 1) Client-facing invoices raised through the billing API get distinct numbers.
  const first = await invoke(createBillingInvoice, "/api/billing/invoices", {
    method: "POST",
    userId: owner.id,
    body: { title: "SOC 2 readiness — phase 1", amount: 450000, projectId },
  });
  assert.equal(first.status, 201, `client invoice #1 failed: ${JSON.stringify(first.body)}`);
  const second = await invoke(createBillingInvoice, "/api/billing/invoices", {
    method: "POST",
    userId: owner.id,
    body: { title: "SOC 2 readiness — phase 2", amount: 300000, projectId },
  });
  assert.equal(second.status, 201, `client invoice #2 failed: ${JSON.stringify(second.body)}`);

  const rows = await db.clientInvoice.findMany({ where: { projectId } });
  assert.equal(rows.length, 2);
  const numbers = rows.map((r) => r.invoiceNumber);
  assert.equal(new Set(numbers).size, 2, `invoice numbers must be unique, got ${JSON.stringify(numbers)}`);
  for (const n of numbers) assert.match(n, /^INV-\d{6}-\d{4}$/, `invoice number format drifted: ${n}`);
  assert.ok(rows.every((r) => r.projectId === projectId), "both invoices must belong to the project");

  // 2) A receipt invoice number already on file must not be reused for a
  //    different receipt — that is how the same payable gets paid twice.
  const firstUpload = await upload("upwork-0417.pdf", "%PDF-1.4 upwork 0417", owner.id);
  const firstVerify = await invoke(verifyInvoice, "/api/cost/invoices/verify", {
    method: "POST",
    userId: owner.id,
    body: {
      invoiceId: firstUpload.id,
      vendor: "Upwork Escrow Inc",
      invoiceNumber: "UPW-2026-0417",
      totalAmount: 250000,
      currency: "INR",
      categoryId,
      createExpense: true,
    },
  });
  assert.ok(ok(firstVerify.status), `first verification failed: ${JSON.stringify(firstVerify.body)}`);
  assert.equal(
    (await db.invoiceRecord.findUnique({ where: { id: firstUpload.id } }))!.invoiceNumber,
    "UPW-2026-0417"
  );

  const duplicateUpload = await upload("upwork-0418.pdf", "%PDF-1.4 upwork 0418", owner.id);
  const duplicateVerify = await invoke(verifyInvoice, "/api/cost/invoices/verify", {
    method: "POST",
    userId: owner.id,
    body: {
      invoiceId: duplicateUpload.id,
      vendor: "Upwork Escrow Inc",
      invoiceNumber: "UPW-2026-0417",
      totalAmount: 250000,
      currency: "INR",
      categoryId,
      createExpense: true,
    },
  });

  assert.ok(
    !ok(duplicateVerify.status),
    `a second invoice reusing the number UPW-2026-0417 must be refused, got ${duplicateVerify.status}: ${JSON.stringify(duplicateVerify.body)}`
  );

  assert.equal(
    await db.invoiceRecord.count({ where: { invoiceNumber: "UPW-2026-0417" } }),
    1,
    "only one invoice record may hold a given invoice number"
  );
  assert.equal(
    await db.expense.count({ where: { invoiceNumber: "UPW-2026-0417" } }),
    1,
    "the same invoice number must not be booked as an expense twice"
  );

  // Nothing anywhere in the ledger holds two invoices under one number.
  const allRecords = await db.invoiceRecord.findMany({ select: { invoiceNumber: true } });
  const allCostNumbers = allRecords.map((r) => r.invoiceNumber);
  assert.equal(
    new Set(allCostNumbers).size,
    allCostNumbers.length,
    `receipt invoice numbers must be unique, got ${JSON.stringify(allCostNumbers)}`
  );

  // 3) The company-scoped listing keeps them apart for the reader too.
  const listed = await invoke(listCostInvoices, "/api/cost/invoices", { userId: owner.id });
  assert.equal(listed.status, 200, JSON.stringify(listed.body));
  const listedNumbers = (((listed.body as any)?.invoices ?? []) as any[]).map((i) => i.invoiceNumber);
  assert.equal(new Set(listedNumbers).size, listedNumbers.length);
});

test("re-uploading an identical receipt does not create a second payable", async () => {
  await resetDb();
  const { owner } = await seedUsers();

  const first = await upload("godaddy-2026-03.pdf", "%PDF-1.4 godaddy march identical bytes", owner.id);
  const second = await upload("godaddy-2026-03.pdf", "%PDF-1.4 godaddy march identical bytes", owner.id);

  assert.equal(
    second.body.isExactDuplicate,
    true,
    "an identical receipt must be reported as an exact duplicate"
  );
  assert.ok(
    Array.isArray(second.body.warnings) && second.body.warnings.length > 0,
    "the duplicate must come with a warning explaining it"
  );
  assert.notEqual((first.body as any).invoice.id, (second.body as any).invoice.id);

  const sameHash = await db.invoiceRecord.count({
    where: { fileHash: (first.body as any).invoice.fileHash },
  });
  assert.equal(
    sameHash,
    1,
    `an identical receipt must be stored once, found ${sameHash} records for the same file hash`
  );
});
