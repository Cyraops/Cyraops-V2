import { db } from "../src/lib/db";
import { newToken, sha256 } from "../src/lib/auth";

async function main() {
  const membersWithoutPassword = await db.user.findMany({
    where: {
      passwordHash: null,
      disabledAt: null,
    },
  });

  console.log(`Found ${membersWithoutPassword.length} members without passwords.`);

  for (const member of membersWithoutPassword) {
    const rawToken = newToken();
    const tokenHash = sha256(rawToken);
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000); // 48 hours

    // Invalidate prior unused tokens
    await db.passwordSetupToken.deleteMany({
      where: { userId: member.id, usedAt: null },
    });

    await db.passwordSetupToken.create({
      data: {
        tokenHash,
        userId: member.id,
        expiresAt,
      },
    });

    console.log(`Generated setup token for ${member.name} (${member.email}): token=${rawToken}`);
  }
}

main()
  .catch((err) => {
    console.error("Error seeding setup tokens:", err);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });

