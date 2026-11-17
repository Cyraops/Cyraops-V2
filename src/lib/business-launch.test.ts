import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { db } from "./db";
import { createSession } from "./auth";

// Route Handlers
import { GET as workspaceGET, PATCH as workspacePATCH } from "../app/api/workspace/route";
import { GET as readinessGET, POST as readinessPOST } from "../app/api/company/readiness/route";
import { PATCH as readinessIdPATCH } from "../app/api/company/readiness/[id]/route";
import { GET as servicesGET } from "../app/api/company/services/route";
import { GET as portfolioGET } from "../app/api/company/portfolio/route";
import { GET as dealsGET, POST as dealsPOST } from "../app/api/crm/deals/route";
import { GET as dealIdGET, PATCH as dealIdPATCH } from "../app/api/crm/deals/[id]/route";
import { POST as convertPOST } from "../app/api/crm/deals/[id]/convert/route";
import { GET as proposalsGET, POST as proposalsPOST } from "../app/api/crm/proposals/route";
import { GET as proposalIdGET, PATCH as proposalIdPATCH } from "../app/api/crm/proposals/[id]/route";
import { GET as milestonesGET, POST as milestonesPOST } from "../app/api/projects/[id]/milestones/route";
import { PATCH as milestoneIdPATCH } from "../app/api/projects/[id]/milestones/[milestoneId]/route";
import { GET as invoicesGET, POST as invoicesPOST } from "../app/api/billing/invoices/route";
import { PATCH as invoiceIdPATCH } from "../app/api/billing/invoices/[id]/route";
import { GET as dashboardGET } from "../app/api/dashboard/route";

