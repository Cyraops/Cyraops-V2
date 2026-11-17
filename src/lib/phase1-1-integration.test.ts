import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { db } from "./db";
import { createSession } from "./auth";
import { GET as recurringGET } from "../app/api/cost/recurring/route";
import { GET as marketingGET } from "../app/api/cost/marketing/route";
import { GET as aiGET } from "../app/api/cost/ai/route";
import { POST as emailSyncPOST, GET as emailSyncGET } from "../app/api/email/sync/route";
import { EmailService } from "./email/service";
import { POST as exportPOST, GET as exportGET } from "../app/api/cost/reports/export/route";
import { sanitizeEmailHtml, hasRemoteImages } from "./email/sanitize";

describe("Phase 1.1 Remediation — Route-Level Integration Tests", () => {
  let ownerUser: any;
  let adminUser: any;
  let memberUser: any;
  let ownerSessionToken: string;
  let adminSessionToken: string;
  let memberSessionToken: string;

  const createdUserIds: string[] = [];

  before(async () => {
    // 1. Create or find test users representing OWNER, ADMIN, and MEMBER
    const timestamp = Date.now();

    ownerUser = await db.user.create({
      data: {
        email: `phase11_owner_${timestamp}@test.local`,
        name: "Phase 1.1 Owner",
        role: "OWNER",
      },
    });
    createdUserIds.push(ownerUser.id);

    adminUser = await db.user.create({
      data: {
        email: `phase11_admin_${timestamp}@test.local`,
        name: "Phase 1.1 Admin",
        role: "ADMIN",
      },
    });
    createdUserIds.push(adminUser.id);

    memberUser = await db.user.create({
      data: {
        email: `phase11_member_${timestamp}@test.local`,
        name: "Phase 1.1 Member",
        role: "MEMBER",
      },
    });
    createdUserIds.push(memberUser.id);

    // 2. Create active sessions for each test user
    const ownerSession = await createSession(ownerUser.id);
    ownerSessionToken = ownerSession.token;

    const adminSession = await createSession(adminUser.id);
    adminSessionToken = adminSession.token;

    const memberSession = await createSession(memberUser.id);
    memberSessionToken = memberSession.token;
  });

  after(async () => {
    // Cleanup sessions and test users
    for (const uid of createdUserIds) {
      await db.session.deleteMany({ where: { userId: uid } }).catch(() => {});
      await db.costAuditLog.deleteMany({ where: { userId: uid } }).catch(() => {});
      await db.user.delete({ where: { id: uid } }).catch(() => {});
    }
  });

  function reqWithAuth(url: string, token?: string, method = "GET", body?: any): NextRequest {
    const headers: Record<string, string> = {
      host: "localhost:3001",
      origin: "http://localhost:3001",
      referer: "http://localhost:3001",
      "sec-fetch-site": "same-origin",
    };
    if (token) {
      headers.cookie = `company_session=${token}`;
    }
    if (body) {
      headers["content-type"] = "application/json";
    }

    return new NextRequest(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  describe("1. Financial Read Authorization (BLK-SEC-05)", () => {
    it("GET /api/cost/recurring rejects unauthenticated requests with 401", async () => {
      const req = reqWithAuth("http://localhost:3001/api/cost/recurring");
      const res = await recurringGET(req);
      assert.strictEqual(res.status, 401, "Unauthenticated request must return HTTP 401");
    });

    it("GET /api/cost/recurring rejects MEMBER with 403 Forbidden", async () => {
      const req = reqWithAuth("http://localhost:3001/api/cost/recurring", memberSessionToken);
      const res = await recurringGET(req);
      assert.strictEqual(res.status, 403, "MEMBER must be rejected with HTTP 403");
      const data = await res.json();
      assert.match(data.error, /restricted to administrators/i);
    });

    it("GET /api/cost/recurring allows ADMIN with 200 OK", async () => {
      const req = reqWithAuth("http://localhost:3001/api/cost/recurring", adminSessionToken);
      const res = await recurringGET(req);
      assert.strictEqual(res.status, 200, "ADMIN must receive HTTP 200");
      const data = await res.json();
      assert.ok(Array.isArray(data.recurring), "Should return recurring array");
    });

    it("GET /api/cost/recurring allows OWNER with 200 OK", async () => {
      const req = reqWithAuth("http://localhost:3001/api/cost/recurring", ownerSessionToken);
      const res = await recurringGET(req);
      assert.strictEqual(res.status, 200, "OWNER must receive HTTP 200");
      const data = await res.json();
      assert.ok(Array.isArray(data.recurring), "Should return recurring array");
    });

    it("GET /api/cost/marketing rejects unauthenticated with 401 and MEMBER with 403", async () => {
      const reqUnauth = reqWithAuth("http://localhost:3001/api/cost/marketing");
      const resUnauth = await marketingGET(reqUnauth);
      assert.strictEqual(resUnauth.status, 401, "Unauthenticated must return 401");

      const reqMember = reqWithAuth("http://localhost:3001/api/cost/marketing", memberSessionToken);
      const resMember = await marketingGET(reqMember);
      assert.strictEqual(resMember.status, 403, "MEMBER must return 403");
      const data = await resMember.json();
      assert.match(data.error, /restricted to administrators/i);
    });

    it("GET /api/cost/marketing allows ADMIN and OWNER with 200 OK", async () => {
      const reqAdmin = reqWithAuth("http://localhost:3001/api/cost/marketing", adminSessionToken);
      const resAdmin = await marketingGET(reqAdmin);
      assert.strictEqual(resAdmin.status, 200, "ADMIN must receive 200");

      const reqOwner = reqWithAuth("http://localhost:3001/api/cost/marketing", ownerSessionToken);
      const resOwner = await marketingGET(reqOwner);
      assert.strictEqual(resOwner.status, 200, "OWNER must receive 200");
    });

    it("GET /api/cost/ai rejects unauthenticated with 401 and MEMBER with 403", async () => {
      const reqUnauth = reqWithAuth("http://localhost:3001/api/cost/ai");
      const resUnauth = await aiGET(reqUnauth);
      assert.strictEqual(resUnauth.status, 401, "Unauthenticated must return 401");

      const reqMember = reqWithAuth("http://localhost:3001/api/cost/ai", memberSessionToken);
      const resMember = await aiGET(reqMember);
      assert.strictEqual(resMember.status, 403, "MEMBER must return 403");
      const data = await resMember.json();
      assert.match(data.error, /restricted to administrators/i);
    });

    it("GET /api/cost/ai allows ADMIN and OWNER with 200 OK", async () => {
      const reqAdmin = reqWithAuth("http://localhost:3001/api/cost/ai", adminSessionToken);
      const resAdmin = await aiGET(reqAdmin);
      assert.strictEqual(resAdmin.status, 200, "ADMIN must receive 200");

      const reqOwner = reqWithAuth("http://localhost:3001/api/cost/ai", ownerSessionToken);
      const resOwner = await aiGET(reqOwner);
      assert.strictEqual(resOwner.status, 200, "OWNER must receive 200");
    });
  });

  describe("2. Email Synchronization Authorization & Folder Validation (RISK-SEC-05)", () => {
    it("POST /api/email/sync rejects unauthenticated with 401 and MEMBER with 403", async () => {
      const reqUnauth = reqWithAuth("http://localhost:3001/api/email/sync", undefined, "POST", { folderPath: "INBOX" });
      const resUnauth = await emailSyncPOST(reqUnauth);
      assert.strictEqual(resUnauth.status, 401, "Unauthenticated must return 401");

      const reqMember = reqWithAuth("http://localhost:3001/api/email/sync", memberSessionToken, "POST", { folderPath: "INBOX" });
      const resMember = await emailSyncPOST(reqMember);
      assert.strictEqual(resMember.status, 403, "MEMBER must return 403");
      const data = await resMember.json();
      assert.match(data.error, /restricted to administrators/i);
    });

    it("POST /api/email/sync rejects path traversal sequences and illegal characters with 400 Bad Request", async () => {
      const maliciousPaths = [
        "../../etc/passwd",
        "INBOX/../SECRET",
        "..\\..\\windows\\system32",
        "folder/subfolder/traversal",
        "INBOX\x00NULLBYTE",
        "Folder\x1fControl",
      ];

      for (const badPath of maliciousPaths) {
        const req = reqWithAuth("http://localhost:3001/api/email/sync", adminSessionToken, "POST", { folderPath: badPath });
        const res = await emailSyncPOST(req);
        assert.strictEqual(res.status, 400, `Bad path "${badPath}" must be rejected with HTTP 400`);
        const data = await res.json();
        assert.match(data.error, /illegal or path-traversal/i);
      }
    });

    it("POST /api/email/sync rejects non-existent unknown non-INBOX folder with 400 Bad Request", async () => {
      const req = reqWithAuth("http://localhost:3001/api/email/sync", adminSessionToken, "POST", { folderPath: "UNKNOWN_GHOST_FOLDER" });
      const res = await emailSyncPOST(req);
      assert.strictEqual(res.status, 400, "Non-existent folder must return 400");
      const data = await res.json();
      assert.match(data.error, /does not exist in configured mailbox/i);
    });

    it("POST /api/email/sync accepts valid configured folder path (INBOX) for ADMIN", async () => {
      const req = reqWithAuth("http://localhost:3001/api/email/sync", adminSessionToken, "POST", { folderPath: "INBOX" });
      const res = await emailSyncPOST(req);
      // Returns 200 with result (e.g. unconfigured credentials message or sync result, not 400/403)
      assert.strictEqual(res.status, 200, "Valid folder sync request must return 200");
    });

    it("POST /api/email/sync defaults to configured INBOX when folderPath is omitted", async () => {
      const req = reqWithAuth("http://localhost:3001/api/email/sync", adminSessionToken, "POST", {});
      const res = await emailSyncPOST(req);
      assert.strictEqual(res.status, 200, "Missing folder path with configured INBOX must default and succeed with 200");
    });

    it("POST /api/email/sync rejects omitted folderPath when INBOX is not configured in mailbox with 400", async () => {
      const originalGetOrCreateAccount = EmailService.getOrCreateAccount;
      try {
        (EmailService as any).getOrCreateAccount = async () => ({
          id: "mock-account-no-inbox",
          folders: [
            { id: "f-sent", name: "Sent", rawPath: "Sent", type: "SENT" },
          ],
        });

        const req = reqWithAuth("http://localhost:3001/api/email/sync", adminSessionToken, "POST", {});
        const res = await emailSyncPOST(req);
        assert.strictEqual(res.status, 400, "Missing folder path without configured INBOX must return 400");
        const data = await res.json();
        assert.match(data.error, /No INBOX folder configured in mailbox/i);
      } finally {
        (EmailService as any).getOrCreateAccount = originalGetOrCreateAccount;
      }
    });

    it("POST /api/email/sync rejects explicit unknown INBOX when INBOX is not configured in mailbox with 400", async () => {
      const originalGetOrCreateAccount = EmailService.getOrCreateAccount;
      try {
        (EmailService as any).getOrCreateAccount = async () => ({
          id: "mock-account-no-inbox",
          folders: [
            { id: "f-sent", name: "Sent", rawPath: "Sent", type: "SENT" },
          ],
        });

        const req = reqWithAuth("http://localhost:3001/api/email/sync", adminSessionToken, "POST", { folderPath: "INBOX" });
        const res = await emailSyncPOST(req);
        assert.strictEqual(res.status, 400, "Explicit unknown INBOX must be rejected with 400 when not in configured folders");
        const data = await res.json();
        assert.match(data.error, /Folder 'INBOX' does not exist in configured mailbox folders/i);
      } finally {
        (EmailService as any).getOrCreateAccount = originalGetOrCreateAccount;
      }
    });

    it("GET /api/email/sync rejects unauthenticated with 401 and MEMBER with 403", async () => {
      const reqUnauth = reqWithAuth("http://localhost:3001/api/email/sync");
      const resUnauth = await emailSyncGET(reqUnauth);
      assert.strictEqual(resUnauth.status, 401, "Unauthenticated probe must return 401");

      const reqMember = reqWithAuth("http://localhost:3001/api/email/sync", memberSessionToken);
      const resMember = await emailSyncGET(reqMember);
      assert.strictEqual(resMember.status, 403, "MEMBER probe must return 403");
      const data = await resMember.json();
      assert.match(data.error, /restricted to administrators/i);
    });

    it("GET /api/email/sync allows ADMIN to probe mailbox connection status", async () => {
      const req = reqWithAuth("http://localhost:3001/api/email/sync", adminSessionToken);
      const res = await emailSyncGET(req);
      assert.strictEqual(res.status, 200, "ADMIN probe must return 200");
      const data = await res.json();
      assert.strictEqual(typeof data.imap?.ok, "boolean");
      assert.strictEqual(typeof data.smtp?.ok, "boolean");
    });
  });

  describe("3. Remote Email Images and Privacy Protection (RISK-SEC-04)", () => {
    it("detects presence of remote images accurately", () => {
      assert.strictEqual(hasRemoteImages('<p>Hello</p><img src="https://tracking.com/beacon.gif">'), true);
      assert.strictEqual(hasRemoteImages('<p>Hello</p><img src="http://evil.com/img.png">'), true);
      assert.strictEqual(hasRemoteImages('<p>Hello</p><img src="//cdn.example.com/logo.jpg">'), true);
      assert.strictEqual(hasRemoteImages('<p>Hello</p><img data-blocked-src="https://blocked.com/a.png">'), true);
      assert.strictEqual(hasRemoteImages('<p>Hello</p><img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUg">'), false);
      assert.strictEqual(hasRemoteImages('<p>Hello</p><img src="cid:inline-attachment-1">'), false);
      assert.strictEqual(hasRemoteImages('<p>No images at all</p>'), false);
    });

    it("blocks remote images by default and preserves blocked URL in data-blocked-src", () => {
      const html = '<div><p>Email content</p><img src="https://tracker.company.com/beacon.png" alt="Company Logo"></div>';
      const sanitized = sanitizeEmailHtml(html, { allowRemoteImages: false });

      assert.doesNotMatch(sanitized, /\ssrc="https:\/\/tracker\.company\.com/i, "Remote image src must be removed from src attribute");
      assert.match(sanitized, /\ssrc="data:image\/svg\+xml/i, "Remote image must be replaced with safe SVG placeholder");
      assert.match(sanitized, /data-blocked-src="https:\/\/tracker\.company\.com\/beacon\.png"/i, "Original URL must be saved in data-blocked-src");
      assert.match(sanitized, /\[Remote image blocked\]/, "Alt text must indicate image is blocked");
    });

    it("allows remote images when explicitly permitted (user consent)", () => {
      const html = '<div><p>Email content</p><img src="https://tracker.company.com/beacon.png" alt="Company Logo"></div>';
      const sanitized = sanitizeEmailHtml(html, { allowRemoteImages: true });

      assert.match(sanitized, /src="https:\/\/tracker\.company\.com\/beacon\.png"/i, "Remote image src must be preserved when allowRemoteImages is true");
      assert.doesNotMatch(sanitized, /data-blocked-src/i, "data-blocked-src should not be added when remote images allowed");
    });

    it("preserves safe inline data URIs and CID embedded images in both modes", () => {
      const dataUriHtml = '<img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=" alt="Dot">';
      const cidHtml = '<img src="cid:inline_logo_42" alt="Inline Logo">';

      const dataDefault = sanitizeEmailHtml(dataUriHtml, { allowRemoteImages: false });
      assert.match(dataDefault, /src="data:image\/png;base64,/i, "Inline data URI must be preserved even when remote images blocked");

      const cidDefault = sanitizeEmailHtml(cidHtml, { allowRemoteImages: false });
      assert.match(cidDefault, /src="cid:inline_logo_42"/i, "CID reference must be preserved even when remote images blocked");
    });
  });

  describe("4. Report Export Architecture & Audit Logging (BLK-ARCH-03)", () => {
    it("POST /api/cost/reports/export provides authenticated mutation with audit log", async () => {
      const initialLogsCount = await db.costAuditLog.count({
        where: { action: "EXPORT", userId: adminUser.id },
      });

      const req = reqWithAuth("http://localhost:3001/api/cost/reports/export", adminSessionToken, "POST", {
        type: "expenses",
        format: "csv",
      });
      const res = await exportPOST(req);

      assert.strictEqual(res.status, 200, "POST export must return 200");
      assert.match(res.headers.get("content-type") || "", /text\/csv/, "Content-Type must be CSV");
      assert.match(res.headers.get("content-disposition") || "", /attachment; filename="cyraops_expenses_/, "Content-Disposition must be attachment");

      // Verify audit log record was written
      const updatedLogsCount = await db.costAuditLog.count({
        where: { action: "EXPORT", userId: adminUser.id },
      });
      assert.strictEqual(updatedLogsCount, initialLogsCount + 1, "POST export must create exactly one CostAuditLog record");
    });

    it("POST /api/cost/reports/export rejects MEMBER with 403 and unauthenticated with 401", async () => {
      const reqUnauth = reqWithAuth("http://localhost:3001/api/cost/reports/export", undefined, "POST", { type: "expenses" });
      const resUnauth = await exportPOST(reqUnauth);
      assert.strictEqual(resUnauth.status, 401, "Unauthenticated POST export must return 401");

      const reqMember = reqWithAuth("http://localhost:3001/api/cost/reports/export", memberSessionToken, "POST", { type: "expenses" });
      const resMember = await exportPOST(reqMember);
      assert.strictEqual(resMember.status, 403, "MEMBER POST export must return 403");
    });

    it("GET /api/cost/reports/export preserves download compatibility with ZERO database writes", async () => {
      const initialLogsCount = await db.costAuditLog.count({
        where: { action: "EXPORT", userId: adminUser.id },
      });

      const req = reqWithAuth("http://localhost:3001/api/cost/reports/export?type=expenses&format=csv", adminSessionToken, "GET");
      const res = await exportGET(req);

      assert.strictEqual(res.status, 200, "GET export must return 200");
      assert.match(res.headers.get("content-type") || "", /text\/csv/, "Content-Type must be text/csv");
      assert.match(res.headers.get("content-disposition") || "", /attachment; filename="cyraops_expenses_/, "Content-Disposition must be attachment");

      // Verify that GET performed ZERO database audit writes (strictly read-only)
      const afterLogsCount = await db.costAuditLog.count({
        where: { action: "EXPORT", userId: adminUser.id },
      });
      assert.strictEqual(afterLogsCount, initialLogsCount, "GET export must perform ZERO database writes (idempotent read-only)");
    });

    it("GET /api/cost/reports/export rejects MEMBER with 403 and unauthenticated with 401", async () => {
      const reqUnauth = reqWithAuth("http://localhost:3001/api/cost/reports/export?type=expenses");
      const resUnauth = await exportGET(reqUnauth);
      assert.strictEqual(resUnauth.status, 401, "Unauthenticated GET export must return 401");

      const reqMember = reqWithAuth("http://localhost:3001/api/cost/reports/export?type=expenses", memberSessionToken);
      const resMember = await exportGET(reqMember);
      assert.strictEqual(resMember.status, 403, "MEMBER GET export must return 403");
    });
  });
});
