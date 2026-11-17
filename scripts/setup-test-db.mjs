import { PrismaClient } from "@prisma/client";
const admin = new PrismaClient();
try {
  const exists = await admin.$queryRawUnsafe("SELECT 1 FROM pg_database WHERE datname='cyraops_test'");
  if (exists.length === 0) {
    await admin.$queryRawUnsafe("CREATE DATABASE cyraops_test");
    console.log("created cyraops_test");
  } else {
    console.log("cyraops_test already exists");
  }
} catch (e) {
  console.log("ERROR:", e.message);
} finally {
  await admin.$disconnect();
}
