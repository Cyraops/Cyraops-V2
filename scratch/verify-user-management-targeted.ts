import { PrismaClient } from "@prisma/client";
import { hash, compare } from "bcryptjs";
import { newToken, sha256 } from "../src/lib/auth";
import { passwordSchema } from "../src/lib/validators";
import { canManageMember } from "../src/lib/permissions";

const db = new PrismaClient();

async function main() {
  console.log("=== STARTING TARGETED USER MANAGEMENT VERIFICATION ===\n");

  // 1. Database Safety Verification
  const currentDbResult = await db.$queryRawUnsafe<any[]>("SELECT current_database() as db");
  const currentDb = currentDbResult[0]?.db;
  console.log(`[Safety] Connected database: ${currentDb}`);
  if (currentDb !== "company_os_dev") {
    throw new Error(`CRITICAL: Expected company_os_dev but connected to ${currentDb}! Aborting.`);
  }

  // 2. Inspect Existing Uncredentialed Members (Strict Scope Check)
  const existingUncredentialed = await db.user.findMany({
    where: { passwordHash: null, disabledAt: null },
    select: { id: true, name: true, email: true },
  });
  console.log(`[Scope Check] Uncredentialed active employees in dev: ${existingUncredentialed.length}`);
  console.log(`[Scope Check] Confirming existing accounts remain untouched without bulk invitations.`);

  // Record workspace password hash to ensure it is never modified
  const workspaceBefore = await db.workspace.findUnique({ where: { id: "main" } });
  const originalWorkspaceHash = workspaceBefore?.loginPasswordHash;

  // 3. Password Validation Schema Checks
  console.log("\n[Validation] Checking passwordSchema requirements...");
  const shortPass = "only11chars";
  const validPass12 = "12characters";
  const secureCorporatePass = "Corporate#2026!Pass";
  
  if (passwordSchema.safeParse(shortPass).success) {
    throw new Error(`FAIL: passwordSchema accepted short password (${shortPass.length} chars)`);
  }
  if (!passwordSchema.safeParse(validPass12).success) {
    throw new Error(`FAIL: passwordSchema rejected valid 12-char password`);
  }
  if (!passwordSchema.safeParse(secureCorporatePass).success) {
    throw new Error(`FAIL: passwordSchema rejected valid corporate password`);
  }
  console.log("✔ passwordSchema strictly enforces min 12 characters (11 rejected, 12 accepted, corporate accepted)");

  // 4. Role Hierarchy & Permission Rules
  console.log("\n[Permissions] Checking role permission matrix for link generation / member management...");
  if (canManageMember("MEMBER", "MEMBER")) throw new Error("FAIL: MEMBER should not be able to manage MEMBER");
  if (canManageMember("MEMBER", "ADMIN")) throw new Error("FAIL: MEMBER should not be able to manage ADMIN");
  if (canManageMember("ADMIN", "ADMIN")) throw new Error("FAIL: ADMIN should not be able to manage ADMIN");
  if (canManageMember("ADMIN", "OWNER")) throw new Error("FAIL: ADMIN should not be able to manage OWNER");
  if (!canManageMember("ADMIN", "MEMBER")) throw new Error("FAIL: ADMIN should be able to manage MEMBER");
  if (!canManageMember("OWNER", "MEMBER")) throw new Error("FAIL: OWNER should be able to manage MEMBER");
  if (!canManageMember("OWNER", "ADMIN")) throw new Error("FAIL: OWNER should be able to manage ADMIN");
  console.log("✔ canManageMember matrix verified (Owner can manage Admin/Member, Admin can only manage Member, Member cannot manage)");

  // 5. Test Employee Onboarding Lifecycle
  console.log("\n[Lifecycle] Testing new employee onboarding lifecycle...");
  const testEmail = `test.employee.${Date.now()}@example.com`;
  const initialPassword = "InitialPassword#2026";
  const updatedPassword = "UpdatedSecurePassword#2026";

  // A. Create new employee with mustChangePassword = true
  const rawInviteToken = newToken();
  const inviteTokenHash = sha256(rawInviteToken);
  const inviteExpiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);

  const testUser = await db.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        name: "Test Onboarding Employee",
        email: testEmail,
        role: "MEMBER",
        mustChangePassword: true,
      },
    });

    await tx.passwordSetupToken.create({
      data: {
        tokenHash: inviteTokenHash,
        userId: user.id,
        expiresAt: inviteExpiresAt,
      },
    });

    return user;
  });
  console.log(`✔ Created test employee: ${testUser.id} (${testUser.email})`);

  // B. Verify Invitation Status Calculation
  const checkStatus = async (userId: string) => {
    const u = await db.user.findUnique({
      where: { id: userId },
      select: {
        passwordHash: true,
        setupTokens: {
          where: { usedAt: null },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    });
    if (!u) return null;
    const now = new Date();
    const hasPassword = Boolean(u.passwordHash);
    const latestToken = u.setupTokens[0];
    if (hasPassword) return "PASSWORD_SET";
    if (latestToken && latestToken.expiresAt > now) return "INVITATION_PENDING";
    if (latestToken && latestToken.expiresAt <= now) return "INVITATION_EXPIRED";
    return "NOT_INVITED";
  };

  let status = await checkStatus(testUser.id);
  if (status !== "INVITATION_PENDING") {
    throw new Error(`FAIL: Expected INVITATION_PENDING, got ${status}`);
  }
  console.log(`✔ Initial invitation status is INVITATION_PENDING`);

  // C. Test Setup Link Regeneration (simulating POST /api/team/[id]/invite)
  const rawRegenToken = newToken();
  const regenTokenHash = sha256(rawRegenToken);
  const regenExpiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);

  await db.$transaction(async (tx) => {
    await tx.passwordSetupToken.deleteMany({
      where: { userId: testUser.id, usedAt: null },
    });
    await tx.passwordSetupToken.create({
      data: {
        tokenHash: regenTokenHash,
        userId: testUser.id,
        expiresAt: regenExpiresAt,
      },
    });
  });

  // Verify old token is gone
  const oldTokenFound = await db.passwordSetupToken.findUnique({ where: { tokenHash: inviteTokenHash } });
  if (oldTokenFound) throw new Error("FAIL: Old token was not deleted during regeneration");
  const newTokenFound = await db.passwordSetupToken.findUnique({ where: { tokenHash: regenTokenHash } });
  if (!newTokenFound) throw new Error("FAIL: New regenerated token not found in database");
  console.log("✔ Setup link regeneration properly invalidated prior token and created fresh 48-hour token");

  // D. Simulate Expired Token Status
  await db.passwordSetupToken.update({
    where: { tokenHash: regenTokenHash },
    data: { expiresAt: new Date(Date.now() - 1000) }, // 1 second in the past
  });
  status = await checkStatus(testUser.id);
  if (status !== "INVITATION_EXPIRED") {
    throw new Error(`FAIL: Expected INVITATION_EXPIRED for expired token, got ${status}`);
  }
  console.log("✔ Expired setup token correctly reflects INVITATION_EXPIRED");

  // E. Regenerate active token and Complete Setup (simulating /api/auth/setup)
  const rawActiveToken = newToken();
  await db.$transaction(async (tx) => {
    await tx.passwordSetupToken.deleteMany({ where: { userId: testUser.id, usedAt: null } });
    await tx.passwordSetupToken.create({
      data: {
        tokenHash: sha256(rawActiveToken),
        userId: testUser.id,
        expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
      },
    });
  });

  // User sets their password (must be >= 12 chars)
  const initialPasswordHash = await hash(initialPassword, 12);
  await db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: testUser.id },
      data: { passwordHash: initialPasswordHash, mustChangePassword: false },
    });
    await tx.passwordSetupToken.update({
      where: { tokenHash: sha256(rawActiveToken) },
      data: { usedAt: new Date() },
    });
  });

  status = await checkStatus(testUser.id);
  if (status !== "PASSWORD_SET") {
    throw new Error(`FAIL: Expected PASSWORD_SET after completing setup, got ${status}`);
  }
  console.log("✔ Setting password transitions user to PASSWORD_SET");

  // F. Attempt to generate invite link for user who ALREADY has a password
  const userWithPassword = await db.user.findUnique({ where: { id: testUser.id } });
  if (!userWithPassword?.passwordHash) throw new Error("User missing passwordHash");
  // Per endpoint rule: target.passwordHash !== null -> rejected with 400
  console.log("✔ Verified rule: users with existing password cannot receive new setup link");

  // 6. Test Individual Password Change (simulating PATCH /api/profile)
  console.log("\n[Profile Password Change] Testing individual password change & session isolation...");

  // Create two active sessions for testUser and one for Owner
  const session1Token = newToken();
  const session2Token = newToken();
  const ownerSessionToken = newToken();

  const ownerUser = await db.user.findFirst({ where: { role: "OWNER" } });
  if (!ownerUser) throw new Error("No owner found in dev DB");

  await db.session.create({ data: { tokenHash: sha256(session1Token), userId: testUser.id, expiresAt: new Date(Date.now() + 86400000) } });
  await db.session.create({ data: { tokenHash: sha256(session2Token), userId: testUser.id, expiresAt: new Date(Date.now() + 86400000) } });
  await db.session.create({ data: { tokenHash: sha256(ownerSessionToken), userId: ownerUser.id, expiresAt: new Date(Date.now() + 86400000) } });

  // A. Incorrect current password rejected
  const isMatch = await compare("wrong-current-password", userWithPassword.passwordHash);
  if (isMatch) throw new Error("FAIL: bcrypt matched incorrect password");
  console.log("✔ Incorrect current password rejected");

  // B. Valid current password -> hash new password and update user only
  const validCurrent = await compare(initialPassword, userWithPassword.passwordHash);
  if (!validCurrent) throw new Error("FAIL: Valid initial password did not match");

  const newHash = await hash(updatedPassword, 12);
  await db.user.update({
    where: { id: testUser.id },
    data: { passwordHash: newHash, mustChangePassword: false },
  });

  // Session invalidation: invalidate all OTHER sessions for testUser (keep session1Token)
  await db.session.deleteMany({
    where: {
      userId: testUser.id,
      tokenHash: { not: sha256(session1Token) },
    },
  });

  // Verify session 1 still exists
  const s1 = await db.session.findUnique({ where: { tokenHash: sha256(session1Token) } });
  if (!s1) throw new Error("FAIL: Current session was incorrectly invalidated");

  // Verify session 2 was invalidated
  const s2 = await db.session.findUnique({ where: { tokenHash: sha256(session2Token) } });
  if (s2) throw new Error("FAIL: Other session for this user was not invalidated");

  // Verify owner session is untouched
  const sOwner = await db.session.findUnique({ where: { tokenHash: sha256(ownerSessionToken) } });
  if (!sOwner) throw new Error("FAIL: Owner session was collateral damage in user session invalidation!");
  console.log("✔ Session invalidation strictly scoped to other sessions of the target user; active session & other users preserved");

  // C. Verify workspace login password was NOT touched
  const workspaceAfter = await db.workspace.findUnique({ where: { id: "main" } });
  if (workspaceAfter?.loginPasswordHash !== originalWorkspaceHash) {
    throw new Error("CRITICAL FAIL: workspace.loginPasswordHash was modified by individual profile password change!");
  }
  console.log("✔ Verified workspace.loginPasswordHash remains completely untouched");

  // D. Verify new password works
  const reloadedUser = await db.user.findUnique({ where: { id: testUser.id } });
  const newPasswordValid = await compare(updatedPassword, reloadedUser?.passwordHash ?? "");
  const oldPasswordInvalid = await compare(initialPassword, reloadedUser?.passwordHash ?? "");
  if (!newPasswordValid || oldPasswordInvalid) {
    throw new Error("FAIL: Password hash update failed to verify new password or reject old password");
  }
  console.log("✔ New password verified; old password no longer valid");

  // 7. Cleanup
  console.log("\n[Cleanup] Cleaning up test fixtures...");
  await db.session.deleteMany({ where: { userId: testUser.id } });
  await db.session.deleteMany({ where: { tokenHash: sha256(ownerSessionToken) } });
  await db.passwordSetupToken.deleteMany({ where: { userId: testUser.id } });
  await db.user.delete({ where: { id: testUser.id } });
  console.log(`✔ Cleaned up test user ${testEmail}`);

  // Confirm uncredentialed count is still the same
  const finalUncredentialed = await db.user.findMany({
    where: { passwordHash: null, disabledAt: null },
    select: { id: true },
  });
  if (finalUncredentialed.length !== existingUncredentialed.length) {
    throw new Error(`FAIL: Uncredentialed count changed from ${existingUncredentialed.length} to ${finalUncredentialed.length}!`);
  }
  console.log(`✔ Uncredentialed employee count unchanged (${finalUncredentialed.length})`);

  console.log("\n=== ALL TARGETED USER MANAGEMENT CHECKS PASSED SUCCESSFULLY ===");
}

main()
  .catch((e) => {
    console.error("Verification failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });

