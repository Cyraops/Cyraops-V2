import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { validateAppUrl, buildSetupUrl, isPrivateOrLocalHost } from "./urls";
import { db } from "./db";
import { POST as teamPost } from "../app/api/team/route";
import { POST as invitePost } from "../app/api/team/[id]/invite/route";

describe("Canonical Application URL Helper (urls.ts) — Production & Development Rules", () => {
  // 1. Production accepts a valid HTTPS URL
  it("1. Production accepts a valid HTTPS URL", () => {
    const prodHttps = validateAppUrl("https://crm.cyraops.com", true);
    assert.equal(prodHttps.isValid, true);
    assert.equal(prodHttps.baseUrl, "https://crm.cyraops.com");
    assert.equal(prodHttps.error, undefined);

    const setupUrl = buildSetupUrl("token-xyz", "https://crm.cyraops.com", true);
    assert.equal(setupUrl, "https://crm.cyraops.com/setup?token=token-xyz");
  });

  // 2. Production rejects http://localhost:3001
  it("2. Production rejects http://localhost:3001", () => {
    const result = validateAppUrl("http://localhost:3001", true);
    assert.equal(result.isValid, false);
    assert.match(result.error ?? "", /Production requires a valid absolute HTTPS APP_URL/);

    const setupUrl = buildSetupUrl("token-xyz", "http://localhost:3001", true);
    assert.equal(setupUrl, null);
  });

  // 3. Production rejects http://127.0.0.1
  it("3. Production rejects http://127.0.0.1 loopback addresses", () => {
    const result = validateAppUrl("http://127.0.0.1:3001", true);
    assert.equal(result.isValid, false);
    assert.match(result.error ?? "", /Production requires a valid absolute HTTPS APP_URL/);

    const setupUrl = buildSetupUrl("token-xyz", "http://127.0.0.1:3001", true);
    assert.equal(setupUrl, null);
  });

  // 4. Production rejects private IPv4 HTTP addresses
  it("4. Production rejects private IPv4 HTTP addresses (10.x, 172.16-31.x, 192.168.x)", () => {
    for (const ip of ["10.0.0.1:8080", "172.20.1.1:3001", "192.168.1.50:3001"]) {
      const result = validateAppUrl(`http://${ip}`, true);
      assert.equal(result.isValid, false, `Expected http://${ip} to be rejected in production`);
      assert.match(result.error ?? "", /Production requires a valid absolute HTTPS APP_URL/);
      assert.equal(buildSetupUrl("token-xyz", `http://${ip}`, true), null);
    }
  });

  // 5. Production rejects link-local HTTP addresses
  it("5. Production rejects link-local HTTP addresses (169.254.x.x)", () => {
    const result = validateAppUrl("http://169.254.1.1:3001", true);
    assert.equal(result.isValid, false);
    assert.match(result.error ?? "", /Production requires a valid absolute HTTPS APP_URL/);
    assert.equal(buildSetupUrl("token-xyz", "http://169.254.1.1:3001", true), null);
  });

  // 6. Production rejects .local HTTP addresses
  it("6. Production rejects .local HTTP addresses", () => {
    const result = validateAppUrl("http://laptop.local:3001", true);
    assert.equal(result.isValid, false);
    assert.match(result.error ?? "", /Production requires a valid absolute HTTPS APP_URL/);
    assert.equal(buildSetupUrl("token-xyz", "http://laptop.local:3001", true), null);
  });

  // Also verify that private/local addresses over HTTPS in production are rejected
  it("Production rejects localhost/private addresses even over HTTPS", () => {
    const resultLocalhost = validateAppUrl("https://localhost:3001", true);
    assert.equal(resultLocalhost.isValid, false);
    assert.match(resultLocalhost.error ?? "", /cannot be localhost, loopback, private LAN/);

    const resultPrivateIp = validateAppUrl("https://192.168.1.1", true);
    assert.equal(resultPrivateIp.isValid, false);
    assert.match(resultPrivateIp.error ?? "", /cannot be localhost, loopback, private LAN/);
  });

  // 7. Production rejects missing APP_URL
  it("7. Production rejects missing APP_URL", () => {
    const emptyResult = validateAppUrl("", true);
    assert.equal(emptyResult.isValid, false);
    assert.match(emptyResult.error ?? "", /APP_URL is required in production/);
    assert.equal(buildSetupUrl("token-xyz", "", true), null);

    const nullResult = validateAppUrl(null, true);
    assert.equal(nullResult.isValid, false);
    assert.match(nullResult.error ?? "", /APP_URL is required in production/);
    assert.equal(buildSetupUrl("token-xyz", null, true), null);
  });

  // 8. Production rejects malformed and unsupported URLs
  it("8. Production rejects malformed and unsupported URLs", () => {
    const malformed = validateAppUrl("not-a-valid-url", true);
    assert.equal(malformed.isValid, false);
    assert.equal(malformed.error, "Invalid URL format");
    assert.equal(buildSetupUrl("token-xyz", "not-a-valid-url", true), null);

    const ftp = validateAppUrl("ftp://crm.company.com", true);
    assert.equal(ftp.isValid, false);
    assert.equal(buildSetupUrl("token-xyz", "ftp://crm.company.com", true), null);

    const creds = validateAppUrl("https://user:pass@crm.company.com", true);
    assert.equal(creds.isValid, false);
    assert.match(creds.error ?? "", /URLs with embedded credentials are not allowed/);
    assert.equal(buildSetupUrl("token-xyz", "https://user:pass@crm.company.com", true), null);
  });

  // 9. Development still accepts permitted local/LAN HTTP URLs
  it("9. Development still accepts permitted local/LAN HTTP URLs", () => {
    // localhost
    const localhost = validateAppUrl("http://localhost:3001", false);
    assert.equal(localhost.isValid, true);
    assert.equal(localhost.baseUrl, "http://localhost:3001");
    assert.equal(buildSetupUrl("token-xyz", "http://localhost:3001", false), "http://localhost:3001/setup?token=token-xyz");

    // 127.0.0.1
    const loopback = validateAppUrl("http://127.0.0.1:3001", false);
    assert.equal(loopback.isValid, true);
    assert.equal(loopback.baseUrl, "http://127.0.0.1:3001");

    // 192.168.x.x
    const lan192 = validateAppUrl("http://192.168.1.100:3001", false);
    assert.equal(lan192.isValid, true);
    assert.equal(lan192.baseUrl, "http://192.168.1.100:3001");

    // 10.x.x.x
    const lan10 = validateAppUrl("http://10.0.4.15:8080", false);
    assert.equal(lan10.isValid, true);
    assert.equal(lan10.baseUrl, "http://10.0.4.15:8080");

    // 172.16-31.x.x
    const lan172 = validateAppUrl("http://172.20.10.5:3001", false);
    assert.equal(lan172.isValid, true);
    assert.equal(lan172.baseUrl, "http://172.20.10.5:3001");

    // .local mDNS
    const mDns = validateAppUrl("http://laptop.local:3001", false);
    assert.equal(mDns.isValid, true);
    assert.equal(mDns.baseUrl, "http://laptop.local:3001");
  });

  // 10. Development relative fallback still works under explicitly permitted configuration
  it("10. Development relative fallback still works when APP_URL is omitted", () => {
    const devMissing = validateAppUrl("", false);
    assert.equal(devMissing.isValid, true);
    assert.equal(devMissing.baseUrl, undefined);

    const fallbackUrl = buildSetupUrl("fallback-token", null, false);
    assert.equal(fallbackUrl, "/setup?token=fallback-token");

    const emptyFallbackUrl = buildSetupUrl("fallback-token", "", false);
    assert.equal(emptyFallbackUrl, "/setup?token=fallback-token");
  });

  it("normalizes trailing slashes on APP_URL in both dev and prod", () => {
    const prodSlash = validateAppUrl("https://crm.company.com///", true);
    assert.equal(prodSlash.isValid, true);
    assert.equal(prodSlash.baseUrl, "https://crm.company.com");

    const devSlash = validateAppUrl("http://localhost:3001///", false);
    assert.equal(devSlash.isValid, true);
    assert.equal(devSlash.baseUrl, "http://localhost:3001");
  });

  it("verifies isPrivateOrLocalHost helper accuracy", () => {
    assert.equal(isPrivateOrLocalHost("localhost"), true);
    assert.equal(isPrivateOrLocalHost("127.0.0.1"), true);
    assert.equal(isPrivateOrLocalHost("::1"), true);
    assert.equal(isPrivateOrLocalHost("[::1]"), true);
    assert.equal(isPrivateOrLocalHost("192.168.0.1"), true);
    assert.equal(isPrivateOrLocalHost("10.254.1.1"), true);
    assert.equal(isPrivateOrLocalHost("172.16.0.1"), true);
    assert.equal(isPrivateOrLocalHost("172.31.255.254"), true);
    assert.equal(isPrivateOrLocalHost("172.32.0.1"), false);
    assert.equal(isPrivateOrLocalHost("8.8.8.8"), false);
    assert.equal(isPrivateOrLocalHost("crm.company.com"), false);
  });

  // 11. An invalid production URL causes both invitation endpoints to return HTTP 500
  it("11. An invalid production URL causes both invitation endpoints to return HTTP 500", async () => {
    const origFindSession = (db as any).session.findUnique;
    const origFindUser = (db as any).user.findUnique;
    const origFindFirst = (db as any).user.findFirst;

    (db as any).session.findUnique = async () => ({
      id: "mock-session-id",
      expiresAt: new Date(Date.now() + 86400000),
      user: {
        id: "mock-owner-id",
        name: "Mock Owner",
        email: "owner@company.com",
        role: "OWNER",
        disabledAt: null,
        passwordHash: "hash",
      },
    });

    (db as any).user.findUnique = async (args: any) => {
      if (args?.where?.id === "test-member-target") {
        return {
          id: "test-member-target",
          name: "Target Teammate",
          email: "target@company.com",
          role: "MEMBER",
          disabledAt: null,
          passwordHash: null,
        };
      }
      return origFindUser.call(db.user, args);
    };

    (db as any).user.findFirst = async () => null;

    const origEnvNodeEnv = process.env.NODE_ENV;
    const origEnvAppUrl = process.env.APP_URL;

    try {
      // Test A: Production with invalid HTTP localhost URL
      (process.env as any).NODE_ENV = "production";
      process.env.APP_URL = "http://localhost:3001";

      const teamReq1 = new NextRequest("http://localhost:3001/api/team", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "sec-fetch-site": "same-origin",
          cookie: "company_session=mock-token",
        },
        body: JSON.stringify({ name: "Alice", email: "alice@test.com", role: "MEMBER" }),
      });
      const teamRes1 = await teamPost(teamReq1);
      assert.equal(teamRes1.status, 500);
      const teamBody1 = await teamRes1.json();
      assert.deepEqual(teamBody1, { error: "Server configuration error" });

      const inviteReq1 = new NextRequest("http://localhost:3001/api/team/test-member-target/invite", {
        method: "POST",
        headers: {
          "sec-fetch-site": "same-origin",
          cookie: "company_session=mock-token",
        },
      });
      const inviteRes1 = await invitePost(inviteReq1, { params: Promise.resolve({ id: "test-member-target" }) });
      assert.equal(inviteRes1.status, 500);
      const inviteBody1 = await inviteRes1.json();
      assert.deepEqual(inviteBody1, { error: "Server configuration error" });

      // Test B: Production with missing APP_URL
      process.env.APP_URL = "";

      const teamReq2 = new NextRequest("http://localhost:3001/api/team", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "sec-fetch-site": "same-origin",
          cookie: "company_session=mock-token",
        },
        body: JSON.stringify({ name: "Bob", email: "bob@test.com", role: "MEMBER" }),
      });
      const teamRes2 = await teamPost(teamReq2);
      assert.equal(teamRes2.status, 500);
      const teamBody2 = await teamRes2.json();
      assert.deepEqual(teamBody2, { error: "Server configuration error" });

      const inviteReq2 = new NextRequest("http://localhost:3001/api/team/test-member-target/invite", {
        method: "POST",
        headers: {
          "sec-fetch-site": "same-origin",
          cookie: "company_session=mock-token",
        },
      });
      const inviteRes2 = await invitePost(inviteReq2, { params: Promise.resolve({ id: "test-member-target" }) });
      assert.equal(inviteRes2.status, 500);
      const inviteBody2 = await inviteRes2.json();
      assert.deepEqual(inviteBody2, { error: "Server configuration error" });
    } finally {
      (process.env as any).NODE_ENV = origEnvNodeEnv;
      process.env.APP_URL = origEnvAppUrl;
      (db as any).session.findUnique = origFindSession;
      (db as any).user.findUnique = origFindUser;
      (db as any).user.findFirst = origFindFirst;
    }
  });

  // 12. Neither endpoint creates or invalidates invitation tokens when URL validation fails
  it("12. Neither endpoint creates or invalidates invitation tokens when URL validation fails", async () => {
    const origFindSession = (db as any).session.findUnique;
    const origFindUser = (db as any).user.findUnique;
    const origFindFirst = (db as any).user.findFirst;
    const origTx = (db as any).$transaction;

    let transactionCallCount = 0;
    (db as any).$transaction = async (...args: any[]) => {
      transactionCallCount++;
      return origTx.apply(db, args);
    };

    (db as any).session.findUnique = async () => ({
      id: "mock-session-id",
      expiresAt: new Date(Date.now() + 86400000),
      user: {
        id: "mock-owner-id",
        name: "Mock Owner",
        email: "owner@company.com",
        role: "OWNER",
        disabledAt: null,
        passwordHash: "hash",
      },
    });

    (db as any).user.findUnique = async (args: any) => {
      if (args?.where?.id === "test-member-target") {
        return {
          id: "test-member-target",
          name: "Target Teammate",
          email: "target@company.com",
          role: "MEMBER",
          disabledAt: null,
          passwordHash: null,
        };
      }
      return origFindUser.call(db.user, args);
    };

    (db as any).user.findFirst = async () => null;

    const origEnvNodeEnv = process.env.NODE_ENV;
    const origEnvAppUrl = process.env.APP_URL;

    try {
      (process.env as any).NODE_ENV = "production";
      process.env.APP_URL = "http://localhost:3001"; // Invalid HTTP URL in production

      // Attempt POST /api/team
      const teamReq = new NextRequest("http://localhost:3001/api/team", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "sec-fetch-site": "same-origin",
          cookie: "company_session=mock-token",
        },
        body: JSON.stringify({ name: "Charlie", email: "charlie@test.com", role: "MEMBER" }),
      });
      const teamRes = await teamPost(teamReq);
      assert.equal(teamRes.status, 500);

      // Attempt POST /api/team/[id]/invite
      const inviteReq = new NextRequest("http://localhost:3001/api/team/test-member-target/invite", {
        method: "POST",
        headers: {
          "sec-fetch-site": "same-origin",
          cookie: "company_session=mock-token",
        },
      });
      const inviteRes = await invitePost(inviteReq, { params: Promise.resolve({ id: "test-member-target" }) });
      assert.equal(inviteRes.status, 500);

      // Verify that db.$transaction was called exactly ZERO times
      assert.equal(transactionCallCount, 0, "db.$transaction must NOT be called when URL validation fails");
    } finally {
      (process.env as any).NODE_ENV = origEnvNodeEnv;
      process.env.APP_URL = origEnvAppUrl;
      (db as any).session.findUnique = origFindSession;
      (db as any).user.findUnique = origFindUser;
      (db as any).user.findFirst = origFindFirst;
      (db as any).$transaction = origTx;
    }
  });
});
