/**
 * J6 — machine intake.
 *
 * A form handler or Zapier zap has no session cookie, so the endpoint has to
 * authenticate some other way. These tests drive the real route handlers with
 * real requests: a token in the URL, no cookie, a real database write.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { db, resetDb, seedUsers, invoke } from "../helpers";
import { POST as intakPost, GET as intakeGet } from "@/app/api/intake/[token]/route";
import { POST as tokensPost, GET as tokensGet, DELETE as tokensDelete } from "@/app/api/intake/tokens/route";
import { POST as emailPost } from "@/app/api/intake/[token]/email/route";
import { sha256 } from "@/lib/auth";

const seed = async () => {
  await resetDb();
  return seedUsers();
};

test("J6: a token is shown once and never stored in the clear", async () => {
  const { owner } = await seed();

  const created = await invoke(tokensPost, "/api/intake/tokens", {
    method: "POST",
    userId: owner.id,
    body: { label: "Website form" },
  });
  assert.equal(created.status, 201);
  const token = (created.body as any).token as string;
  assert.match(token, /^cyi_/);

  const rows = await db.intakeToken.findMany();
  assert.equal(rows.length, 1);
  assert.ok(!JSON.stringify(rows).includes(token), "the raw token must not be stored");

  const listed = await invoke(tokensGet, "/api/intake/tokens", { userId: owner.id });
  assert.equal(listed.status, 200);
  const listedTokens = (listed.body as any).tokens;
  assert.equal(listedTokens.length, 1);
  assert.ok(!JSON.stringify(listedTokens).includes(token), "the list must not echo the secret");
  assert.ok(listedTokens[0].hint, "but a hint is shown so tokens can be told apart");
});

test("J6: a member cannot mint an intake token", async () => {
  const { member } = await seed();
  const res = await invoke(tokensPost, "/api/intake/tokens", {
    method: "POST",
    userId: member.id,
    body: { label: "Sneaky" },
  });
  assert.equal(res.status, 403);
  assert.equal(await db.intakeToken.count(), 0);
});

test("J6: a valid token creates an attributed, scored, deduped lead", async () => {
  const { owner } = await seed();
  const created = await invoke(tokensPost, "/api/intake/tokens", {
    method: "POST",
    userId: owner.id,
    body: { label: "Typeform", source: "typeform" },
  });
  const token = (created.body as any).token as string;

  // No cookie: this is a machine caller.
  const first = await invoke(intakPost, `/api/intake/${token}`, {
    method: "POST",
    params: { token },
    body: {
      name: "Priya Nair",
      company: "Northwind Logistics",
      email: "Priya@Northwind.example",
      message: "We need a warehouse integration before Q3",
      estimatedValue: "18000",
      signals: {
        publicPain: { value: "migration", state: "observed" },
        hiring: { value: 4, state: "observed" },
        funding: { value: "series_a_b", state: "observed" },
        authority: { value: "exec", state: "observed" },
        valueBand: { value: "l", state: "observed" },
        industryMatch: { value: "exact", state: "observed" },
      },
    },
  });
  assert.equal(first.status, 201, JSON.stringify(first.body));
  const body = first.body as any;
  assert.ok(body.leadId);
  assert.ok(body.score > 0, "signals must produce a real score");
  assert.notEqual(body.band, "INSUFFICIENT_DATA");

  const lead = await db.lead.findUniqueOrThrow({ where: { id: body.leadId } });
  assert.equal(lead.title, "Priya Nair");
  assert.equal(lead.companyName, "Northwind Logistics");
  assert.equal(lead.email, "priya@northwind.example", "email is normalised");
  assert.equal(lead.source, "typeform", "the token's source is recorded");
  assert.equal(lead.assignedToId, owner.id, "the token owner is attributed");
  assert.ok(lead.contactId, "the person becomes a contact too");
  assert.ok(lead.score > 0);
  assert.equal(lead.estimatedValue, 18000);

  // The owner is told, or the lead is never called.
  assert.equal(await db.notification.count({ where: { userId: owner.id } }), 1);

  // The same person submitting twice must not duplicate the pipeline.
  const second = await invoke(intakPost, `/api/intake/${token}`, {
    method: "POST",
    params: { token },
    body: { name: "Priya Nair", email: "priya@northwind.example", message: "Sending again" },
  });
  assert.equal(second.status, 200);
  assert.equal((second.body as any).deduped, true);
  assert.equal(await db.lead.count(), 1);

  // Use is recorded, so a stale integration is visible.
  const used = await db.intakeToken.findFirstOrThrow();
  assert.equal(used.useCount, 2);
  assert.ok(used.lastUsedAt);
});

test("J6: a lead with no signals is scored honestly, not guessed", async () => {
  const { owner } = await seed();
  const created = await invoke(tokensPost, "/api/intake/tokens", {
    method: "POST",
    userId: owner.id,
    body: { label: "Bare form" },
  });
  const token = (created.body as any).token as string;

  const res = await invoke(intakPost, `/api/intake/${token}`, {
    method: "POST",
    params: { token },
    body: { name: "Bare Minimum", email: "bare@example.com" },
  });
  assert.equal(res.status, 201);
  // No signals were supplied, so the rubric refuses to hand out a letter band.
  // This is the behaviour that replaced a language model picking an integer.
  assert.ok(
    !["A", "B", "C", "D"].includes((res.body as any).band),
    `expected no confident band, got ${(res.body as any).band}`
  );
});

test("J6: a revoked or unknown token is refused identically", async () => {
  const { owner } = await seed();
  const created = await invoke(tokensPost, "/api/intake/tokens", {
    method: "POST",
    userId: owner.id,
    body: { label: "Old form" },
  });
  const token = (created.body as any).token as string;
  const id = (created.body as any).id as string;

  const unknown = await invoke(intakPost, "/api/intake/cyi_notarealtokenatall123456", {
    method: "POST",
    params: { token: "cyi_notarealtokenatall123456" },
    body: { name: "Nobody", email: "nobody@example.com" },
  });
  assert.equal(unknown.status, 401);

  const revokedResponse = await invoke(tokensDelete, `/api/intake/tokens?id=${id}`, {
    method: "DELETE",
    userId: owner.id,
  });
  assert.equal(revokedResponse.status, 200);

  const afterRevoke = await invoke(intakPost, `/api/intake/${token}`, {
    method: "POST",
    params: { token },
    body: { name: "Nobody", email: "nobody@example.com" },
  });
  assert.equal(afterRevoke.status, 401, "a revoked token stops working immediately");
  assert.equal(await db.lead.count(), 0);
});

test("J6: one account cannot revoke another account's token", async () => {
  const { owner, member } = await seed();
  const created = await invoke(tokensPost, "/api/intake/tokens", {
    method: "POST",
    userId: owner.id,
    body: { label: "Owner form" },
  });
  const id = (created.body as any).id as string;

  const res = await invoke(tokensDelete, `/api/intake/tokens?id=${id}`, {
    method: "DELETE",
    userId: member.id,
  });
  assert.equal(res.status, 404);
  const row = await db.intakeToken.findUniqueOrThrow({ where: { id } });
  assert.equal(row.disabledAt, null);
});

test("J6: junk payloads are rejected without writing anything", async () => {
  const { owner } = await seed();
  const created = await invoke(tokensPost, "/api/intake/tokens", {
    method: "POST",
    userId: owner.id,
    body: { label: "Form" },
  });
  const token = (created.body as any).token as string;

  const noIdentity = await invoke(intakPost, `/api/intake/${token}`, {
    method: "POST",
    params: { token },
    body: { company: "Anonymous Co" },
  });
  assert.equal(noIdentity.status, 400);

  const badEmail = await invoke(intakPost, `/api/intake/${token}`, {
    method: "POST",
    params: { token },
    body: { name: "Someone", email: "not-an-email" },
  });
  assert.equal(badEmail.status, 400);

  const honeypot = await invoke(intakPost, `/api/intake/${token}`, {
    method: "POST",
    params: { token },
    body: { name: "Bot", email: "bot@example.com", website: "http://spam.example" },
  });
  assert.equal(honeypot.status, 202, "a bot is answered, not argued with");
  assert.equal(await db.lead.count(), 0, "but nothing is written");
});

test("J6: an oversized payload is refused before parsing", async () => {
  const { owner } = await seed();
  const created = await invoke(tokensPost, "/api/intake/tokens", {
    method: "POST",
    userId: owner.id,
    body: { label: "Form" },
  });
  const token = (created.body as any).token as string;

  const res = await invoke(intakPost, `/api/intake/${token}`, {
    method: "POST",
    params: { token },
    body: { name: "Big", email: "big@example.com", message: "x".repeat(20_000) },
  });
  assert.equal(res.status, 413);
  assert.equal(await db.lead.count(), 0);
});

test("J6: a token whose owner was disabled stops working", async () => {
  const { owner } = await seed();
  const created = await invoke(tokensPost, "/api/intake/tokens", {
    method: "POST",
    userId: owner.id,
    body: { label: "Form" },
  });
  const token = (created.body as any).token as string;

  await db.user.update({ where: { id: owner.id }, data: { disabledAt: new Date() } });

  const res = await invoke(intakPost, `/api/intake/${token}`, {
    method: "POST",
    params: { token },
    body: { name: "Late Arrival", email: "late@example.com" },
  });
  assert.equal(res.status, 401, "disabling a person must also disable their tokens");
  assert.equal(await db.lead.count(), 0);
});

test("J6: GET reports the token is live without creating anything", async () => {
  const { owner } = await seed();
  const created = await invoke(tokensPost, "/api/intake/tokens", {
    method: "POST",
    userId: owner.id,
    body: { label: "Form" },
  });
  const token = (created.body as any).token as string;

  const res = await invoke(intakeGet, `/api/intake/${token}`, { params: { token } });
  assert.equal(res.status, 200);
  assert.equal((res.body as any).ok, true);
  assert.equal(await db.lead.count(), 0);
});

// ---------------------------------------------------------------------------
// Inbound email
// ---------------------------------------------------------------------------

test("J6: an inbound email from a buyer becomes a scored, attributed lead", async () => {
  const { owner } = await seed();
  const created = await invoke(tokensPost, "/api/intake/tokens", {
    method: "POST",
    userId: owner.id,
    body: { label: "Inbox", source: "Email" },
  });
  const token = (created.body as any).token as string;

  const res = await invoke(emailPost, `/api/intake/${token}/email`, {
    method: "POST",
    params: { token },
    body: {
      from: "Ana Ruiz <ana.ruiz@northwind-logistics.com>",
      subject: "Need help with our Azure migration",
      text: "We are moving 40 services off on-prem and need help before Q3.",
    },
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));

  const lead = await db.lead.findFirstOrThrow();
  assert.equal(lead.email, "ana.ruiz@northwind-logistics.com");
  assert.equal(lead.title, "Ana Ruiz");
  assert.equal(lead.assignedToId, owner.id);
  assert.equal(lead.source, "Email");
  // Arriving proves the address delivers; nothing else.
  assert.ok(lead.score >= 0);
  assert.equal(await db.notification.count({ where: { userId: owner.id } }), 1);
});

test("J6: the guard list keeps bounces, robots and our own staff out", async () => {
  const { owner } = await seed();
  const created = await invoke(tokensPost, "/api/intake/tokens", {
    method: "POST",
    userId: owner.id,
    body: { label: "Inbox" },
  });
  const token = (created.body as any).token as string;

  const cases = [
    { from: "mailer-daemon@northwind.com", subject: "Delivery Status Notification (Failure)", text: "failed" },
    { from: "no-reply@northwind.com", subject: "Your receipt", text: "thanks" },
    { from: "ana@cyraops.com", subject: "Internal note", text: "hello" },
    { from: "ana@northwind.com", subject: "Automatic reply: hello", text: "I am out of the office." },
  ];
  for (const payload of cases) {
    const res = await invoke(emailPost, `/api/intake/${token}/email`, {
      method: "POST",
      params: { token },
      body: payload,
    });
    assert.equal(res.status, 202, JSON.stringify(payload));
    assert.equal((res.body as any).accepted, false);
  }
  assert.equal(await db.lead.count(), 0, "the guard list must write nothing");
});

test("J6: the hourly cap stops a runaway mailbox", async () => {
  const { owner } = await seed();
  const created = await invoke(tokensPost, "/api/intake/tokens", {
    method: "POST",
    userId: owner.id,
    body: { label: "Inbox" },
  });
  const token = (created.body as any).token as string;

  // Pre-load the bucket at the cap so the test does not have to send 60 emails.
  const bucketKey = sha256(`intake-email:${(created.body as any).id}`);
  await db.authRateLimit.create({
    data: { key: bucketKey, hits: 60, windowEnds: new Date(Date.now() + 30 * 60 * 1000) },
  });

  const res = await invoke(emailPost, `/api/intake/${token}/email`, {
    method: "POST",
    params: { token },
    body: { from: "late@northwind.com", subject: "Hello", text: "Are you there?" },
  });
  assert.equal(res.status, 429);
  assert.equal(await db.lead.count(), 0);
});

test("J6: a free-mail sender is recorded as a person with no company", async () => {
  const { owner } = await seed();
  const created = await invoke(tokensPost, "/api/intake/tokens", {
    method: "POST",
    userId: owner.id,
    body: { label: "Inbox" },
  });
  const token = (created.body as any).token as string;

  const res = await invoke(emailPost, `/api/intake/${token}/email`, {
    method: "POST",
    params: { token },
    body: { from: "ana.ruiz@gmail.com", subject: "Question", text: "Do you do cloud migrations?" },
  });
  assert.equal(res.status, 201);
  const lead = await db.lead.findFirstOrThrow();
  assert.equal(lead.companyName, null, "a gmail address cannot be attributed to a company");
});
