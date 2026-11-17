import { createHash } from "node:crypto";
import { createReadStream, existsSync, lstatSync, mkdirSync, openSync, closeSync, chmodSync, unlinkSync, writeFileSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";

function readDatabaseUrl(envPath) {
  const line = readFileSync(envPath, "utf8").split(/\r?\n/).find((item) => /^\s*DATABASE_URL\s*=/.test(item));
  if (!line) throw new Error("Production DATABASE_URL is missing.");
  let value = line.slice(line.indexOf("=") + 1).trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
  const url = new URL(value);
  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") throw new Error("Production database URL is not PostgreSQL.");
  const database = decodeURIComponent(url.pathname.replace(/^\//, "").split("?")[0]);
  if (database !== "company_os" || !["localhost", "127.0.0.1"].includes(url.hostname) || (url.port && url.port !== "5432")) {
    throw new Error("Refusing to back up an unexpected database target.");
  }
  const env = { ...process.env };
  env.PGHOST = url.hostname;
  env.PGPORT = url.port || "5432";
  env.PGDATABASE = database;
  env.PGUSER = decodeURIComponent(url.username);
  env.PGPASSWORD = decodeURIComponent(url.password);
  env.PGCONNECT_TIMEOUT = "10";
  if (url.searchParams.has("sslmode")) env.PGSSLMODE = url.searchParams.get("sslmode");
  return env;
}

function runToFile(command, args, env, outputPath) {
  return new Promise((resolvePromise, rejectPromise) => {
    const fd = openSync(outputPath, "wx", 0o600);
    const child = spawn(command, args, { env, stdio: ["ignore", fd, "inherit"] });
    let descriptorClosed = false;
    const closeDescriptor = () => {
      if (descriptorClosed) return;
      descriptorClosed = true;
      closeSync(fd);
    };
    child.once("error", (error) => {
      closeDescriptor();
      rejectPromise(error);
    });
    child.once("close", (code) => {
      closeDescriptor();
      if (code === 0) resolvePromise();
      else rejectPromise(new Error(`${command} exited with status ${code}.`));
    });
  });
}

function verifyArchive(command, args, description) {
  const result = spawnSync(command, args, { stdio: "ignore" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${description} verification failed.`);
}

async function sha256(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function main() {
  const productionDir = resolve(process.argv[2] || "");
  const backupDir = resolve(process.argv[3] || "");
  if (!productionDir || !backupDir || !existsSync(join(productionDir, ".env"))) {
    throw new Error("Usage: backup-production-state.mjs <production-directory> <backup-directory>");
  }
  mkdirSync(backupDir, { recursive: true, mode: 0o700 });
  chmodSync(backupDir, 0o700);

  const uploadsPath = join(productionDir, "uploads");
  const uploadStat = lstatSync(uploadsPath);
  if (!uploadStat.isDirectory() || uploadStat.isSymbolicLink()) throw new Error("Production uploads must be a regular directory.");

  const databasePath = join(backupDir, "company_os.dump");
  const uploadsArchivePath = join(backupDir, "uploads.tar.gz");
  const manifestPath = join(backupDir, "SHA256SUMS");
  try {
    const dbEnv = readDatabaseUrl(join(productionDir, ".env"));
    await runToFile("pg_dump", ["--format=custom", "--no-owner", "--no-acl"], dbEnv, databasePath);
    verifyArchive("pg_restore", ["--list", databasePath], "PostgreSQL dump");

    await runToFile("tar", ["-czf", "-", "-C", productionDir, "uploads"], process.env, uploadsArchivePath);
    verifyArchive("tar", ["-tzf", uploadsArchivePath], "Uploads archive");

    const manifest = `${await sha256(databasePath)}  ${basename(databasePath)}\n${await sha256(uploadsArchivePath)}  ${basename(uploadsArchivePath)}\n`;
    writeFileSync(manifestPath, manifest, { flag: "wx", mode: 0o600 });
    for (const path of [databasePath, uploadsArchivePath, manifestPath]) chmodSync(path, 0o600);
    console.log(`Verified production recovery point created at ${backupDir}`);
  } catch (error) {
    for (const path of [databasePath, uploadsArchivePath, manifestPath]) {
      try { unlinkSync(path); } catch {}
    }
    throw error;
  }
}

main().catch((error) => {
  console.error(`Production backup failed: ${error.message}`);
  process.exitCode = 1;
});
