/**
 * DB bridge for @cyraops/harness-crm — the mechanism that lets the tool read
 * real Cyraops data while its own module graph is served by the vendored
 * harness loader.
 *
 * Why createRequire instead of a static import:
 *   The vendored loader routes every bare specifier a plugin imports to the
 *   runtime resolution table anchored at vendor/dsh (plus the plugin's own
 *   peer declarations), and `@prisma/client` does not exist under
 *   vendor/dsh/node_modules — it lives in the Cyraops V2 root node_modules,
 *   generated against prisma/schema.prisma. A `createRequire` anchored at the
 *   V2 root package.json is not in any interception layer, so the loader
 *   leaves it to Node's native resolution and the require lands exactly on
 *   the repo's generated client. The root is taken from CYRAOPS_ROOT or, in
 *   the in-process harness (which runs inside the Next server), process.cwd().
 *
 * This module imports only node builtins so the unit test can load it
 * without the vendored loader.
 */

import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

/** TaskStatus values that count as an open ticket (not DONE, not archived). */
export const OPEN_STATUSES = Object.freeze(["BACKLOG", "TODO", "IN_PROGRESS", "IN_REVIEW"]);

/** The Prisma `where` clause the open-ticket aggregate runs against. */
export const OPEN_WHERE = Object.freeze({
  archivedAt: null,
  status: { in: [...OPEN_STATUSES] },
});

/**
 * Locate the Cyraops V2 application root: CYRAOPS_ROOT wins, else the
 * process cwd (the in-process harness runs inside the Next server, whose cwd
 * is the repo root). Verified by the presence of package.json.
 * @param {string} [cwd]
 * @param {Record<string, string | undefined>} [env]
 */
export function cyraopsRoot(cwd = process.cwd(), env = process.env) {
  const candidates = [env?.CYRAOPS_ROOT, cwd].filter((value) => typeof value === "string" && value.length > 0);
  for (const dir of candidates) {
    if (existsSync(path.join(dir, "package.json"))) return dir;
  }
  throw new Error(
    "cyraops-crm: cannot locate the Cyraops application root (set CYRAOPS_ROOT to the repo root)"
  );
}

/** A `require` bound to the Cyraops V2 root package.json (its node_modules). */
export function createRootRequire(rootDir) {
  return createRequire(path.join(rootDir, "package.json"));
}

/** Load PrismaClient from the V2 root node_modules through the root require. */
export function loadPrismaClient(rootRequire) {
  let mod;
  try {
    mod = rootRequire("@prisma/client");
  } catch (error) {
    throw new Error(`cyraops-crm: @prisma/client is not resolvable from the Cyraops root (${error?.message})`);
  }
  const PrismaClient = mod?.PrismaClient ?? mod?.default?.PrismaClient;
  if (typeof PrismaClient !== "function") {
    throw new Error("cyraops-crm: @prisma/client did not export PrismaClient");
  }
  return PrismaClient;
}

/** Validate the optional `limit` tool argument (strict: number only). */
export function normalizeLimit(limit) {
  if (limit === undefined || limit === null) return undefined;
  if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1) {
    throw new Error("cyraops-crm: limit must be a positive integer");
  }
  return limit;
}

/**
 * Aggregate open tickets from any `findMany`-capable client (the real Prisma
 * client or a unit-test stub): { count, statuses }.
 * `limit` (optional) caps how many open-ticket rows are read, so count and
 * statuses describe the capped set; without it every open ticket is counted.
 */
export async function openTickets(prisma, { limit } = {}) {
  const take = normalizeLimit(limit);
  const rows = await prisma.task.findMany({ where: OPEN_WHERE, select: { status: true }, take });
  const statuses = {};
  for (const row of rows) {
    const status = row.status;
    statuses[status] = (statuses[status] ?? 0) + 1;
  }
  return { count: rows.length, statuses };
}

/**
 * One read-only aggregate over the live Cyraops database: connect with a
 * fresh PrismaClient (created through the root require), run the aggregate,
 * and always disconnect.
 */
export async function queryOpenTickets({ limit } = {}) {
  const rootRequire = createRootRequire(cyraopsRoot());
  const PrismaClient = loadPrismaClient(rootRequire);
  const prisma = new PrismaClient();
  try {
    return await openTickets(prisma, { limit });
  } finally {
    await prisma.$disconnect();
  }
}
