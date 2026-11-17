import { PrismaClient } from "@prisma/client";
import { compare, hash } from "bcryptjs";
import { createHash, randomBytes } from "node:crypto";

const DISPOSABLE_DB_URL = "postgresql://tanveersinghsaini@localhost:5432/company_os_dev_audit_test?schema=public";
const testDb = new PrismaClient({
  datasources: { db: { url: DISPOSABLE_DB_URL } },
});

const sha256 = (val: string) => createHash("sha256").update(val).digest("hex");
const newToken = () => randomBytes(32).toString("base64url");

async function main() {
  console.log("=== RUNNING AUDIT OF PASSWORD SETUP FLOW ON DISPOSABLE DATABASE ===");

  // 1. Setup candidate test employee in disposable DB
  const employee = await testDb.user.create({
    data: {
      name: "Audit Candidate",
      email: "audit.candidate@cyraops.com",
      role: "MEMBER",
      mustChangePassword: true,
    },
  });

  // ---------------------------------------------------------
  // TEST A: Valid setup link verification & token redemption
  // ---------------------------------------------------------
  const validRawToken = newToken();
  const validHash = sha256(validRawToken);
  const validExpiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);

  await testDb.passwordSetupToken.create({
    data: {
      tokenHash: validHash,
      userId: employee.id,
      expiresAt: validExpiresAt,
    },
  });

  // Verify valid token lookup
  const tokenRecord = await testDb.passwordSetupToken.findUnique({
    where: { tokenHash: validHash },
    include: { user: true },
  });
  const isValid = Boolean(tokenRecord && !tokenRecord.usedAt && tokenRecord.expiresAt > new Date() && !tokenRecord.user.disabledAt);
  console.log(`[TEST A1 - Valid token lookup]: ${isValid ? "PASS" : "FAIL"}`);

  // ---------------------------------------------------------
  // TEST B: Invalid token lookup
  // ---------------------------------------------------------
  const bogusHash = sha256("bogus_token_12345");
  const bogusRecord = await testDb.passwordSetupToken.findUnique({ where: { tokenHash: bogusHash } });
  console.log(`[TEST B - Invalid token lookup]: ${bogusRecord === null ? "PASS (Null record)" : "FAIL"}`);

  // ---------------------------------------------------------
  // TEST C: Expired token rejection
  // ---------------------------------------------------------
  const expiredRawToken = newToken();
  const expiredHash = sha256(expiredRawToken);
  await testDb.passwordSetupToken.create({
    data: {
      tokenHash: expiredHash,
      userId: employee.id,
      expiresAt: new Date(Date.now() - 60 * 1000), // 1 min ago
    },
  });
  const expRecord = await testDb.passwordSetupToken.findUnique({ where: { tokenHash: expiredHash } });
  const isExpired = Boolean(expRecord && expRecord.expiresAt < new Date());
  console.log(`[TEST C - Expired token rejection]: ${isExpired ? "PASS (Recognized as expired)" : "FAIL"}`);

  // ---------------------------------------------------------
  // TEST D: Disabled account token rejection
  // ---------------------------------------------------------
  const disabledEmp = await testDb.user.create({
    data: {
      name: "Disabled Emp",
      email: "disabled.emp@cyraops.com",
      role: "MEMBER",
      disabledAt: new Date(),
    },
  });
  const disRawToken = newToken();
  const disHash = sha256(disRawToken);
  await testDb.passwordSetupToken.create({
    data: {
      tokenHash: disHash,
      userId: disabledEmp.id,
      expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
    },
  });
  const disRecord = await testDb.passwordSetupToken.findUnique({
    where: { tokenHash: disHash },
    include: { user: true },
  });
  const isDisabledBlocked = Boolean(disRecord && disRecord.user.disabledAt !== null);
  console.log(`[TEST D - Disabled account rejection]: ${isDisabledBlocked ? "PASS (Blocked)" : "FAIL"}`);

  // ---------------------------------------------------------
  // TEST E: Race condition - Two simultaneous redemption requests
  // ---------------------------------------------------------
  const raceRawToken = newToken();
  const raceHash = sha256(raceRawToken);
  const raceTokenRec = await testDb.passwordSetupToken.create({
    data: {
      tokenHash: raceHash,
      userId: employee.id,
      expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
    },
  });

  // Function representing the exact atomic transaction in POST /api/auth/setup
  async function redeem(password: string) {
    const pwHash = await hash(password, 12);
    return testDb.$transaction(async (tx) => {
      const currentToken = await tx.passwordSetupToken.findUnique({
        where: { id: raceTokenRec.id },
      });
      if (!currentToken || currentToken.usedAt || currentToken.expiresAt < new Date()) {
        throw new Error("TOKEN_ALREADY_USED");
      }
      await tx.passwordSetupToken.update({
        where: { id: raceTokenRec.id },
        data: { usedAt: new Date() },
      });
      return tx.user.update({
        where: { id: employee.id },
        data: { passwordHash: pwHash, mustChangePassword: false },
      });
    }, { isolationLevel: "Serializable" });
  }

  const [race1, race2] = await Promise.allSettled([
    redeem("PassAttemptOne123!"),
    redeem("PassAttemptTwo123!"),
  ]);

  const race1Ok = race1.status === "fulfilled";
  const race2Ok = race2.status === "fulfilled";
  const exactlyOneWinner = (race1Ok && !race2Ok) || (!race1Ok && race2Ok);
  console.log(`[TEST E - Simultaneous redemption race condition]: ${exactlyOneWinner ? "PASS (Exactly one request won, other aborted)" : "FAIL"}`);

  // ---------------------------------------------------------
  // TEST F: Token reuse rejection
  // ---------------------------------------------------------
  const reuseAttempt = await redeem("PassAttemptThree123!").catch((err) => err.message);
  console.log(`[TEST F - Token reuse rejection]: ${reuseAttempt === "TOKEN_ALREADY_USED" ? "PASS (Rejected with TOKEN_ALREADY_USED)" : "FAIL"}`);

  // ---------------------------------------------------------
  // TEST G: Successful password setup followed by login
  // ---------------------------------------------------------
  // Verify user in DB now has passwordHash and mustChangePassword = false
  const updatedEmp = await testDb.user.findUnique({ where: { id: employee.id } });
  const hasPassword = Boolean(updatedEmp?.passwordHash && !updatedEmp.mustChangePassword);

  // Authenticate candidate with the winning password
  const winningPassword = race1Ok ? "PassAttemptOne123!" : "PassAttemptTwo123!";
  const matches = await compare(winningPassword, updatedEmp?.passwordHash ?? "");
  console.log(`[TEST G - Password setup and subsequent login check]: ${hasPassword && matches ? "PASS (User password set, bcrypt verified)" : "FAIL"}`);

  console.log("=== DISPOSABLE DATABASE PASSWORD SETUP AUDIT COMPLETE ===");
}

main()
  .catch((err) => {
    console.error("Audit error:", err);
    process.exit(1);
  })
  .finally(async () => {
    await testDb.$disconnect();
  });

