/**
 * CYRAOPS PHASE 0 — IDENTITY AND ACCESS CONTROL VERIFICATION SUITE
 * Tests TEST-01 through TEST-10
 *
 * Absolute Safety Rule:
 * Runs strictly against localhost:3001 and company_os_dev.
 * Never touches localhost:3000 or company_os.
 */

import { db } from "../src/lib/db";
import { compare, hash } from "bcryptjs";
import { createSession, newToken, sha256 } from "../src/lib/auth";

const BASE_URL = "http://localhost:3001";

async function runTests() {
  console.log("=== STARTING PHASE 0 IDENTITY & IMMUTABILITY VERIFICATION SUITE ===\n");
  let passedCount = 0;
  let failedCount = 0;

  function pass(testId: string, description: string, detail?: string) {
    passedCount++;
    console.log(`✅ PASS [${testId}]: ${description}${detail ? ` (${detail})` : ""}`);
  }

  function fail(testId: string, description: string, error: any) {
    failedCount++;
    console.error(`❌ FAIL [${testId}]: ${description}`, error);
  }

  // Pre-flight check: Verify we are on dev DB
  const dbUrl = process.env.DATABASE_URL || "";
  if (!dbUrl.includes("company_os_dev")) {
    throw new Error(`CRITICAL ABORT: DATABASE_URL does not point to company_os_dev: ${dbUrl}`);
  }

  // Central apiFetch with proper Origin & Host headers
  async function apiFetch(path: string, options: RequestInit = {}) {
    const headers: Record<string, string> = {
      Origin: BASE_URL,
      Host: "localhost:3001",
      ...(options.headers as Record<string, string> || {}),
    };
    return fetch(`${BASE_URL}${path}`, {
      ...options,
      headers,
    });
  }

  // Setup test users in company_os_dev
  const testOwner = await db.user.findFirst({ where: { role: "OWNER" } });
  if (!testOwner || !testOwner.email) {
    throw new Error("Pre-flight failed: Owner user with email not found in company_os_dev");
  }

  // Ensure clean state before tests
  const testMemberEmail = "test.suite.member@cyraops.com";
  const testMemberPassword = "MemberPassword123!";
  const testMemberPasswordHash = await hash(testMemberPassword, 12);

  await db.user.deleteMany({
    where: { email: { in: [testMemberEmail, "tamper.test@cyraops.com", "concurrent.test@cyraops.com", "rogue@cyraops.com"] } },
  });

  const testMember = await db.user.create({
    data: {
      name: "Test Suite Member",
      email: testMemberEmail,
      role: "MEMBER",
      passwordHash: testMemberPasswordHash,
      mustChangePassword: false,
    },
  });

  // Helper to create session cookie
  async function makeSessionCookie(userId: string, expiresAt?: Date) {
    const rawToken = newToken();
    const tokenHash = sha256(rawToken);
    const exp = expiresAt ?? new Date(Date.now() + 24 * 60 * 60 * 1000);
    await db.session.create({
      data: {
        tokenHash,
        userId,
        expiresAt: exp,
      },
    });
    return `company_session=${rawToken}`;
  }

  // --------------------------------------------------------------------------
  // TEST-01: Client payload identity tampering blocked
  // --------------------------------------------------------------------------
  try {
    const memberCookie = await makeSessionCookie(testMember.id);

    // Attempt to create a task claiming the owner is the creator
    const taskRes = await apiFetch("/api/tasks", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: memberCookie,
      },
      body: JSON.stringify({
        title: "Tamper Probe Task",
        creatorId: testOwner.id, // Tampered identity in payload
        assigneeId: testOwner.id,
      }),
    });

    const taskData = await taskRes.json().catch(() => ({}));
    if (taskRes.ok && taskData.task) {
      if (taskData.task.creatorId === testMember.id) {
        pass("TEST-01", "Client payload identity tampering blocked", "creatorId bound to authenticated session identity");
      } else {
        throw new Error(`Tampered creatorId was accepted! Expected ${testMember.id}, got ${taskData.task.creatorId}`);
      }
      await db.task.delete({ where: { id: taskData.task.id } }).catch(() => {});
    } else {
      pass("TEST-01", "Client payload identity tampering blocked", "Server enforces session identity");
    }
  } catch (err: any) {
    fail("TEST-01", "Client payload identity tampering test failed", err.message);
  }

  // --------------------------------------------------------------------------
  // TEST-02: Member cannot escalate role to ADMIN or OWNER
  // --------------------------------------------------------------------------
  try {
    const memberCookie = await makeSessionCookie(testMember.id);

    // Attempt 1: Member tries to update own role to OWNER/ADMIN via PATCH /api/team/[id]
    const patchRes = await apiFetch(`/api/team/${testMember.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: memberCookie },
      body: JSON.stringify({ role: "ADMIN" }),
    });

    // Attempt 2: Member tries to create an ADMIN via POST /api/team
    const postRes = await apiFetch("/api/team", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: memberCookie },
      body: JSON.stringify({ name: "Rogue Admin", email: "rogue@cyraops.com", role: "ADMIN" }),
    });

    if (patchRes.status === 403 && postRes.status === 403) {
      pass("TEST-02", "Member cannot escalate role to ADMIN or OWNER", "PATCH returned 403, POST returned 403");
    } else {
      throw new Error(`Expected 403 for both, got PATCH: ${patchRes.status}, POST: ${postRes.status}`);
    }
  } catch (err: any) {
    fail("TEST-02", "Privilege escalation test failed", err.message);
  }

  // --------------------------------------------------------------------------
  // TEST-03: Session identity reassignment blocked by DB trigger
  // --------------------------------------------------------------------------
  try {
    const testSessionToken = newToken();
    const testSession = await db.session.create({
      data: {
        tokenHash: sha256(testSessionToken),
        userId: testMember.id,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });

    let triggerBlocked = false;
    try {
      // Attempt to mutate userId directly via raw SQL
      await db.$executeRawUnsafe(
        `UPDATE "Session" SET "userId" = '${testOwner.id}' WHERE id = '${testSession.id}';`
      );
    } catch (dbErr: any) {
      if (dbErr.message.includes("SECURITY VIOLATION") || dbErr.message.includes("Session userId is immutable")) {
        triggerBlocked = true;
      } else {
        throw dbErr;
      }
    }

    // Cleanup test session
    await db.session.delete({ where: { id: testSession.id } }).catch(() => {});

    if (triggerBlocked) {
      pass("TEST-03", "Session identity reassignment strictly blocked by PostgreSQL trigger", "SECURITY VIOLATION exception raised");
    } else {
      throw new Error("Trigger did NOT raise exception when updating Session.userId!");
    }
  } catch (err: any) {
    fail("TEST-03", "PostgreSQL Session immutability trigger test failed", err.message);
  }

  // --------------------------------------------------------------------------
  // TEST-04: Disabled account cannot authenticate
  // --------------------------------------------------------------------------
  try {
    // Disable the test member
    await db.user.update({
      where: { id: testMember.id },
      data: { disabledAt: new Date() },
    });

    // Attempt login
    const loginRes = await apiFetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: testMemberEmail,
        password: testMemberPassword,
      }),
    });

    if (loginRes.status === 401) {
      pass("TEST-04", "Disabled account cannot authenticate", "Login returned 401 Unauthorized");
    } else {
      throw new Error(`Expected 401 Unauthorized, got HTTP ${loginRes.status}`);
    }
  } catch (err: any) {
    fail("TEST-04", "Disabled account authentication test failed", err.message);
  } finally {
    // Restore member
    await db.user.update({
      where: { id: testMember.id },
      data: { disabledAt: null },
    });
  }

  // --------------------------------------------------------------------------
  // TEST-05: Existing sessions invalidated upon account disable
  // --------------------------------------------------------------------------
  try {
    // Ensure member is active
    await db.user.update({
      where: { id: testMember.id },
      data: { disabledAt: null },
    });

    // Create an active session
    const activeMemberCookie = await makeSessionCookie(testMember.id);

    // Verify session currently works
    const verifyBefore = await apiFetch("/api/auth/me", {
      headers: { Cookie: activeMemberCookie },
    });
    if (verifyBefore.status !== 200) {
      const errB = await verifyBefore.json().catch(() => ({}));
      throw new Error(`Pre-disable session check failed: status ${verifyBefore.status} ${JSON.stringify(errB)}`);
    }

    // Owner disables the member via PATCH /api/team/[id]
    const ownerCookie = await makeSessionCookie(testOwner.id);
    const disableRes = await apiFetch(`/api/team/${testMember.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: ownerCookie },
      body: JSON.stringify({ disabled: true }),
    });

    if (!disableRes.ok) {
      throw new Error(`Failed to disable member via API: status ${disableRes.status}`);
    }

    // Now test if activeMemberCookie is rejected
    const verifyAfter = await apiFetch("/api/auth/me", {
      headers: { Cookie: activeMemberCookie },
    });

    if (verifyAfter.status === 401) {
      pass("TEST-05", "Existing sessions invalidated upon account disable", "Active session returned 401 immediately after disable");
    } else {
      throw new Error(`Expected 401 after disable, got ${verifyAfter.status}`);
    }
  } catch (err: any) {
    fail("TEST-05", "Session invalidation on account disable test failed", err.message);
  } finally {
    // Re-enable member
    await db.user.update({
      where: { id: testMember.id },
      data: { disabledAt: null },
    });
  }

  // --------------------------------------------------------------------------
  // TEST-06: Expired session rejected
  // --------------------------------------------------------------------------
  try {
    const expiredCookie = await makeSessionCookie(testMember.id, new Date(Date.now() - 1000 * 60)); // 1 minute ago

    const expRes = await apiFetch("/api/auth/me", {
      headers: { Cookie: expiredCookie },
    });

    if (expRes.status === 401) {
      pass("TEST-06", "Expired session rejected", "Returned 401 Unauthorized");
    } else {
      throw new Error(`Expected 401 for expired session, got HTTP ${expRes.status}`);
    }
  } catch (err: any) {
    fail("TEST-06", "Expired session test failed", err.message);
  }

  // --------------------------------------------------------------------------
  // TEST-07: Setup token cannot be reused
  // --------------------------------------------------------------------------
  try {
    const rawToken = newToken();
    const tokenHash = sha256(rawToken);

    await db.passwordSetupToken.create({
      data: {
        tokenHash,
        userId: testMember.id,
        expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
      },
    });

    // Redemption 1: Must succeed
    const redeemRes1 = await apiFetch("/api/auth/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: rawToken,
        password: "FirstRedeemPass123!",
      }),
    });

    if (!redeemRes1.ok) {
      const errData = await redeemRes1.json().catch(() => ({}));
      throw new Error(`Redemption 1 failed: ${errData.error || redeemRes1.status}`);
    }

    // Redemption 2: Must fail (token already used)
    const redeemRes2 = await apiFetch("/api/auth/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: rawToken,
        password: "SecondRedeemPass123!",
      }),
    });

    if (redeemRes2.status === 400 || redeemRes2.status === 409) {
      pass("TEST-07", "Setup token cannot be reused", `First redemption 200, second redemption ${redeemRes2.status}`);
    } else {
      throw new Error(`Expected 400 or 409 for reused token, got HTTP ${redeemRes2.status}`);
    }
  } catch (err: any) {
    fail("TEST-07", "Setup token single-use test failed", err.message);
  }

  // --------------------------------------------------------------------------
  // TEST-08: Expired setup token rejected
  // --------------------------------------------------------------------------
  try {
    const rawExpiredToken = newToken();
    const expiredTokenHash = sha256(rawExpiredToken);

    await db.passwordSetupToken.create({
      data: {
        tokenHash: expiredTokenHash,
        userId: testMember.id,
        expiresAt: new Date(Date.now() - 1000 * 60 * 60), // 1 hour ago
      },
    });

    const getRes = await apiFetch(`/api/auth/setup?token=${rawExpiredToken}`);
    const postRes = await apiFetch("/api/auth/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: rawExpiredToken,
        password: "ExpiredTokenPass123!",
      }),
    });

    if (getRes.status === 400 && postRes.status === 400) {
      pass("TEST-08", "Expired setup token rejected", "Both verification and redemption returned 400 Bad Request");
    } else {
      throw new Error(`Expected 400, got GET: ${getRes.status}, POST: ${postRes.status}`);
    }
  } catch (err: any) {
    fail("TEST-08", "Expired setup token test failed", err.message);
  }

  // --------------------------------------------------------------------------
  // TEST-09: Duplicate email registration handled safely
  // --------------------------------------------------------------------------
  try {
    const ownerCookie = await makeSessionCookie(testOwner.id);

    // Attempt to register a user with testOwner's exact email
    const dupRes1 = await apiFetch("/api/team", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: ownerCookie },
      body: JSON.stringify({
        name: "Duplicate User 1",
        email: testOwner.email,
        role: "MEMBER",
      }),
    });

    // Attempt to register a user with testOwner's email in uppercase
    const dupRes2 = await apiFetch("/api/team", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: ownerCookie },
      body: JSON.stringify({
        name: "Duplicate User 2",
        email: testOwner.email.toUpperCase(),
        role: "MEMBER",
      }),
    });

    if (dupRes1.status === 409 && dupRes2.status === 409) {
      pass("TEST-09", "Duplicate email registration handled safely", "Both duplicate attempts returned 409 Conflict");
    } else {
      throw new Error(`Expected 409 for duplicate emails, got attempt 1: ${dupRes1.status}, attempt 2: ${dupRes2.status}`);
    }
  } catch (err: any) {
    fail("TEST-09", "Duplicate email collision test failed", err.message);
  }

  // --------------------------------------------------------------------------
  // TEST-10: Concurrent login and account disable serializes safely
  // --------------------------------------------------------------------------
  try {
    const concurrentEmail = "concurrent.test@cyraops.com";
    const concurrentPassword = "ConcurrentTestPass123!";
    const concurrentUser = await db.user.create({
      data: {
        name: "Concurrent Test User",
        email: concurrentEmail,
        role: "MEMBER",
        passwordHash: await hash(concurrentPassword, 12),
        mustChangePassword: false,
      },
    });

    const ownerCookie = await makeSessionCookie(testOwner.id);

    // Race login and disable simultaneously
    const [loginResult, disableResult] = await Promise.all([
      apiFetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: concurrentEmail,
          password: concurrentPassword,
        }),
      }),
      apiFetch(`/api/team/${concurrentUser.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Cookie: ownerCookie },
        body: JSON.stringify({ disabled: true }),
      }),
    ]);

    // Check final state in DB and session viability
    const freshUser = await db.user.findUnique({ where: { id: concurrentUser.id } });
    const userIsDisabled = Boolean(freshUser?.disabledAt);

    // If login returned a cookie before disable, that session must now be rejected
    const setCookieHeader = loginResult.headers.get("set-cookie");
    let sessionRejected = true;
    if (setCookieHeader && setCookieHeader.includes("company_session=")) {
      const tokenMatch = setCookieHeader.match(/company_session=([^;]+)/);
      if (tokenMatch) {
        const testCookie = `company_session=${tokenMatch[1]}`;
        const checkRes = await apiFetch("/api/auth/me", {
          headers: { Cookie: testCookie },
        });
        sessionRejected = (checkRes.status === 401);
      }
    }

    if (userIsDisabled && sessionRejected) {
      pass("TEST-10", "Concurrent login and account disable serializes safely", "User is disabled and has zero viable sessions");
    } else {
      throw new Error(`Concurrent race state invalid: userIsDisabled=${userIsDisabled}, sessionRejected=${sessionRejected}`);
    }

    await db.user.delete({ where: { id: concurrentUser.id } }).catch(() => {});
  } catch (err: any) {
    fail("TEST-10", "Concurrent login/disable serialization test failed", err.message);
  }

  // Cleanup test member
  await db.user.delete({ where: { id: testMember.id } }).catch(() => {});

  console.log(`\n=== TEST SUITE COMPLETE: ${passedCount}/10 PASSED, ${failedCount} FAILED ===\n`);
  if (failedCount > 0) {
    process.exit(1);
  }
}

runTests()
  .catch((err) => {
    console.error("FATAL ERROR in test execution:", err);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
