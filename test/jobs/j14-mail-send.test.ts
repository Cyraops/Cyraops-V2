/**
 * J14 — the bot can send mail, but never quietly.
 *
 * The reported failure: asked to email Adil, the assistant answered "I have no
 * mail-sending tool". Now it has one. Because sending leaves the CRM and cannot
 * be recalled, it must always wait for a human — that is the property this file
 * protects, alongside honest failures instead of silent ones.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { resetDb, seedUsers } from "../helpers";
import { toolRegistry } from "../../src/lib/ai/tools/registry";
import "../../src/lib/ai/tools/crm-tools";

const context = (userId: string) => ({ userId, userRole: "OWNER" });

test("J14: send_email is registered and always requires explicit approval", () => {
  const tool = toolRegistry.getTool("send_email");
  assert.ok(tool, "the assistant must be able to find the tool");
  assert.equal(tool!.requiresApproval, true);
  assert.equal(tool!.explicitApproval, true, "sending must never be auto-approved");
  assert.equal(tool!.riskClass, "CLASS_C");
});

test("J14: an invalid recipient is refused before anything is sent", async () => {
  await resetDb();
  const { owner } = await seedUsers();
  const tool = toolRegistry.getTool("send_email")!;

  const result = await tool.execute({ to: "not-an-address", subject: "Hi", body: "Body" }, context(owner.id));
  assert.equal(result.success, false);
  assert.match(result.error ?? "", /not valid/i);
});

test("J14: a missing subject or body is refused", async () => {
  await resetDb();
  const { owner } = await seedUsers();
  const tool = toolRegistry.getTool("send_email")!;

  const noSubject = await tool.execute({ to: "adil@example.com", subject: "   ", body: "Body" }, context(owner.id));
  assert.equal(noSubject.success, false);
  assert.match(noSubject.error ?? "", /subject/i);

  const noBody = await tool.execute({ to: "adil@example.com", subject: "Hi", body: "" }, context(owner.id));
  assert.equal(noBody.success, false);
  assert.match(noBody.error ?? "", /body/i);

  const noRecipient = await tool.execute({ to: "", subject: "Hi", body: "Body" }, context(owner.id));
  assert.equal(noRecipient.success, false);
});

test("J14: with no mailbox configured the failure says so, and names the fix", async (t) => {
  await resetDb();
  const { owner } = await seedUsers();
  const tool = toolRegistry.getTool("send_email")!;

  const previous = { address: process.env.GODADDY_EMAIL_ADDRESS, password: process.env.GODADDY_EMAIL_PASSWORD };
  delete process.env.GODADDY_EMAIL_ADDRESS;
  delete process.env.GODADDY_EMAIL_PASSWORD;
  t.after(() => {
    if (previous.address !== undefined) process.env.GODADDY_EMAIL_ADDRESS = previous.address;
    if (previous.password !== undefined) process.env.GODADDY_EMAIL_PASSWORD = previous.password;
  });

  const result = await tool.execute({ to: "adil@example.com", subject: "Details", body: "Please share the recap." }, context(owner.id));
  assert.equal(result.success, false);
  assert.match(result.error ?? "", /not configured/i);
  assert.match(result.error ?? "", /GODADDY_EMAIL_ADDRESS/);
});

test("J14: multiple recipients and cc are accepted as input", async () => {
  await resetDb();
  const { owner } = await seedUsers();
  const tool = toolRegistry.getTool("send_email")!;

  // No mailbox in the test environment, so the assertion is that parsing passed
  // the validation stage and reached the configuration check.
  const result = await tool.execute(
    { to: "a@example.com, b@example.com", cc: "c@example.com", subject: "Hi", body: "Body" },
    context(owner.id)
  );
  assert.equal(result.success, false);
  assert.match(result.error ?? "", /not configured/i, "validation should pass, configuration should stop it");
});
