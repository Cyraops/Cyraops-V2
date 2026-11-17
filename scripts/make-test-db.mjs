import { PrismaClient } from "@prisma/client";
const db = process.env.CYRAOPS_TEST_DB || "cyraops_test";
const admin = new PrismaClient();
try {
  const rows = await admin.$queryRawUnsafe("SELECT 1 FROM pg_database WHERE datname=$1", db);
  if (rows.length === 0) {
    await admin.$queryRawUnsafe(`CREATE DATABASE "${db}"`);
    console.log(`created ${db}`);
  } else {
    console.log(`exists ${db}`);
  }
} catch (e) {
  console.error(e.message);
  process.exit(1);
} finally {
  await admin.$disconnect();
}
