import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { db } from "./db";
import { createSession } from "./auth";

// Import Route Handlers
import { GET as statsGET } from "../app/api/crm/stats/route";
import { GET as leadsGET, POST as leadsPOST } from "../app/api/crm/leads/route";
import { GET as leadIdGET, PATCH as leadIdPATCH, DELETE as leadIdDELETE } from "../app/api/crm/leads/[id]/route";
import { GET as contactsGET, POST as contactsPOST } from "../app/api/crm/contacts/route";
import { GET as contactIdGET, PATCH as contactIdPATCH, DELETE as contactIdDELETE } from "../app/api/crm/contacts/[id]/route";
import { GET as companiesGET, POST as companiesPOST } from "../app/api/crm/companies/route";
import { GET as companyIdGET, PATCH as companyIdPATCH, DELETE as companyIdDELETE } from "../app/api/crm/companies/[id]/route";
import { GET as dealsGET, POST as dealsPOST } from "../app/api/crm/deals/route";
import { GET as dealIdGET, PATCH as dealIdPATCH, DELETE as dealIdDELETE } from "../app/api/crm/deals/[id]/route";
import { POST as convertPOST } from "../app/api/crm/deals/[id]/convert/route";

describe("Phase 2 — CRM Foundation Live Route & Database Integration Tests", () => {
  let ownerUser: any;
  let adminUser: any;
  let memberUser: any;
  let ownerToken: string;
  let adminToken: string;
  let memberToken: string;

  const testUserIds: string[] = [];
  const testCompanyIds: string[] = [];
  const testContactIds: string[] = [];
  const testLeadIds: string[] = [];
  const testDealIds: string[] = [];
  const testProjectIds: string[] = [];

  before(async () => {
    const timestamp = Date.now();

    // 1. Create real test users in company_os_dev
    ownerUser = await db.user.create({
      data: {
        email: `crm_owner_${timestamp}@test.local`,
        name: "CRM Test Owner",
        role: "OWNER",
      },
    });
    testUserIds.push(ownerUser.id);

    adminUser = await db.user.create({
      data: {
        email: `crm_admin_${timestamp}@test.local`,
        name: "CRM Test Admin",
        role: "ADMIN",
      },
    });
    testUserIds.push(adminUser.id);

    memberUser = await db.user.create({
      data: {
        email: `crm_member_${timestamp}@test.local`,
        name: "CRM Test Member",
        role: "MEMBER",
      },
    });
    testUserIds.push(memberUser.id);

    // 2. Create authenticated sessions
    ownerToken = (await createSession(ownerUser.id)).token;
    adminToken = (await createSession(adminUser.id)).token;
    memberToken = (await createSession(memberUser.id)).token;
  });

  after(async () => {
    // Clean up created entities in reverse dependency order
    for (const pid of testProjectIds) {
      await db.task.deleteMany({ where: { projectId: pid } }).catch(() => {});
      await db.projectMember.deleteMany({ where: { projectId: pid } }).catch(() => {});
      await db.activity.deleteMany({ where: { projectId: pid } }).catch(() => {});
      await db.project.delete({ where: { id: pid } }).catch(() => {});
    }
    for (const did of testDealIds) {
      await db.activity.deleteMany({ where: { entity: "deal", entityId: did } }).catch(() => {});
      await db.deal.delete({ where: { id: did } }).catch(() => {});
    }
    for (const lid of testLeadIds) {
      await db.activity.deleteMany({ where: { entity: "lead", entityId: lid } }).catch(() => {});
      await db.lead.delete({ where: { id: lid } }).catch(() => {});
    }
    for (const cid of testContactIds) {
      await db.activity.deleteMany({ where: { entity: "contact", entityId: cid } }).catch(() => {});
      await db.contact.delete({ where: { id: cid } }).catch(() => {});
    }
    for (const coid of testCompanyIds) {
      await db.activity.deleteMany({ where: { entity: "company", entityId: coid } }).catch(() => {});
      await db.company.delete({ where: { id: coid } }).catch(() => {});
    }
    for (const uid of testUserIds) {
      await db.session.deleteMany({ where: { userId: uid } }).catch(() => {});
      await db.activity.deleteMany({ where: { userId: uid } }).catch(() => {});
      await db.user.delete({ where: { id: uid } }).catch(() => {});
    }
  });

  function makeReq(url: string, token?: string, method = "GET", body?: any): NextRequest {
    const headers: Record<string, string> = {
      host: "localhost:3001",
      origin: "http://localhost:3001",
      referer: "http://localhost:3001",
      "sec-fetch-site": "same-origin",
    };
    if (token) headers["cookie"] = `company_session=${token}`;
    if (body) headers["content-type"] = "application/json";

    return new NextRequest(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  // --- SECTION 1: AUTHENTICATION & CSRF SECURITY ---
  describe("1. Route Security & Authorization Guards", () => {
    it("rejects unauthenticated requests to CRM endpoints with 401", async () => {
      const statsReq = makeReq("http://localhost:3001/api/crm/stats");
      const res = await statsGET(statsReq);
      assert.strictEqual(res.status, 401);

      const leadsReq = makeReq("http://localhost:3001/api/crm/leads");
      const leadsRes = await leadsGET(leadsReq);
      assert.strictEqual(leadsRes.status, 401);
    });

    it("rejects mutating requests missing same-origin headers with 403", async () => {
      const untrustedReq = new NextRequest("http://localhost:3001/api/crm/leads", {
        method: "POST",
        headers: {
          host: "localhost:3001",
          cookie: `company_session=${ownerToken}`,
          origin: "http://evil-attacker.com",
          "content-type": "application/json",
        },
        body: JSON.stringify({ title: "CSRF Probe" }),
      });
      const res = await leadsPOST(untrustedReq);
      assert.strictEqual(res.status, 403);
    });
  });

  // --- SECTION 2: COMPANIES LIFECYCLE & DUPLICATE PROTECTION ---
  describe("2. Companies CRUD & Data Integrity", () => {
    let companyId: string;
    const testName = `Acme Enterprise ${Date.now()}`;
    const testDomain = `acme-${Date.now()}.com`;

    it("creates a new company and verifies audit logging", async () => {
      const req = makeReq("http://localhost:3001/api/crm/companies", ownerToken, "POST", {
        name: testName,
        domain: testDomain,
        industry: "Cloud Infrastructure",
        size: "100-500",
        website: `https://${testDomain}`,
        phone: "+91 22 12345678",
        notes: "Major enterprise prospect for OpenStack modernization.",
      });

      const res = await companiesPOST(req);
      assert.strictEqual(res.status, 201);
      const data = await res.json();
      assert.ok(data.company.id);
      assert.strictEqual(data.company.name, testName);
      companyId = data.company.id;
      testCompanyIds.push(companyId);

      // Verify audit log
      const act = await db.activity.findFirst({
        where: { entity: "company", entityId: companyId, action: "created" },
      });
      assert.ok(act);
      assert.ok(act.summary.includes(testName));
    });

    it("prevents duplicate active companies with identical name or domain (409 Conflict)", async () => {
      const dupReq = makeReq("http://localhost:3001/api/crm/companies", ownerToken, "POST", {
        name: testName, // identical name
        domain: "other-domain.com",
      });
      const dupRes = await companiesPOST(dupReq);
      assert.strictEqual(dupRes.status, 409);

      const dupDomainReq = makeReq("http://localhost:3001/api/crm/companies", ownerToken, "POST", {
        name: "Different Name LLC",
        domain: testDomain, // identical domain
      });
      const dupDomainRes = await companiesPOST(dupDomainReq);
      assert.strictEqual(dupDomainRes.status, 409);
    });

    it("retrieves company details with related records", async () => {
      const req = makeReq(`http://localhost:3001/api/crm/companies/${companyId}`, memberToken);
      const res = await companyIdGET(req, { params: Promise.resolve({ id: companyId }) });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.company.id, companyId);
      assert.ok(Array.isArray(data.company.contacts));
      assert.ok(Array.isArray(data.activities));
    });

    it("allows MEMBER to update notes but forbids MEMBER from archiving company (403)", async () => {
      // Member can update notes
      const patchReq = makeReq(`http://localhost:3001/api/crm/companies/${companyId}`, memberToken, "PATCH", {
        notes: "Updated discovery notes from technical discovery call.",
      });
      const patchRes = await companyIdPATCH(patchReq, { params: Promise.resolve({ id: companyId }) });
      assert.strictEqual(patchRes.status, 200);

      // Member cannot archive
      const archiveReq = makeReq(`http://localhost:3001/api/crm/companies/${companyId}`, memberToken, "PATCH", {
        archive: true,
      });
      const archiveRes = await companyIdPATCH(archiveReq, { params: Promise.resolve({ id: companyId }) });
      assert.strictEqual(archiveRes.status, 403);

      const deleteReq = makeReq(`http://localhost:3001/api/crm/companies/${companyId}`, memberToken, "DELETE");
      const deleteRes = await companyIdDELETE(deleteReq, { params: Promise.resolve({ id: companyId }) });
      assert.strictEqual(deleteRes.status, 403);
    });
  });

  // --- SECTION 3: CONTACTS LIFECYCLE & RELATIONSHIPS ---
  describe("3. Contacts CRUD & Company Associations", () => {
    let contactId: string;
    let companyId: string;
    const testEmail = `jane.doe_${Date.now()}@acme.test`;
    const testPhone = `+91-9876-${Date.now().toString().slice(-6)}`;

    before(async () => {
      const co = await db.company.create({
        data: { name: `TechCorp_${Date.now()}`, domain: `techcorp_${Date.now()}.in` },
      });
      companyId = co.id;
      testCompanyIds.push(companyId);
    });

    it("creates a contact associated with a company", async () => {
      const req = makeReq("http://localhost:3001/api/crm/contacts", ownerToken, "POST", {
        firstName: "Jane",
        lastName: "Doe",
        email: testEmail,
        phone: testPhone,
        title: "VP of Engineering",
        status: "CUSTOMER",
        companyId,
        notes: "Primary technical buyer.",
      });

      const res = await contactsPOST(req);
      assert.strictEqual(res.status, 201);
      const data = await res.json();
      assert.ok(data.contact.id);
      assert.strictEqual(data.contact.email, testEmail.toLowerCase());
      assert.strictEqual(data.contact.companyId, companyId);
      contactId = data.contact.id;
      testContactIds.push(contactId);
    });

    it("prevents duplicate active contacts with same email or phone (409 Conflict)", async () => {
      const dupReq = makeReq("http://localhost:3001/api/crm/contacts", ownerToken, "POST", {
        firstName: "Duplicate",
        lastName: "Person",
        email: testEmail, // duplicate email
      });
      const dupRes = await contactsPOST(dupReq);
      assert.strictEqual(dupRes.status, 409);

      const dupPhoneReq = makeReq("http://localhost:3001/api/crm/contacts", ownerToken, "POST", {
        firstName: "Other",
        lastName: "Person",
        phone: testPhone, // duplicate phone
      });
      const dupPhoneRes = await contactsPOST(dupPhoneReq);
      assert.strictEqual(dupPhoneRes.status, 409);
    });

    it("retrieves contact details and verifies associated company relationship", async () => {
      const req = makeReq(`http://localhost:3001/api/crm/contacts/${contactId}`, memberToken);
      const res = await contactIdGET(req, { params: Promise.resolve({ id: contactId }) });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.contact.id, contactId);
      assert.strictEqual(data.contact.company.id, companyId);
    });
  });

  // --- SECTION 4: LEADS LIFECYCLE & QUALIFICATION ---
  describe("4. Leads CRUD, Filtering & Duplicate Detection", () => {
    let leadId: string;
    const testLeadEmail = `lead_${Date.now()}@inbound.test`;

    it("creates a new lead with assignment and estimated value", async () => {
      const req = makeReq("http://localhost:3001/api/crm/leads", ownerToken, "POST", {
        title: "FinTech Cloud Migration Lead",
        companyName: "FinTech Global",
        email: testLeadEmail,
        phone: "+91 99999 11111",
        status: "NEW",
        score: 75,
        source: "Inbound Website",
        estimatedValue: 750000,
        assignedToId: memberUser.id,
        notes: "Needs hybrid cloud compliance architecture.",
      });

      const res = await leadsPOST(req);
      assert.strictEqual(res.status, 201);
      const data = await res.json();
      assert.ok(data.lead.id);
      assert.strictEqual(data.lead.estimatedValue, 750000);
      assert.strictEqual(data.lead.assignedToId, memberUser.id);
      leadId = data.lead.id;
      testLeadIds.push(leadId);
    });

    it("prevents duplicate active lead with same email (409)", async () => {
      const dupReq = makeReq("http://localhost:3001/api/crm/leads", ownerToken, "POST", {
        title: "Duplicate Inbound Lead",
        email: testLeadEmail,
      });
      const dupRes = await leadsPOST(dupReq);
      assert.strictEqual(dupRes.status, 409);
    });

    it("updates lead status to QUALIFIED and verifies activity log", async () => {
      const patchReq = makeReq(`http://localhost:3001/api/crm/leads/${leadId}`, memberToken, "PATCH", {
        status: "QUALIFIED",
        score: 90,
      });
      const patchRes = await leadIdPATCH(patchReq, { params: Promise.resolve({ id: leadId }) });
      assert.strictEqual(patchRes.status, 200);
      const data = await patchRes.json();
      assert.strictEqual(data.lead.status, "QUALIFIED");
      assert.strictEqual(data.lead.score, 90);

      // Verify activity recorded
      const act = await db.activity.findFirst({
        where: { entity: "lead", entityId: leadId, action: "updated" },
      });
      assert.ok(act);
      assert.ok(act.summary.includes("QUALIFIED"));
    });

    it("filters leads by status in list endpoint", async () => {
      const req = makeReq("http://localhost:3001/api/crm/leads?status=QUALIFIED", memberToken);
      const res = await leadsGET(req);
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.ok(data.leads.some((l: any) => l.id === leadId));
    });
  });

  // --- SECTION 5: DEALS PIPELINE & PROJECT CONVERSION ---
  describe("5. Deals Lifecycle, Pipeline Math & Project Conversion", () => {
    let dealId: string;
    let companyId: string;
    let contactId: string;

    before(async () => {
      const co = await db.company.create({
        data: { name: `BigBank Systems ${Date.now()}` },
      });
      companyId = co.id;
      testCompanyIds.push(companyId);

      const ct = await db.contact.create({
        data: { firstName: "Robert", lastName: "Smith", companyId },
      });
      contactId = ct.id;
      testContactIds.push(contactId);
    });

    it("creates a deal with INR base currency and default probability", async () => {
      const req = makeReq("http://localhost:3001/api/crm/deals", ownerToken, "POST", {
        title: "Core Banking DevOps Automation",
        value: 2500000,
        currency: "INR",
        stage: "DISCOVERY",
        companyId,
        contactId,
        ownerId: ownerUser.id,
        notes: "Enterprise platform automation project.",
      });

      const res = await dealsPOST(req);
      assert.strictEqual(res.status, 201);
      const data = await res.json();
      assert.ok(data.deal.id);
      assert.strictEqual(data.deal.value, 2500000);
      assert.strictEqual(data.deal.currency, "INR");
      assert.strictEqual(data.deal.probability, 20); // Discovery default is 20%
      dealId = data.deal.id;
      testDealIds.push(dealId);
    });

    it("advances deal through stages: PROPOSAL (50%) -> NEGOTIATION (75%) -> CLOSED_WON (100%)", async () => {
      // Advance to PROPOSAL
      const p1 = await dealIdPATCH(
        makeReq(`http://localhost:3001/api/crm/deals/${dealId}`, ownerToken, "PATCH", { stage: "PROPOSAL" }),
        { params: Promise.resolve({ id: dealId }) }
      );
      assert.strictEqual(p1.status, 200);
      assert.strictEqual((await p1.json()).deal.probability, 50);

      // Advance to NEGOTIATION
      const p2 = await dealIdPATCH(
        makeReq(`http://localhost:3001/api/crm/deals/${dealId}`, ownerToken, "PATCH", { stage: "NEGOTIATION" }),
        { params: Promise.resolve({ id: dealId }) }
      );
      assert.strictEqual(p2.status, 200);
      assert.strictEqual((await p2.json()).deal.probability, 75);

      // Advance to CLOSED_WON
      const p3 = await dealIdPATCH(
        makeReq(`http://localhost:3001/api/crm/deals/${dealId}`, ownerToken, "PATCH", { stage: "CLOSED_WON" }),
        { params: Promise.resolve({ id: dealId }) }
      );
      assert.strictEqual(p3.status, 200);
      assert.strictEqual((await p3.json()).deal.probability, 100);
    });

    it("prevents MEMBER from converting deal to project (403 Forbidden)", async () => {
      const convertReq = makeReq(`http://localhost:3001/api/crm/deals/${dealId}/convert`, memberToken, "POST", {
        confirm: true,
        projectName: "Member Attempted Project",
      });
      const convertRes = await convertPOST(convertReq, { params: Promise.resolve({ id: dealId }) });
      assert.strictEqual(convertRes.status, 403);
    });

    it("requires explicit user confirmation before converting deal (400 Bad Request if missing)", async () => {
      const noConfirmReq = makeReq(`http://localhost:3001/api/crm/deals/${dealId}/convert`, ownerToken, "POST", {
        confirm: false, // missing true confirmation
        projectName: "Unconfirmed Project",
      });
      const res = await convertPOST(noConfirmReq, { params: Promise.resolve({ id: dealId }) });
      assert.strictEqual(res.status, 400);
    });

    it("converts won deal to project with bidirectional link preservation", async () => {
      const convertReq = makeReq(`http://localhost:3001/api/crm/deals/${dealId}/convert`, ownerToken, "POST", {
        confirm: true,
        projectName: "Core Banking Delivery Project",
        description: "Delivery project from commercial contract.",
        priority: "HIGH",
      });

      const res = await convertPOST(convertReq, { params: Promise.resolve({ id: dealId }) });
      assert.strictEqual(res.status, 201);
      const data = await res.json();

      assert.ok(data.project.id);
      assert.strictEqual(data.project.name, "Core Banking Delivery Project");
      testProjectIds.push(data.project.id);

      // Verify bidirectional link
      assert.strictEqual(data.deal.convertedProjectId, data.project.id);
      assert.strictEqual(data.deal.stage, "CLOSED_WON");
      assert.strictEqual(data.deal.probability, 100);

      const dbProject = await db.project.findUnique({ where: { id: data.project.id } });
      assert.strictEqual(dbProject?.dealId, dealId);
    });

    it("enforces conversion idempotency: cannot convert an already-converted deal (400)", async () => {
      const secondConvertReq = makeReq(`http://localhost:3001/api/crm/deals/${dealId}/convert`, ownerToken, "POST", {
        confirm: true,
        projectName: "Duplicate Project Attempt",
      });
      const res = await convertPOST(secondConvertReq, { params: Promise.resolve({ id: dealId }) });
      assert.strictEqual(res.status, 400);
      const data = await res.json();
      assert.ok(data.error.includes("already been converted"));
    });
  });

  // --- SECTION 6: LIVE DASHBOARD / STATS CALCULATION ---
  describe("6. CRM Real-Time Analytics & Aggregation", () => {
    it("computes truthful live statistics from actual PostgreSQL rows without hardcoded mock data", async () => {
      const req = makeReq("http://localhost:3001/api/crm/stats", memberToken);
      const res = await statsGET(req);
      assert.strictEqual(res.status, 200);
      const data = await res.json();

      assert.strictEqual(data.currency, "INR");
      assert.strictEqual(typeof data.totalLeads, "number");
      assert.strictEqual(typeof data.openDeals, "number");
      assert.strictEqual(typeof data.pipelineValue, "number");
      assert.strictEqual(typeof data.wonDeals, "number");
      assert.strictEqual(typeof data.wonValue, "number");
      assert.strictEqual(typeof data.winRate, "number");
      assert.ok(data.wonDeals >= 1, "Expected at least 1 won deal from Section 5");
      assert.ok(data.wonValue >= 2500000, "Expected at least 25,00,000 INR from won deal");
    });
  });

  // --- SECTION 7: CONCURRENCY, DATABASE INVARIANTS & SECURITY HARDENING (PHASE 2.1) ---
  describe("7. Phase 2.1 Concurrency, Database Invariants & Security Hardening", () => {
    it("rejects creation and updates of deals with non-INR currencies (400 Bad Request)", async () => {
      // Create with USD
      const usdReq = makeReq("http://localhost:3001/api/crm/deals", ownerToken, "POST", {
        title: "Foreign USD Deal",
        value: 10000,
        currency: "USD",
      });
      const usdRes = await dealsPOST(usdReq);
      assert.strictEqual(usdRes.status, 400);

      // Create with EUR
      const eurReq = makeReq("http://localhost:3001/api/crm/deals", ownerToken, "POST", {
        title: "Foreign EUR Deal",
        value: 10000,
        currency: "EUR",
      });
      const eurRes = await dealsPOST(eurReq);
      assert.strictEqual(eurRes.status, 400);

      // Valid INR Deal
      const inrReq = makeReq("http://localhost:3001/api/crm/deals", ownerToken, "POST", {
        title: "Valid INR Deal",
        value: 500000,
        currency: "INR",
      });
      const inrRes = await dealsPOST(inrReq);
      assert.strictEqual(inrRes.status, 201);
      const inrData = await inrRes.json();
      testDealIds.push(inrData.deal.id);
      assert.strictEqual(inrData.deal.currency, "INR");

      // Attempt to update currency to USD
      const patchReq = makeReq(`http://localhost:3001/api/crm/deals/${inrData.deal.id}`, ownerToken, "PATCH", {
        currency: "USD",
      });
      const patchRes = await dealIdPATCH(patchReq, { params: Promise.resolve({ id: inrData.deal.id }) });
      assert.strictEqual(patchRes.status, 400);
    });

    it("strictly rejects deal conversion for deals not in CLOSED_WON stage (400 Bad Request)", async () => {
      const nonWonStages = ["DISCOVERY", "PROPOSAL", "NEGOTIATION", "CLOSED_LOST"] as const;

      for (const st of nonWonStages) {
        const d = await db.deal.create({
          data: {
            title: `Unwon Deal in ${st}`,
            value: 100000,
            currency: "INR",
            stage: st,
            probability: st === "CLOSED_LOST" ? 0 : 30,
            ownerId: ownerUser.id,
          },
        });
        testDealIds.push(d.id);

        const convReq = makeReq(`http://localhost:3001/api/crm/deals/${d.id}/convert`, ownerToken, "POST", {
          confirm: true,
          projectName: `Invalid Project from ${st}`,
        });
        const res = await convertPOST(convReq, { params: Promise.resolve({ id: d.id }) });
        assert.strictEqual(res.status, 400);
        const body = await res.json();
        assert.strictEqual(body.error, "Only deals in CLOSED_WON stage can be converted to projects");

        // Verify no project was created in DB
        const projectCount = await db.project.count({ where: { dealId: d.id } });
        assert.strictEqual(projectCount, 0);
      }
    });

    it("enforces MEMBER authorization boundaries: members cannot modify deals owned by other team members (403)", async () => {
      // 1. Create a deal owned by ownerUser
      const ownerDeal = await db.deal.create({
        data: {
          title: "Executive Strategic Account",
          value: 10000000,
          currency: "INR",
          stage: "PROPOSAL",
          probability: 50,
          ownerId: ownerUser.id,
          notes: "Sensitive pricing negotiation",
        },
      });
      testDealIds.push(ownerDeal.id);

      // Attempt by memberUser to modify commercial value
      const valReq = makeReq(`http://localhost:3001/api/crm/deals/${ownerDeal.id}`, memberToken, "PATCH", {
        value: 5000000,
      });
      const valRes = await dealIdPATCH(valReq, { params: Promise.resolve({ id: ownerDeal.id }) });
      assert.strictEqual(valRes.status, 403);
      assert.ok((await valRes.json()).error.includes("Members cannot modify deals owned by other team members"));

      // Attempt by memberUser to modify stage
      const stageReq = makeReq(`http://localhost:3001/api/crm/deals/${ownerDeal.id}`, memberToken, "PATCH", {
        stage: "CLOSED_LOST",
      });
      const stageRes = await dealIdPATCH(stageReq, { params: Promise.resolve({ id: ownerDeal.id }) });
      assert.strictEqual(stageRes.status, 403);

      // Attempt by memberUser to modify notes
      const notesReq = makeReq(`http://localhost:3001/api/crm/deals/${ownerDeal.id}`, memberToken, "PATCH", {
        notes: "Overwritten notes by non-owner member",
      });
      const notesRes = await dealIdPATCH(notesReq, { params: Promise.resolve({ id: ownerDeal.id }) });
      assert.strictEqual(notesRes.status, 403);

      // 2. Member CAN modify their own deal
      const memberDeal = await db.deal.create({
        data: {
          title: "Member Assigned Deal",
          value: 750000,
          currency: "INR",
          stage: "DISCOVERY",
          probability: 20,
          ownerId: memberUser.id,
          notes: "Initial member notes",
        },
      });
      testDealIds.push(memberDeal.id);

      const memberEditReq = makeReq(`http://localhost:3001/api/crm/deals/${memberDeal.id}`, memberToken, "PATCH", {
        value: 900000,
        notes: "Updated member notes",
      });
      const memberEditRes = await dealIdPATCH(memberEditReq, { params: Promise.resolve({ id: memberDeal.id }) });
      assert.strictEqual(memberEditRes.status, 200);
      const updatedMemberDeal = (await memberEditRes.json()).deal;
      assert.strictEqual(updatedMemberDeal.value, 900000);
      assert.strictEqual(updatedMemberDeal.notes, "Updated member notes");
    });

    it("concurrent duplicate lead creation stress test: prevents duplicates under race conditions (P2002 -> 409)", async () => {
      const email = `race_lead_${Date.now()}@concurrent-test.com`;
      const payload = {
        title: "Concurrent Lead Registration",
        email,
        status: "NEW",
        score: 50,
      };

      const req1 = makeReq("http://localhost:3001/api/crm/leads", ownerToken, "POST", payload);
      const req2 = makeReq("http://localhost:3001/api/crm/leads", ownerToken, "POST", payload);

      const [res1, res2] = await Promise.all([leadsPOST(req1), leadsPOST(req2)]);

      const statuses = [res1.status, res2.status].sort();
      assert.deepStrictEqual(statuses, [201, 409], "Expected exactly one 201 Created and one 409 Conflict");

      // Verify database record count
      const dbLeads = await db.lead.findMany({ where: { email } });
      assert.strictEqual(dbLeads.length, 1, "Exactly one lead record must exist in PostgreSQL");
      testLeadIds.push(dbLeads[0].id);
    });

    it("concurrent duplicate contact creation stress test: prevents duplicates under race conditions (P2002 -> 409)", async () => {
      const email = `race_contact_${Date.now()}@concurrent-test.com`;
      const payload = {
        firstName: "Concurrent",
        lastName: "Contact",
        email,
        status: "LEAD",
      };

      const req1 = makeReq("http://localhost:3001/api/crm/contacts", ownerToken, "POST", payload);
      const req2 = makeReq("http://localhost:3001/api/crm/contacts", ownerToken, "POST", payload);

      const [res1, res2] = await Promise.all([contactsPOST(req1), contactsPOST(req2)]);

      const statuses = [res1.status, res2.status].sort();
      assert.deepStrictEqual(statuses, [201, 409], "Expected exactly one 201 Created and one 409 Conflict");

      // Verify database record count
      const dbContacts = await db.contact.findMany({ where: { email } });
      assert.strictEqual(dbContacts.length, 1, "Exactly one contact record must exist in PostgreSQL");
      testContactIds.push(dbContacts[0].id);
    });

    it("concurrent duplicate company creation stress test: prevents duplicates under race conditions (P2002 -> 409)", async () => {
      const ts = Date.now();
      const name = `Concurrent Enterprise ${ts}`;
      const domain = `concurrent-${ts}.com`;
      const payload = {
        name,
        domain,
        industry: "Cloud Computing",
      };

      const req1 = makeReq("http://localhost:3001/api/crm/companies", ownerToken, "POST", payload);
      const req2 = makeReq("http://localhost:3001/api/crm/companies", ownerToken, "POST", payload);

      const [res1, res2] = await Promise.all([companiesPOST(req1), companiesPOST(req2)]);

      const statuses = [res1.status, res2.status].sort();
      assert.deepStrictEqual(statuses, [201, 409], "Expected exactly one 201 Created and one 409 Conflict");

      // Verify database record count
      const dbCompanies = await db.company.findMany({ where: { name } });
      assert.strictEqual(dbCompanies.length, 1, "Exactly one company record must exist in PostgreSQL");
      testCompanyIds.push(dbCompanies[0].id);
    });

    it("concurrent deal conversion stress test: guarantees 1-to-1 conversion and prevents orphaned projects (P2002 -> 400)", async () => {
      // 1. Create a won deal ready for conversion
      const wonDeal = await db.deal.create({
        data: {
          title: `Concurrent Conversion Deal ${Date.now()}`,
          value: 5000000,
          currency: "INR",
          stage: "CLOSED_WON",
          probability: 100,
          ownerId: ownerUser.id,
        },
      });
      testDealIds.push(wonDeal.id);

      const req1 = makeReq(`http://localhost:3001/api/crm/deals/${wonDeal.id}/convert`, ownerToken, "POST", {
        confirm: true,
        projectName: `Concurrent Project A ${Date.now()}`,
      });
      const req2 = makeReq(`http://localhost:3001/api/crm/deals/${wonDeal.id}/convert`, ownerToken, "POST", {
        confirm: true,
        projectName: `Concurrent Project B ${Date.now()}`,
      });

      // Fire both conversion requests concurrently
      const [res1, res2] = await Promise.all([
        convertPOST(req1, { params: Promise.resolve({ id: wonDeal.id }) }),
        convertPOST(req2, { params: Promise.resolve({ id: wonDeal.id }) }),
      ]);

      const statuses = [res1.status, res2.status].sort();
      assert.deepStrictEqual(statuses, [201, 400], "Expected exactly one 201 Created and one 400 Bad Request");

      // Find the 201 result and 400 result
      const successRes = res1.status === 201 ? res1 : res2;
      const failedRes = res1.status === 400 ? res1 : res2;

      const successData = await successRes.json();
      const failedData = await failedRes.json();

      assert.ok(successData.project?.id);
      testProjectIds.push(successData.project.id);
      assert.ok(failedData.error.includes("already been converted"));

      // PostgreSQL Invariant Verification:
      // Exactly ONE project in the entire database must reference this dealId
      const linkedProjects = await db.project.findMany({ where: { dealId: wonDeal.id } });
      assert.strictEqual(linkedProjects.length, 1, "Only one project must be linked to dealId");
      assert.strictEqual(linkedProjects[0].id, successData.project.id);

      // The deal's convertedProjectId must point to this unique project
      const refreshedDeal = await db.deal.findUnique({ where: { id: wonDeal.id } });
      assert.strictEqual(refreshedDeal?.convertedProjectId, successData.project.id);
    });
  });
});

