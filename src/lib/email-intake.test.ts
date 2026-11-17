import test from "node:test";
import assert from "node:assert/strict";
import { classifyInboundEmail, signalsFromEmail } from "./email-intake";

/**
 * The guard list is the whole point of email intake: without it the pipeline
 * fills with bounces and our own staff, and the lead score becomes noise.
 */

const buyer = {
  from: "Ana Ruiz <ana.ruiz@northwind-logistics.com>",
  subject: "Need help with our Azure migration",
  text: "Hi, we are moving 40 services off on-prem and need help before Q3.\n\nAna",
};

test("a real buyer is accepted with company attribution", () => {
  const result = classifyInboundEmail(buyer);
  assert.equal(result.accepted, true);
  assert.equal(result.lead?.email, "ana.ruiz@northwind-logistics.com");
  assert.equal(result.lead?.title, "Ana Ruiz");
  assert.equal(result.lead?.companyName, "Northwind-logistics");
  assert.equal(result.lead?.freeMailOnly, false);
  assert.match(String(result.lead?.notes), /Q3/);
});

test("our own domains never become leads", () => {
  const result = classifyInboundEmail({ ...buyer, from: "someone@cyraops.com" });
  assert.equal(result.accepted, false);
  assert.equal(result.reason, "internal_sender");

  const configured = classifyInboundEmail(
    { ...buyer, from: "ops@acme-holdings.com" },
    { internalDomains: ["acme-holdings.com"] }
  );
  assert.equal(configured.accepted, false);
  assert.equal(configured.reason, "internal_sender");
});

test("automated mailboxes are rejected", () => {
  // Only unambiguously machine-owned local parts. `billing@` is deliberately not
  // here: a finance person can legitimately write from one.
  for (const local of ["no-reply", "noreply", "donotreply", "mailer-daemon", "postmaster", "notifications"]) {
    const result = classifyInboundEmail({ ...buyer, from: `${local}@northwind-logistics.com` });
    assert.equal(result.accepted, false, `${local} should be rejected`);
    assert.equal(result.reason, "automated_sender");
  }
});

test("out-of-office and auto-replies are rejected", () => {
  const ooo = classifyInboundEmail({
    from: "ana.ruiz@northwind-logistics.com",
    subject: "Automatic reply: Need help with migration",
    text: "I am currently out of the office and will return Monday.",
  });
  assert.equal(ooo.accepted, false);
  assert.equal(ooo.reason, "auto_reply");

  const away = classifyInboundEmail({
    from: "ana.ruiz@northwind-logistics.com",
    subject: "Re: intro",
    text: "Thank you for your message. This is an automated response.",
  });
  assert.equal(away.accepted, false);
});

test("bounces and delivery notices are rejected", () => {
  const bounce = classifyInboundEmail({
    from: "mailer-daemon@northwind-logistics.com",
    subject: "Delivery Status Notification (Failure)",
    text: "Your message could not be delivered.",
  });
  assert.equal(bounce.accepted, false);

  const notice = classifyInboundEmail({
    from: "ana.ruiz@northwind-logistics.com",
    subject: "Undeliverable: invoice",
    text: "The following recipient does not exist.",
  });
  assert.equal(notice.accepted, false);
  assert.equal(notice.reason, "bounce_or_notice");
});

test("an unparseable sender is rejected instead of guessed", () => {
  const result = classifyInboundEmail({ from: "not an address", text: "hello" });
  assert.equal(result.accepted, false);
  assert.equal(result.reason, "invalid_sender");
});

test("a free mailbox is a person without a company, and says so", () => {
  const result = classifyInboundEmail({
    from: "ana.ruiz@gmail.com",
    subject: "Question about your services",
    text: "Can you help us?",
  });
  assert.equal(result.accepted, true);
  assert.equal(result.lead?.freeMailOnly, true);
  assert.equal(result.lead?.companyName, null, "no company can be inferred from gmail");

  const signals = signalsFromEmail(result) as any;
  assert.equal(signals.reachable.value, "verified", "the address demonstrably delivers");
  assert.deepEqual(signals.knockout, { freeMailOnly: true }, "and that is a scoring knock-out");
});

test("a corporate sender gets no free-mail knock-out", () => {
  const signals = signalsFromEmail(classifyInboundEmail(buyer)) as any;
  assert.equal(signals.reachable.value, "verified");
  assert.equal(signals.knockout, undefined);
});

test("intent is never claimed from an email merely arriving", () => {
  const signals = signalsFromEmail(classifyInboundEmail(buyer)) as any;
  // Arriving proves the address works and nothing about budget, authority or
  // timing, so those stay absent rather than being invented.
  assert.equal(signals.hiring, undefined);
  assert.equal(signals.funding, undefined);
  assert.equal(signals.publicPain, undefined);
  assert.equal(signals.authority, undefined);
});

test("quoted reply chains are trimmed from the notes", () => {
  const result = classifyInboundEmail({
    from: "ana.ruiz@northwind-logistics.com",
    subject: "Re: pricing",
    text: "We have budget approved for this quarter.\n\nOn Mon, Jan 5, 2026 at 9:02 AM Cyraops <x@cyraops.com> wrote:\n> old text here\n> more old text",
  });
  assert.equal(result.accepted, true);
  assert.match(String(result.lead?.notes), /budget approved/);
  assert.ok(!String(result.lead?.notes).includes("old text here"), "quoted history is dropped");
});

test("an empty body is not a lead", () => {
  const result = classifyInboundEmail({ from: "ana.ruiz@northwind-logistics.com", subject: "hi", text: "   " });
  assert.equal(result.accepted, false);
  assert.equal(result.reason, "empty_body");
});
