import { config } from "dotenv";
config();
const dbName = process.env.CYRAOPS_TEST_DB || "cyraops_test";
const url = new URL(process.env.DATABASE_URL || "");
url.pathname = `/${dbName}`;
process.stdout.write(url.toString());
