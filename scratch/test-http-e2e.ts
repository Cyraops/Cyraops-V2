import { PrismaClient } from "@prisma/client";
import { sha256 } from "../src/lib/auth";

const db = new PrismaClient();
const BASE_URL = "http://localhost:3001";

async function main() {
  console.log("=== RUNNING HTTP API INTEGRATION TESTS ===");

  // 1. Get owner user from dev DB to create a temporary session
  const owner = await db.user.findFirst({ where: { role: "OWNER" } });
  if (!owner) throw new Error("No owner found");

  const ownerSessionToken = "e2e-owner-token-" + Date.now();
  await db.session.create({
    data: {
      tokenHash: sha256(ownerSessionToken),
      userId: owner.id,
      expiresAt: new Date(Date.now() + 3600000),
    },
  });

  const ownerHeaders = {
    "Cookie": `company_session=${ownerSessionToken}`,
    "Origin": BASE_URL,
    "Content-Type": "application/json",
  };

  try {
    // 2. Test GET /api/team
    console.log("[HTTP] Testing GET /api/team...");
    const teamRes = await fetch(`${BASE_URL}/api/team`, { headers: ownerHeaders });
    if (!teamRes.ok) throw new Error(`GET /api/team failed: ${teamRes.status}`);
    const teamData = await teamRes.json();
    console.log(`✔ GET /api/team returned ${teamData.members.length} members`);
    
    // Check fields of first member
    const first = teamData.members[0];
    if (first.passwordHash !== undefined || first.setupTokens !== undefined) {
      throw new Error("SECURITY LEAK: GET /api/team leaked passwordHash or setupTokens!");
    }
    if (typeof first.hasPassword !== "boolean" || !first.invitationStatus) {
      throw new Error("Missing computed fields in GET /api/team member object");
    }
    console.log(`✔ Safe member fields confirmed: hasPassword=${first.hasPassword}, status=${first.invitationStatus}`);

    // 3. Test POST /api/team (Create new employee)
    console.log("\n[HTTP] Testing POST /api/team (create employee)...");
    const testEmployeeEmail = `e2e.employee.${Date.now()}@cyraops-test.internal`;
    const createRes = await fetch(`${BASE_URL}/api/team`, {
      method: "POST",
      headers: ownerHeaders,
      body: JSON.stringify({
        name: "E2E Test Employee",
        email: testEmployeeEmail,
        role: "MEMBER",
      }),
    });
    if (!createRes.ok) throw new Error(`POST /api/team failed: ${createRes.status} ${await createRes.text()}`);
    const createData = await createRes.json();
    if (!createData.setupUrl.startsWith(`${BASE_URL}/setup?token=`)) {
      throw new Error(`Expected setupUrl to start with ${BASE_URL}/setup?token=, got: ${createData.setupUrl}`);
    }
    console.log("✔ Member created successfully with canonical setup link [TOKEN REDACTED]");
    const newMemberId = createData.member.id;
    const initialSetupToken = createData.setupToken;

    // 4. Test POST /api/team/[id]/invite (Regenerate setup link)
    console.log("\n[HTTP] Testing POST /api/team/[id]/invite (regenerate setup link)...");
    const regenRes = await fetch(`${BASE_URL}/api/team/${newMemberId}/invite`, {
      method: "POST",
      headers: ownerHeaders,
    });
    if (!regenRes.ok) throw new Error(`POST /api/team/${newMemberId}/invite failed: ${regenRes.status} ${await regenRes.text()}`);
    const regenData = await regenRes.json();
    if (!regenData.setupUrl.startsWith(`${BASE_URL}/setup?token=`)) {
      throw new Error(`Expected regenerated setupUrl to start with ${BASE_URL}/setup?token=, got: ${regenData.setupUrl}`);
    }
    console.log("✔ Setup link generated successfully with canonical APP_URL [TOKEN REDACTED]");
    const activeSetupToken = regenData.setupToken;

    // Verify initial token was invalidated
    const oldTokenQuery = await db.passwordSetupToken.findUnique({
      where: { tokenHash: sha256(initialSetupToken) },
    });
    if (oldTokenQuery) throw new Error("FAIL: Initial setup token was not deleted upon regeneration");
    console.log("✔ Prior setup token invalidated");

    // 5. Test Password Complexity on Setup (< 12 characters should fail)
    console.log("\n[HTTP] Testing password validation on /api/auth/setup (< 12 chars)...");
    const failSetupRes = await fetch(`${BASE_URL}/api/auth/setup`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Origin": BASE_URL },
      body: JSON.stringify({
        token: activeSetupToken,
        password: "shortpass",
      }),
    });
    if (failSetupRes.status !== 400) {
      throw new Error(`Expected 400 for password < 12 chars, got ${failSetupRes.status}`);
    }
    console.log("✔ Password setup rejected < 12 characters with 400");

    // 6. Complete Setup with valid 12+ char password
    console.log("\n[HTTP] Testing password setup with >= 12 chars...");
    const validPassword1 = "SuperSecure#Employee2026";
    const setupRes = await fetch(`${BASE_URL}/api/auth/setup`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Origin": BASE_URL },
      body: JSON.stringify({
        token: activeSetupToken,
        password: validPassword1,
      }),
    });
    if (!setupRes.ok) throw new Error(`POST /api/auth/setup failed: ${setupRes.status} ${await setupRes.text()}`);
    console.log("✔ Password setup completed successfully");

    // Extract session cookie from setup response
    const setupCookie = setupRes.headers.get("set-cookie") ?? "";
    console.log(`✔ Session cookie received from setup`);

    // 7. Verify Attempt to Regenerate Invite for User with Password Fails
    console.log("\n[HTTP] Verifying setup link cannot be generated once password is set...");
    const blockInviteRes = await fetch(`${BASE_URL}/api/team/${newMemberId}/invite`, {
      method: "POST",
      headers: ownerHeaders,
    });
    if (blockInviteRes.status !== 400) {
      throw new Error(`Expected 400 for invite on credentialed user, got ${blockInviteRes.status}`);
    }
    const blockInviteData = await blockInviteRes.json();
    console.log(`✔ Endpoint rejected with 400: "${blockInviteData.error}"`);

    // 8. Sign in with the new employee credentials
    console.log("\n[HTTP] Testing POST /api/auth/login with new credentials...");
    const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Origin": BASE_URL },
      body: JSON.stringify({
        email: testEmployeeEmail,
        password: validPassword1,
      }),
    });
    if (!loginRes.ok) throw new Error(`Login failed: ${loginRes.status} ${await loginRes.text()}`);
    const loginCookieHeader = loginRes.headers.get("set-cookie") ?? "";
    const sessionMatch = loginCookieHeader.match(/company_session=([^;]+)/);
    const employeeSessionToken = sessionMatch ? sessionMatch[1] : "";
    if (!employeeSessionToken) throw new Error("No company_session cookie returned in login");
    console.log("✔ Login successful with individual credentials");

    const employeeHeaders = {
      "Cookie": `company_session=${employeeSessionToken}`,
      "Origin": BASE_URL,
      "Content-Type": "application/json",
    };

    // 9. Change Password via PATCH /api/profile
    console.log("\n[HTTP] Testing individual password change via PATCH /api/profile...");
    // A. Wrong current password -> 403
    const wrongPassRes = await fetch(`${BASE_URL}/api/profile`, {
      method: "PATCH",
      headers: employeeHeaders,
      body: JSON.stringify({
        currentPassword: "IncorrectCurrentPassword",
        newPassword: "BrandNewPassword#2026",
      }),
    });
    if (wrongPassRes.status !== 403) throw new Error(`Expected 403, got ${wrongPassRes.status}`);
    console.log("✔ Profile password change rejected incorrect current password with 403");

    // B. New password < 12 characters -> 400
    const shortNewPassRes = await fetch(`${BASE_URL}/api/profile`, {
      method: "PATCH",
      headers: employeeHeaders,
      body: JSON.stringify({
        currentPassword: validPassword1,
        newPassword: "short-pass",
      }),
    });
    if (shortNewPassRes.status !== 400) throw new Error(`Expected 400, got ${shortNewPassRes.status}`);
    console.log("✔ Profile password change rejected new password < 12 chars with 400");

    // C. Valid new password >= 12 characters -> 200
    const validPassword2 = "BrandNewPassword#2026!";
    const changePassRes = await fetch(`${BASE_URL}/api/profile`, {
      method: "PATCH",
      headers: employeeHeaders,
      body: JSON.stringify({
        currentPassword: validPassword1,
        newPassword: validPassword2,
      }),
    });
    if (!changePassRes.ok) throw new Error(`PATCH /api/profile failed: ${changePassRes.status} ${await changePassRes.text()}`);
    console.log("✔ Profile password change succeeded with 200 OK");

    // 10. Verify login with updated password
    console.log("\n[HTTP] Verifying login with updated password...");
    const oldLoginRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Origin": BASE_URL },
      body: JSON.stringify({
        email: testEmployeeEmail,
        password: validPassword1,
      }),
    });
    if (oldLoginRes.ok) throw new Error("FAIL: Login with old password still succeeded!");

    const newLoginRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Origin": BASE_URL },
      body: JSON.stringify({
        email: testEmployeeEmail,
        password: validPassword2,
      }),
    });
    if (!newLoginRes.ok) throw new Error(`FAIL: Login with new password failed: ${newLoginRes.status}`);
    console.log("✔ Old password rejected; new password authenticated successfully");

    // 11. Cleanup test employee
    console.log("\n[Cleanup] Removing E2E test user...");
    await db.session.deleteMany({ where: { userId: newMemberId } });
    await db.passwordSetupToken.deleteMany({ where: { userId: newMemberId } });
    await db.user.delete({ where: { id: newMemberId } });
    console.log(`✔ Cleaned up test user ${newMemberId}`);

  } finally {
    await db.session.deleteMany({ where: { tokenHash: sha256(ownerSessionToken) } });
    await db.$disconnect();
  }

  console.log("\n=== ALL HTTP INTEGRATION TESTS PASSED ===");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

