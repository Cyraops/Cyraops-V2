import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { db } from "./db";
import { createSession } from "./auth";
import { isValidExternalUrl } from "./validators";

// Route Handlers under test
import { GET as workspaceGET, PATCH as workspacePATCH } from "../app/api/workspace/route";
import { GET as dealsGET, POST as dealsPOST } from "../app/api/crm/deals/route";
import { PATCH as dealIdPATCH } from "../app/api/crm/deals/[id]/route";
import { POST as proposalsPOST } from "../app/api/crm/proposals/route";
import { PATCH as proposalIdPATCH } from "../app/api/crm/proposals/[id]/route";
import { GET as portfolioGET, POST as portfolioPOST } from "../app/api/company/portfolio/route";
import { POST as invoicesPOST } from "../app/api/billing/invoices/route";
import { PATCH as invoiceIdPATCH, DELETE as invoiceIdDELETE } from "../app/api/billing/invoices/[id]/route";

describe("Cyraops — Business Launch Remediation 1.0 Comprehensive Suite", () => {
  let ownerUser: any;
  let memberUser: any;
  let ownerToken: string;
  let memberToken: string;
  let originalRegistrationDetails: string | null = null;

  const testUserIds: string[] = [];
  const testDealIds: string[] = [];
  const testProposalIds: string[] = [];
  const testInvoiceIds: string[] = [];
  const testPortfolioIds: string[] = [];

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

  before(async () => {
    const timestamp = Date.now();
    const originalWorkspace = await db.workspace.findUnique({
      where: { id: "main" },
      select: { registrationDetails: true },
    });
    originalRegistrationDetails = originalWorkspace?.registrationDetails ?? null;

    // 1. Setup OWNER account
    ownerUser = await db.user.create({
      data: {
        email: `remed_owner_${timestamp}@cyraops.test`,
        name: "Test Founder (Owner)",
        role: "OWNER",
      },
    });
    testUserIds.push(ownerUser.id);

    // 2. Setup MEMBER account
    memberUser = await db.user.create({
      data: {
        email: `remed_member_${timestamp}@cyraops.test`,
        name: "Test Collaborator (Member)",
        role: "MEMBER",
      },
    });
    testUserIds.push(memberUser.id);

    ownerToken = (await createSession(ownerUser.id)).token;
    memberToken = (await createSession(memberUser.id)).token;

    // Seed test registration details into workspace. upsert, not update: a
    // freshly migrated test database has no workspace row, and the old `update`
    // threw here, which cancelled every test in this suite before it ran.
    await db.workspace.upsert({
      where: { id: "main" },
      create: {
        id: "main",
        name: "Cyraops",
        ownerId: ownerUser.id,
        loginEmail: ownerUser.email ?? "remed_owner@cyraops.test",
        // Required by the schema; this suite never signs in through the workspace.
        loginPasswordHash: "x",
        registrationDetails: "GSTIN: 29TESTG0000Z1 | HDFC Bank Current A/C 50200000000000",
      },
      update: {
        registrationDetails: "GSTIN: 29TESTG0000Z1 | HDFC Bank Current A/C 50200000000000",
      },
    });
  });

  after(async () => {
    // Teardown created entities in reverse dependency order
    for (const invId of testInvoiceIds) {
      await db.clientInvoice.delete({ where: { id: invId } }).catch(() => {});
    }
    for (const propId of testProposalIds) {
      await db.proposal.delete({ where: { id: propId } }).catch(() => {});
    }
    for (const dId of testDealIds) {
      await db.activity.deleteMany({ where: { entity: "deal", entityId: dId } }).catch(() => {});
      await db.deal.delete({ where: { id: dId } }).catch(() => {});
    }
    for (const portId of testPortfolioIds) {
      await db.portfolioItem.delete({ where: { id: portId } }).catch(() => {});
    }
    for (const uId of testUserIds) {
      await db.session.deleteMany({ where: { userId: uId } }).catch(() => {});
      await db.activity.deleteMany({ where: { userId: uId } }).catch(() => {});
      await db.user.delete({ where: { id: uId } }).catch(() => {});
    }
    await db.workspace.update({
      where: { id: "main" },
      data: { registrationDetails: originalRegistrationDetails },
    }).catch(() => {});
  });

  // ==========================================================================
  // SECTION 1: F-BL-01 — EXTERNAL URL SECURITY (11 CASES + UNIT TESTS)
  // ==========================================================================
  describe("F-BL-01: External URL Validation & XSS Prevention", () => {
    it("1. unit test: isValidExternalUrl correctly evaluates all schemes and formats", () => {
      // Valid
      assert.strictEqual(isValidExternalUrl("https://www.upwork.com/jobs/~01abc12345"), true);
      assert.strictEqual(isValidExternalUrl("http://freelancer.com/projects/123"), true);
      assert.strictEqual(isValidExternalUrl(""), true);
      assert.strictEqual(isValidExternalUrl(null), true);
      assert.strictEqual(isValidExternalUrl(undefined), true);

      // Dangerous schemes
      assert.strictEqual(isValidExternalUrl("javascript:alert(document.cookie)"), false);
      assert.strictEqual(isValidExternalUrl("javascript://example.com/%0Aalert(1)"), false);
      assert.strictEqual(isValidExternalUrl("data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=="), false);
      assert.strictEqual(isValidExternalUrl("vbscript:msgbox(1)"), false);
      assert.strictEqual(isValidExternalUrl("file:///etc/passwd"), false);
      assert.strictEqual(isValidExternalUrl("ftp://ftp.example.com/file"), false);

      // Protocol-relative and malformed
      assert.strictEqual(isValidExternalUrl("//evil.com/phish"), false);
      assert.strictEqual(isValidExternalUrl("http://[invalid-ipv6"), false);
      assert.strictEqual(isValidExternalUrl("not-a-url"), false);

      // Embedded credentials
      assert.strictEqual(isValidExternalUrl("https://user:password@example.com/job"), false);
      assert.strictEqual(isValidExternalUrl("http://admin@example.com/dashboard"), false);
    });

    it("2. accepts valid HTTPS URL on deal creation", async () => {
      const req = makeReq("http://localhost:3001/api/crm/deals", ownerToken, "POST", {
        title: "Valid HTTPS Job Opportunity",
        externalUrl: "https://www.upwork.com/jobs/~01abc12345",
      });
      const res = await dealsPOST(req);
      assert.strictEqual(res.status, 201);
      const data = await res.json();
      testDealIds.push(data.deal.id);
      assert.strictEqual(data.deal.externalUrl, "https://www.upwork.com/jobs/~01abc12345");
    });

    it("3. accepts valid HTTP URL on deal creation", async () => {
      const req = makeReq("http://localhost:3001/api/crm/deals", ownerToken, "POST", {
        title: "Valid HTTP Job Opportunity",
        externalUrl: "http://www.freelancer.com/projects/12345",
      });
      const res = await dealsPOST(req);
      assert.strictEqual(res.status, 201);
      const data = await res.json();
      testDealIds.push(data.deal.id);
      assert.strictEqual(data.deal.externalUrl, "http://www.freelancer.com/projects/12345");
    });

    it("4. accepts empty string for externalUrl (optional field)", async () => {
      const req = makeReq("http://localhost:3001/api/crm/deals", ownerToken, "POST", {
        title: "Empty URL Opportunity",
        externalUrl: "",
      });
      const res = await dealsPOST(req);
      assert.strictEqual(res.status, 201);
      const data = await res.json();
      testDealIds.push(data.deal.id);
    });

    it("5. accepts null for externalUrl (optional field)", async () => {
      const req = makeReq("http://localhost:3001/api/crm/deals", ownerToken, "POST", {
        title: "Null URL Opportunity",
        externalUrl: null,
      });
      const res = await dealsPOST(req);
      assert.strictEqual(res.status, 201);
      const data = await res.json();
      testDealIds.push(data.deal.id);
    });

    it("6. rejects javascript: scheme with HTTP 400", async () => {
      const req = makeReq("http://localhost:3001/api/crm/deals", ownerToken, "POST", {
        title: "XSS Attempt javascript:",
        externalUrl: "javascript:alert(document.cookie)",
      });
      const res = await dealsPOST(req);
      assert.strictEqual(res.status, 400);
      const data = await res.json();
      assert.ok(data.error.includes("External URL must be a valid absolute HTTP or HTTPS URL"));
    });

    it("7. rejects data: scheme with HTTP 400", async () => {
      const req = makeReq("http://localhost:3001/api/crm/deals", ownerToken, "POST", {
        title: "XSS Attempt data:",
        externalUrl: "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
      });
      const res = await dealsPOST(req);
      assert.strictEqual(res.status, 400);
    });

    it("8. rejects vbscript: scheme with HTTP 400", async () => {
      const req = makeReq("http://localhost:3001/api/crm/deals", ownerToken, "POST", {
        title: "XSS Attempt vbscript:",
        externalUrl: "vbscript:msgbox(1)",
      });
      const res = await dealsPOST(req);
      assert.strictEqual(res.status, 400);
    });

    it("9. rejects file: scheme with HTTP 400", async () => {
      const req = makeReq("http://localhost:3001/api/crm/deals", ownerToken, "POST", {
        title: "SSRF Attempt file:",
        externalUrl: "file:///etc/passwd",
      });
      const res = await dealsPOST(req);
      assert.strictEqual(res.status, 400);
    });

    it("10. rejects protocol-relative URL with HTTP 400", async () => {
      const req = makeReq("http://localhost:3001/api/crm/deals", ownerToken, "POST", {
        title: "Protocol-relative URL",
        externalUrl: "//evil.com/phish",
      });
      const res = await dealsPOST(req);
      assert.strictEqual(res.status, 400);
    });

    it("11. rejects malformed URL with HTTP 400", async () => {
      const req = makeReq("http://localhost:3001/api/crm/deals", ownerToken, "POST", {
        title: "Malformed URL",
        externalUrl: "http://[invalid-ipv6",
      });
      const res = await dealsPOST(req);
      assert.strictEqual(res.status, 400);
    });

    it("12. rejects URL with embedded credentials with HTTP 400", async () => {
      const req = makeReq("http://localhost:3001/api/crm/deals", ownerToken, "POST", {
        title: "Embedded credentials URL",
        externalUrl: "https://admin:secret123@example.com/job",
      });
      const res = await dealsPOST(req);
      assert.strictEqual(res.status, 400);
    });

    it("13. rejects unsafe externalUrl on deal PATCH update with HTTP 400", async () => {
      const dealId = testDealIds[0];
      const req = makeReq(`http://localhost:3001/api/crm/deals/${dealId}`, ownerToken, "PATCH", {
        externalUrl: "javascript:eval('malicious')",
      });
      const res = await dealIdPATCH(req, { params: Promise.resolve({ id: dealId }) });
      assert.strictEqual(res.status, 400);
    });
  });

  // ==========================================================================
  // SECTION 2: F-BL-02 — WORKSPACE SENSITIVE INFORMATION PRIVACY
  // ==========================================================================
  describe("F-BL-02: Workspace Sensitive Information Privacy & Role Authorization", () => {
    it("14. unauthenticated GET /api/workspace returns HTTP 401 Unauthorized", async () => {
      const req = makeReq("http://localhost:3001/api/workspace");
      const res = await workspaceGET(req);
      assert.strictEqual(res.status, 401);
    });

    it("15. MEMBER cannot retrieve raw registrationDetails (returns null)", async () => {
      const req = makeReq("http://localhost:3001/api/workspace", memberToken);
      const res = await workspaceGET(req);
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.ok(data.workspace);
      assert.strictEqual(data.workspace.registrationDetails, null, "MEMBER response must omit raw registrationDetails");
      assert.ok(data.workspace.name, "Public workspace name remains accessible");
    });

    it("16. OWNER can retrieve raw registrationDetails", async () => {
      const req = makeReq("http://localhost:3001/api/workspace", ownerToken);
      const res = await workspaceGET(req);
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.ok(data.workspace);
      assert.ok(data.workspace.registrationDetails?.includes("GSTIN"), "OWNER response must contain registrationDetails");
    });

    it("17. MEMBER cannot modify workspace settings via PATCH (returns HTTP 403 Forbidden)", async () => {
      const req = makeReq("http://localhost:3001/api/workspace", memberToken, "PATCH", {
        tagline: "Unauthorized member modification attempt",
      });
      const res = await workspacePATCH(req);
      assert.strictEqual(res.status, 403);
    });
  });

  // ==========================================================================
  // SECTION 3: F-BL-04 — PORTFOLIO TRUTHFULNESS
  // ==========================================================================
  describe("F-BL-04: Portfolio Truthfulness & Data Provenance", () => {
    it("18. confirms existing synthetic case studies in database are flagged isRealClient=false and isPublic=false", async (t) => {
      const items = await db.portfolioItem.findMany({
        where: {
          title: {
            in: [
              "High-Availability E-Commerce Infrastructure on AWS",
              "Fintech CI/CD Pipeline & Zero-Downtime Containerization",
            ],
          },
        },
      });
      // These two rows come from the demo seed script, not from a migration, so a
      // freshly migrated test database legitimately has neither. Skipping says so
      // instead of failing and pretending the whole suite is broken.
      if (items.length === 0) {
        t.skip("demo portfolio seed not present in this database");
        return;
      }
      assert.strictEqual(items.length, 2);
      for (const item of items) {
        assert.strictEqual(item.isRealClient, false, `${item.title} must have isRealClient=false`);
        assert.strictEqual(item.isPublic, false, `${item.title} must have isPublic=false`);
      }
    });

    it("19. new portfolio items default to isRealClient=false and isPublic=false", async () => {
      const req = makeReq("http://localhost:3001/api/company/portfolio", ownerToken, "POST", {
        title: "Test Kubernetes Cluster Automation",
        category: "Cloud Native",
        description: "Automated Kubernetes cluster provisioning with ArgoCD.",
        problem: "Manual deployments caused downtime.",
        solution: "GitOps deployment workflows.",
        workDone: "Configured Helm charts and ArgoCD.",
        outcome: "Continuous delivery.",
      });
      const res = await portfolioPOST(req);
      assert.strictEqual(res.status, 201);
      const data = await res.json();
      testPortfolioIds.push(data.item.id);

      assert.strictEqual(data.item.isRealClient, false);
      assert.strictEqual(data.item.isPublic, false);
    });
  });

  // ==========================================================================
  // SECTION 4: F-BL-03 & F-BL-12 — INVOICE CONCURRENCY & PAYMENT VALIDATION
  // ==========================================================================
  describe("F-BL-03 & F-BL-12: Atomic Invoice Numbers & Overpayment Hardening", () => {
    it("20. concurrent invoice creation generates strictly unique invoice numbers without collisions", async () => {
      const createPromises = Array.from({ length: 5 }, (_, i) => {
        const req = makeReq("http://localhost:3001/api/billing/invoices", ownerToken, "POST", {
          title: `Concurrent Test Invoice #${i + 1}`,
          amount: 10000 + i * 1000,
          currency: "INR",
        });
        return invoicesPOST(req);
      });

      const responses = await Promise.all(createPromises);
      const invoiceNumbers = new Set<string>();

      for (const res of responses) {
        assert.strictEqual(res.status, 201);
        const data = await res.json();
        testInvoiceIds.push(data.invoice.id);

        assert.ok(data.invoice.invoiceNumber.startsWith("INV-"));
        assert.strictEqual(invoiceNumbers.has(data.invoice.invoiceNumber), false, "Each invoice number must be unique");
        invoiceNumbers.add(data.invoice.invoiceNumber);
      }
      assert.strictEqual(invoiceNumbers.size, 5);
    });

    it("21. rejects negative payment amount with HTTP 400", async () => {
      const invoiceId = testInvoiceIds[0];
      const req = makeReq(`http://localhost:3001/api/billing/invoices/${invoiceId}`, ownerToken, "PATCH", {
        amountPaid: -1000,
      });
      const res = await invoiceIdPATCH(req, { params: Promise.resolve({ id: invoiceId }) });
      assert.strictEqual(res.status, 400);
    });

    it("22. rejects payment amount exceeding invoice amount (overpayment) with HTTP 400", async () => {
      const invoiceId = testInvoiceIds[0];
      const req = makeReq(`http://localhost:3001/api/billing/invoices/${invoiceId}`, ownerToken, "PATCH", {
        amountPaid: 99999999, // Way higher than invoice amount
      });
      const res = await invoiceIdPATCH(req, { params: Promise.resolve({ id: invoiceId }) });
      assert.strictEqual(res.status, 400);
      const data = await res.json();
      assert.ok(data.error.includes("cannot exceed total invoice amount"));
    });

    it("23. records legitimate partial payment and sets status=PARTIALLY_PAID", async () => {
      const invoiceId = testInvoiceIds[0];
      const req = makeReq(`http://localhost:3001/api/billing/invoices/${invoiceId}`, ownerToken, "PATCH", {
        amountPaid: 5000,
        paymentMethod: "Bank Transfer",
      });
      const res = await invoiceIdPATCH(req, { params: Promise.resolve({ id: invoiceId }) });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.invoice.status, "PARTIALLY_PAID");
      assert.strictEqual(data.invoice.amountPaid, 5000);
    });

    it("24. rejects marking status=PAID when amountPaid is less than total invoice amount", async () => {
      const invoiceId = testInvoiceIds[0];
      const req = makeReq(`http://localhost:3001/api/billing/invoices/${invoiceId}`, ownerToken, "PATCH", {
        status: "PAID",
        amountPaid: 6000, // Still less than 10,000
      });
      const res = await invoiceIdPATCH(req, { params: Promise.resolve({ id: invoiceId }) });
      assert.strictEqual(res.status, 400);
      const data = await res.json();
      assert.ok(data.error.includes("is less than invoice amount"));
    });

    it("25. records full payment and automatically transitions to PAID", async () => {
      const invoiceId = testInvoiceIds[0];
      const invoice = await db.clientInvoice.findUnique({ where: { id: invoiceId } });
      const fullAmount = invoice!.amount;

      const req = makeReq(`http://localhost:3001/api/billing/invoices/${invoiceId}`, ownerToken, "PATCH", {
        amountPaid: fullAmount,
      });
      const res = await invoiceIdPATCH(req, { params: Promise.resolve({ id: invoiceId }) });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.invoice.status, "PAID");
      assert.strictEqual(data.invoice.amountPaid, fullAmount);
      assert.ok(data.invoice.paidAt);
    });

    it("26. rejects cancelling an invoice that has recorded payments", async () => {
      const invoiceId = testInvoiceIds[0];
      const req = makeReq(`http://localhost:3001/api/billing/invoices/${invoiceId}`, ownerToken, "DELETE");
      const res = await invoiceIdDELETE(req, { params: Promise.resolve({ id: invoiceId }) });
      assert.strictEqual(res.status, 400);
      const data = await res.json();
      assert.ok(data.error.includes("Cannot cancel an invoice with recorded payments"));
    });

    it("27. safely cancels an unpaid invoice (soft cancel via status=CANCELLED)", async () => {
      const invoiceId = testInvoiceIds[1]; // Unpaid invoice
      const req = makeReq(`http://localhost:3001/api/billing/invoices/${invoiceId}`, ownerToken, "DELETE");
      const res = await invoiceIdDELETE(req, { params: Promise.resolve({ id: invoiceId }) });
      assert.strictEqual(res.status, 200);

      const updated = await db.clientInvoice.findUnique({ where: { id: invoiceId } });
      assert.strictEqual(updated?.status, "CANCELLED");
    });
  });

  // ==========================================================================
  // SECTION 5: PROPOSAL ACCEPTANCE AUDIT EVIDENCE
  // ==========================================================================
  describe("Proposal Acceptance Auditability & Evidence Workflow", () => {
    let proposalId: string;
    let dealId: string;

    before(async () => {
      const deal = await db.deal.create({
        data: {
          title: "Proposal Audit Test Deal",
          stage: "DISCOVERY",
          value: 45000,
          currency: "INR",
          ownerId: ownerUser.id,
        },
      });
      dealId = deal.id;
      testDealIds.push(dealId);

      const propReq = makeReq("http://localhost:3001/api/crm/proposals", ownerToken, "POST", {
        dealId,
        title: "Enterprise AWS Migration Proposal",
        clientName: "Audit Test Client",
        problemStatement: "Infrastructure performance bottlenecks",
        solution: "High availability architecture",
        scope: "Full cloud migration",
        deliverables: ["Architecture diagrams", "Terraform modules"],
        timeline: "3 weeks",
        pricing: 45000,
        paymentTerms: "50% upfront, 50% upon completion",
        status: "READY_TO_SEND",
      });
      const propRes = await proposalsPOST(propReq);
      assert.strictEqual(propRes.status, 201);
      const data = await propRes.json();
      proposalId = data.proposal.id;
      testProposalIds.push(proposalId);
    });

    it("28. rejects recording acceptance without acceptanceChannel (HTTP 400)", async () => {
      const req = makeReq(`http://localhost:3001/api/crm/proposals/${proposalId}`, ownerToken, "PATCH", {
        status: "ACCEPTED",
        acceptanceReference: "https://www.upwork.com/contracts/~012345",
      });
      const res = await proposalIdPATCH(req, { params: Promise.resolve({ id: proposalId }) });
      assert.strictEqual(res.status, 400);
      const data = await res.json();
      assert.ok(data.error.includes("Client acceptance channel is required"));
    });

    it("29. rejects recording acceptance without acceptanceReference (HTTP 400)", async () => {
      const req = makeReq(`http://localhost:3001/api/crm/proposals/${proposalId}`, ownerToken, "PATCH", {
        status: "ACCEPTED",
        acceptanceChannel: "UPWORK_CONTRACT",
      });
      const res = await proposalIdPATCH(req, { params: Promise.resolve({ id: proposalId }) });
      assert.strictEqual(res.status, 400);
      const data = await res.json();
      assert.ok(data.error.includes("Client confirmation reference identifier or URL is required"));
    });

    it("30. records verified acceptance with channel and reference, updates proposal and deal", async () => {
      const req = makeReq(`http://localhost:3001/api/crm/proposals/${proposalId}`, ownerToken, "PATCH", {
        status: "ACCEPTED",
        acceptanceChannel: "UPWORK_CONTRACT",
        acceptanceReference: "https://www.upwork.com/contracts/~01987654321",
        acceptanceNotes: "Client approved milestone 1 contract offer on Upwork",
      });
      const res = await proposalIdPATCH(req, { params: Promise.resolve({ id: proposalId }) });
      assert.strictEqual(res.status, 200);
      const data = await res.json();

      assert.strictEqual(data.proposal.status, "ACCEPTED");
      assert.strictEqual(data.proposal.acceptanceChannel, "UPWORK_CONTRACT");
      assert.strictEqual(data.proposal.acceptanceReference, "https://www.upwork.com/contracts/~01987654321");
      assert.ok(data.proposal.acceptedAt);
      assert.strictEqual(data.proposal.acceptedByUserId, ownerUser.id);

      // Verify associated deal was advanced to CLOSED_WON with 100% probability
      const deal = await db.deal.findUnique({ where: { id: dealId } });
      assert.strictEqual(deal?.stage, "CLOSED_WON");
      assert.strictEqual(deal?.probability, 100);
      assert.strictEqual(deal?.value, 45000);
    });
  });
});