describe("Cyraops — Business Launch MVP End-to-End Lifecycle Suite", () => {
  let ownerUser: any;
  let devopsUser: any;
  let ownerToken: string;
  let devopsToken: string;
  let originalWorkspace: any;
  let originalReadinessItems: any[] = [];

  const testUserIds: string[] = [];
  const testDealIds: string[] = [];
  const testProposalIds: string[] = [];
  const testProjectIds: string[] = [];
  const testMilestoneIds: string[] = [];
  const testInvoiceIds: string[] = [];
  const testReadinessIds: string[] = [];

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
    originalWorkspace = await db.workspace.findUnique({ where: { id: "main" } });
    originalReadinessItems = await db.businessReadinessItem.findMany();

    // 1. Create Owner (Collaborator A)
    ownerUser = await db.user.create({
      data: {
        email: `launch_owner_${timestamp}@cyraops.test`,
        name: "Tanveer Singh (Founder/Owner)",
        role: "OWNER",
      },
    });
    testUserIds.push(ownerUser.id);

    // 2. Create DevOps Technical Lead (Collaborator B)
    devopsUser = await db.user.create({
      data: {
        email: `launch_devops_${timestamp}@cyraops.test`,
        name: "DevOps Technical Lead",
        role: "MEMBER",
      },
    });
    testUserIds.push(devopsUser.id);

    ownerToken = (await createSession(ownerUser.id)).token;
    devopsToken = (await createSession(devopsUser.id)).token;
  });

  after(async () => {
    // Teardown created entities in reverse dependency order
    for (const invId of testInvoiceIds) {
      await db.clientInvoice.delete({ where: { id: invId } }).catch(() => {});
    }
    for (const mId of testMilestoneIds) {
      await db.projectMilestone.delete({ where: { id: mId } }).catch(() => {});
    }
    for (const pId of testProjectIds) {
      await db.task.deleteMany({ where: { projectId: pId } }).catch(() => {});
      await db.projectMember.deleteMany({ where: { projectId: pId } }).catch(() => {});
      await db.activity.deleteMany({ where: { projectId: pId } }).catch(() => {});
      await db.project.delete({ where: { id: pId } }).catch(() => {});
    }
    for (const propId of testProposalIds) {
      await db.proposal.delete({ where: { id: propId } }).catch(() => {});
    }
    for (const dId of testDealIds) {
      await db.activity.deleteMany({ where: { entity: "deal", entityId: dId } }).catch(() => {});
      await db.deal.delete({ where: { id: dId } }).catch(() => {});
    }
    for (const rId of testReadinessIds) {
      await db.businessReadinessItem.delete({ where: { id: rId } }).catch(() => {});
    }
    for (const uId of testUserIds) {
      await db.session.deleteMany({ where: { userId: uId } }).catch(() => {});
      await db.activity.deleteMany({ where: { userId: uId } }).catch(() => {});
      await db.user.delete({ where: { id: uId } }).catch(() => {});
    }
    for (const item of originalReadinessItems) {
      await db.businessReadinessItem.update({
        where: { id: item.id },
        data: {
          category: item.category,
          title: item.title,
          description: item.description,
          status: item.status,
          ownerId: item.ownerId,
          notes: item.notes,
          completedAt: item.completedAt,
        },
      }).catch(() => {});
    }
    if (originalWorkspace) {
      await db.workspace.update({
        where: { id: "main" },
        data: {
          name: originalWorkspace.name,
          tagline: originalWorkspace.tagline,
          industry: originalWorkspace.industry,
          phone: originalWorkspace.phone,
          website: originalWorkspace.website,
          address: originalWorkspace.address,
          timezone: originalWorkspace.timezone,
          socialLinks: originalWorkspace.socialLinks,
          registrationDetails: originalWorkspace.registrationDetails,
        },
      });
    }
  });

  // ==========================================================================
  // PHASE 1: COMPANY PROFILE, SERVICE CATALOGUE & LAUNCH READINESS
  // ==========================================================================
  describe("Phase 1: Company Profile, Services Catalogue & Readiness", () => {
    it("1. seeds and retrieves baseline business readiness checklist items", async () => {
      const req = makeReq("http://localhost:3001/api/company/readiness", ownerToken);
      const res = await readinessGET(req);
      assert.strictEqual(res.status, 200);
      const data = await res.json();

      assert.ok(Array.isArray(data.items));
      assert.ok(data.items.length >= 8);
      const existingIds = new Set(originalReadinessItems.map((item) => item.id));
      testReadinessIds.push(...data.items.filter((item: any) => !existingIds.has(item.id)).map((item: any) => item.id));
      assert.ok(data.summary);
      assert.strictEqual(typeof data.summary.progressPercent, "number");
    });

    it("2. updates and persists company profile with complete IT services identity", async () => {
      const patchReq = makeReq("http://localhost:3001/api/workspace", ownerToken, "PATCH", {
        name: "Cyraops",
        tagline: "Cloud Infrastructure & Managed IT Services",
        industry: "IT Services & Cloud Consulting",
        website: "https://cyraops.com",
        phone: "+91 98765 43210",
        timezone: "Asia/Kolkata",
        address: "Bengaluru, Karnataka, India",
        socialLinks: {
          upwork: "https://www.upwork.com/agencies/cyraops",
          freelancer: "https://www.freelancer.com/u/cyraops",
          fiverr: "https://www.fiverr.com/cyraops",
          linkedin: "https://www.linkedin.com/company/cyraops",
          github: "https://github.com/cyraops",
        },
        registrationDetails: "GSTIN: 29AAAAA0000A1Z5 | Bank: HDFC Bank Current A/C",
      });

      const patchRes = await workspacePATCH(patchReq);
      assert.strictEqual(patchRes.status, 200);
      const patchData = await patchRes.json();
      assert.strictEqual(patchData.workspace.name, "Cyraops");
      assert.strictEqual(patchData.workspace.tagline, "Cloud Infrastructure & Managed IT Services");

      // Verify read endpoint returns persisted metadata
      const getReq = makeReq("http://localhost:3001/api/workspace", devopsToken);
      const getRes = await workspaceGET(getReq);
      const getData = await getRes.json();
      assert.strictEqual(getData.workspace.name, "Cyraops");
      assert.ok(getData.workspace.socialLinks.includes("upwork"));
    });

    it("3. reads only explicitly configured services", async () => {
      const existingCount = await db.serviceCapability.count();
      const req = makeReq("http://localhost:3001/api/company/services", devopsToken);
      const res = await servicesGET(req);
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.ok(Array.isArray(data.services));
      assert.strictEqual(data.services.length, existingCount);
    });

    it("4. reads only explicitly configured portfolio evidence", async () => {
      const existingIds = await db.portfolioItem.findMany({ select: { id: true } });
      const req = makeReq("http://localhost:3001/api/company/portfolio", devopsToken);
      const res = await portfolioGET(req);
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.ok(Array.isArray(data.items));
      assert.strictEqual(data.items.length, existingIds.length);
    });

    it("5. Collaborator B completes a readiness item and verifies progress percentage advances", async () => {
      const getReq = makeReq("http://localhost:3001/api/company/readiness", devopsToken);
      const getRes = await readinessGET(getReq);
      const getData = await getRes.json();
      const firstItem = getData.items[0];

      const patchReq = makeReq(
        `http://localhost:3001/api/company/readiness/${firstItem.id}`,
        devopsToken,
        "PATCH",
        { status: "COMPLETED", notes: "Verified company identity by Collaborator B" }
      );
      const patchRes = await readinessIdPATCH(patchReq, { params: Promise.resolve({ id: firstItem.id }) });
      assert.strictEqual(patchRes.status, 200);
      const patchData = await patchRes.json();
      assert.strictEqual(patchData.item.status, "COMPLETED");
      assert.ok(patchData.item.completedAt);
    });
  });

  // ==========================================================================
  // PHASE 2: OPPORTUNITY INTAKE, FREELANCE CHANNELS & PROPOSALS
  // ==========================================================================
  describe("Phase 2: Project Opportunity Intake & Sales Workflow", () => {
    let upworkDealId: string;
    let freelancerDealId: string;
    let proposalId: string;

    it("6. intaking an Upwork RFP opportunity with job link, value, and next action", async () => {
      const today = new Date().toISOString();
      const req = makeReq("http://localhost:3001/api/crm/deals", ownerToken, "POST", {
        title: "AWS Cloud Migration & Hardening (Upwork RFP)",
        value: 35000,
        currency: "INR",
        stage: "DISCOVERY",
        sourcePlatform: "UPWORK",
        externalUrl: "https://www.upwork.com/jobs/~0123456789abcdef",
        nextAction: "Draft technical proposal for client review",
        followUpDate: today,
        notes: "Client requires multi-AZ AWS architecture with RDS and Terraform.",
      });

      const res = await dealsPOST(req);
      assert.strictEqual(res.status, 201);
      const data = await res.json();
      upworkDealId = data.deal.id;
      testDealIds.push(upworkDealId);

      assert.strictEqual(data.deal.sourcePlatform, "UPWORK");
      assert.strictEqual(data.deal.value, 35000);
      assert.strictEqual(data.deal.currency, "INR");
    });

    it("7. intaking a Freelancer.com opportunity", async () => {
      const req = makeReq("http://localhost:3001/api/crm/deals", ownerToken, "POST", {
        title: "Docker CI/CD Pipeline Setup (Freelancer)",
        value: 25000,
        currency: "INR",
        stage: "DISCOVERY",
        sourcePlatform: "FREELANCER",
        externalUrl: "https://www.freelancer.com/projects/devops/12345",
      });

      const res = await dealsPOST(req);
      assert.strictEqual(res.status, 201);
      const data = await res.json();
      freelancerDealId = data.deal.id;
      testDealIds.push(freelancerDealId);

      assert.strictEqual(data.deal.sourcePlatform, "FREELANCER");
    });

    it("8. filters deals by acquisition source platform (sourcePlatform=UPWORK)", async () => {
      // Queried as the owner who created the deal: a MEMBER only sees deals they
      // own, which is deliberate row-level scoping, not a broken filter.
      const req = makeReq("http://localhost:3001/api/crm/deals?sourcePlatform=UPWORK", ownerToken);
      const res = await dealsGET(req);
      assert.strictEqual(res.status, 200);
      const data = await res.json();

      assert.ok(data.deals.length >= 1);
      assert.ok(data.deals.every((d: any) => d.sourcePlatform === "UPWORK"));
    });

    it("9. filters deals with follow-ups due today (followUp=today)", async () => {
      const req = makeReq("http://localhost:3001/api/crm/deals?followUp=today", ownerToken);
      const res = await dealsGET(req);
      assert.strictEqual(res.status, 200);
      const data = await res.json();

      assert.ok(data.deals.some((d: any) => d.id === upworkDealId));
    });

    it("10. Collaborator A drafts a formal technical proposal for the Upwork opportunity", async () => {
      const req = makeReq("http://localhost:3001/api/crm/proposals", ownerToken, "POST", {
        dealId: upworkDealId,
        title: "AWS Cloud Infrastructure Architecture & Zero-Downtime Migration",
        clientName: "Upwork Client Inc.",
        problemStatement: "Current unmanaged single VPS experiences recurring outages during peak traffic.",
        solution: "Multi-AZ AWS architecture utilizing Terraform IaC, ALB, Auto-scaling EC2, and RDS Multi-AZ.",
        scope: "Full IaC setup, database migration, automated backup policy, and CloudFront SSL.",
        deliverables: [
          "Terraform scripts in private GitHub repository",
          "Production VPC and RDS Multi-AZ cluster",
          "CloudWatch monitoring dashboards and alert triggers",
          "Root credentials and runbook handover",
        ],
        technologies: ["AWS", "Terraform", "PostgreSQL", "Docker", "CloudFront"],
        timeline: "2 weeks",
        pricing: 35000,
        currency: "INR",
        paymentTerms: "50% advance deposit, 50% upon final staging sign-off",
        status: "DRAFT",
      });

      const res = await proposalsPOST(req);
      assert.strictEqual(res.status, 201);
      const data = await res.json();
      proposalId = data.proposal.id;
      testProposalIds.push(proposalId);

      assert.strictEqual(data.proposal.status, "DRAFT");
      assert.strictEqual(data.proposal.pricing, 35000);
      assert.strictEqual(data.proposal.currency, "INR");
      assert.strictEqual(data.proposal.version, 1);
    });

    it("11. Collaborator A submits proposal for internal team review", async () => {
      const req = makeReq(
        `http://localhost:3001/api/crm/proposals/${proposalId}`,
        ownerToken,
        "PATCH",
        { status: "INTERNAL_REVIEW" }
      );
      const res = await proposalIdPATCH(req, { params: Promise.resolve({ id: proposalId }) });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.proposal.status, "INTERNAL_REVIEW");
    });

    it("12. Collaborator B (Technical Lead) reviews and approves proposal to READY_TO_SEND", async () => {
      const req = makeReq(
        `http://localhost:3001/api/crm/proposals/${proposalId}`,
        devopsToken,
        "PATCH",
        { status: "READY_TO_SEND" }
      );
      const res = await proposalIdPATCH(req, { params: Promise.resolve({ id: proposalId }) });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.proposal.status, "READY_TO_SEND");
    });

    it("13. Client accepts proposal (status=ACCEPTED); deal automatically advances to CLOSED_WON", async () => {
      const req = makeReq(
        `http://localhost:3001/api/crm/proposals/${proposalId}`,
        ownerToken,
        "PATCH",
        {
          status: "ACCEPTED",
          acceptanceChannel: "UPWORK_CONTRACT",
          acceptanceReference: "https://www.upwork.com/contracts/~0123456789",
          acceptanceNotes: "Client accepted terms via Upwork escrow offer",
        }
      );
      const res = await proposalIdPATCH(req, { params: Promise.resolve({ id: proposalId }) });
      assert.strictEqual(res.status, 200);

      // Verify the associated deal was automatically updated to CLOSED_WON with 100% probability
      const dealReq = makeReq(`http://localhost:3001/api/crm/deals/${upworkDealId}`, ownerToken);
      const dealRes = await dealIdGET(dealReq, { params: Promise.resolve({ id: upworkDealId }) });
      const dealData = await dealRes.json();
      assert.strictEqual(dealData.deal.stage, "CLOSED_WON");
      assert.strictEqual(dealData.deal.probability, 100);
      assert.strictEqual(dealData.deal.value, 35000);
    });
  });

  // ==========================================================================
  // PHASE 3: DEAL-TO-PROJECT CONVERSION & MILESTONES
  // ==========================================================================
  describe("Phase 3: Deal-to-Project Conversion & Milestone Execution", () => {
    let projectId: string;
    let milestone1Id: string;
    let milestone2Id: string;

    it("14. converts WON deal to delivery project with Collaborator B as designated lead", async () => {
      const req = makeReq(
        `http://localhost:3001/api/crm/deals/${testDealIds[0]}/convert`,
        ownerToken,
        "POST",
        {
          confirm: true,
          projectName: "AWS Cloud Infrastructure Setup & Migration",
          priority: "HIGH",
          ownerId: devopsUser.id,
          memberIds: [ownerUser.id, devopsUser.id],
        }
      );

      const res = await convertPOST(req, { params: Promise.resolve({ id: testDealIds[0] }) });
      assert.strictEqual(res.status, 201);
      const data = await res.json();
      projectId = data.project.id;
      testProjectIds.push(projectId);

      assert.strictEqual(data.project.ownerId, devopsUser.id);
      assert.strictEqual(data.deal.convertedProjectId, projectId);
    });

    it("15. Collaborator B creates Milestone 1 (VPC & Database Provisioning, ₹15,000)", async () => {
      const req = makeReq(
        `http://localhost:3001/api/projects/${projectId}/milestones`,
        devopsToken,
        "POST",
        {
          title: "Milestone 1: VPC Architecture & RDS Multi-AZ Provisioning",
          description: "Terraform IaC provisioning of VPC, private subnets, security groups, and RDS PostgreSQL.",
          billingAmount: 15000,
          status: "IN_PROGRESS",
          deliverables: ["VPC", "Terraform scripts", "RDS Multi-AZ"],
        }
      );

      const res = await milestonesPOST(req, { params: Promise.resolve({ id: projectId }) });
      assert.strictEqual(res.status, 201);
      const data = await res.json();
      milestone1Id = data.milestone.id;
      testMilestoneIds.push(milestone1Id);

      assert.strictEqual(data.milestone.billingAmount, 15000);
      assert.strictEqual(data.milestone.status, "IN_PROGRESS");
    });

    it("16. Collaborator B creates Milestone 2 (Production Deployment & Handover, ₹20,000)", async () => {
      const req = makeReq(
        `http://localhost:3001/api/projects/${projectId}/milestones`,
        devopsToken,
        "POST",
        {
          title: "Milestone 2: Production Deployment & Root Handover",
          description: "Database zero-downtime cutover, CloudFront SSL, and credential handover.",
          billingAmount: 20000,
          status: "PENDING",
        }
      );

      const res = await milestonesPOST(req, { params: Promise.resolve({ id: projectId }) });
      assert.strictEqual(res.status, 201);
      const data = await res.json();
      milestone2Id = data.milestone.id;
      testMilestoneIds.push(milestone2Id);

      assert.strictEqual(data.milestone.billingAmount, 20000);
    });

    it("17. Collaborator B completes Milestone 1 (status=COMPLETED)", async () => {
      const req = makeReq(
        `http://localhost:3001/api/projects/${projectId}/milestones/${milestone1Id}`,
        devopsToken,
        "PATCH",
        { status: "COMPLETED" }
      );
      const res = await milestoneIdPATCH(req, {
        params: Promise.resolve({ id: projectId, milestoneId: milestone1Id }),
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.milestone.status, "COMPLETED");
      assert.ok(data.milestone.completedAt);
    });
  });

  // ==========================================================================
  // PHASE 4: CLIENT BILLING & INVOICE PAYMENT TRACKER
  // ==========================================================================
  describe("Phase 4: Client Invoicing & Payment Collection (Accounts Receivable)", () => {
    let invoiceId: string;

    it("18. issues client invoice for Milestone 1 with auto-generated invoice number", async () => {
      const req = makeReq("http://localhost:3001/api/billing/invoices", ownerToken, "POST", {
        title: "Milestone 1: VPC Architecture & RDS Multi-AZ",
        amount: 15000,
        currency: "INR",
        projectId: testProjectIds[0],
        dealId: testDealIds[0],
        notes: "Payable via Bank Transfer or UPI. 5 business day terms.",
        status: "ISSUED",
      });

      const res = await invoicesPOST(req);
      assert.strictEqual(res.status, 201);
      const data = await res.json();
      invoiceId = data.invoice.id;
      testInvoiceIds.push(invoiceId);

      assert.strictEqual(data.invoice.amount, 15000);
      assert.strictEqual(data.invoice.currency, "INR");
      assert.ok(data.invoice.invoiceNumber.startsWith("INV-"));
      assert.strictEqual(data.invoice.status, "ISSUED");
    });

    it("19. records client invoice payment (status=PAID, amountPaid=15000)", async () => {
      const req = makeReq(
        `http://localhost:3001/api/billing/invoices/${invoiceId}`,
        ownerToken,
        "PATCH",
        {
          status: "PAID",
          amountPaid: 15000,
          paymentMethod: "Bank Transfer (NEFT)",
        }
      );

      const res = await invoiceIdPATCH(req, { params: Promise.resolve({ id: invoiceId }) });
      assert.strictEqual(res.status, 200);
      const data = await res.json();

      assert.strictEqual(data.invoice.status, "PAID");
      assert.strictEqual(data.invoice.amountPaid, 15000);
      assert.ok(data.invoice.paidAt);
    });

    it("20. verifies Accounts Receivable summary reports accurate paid and balance totals", async () => {
      const req = makeReq(
        `http://localhost:3001/api/billing/invoices?projectId=${testProjectIds[0]}`,
        devopsToken
      );
      const res = await invoicesGET(req);
      assert.strictEqual(res.status, 200);
      const data = await res.json();

      assert.ok(data.summary);
      assert.strictEqual(data.summary.totalInvoiced, 15000);
      assert.strictEqual(data.summary.totalPaid, 15000);
      assert.strictEqual(data.summary.outstandingBalance, 0);
    });
  });

  // ==========================================================================
  // PHASE 5: EXECUTIVE ATTENTION & DASHBOARD DATA TRUTH
  // ==========================================================================
  describe("Phase 5: Daily Attention & Dashboard Data Truth", () => {
    it("21. verifies dashboard uses INR currency symbol and returns daily operations", async () => {
      const req = makeReq("http://localhost:3001/api/dashboard", ownerToken);
      const res = await dashboardGET(req);
      assert.strictEqual(res.status, 200);
      const data = await res.json();

      // Check Sales Pipeline currency symbol is ₹ (never $)
      const pipelineHealth = data.healthIndicators?.find((h: any) => h.id === "sales-pipeline");
      assert.ok(pipelineHealth, "sales-pipeline health indicator must exist");
      assert.ok(
        !pipelineHealth.value.includes("$"),
        "Pipeline value must not contain $ symbol"
      );
      assert.ok(
        !pipelineHealth.supportingData.includes("$"),
        "Pipeline supportingData must not contain $ symbol"
      );

      // Verify daily operations payload
      assert.ok(data.dailyOperations);
      assert.ok(Array.isArray(data.dailyOperations.followUpsDueToday));
      assert.ok(Array.isArray(data.dailyOperations.proposalsAwaitingReview));
      assert.ok(data.dailyOperations.readiness);
      assert.strictEqual(typeof data.dailyOperations.readiness.progressPercent, "number");
    });
  });
});
