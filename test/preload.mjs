import { config } from "dotenv";
config();

const dbName = process.env.CYRAOPS_TEST_DB || "cyraops_test";
// resetDb() TRUNCATEs every table, so refuse to run against a real database.
// "test" must appear as a whole word — test_*, *_test or *_test_* — so the
// per-job databases (cyraops_test_j2) work while company_os_dev is refused.
if (!/(^|_)test(_|$)/.test(dbName)) {
  console.error(`[test] Refusing to run: "${dbName}" is not a test database. Name it test_*, *_test or *_test_*.`);
  process.exit(1);
}

const url = new URL(process.env.DATABASE_URL || "");
url.pathname = `/${dbName}`;
process.env.DATABASE_URL = url.toString();
process.env.STORAGE_PATH = "/tmp/cyraops-test-uploads";
