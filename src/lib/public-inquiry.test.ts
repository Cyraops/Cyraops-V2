import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { handlePublicInquiry } from "./public-inquiry";

function makeRequest(payload: unknown) {
  return new NextRequest("http://localhost:3001/api/public/inquiries", {
    method: "POST",
    headers: {
      host: "localhost:3001",
      origin: "http://localhost:3001",
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

function makeDatabase(overrides: Record<string, any> = {}) {
  const calls = {
    createdLeads: [] as any[],
    updatedLeads: [] as any[],
    createdContacts: [] as any[],
    activities: [] as any[],
    notifications: [] as any[],
    rateLimitReads: 0,
    rateLimitWrites: 0,
  };
  const database = {
    authRateLimit: {
      findMany: async () => { calls.rateLimitReads += 1; return []; },
      upsert: async () => { calls.rateLimitWrites += 1; },
    },
    lead: {
      findFirst: async () => null,
      create: async ({ data }: any) => { calls.createdLeads.push(data); return { id: "test-lead-id" }; },
      update: async ({ data }: any) => { calls.updatedLeads.push(data); return { id: "existing-lead-id" }; },
    },
    // The inquiry is a person, so intake also links a contact and tells someone.
    contact: {
      findFirst: async () => null,
      create: async ({ data }: any) => { calls.createdContacts.push(data); return { id: "test-contact-id" }; },
    },
    activity: { create: async ({ data }: any) => { calls.activities.push(data); return { id: "test-activity-id" }; } },
    notification: { create: async ({ data }: any) => { calls.notifications.push(data); return { id: "test-notification-id" }; } },
    user: { findFirst: async () => ({ id: "owner-id" }) },
    ...overrides,
  };
  return { database: database as any, calls };
}

describe("Public project inquiry intake", () => {
  it("stores a validated website inquiry as a CRM lead without returning its details", async () => {
    const { database, calls } = makeDatabase();

    const response = await handlePublicInquiry(makeRequest({
      name: "Alex Morgan",
      email: "Alex@Example.com",
      company: "Example Co",
      environment: "A small AWS production environment",
      spend: "Under $1,000 / month",
      helpTopic: "We need help reducing our AWS bill and improving uptime.",
      website: "",
    }), database);

    assert.equal(response.status, 202);
    assert.deepEqual(await response.json(), { ok: true });
    assert.equal(calls.createdLeads.length, 1);
    const lead = calls.createdLeads[0];
    assert.equal(lead.email, "alex@example.com");
    assert.equal(lead.companyName, "Example Co");
    assert.equal(lead.source, "Website");
    assert.equal(lead.assignedToId, "owner-id");
    assert.match(lead.notes, /AWS bill and improving uptime/);
    assert.equal(lead.contactId, "test-contact-id", "the sender becomes a contact");
    assert.equal(calls.createdContacts.length, 1);
    assert.equal(calls.createdContacts[0].email, "alex@example.com");
    assert.equal(calls.activities.length, 1, "the pipeline shows how the lead arrived");
    assert.equal(calls.notifications.length, 1, "and someone is told about it");
    assert.equal(calls.notifications[0].userId, "owner-id");
  });

  it("silently accepts a filled honeypot without writing a lead", async () => {
    const { database, calls } = makeDatabase();
    const response = await handlePublicInquiry(makeRequest({
      name: "Bot User",
      email: "bot@example.com",
      helpTopic: "A sufficiently long automated message.",
      website: "https://spam.example",
    }), database);

    assert.equal(response.status, 202);
    assert.deepEqual(await response.json(), { ok: true });
    assert.equal(calls.createdLeads.length, 0);
    assert.equal(calls.rateLimitWrites, 0);
  });

  it("rejects incomplete inquiries before any database access", async () => {
    const { database, calls } = makeDatabase();
    const response = await handlePublicInquiry(makeRequest({ name: "A", email: "invalid", helpTopic: "Too short" }), database);

    assert.equal(response.status, 400);
    assert.equal(calls.rateLimitReads, 0);
    assert.equal(calls.rateLimitWrites, 0);
  });
});
