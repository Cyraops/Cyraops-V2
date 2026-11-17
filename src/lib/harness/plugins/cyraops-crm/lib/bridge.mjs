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

/** TaskStatus values the list-tickets status filter accepts (all five). */
export const ALL_STATUSES = Object.freeze([...OPEN_STATUSES, "DONE"]);

/** Priority values cyraops_update_ticket accepts. */
export const ALL_PRIORITIES = Object.freeze(["LOW", "MEDIUM", "HIGH", "URGENT"]);

/** Bounds shared by the list/search tools. */
export const LIST_LIMIT_DEFAULT = 10;
export const LIST_LIMIT_MAX = 25;
/** Bounds for the schedule window. */
export const SCHEDULE_DAYS_DEFAULT = 7;
export const SCHEDULE_DAYS_MIN = 1;
export const SCHEDULE_DAYS_MAX = 30;
/** Hard cap on rows the schedule tool reads in one call. */
export const SCHEDULE_ROWS_MAX = 50;

// ---------------------------------------------------------------------------
// Tenant scoping (TASK 2): the bridge derives the turn's workspace/tenant from
// CYRAOPS_WORKSPACE_ID, which the runtime sets (under its global turn mutex)
// to the conversation owner's user id before the turn executes.
//
// Why a user id: the schema has no workspace column on Task/Contact/
// CalendarEvent. The only tenant-stable keys are user ids (Task.creatorId,
// Task.project.ownerId, CalendarEvent.creatorId), and Workspace.ownerId maps a
// workspace 1:1 to its owner user. The bot conversation's owner (Assistant.
// userId) is therefore the data boundary the bridge can actually enforce.
//
// LIMITATIONS (documented honestly):
// - Contact has no tenant/owner column at all, so cyraops_search_contacts
//   cannot be scoped and still searches the whole DB (the app's own
//   /api/crm/contacts behaves the same way).
// - When CYRAOPS_WORKSPACE_ID is unset the tools keep their previous
//   whole-DB behaviour (used by unit tests and any turn that never passed a
//   tenant, e.g. the CLI fallback). This is a query-level, model-visible
//   filter — not a DB row-level security policy.
// ---------------------------------------------------------------------------

/**
 * Read the turn's tenant key from the environment. Empty/unset means no
 * tenant is known: the caller decides whether to filter (fail closed) or keep
 * legacy behaviour. The bridge keeps legacy behaviour and the tools document
 * it; the live bot path always sets the variable.
 * @param {Record<string, string | undefined>} [env]
 */
export function readTenantId(env = process.env) {
  const value = env?.CYRAOPS_WORKSPACE_ID;
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

/**
 * The Prisma `where` fragment scoping tasks to one tenant: rows the tenant
 * created or rows in projects the tenant owns. No tenant id → `{}` (whole DB,
 * the pre-scoping behaviour).
 */
export function taskTenantWhere(tenantId) {
  if (!tenantId) return {};
  return { OR: [{ creatorId: tenantId }, { project: { ownerId: tenantId } }] };
}

/** The open-ticket `where`: tenant-scoped when a tenant is known, else the legacy constant. */
export function openTicketsWhere(tenantId) {
  if (!tenantId) return OPEN_WHERE;
  return {
    archivedAt: null,
    AND: [{ status: { in: [...OPEN_STATUSES] } }, taskTenantWhere(tenantId)],
  };
}

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

/** Validate a bounded list size: an integer between 1 and `max`. */
export function normalizeBoundedLimit(limit, max) {
  if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > max) {
    throw new Error(`cyraops-crm: limit must be an integer between 1 and ${max}`);
  }
  return limit;
}

/** Optional free-text filter: undefined/null is fine, else a non-empty string (trimmed). */
export function normalizeOptionalQuery(query) {
  if (query === undefined || query === null) return undefined;
  if (typeof query !== "string" || query.trim() === "") {
    throw new Error("cyraops-crm: query must be a non-empty string when provided");
  }
  return query.trim();
}

/** Required free-text filter: must be a non-empty string (trimmed). */
export function normalizeRequiredQuery(query) {
  if (typeof query !== "string" || query.trim() === "") {
    throw new Error("cyraops-crm: query must be a non-empty string");
  }
  return query.trim();
}

/** Optional schedule window: undefined/null → 7, else an integer 1..30. */
export function normalizeDays(days) {
  if (days === undefined || days === null) return SCHEDULE_DAYS_DEFAULT;
  if (
    typeof days !== "number" ||
    !Number.isInteger(days) ||
    days < SCHEDULE_DAYS_MIN ||
    days > SCHEDULE_DAYS_MAX
  ) {
    throw new Error(`cyraops-crm: days must be an integer between ${SCHEDULE_DAYS_MIN} and ${SCHEDULE_DAYS_MAX}`);
  }
  return days;
}

/**
 * Aggregate open tickets from any `findMany`-capable client (the real Prisma
 * client or a unit-test stub): { count, statuses }.
 * `limit` (optional) caps how many open-ticket rows are read, so count and
 * statuses describe the capped set; without it every open ticket is counted.
 * `tenantId` (optional) scopes the set to the turn's workspace/tenant.
 */
export async function openTickets(prisma, { limit, tenantId } = {}) {
  const take = normalizeLimit(limit);
  const rows = await prisma.task.findMany({ where: openTicketsWhere(tenantId), select: { status: true }, take });
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
 * and always disconnect. The tenant comes from CYRAOPS_WORKSPACE_ID.
 */
export async function queryOpenTickets({ limit } = {}) {
  const rootRequire = createRootRequire(cyraopsRoot());
  const PrismaClient = loadPrismaClient(rootRequire);
  const prisma = new PrismaClient();
  try {
    return await openTickets(prisma, { limit, tenantId: readTenantId() });
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * List tickets: open tickets by default (not archived, status in
 * BACKLOG/TODO/IN_PROGRESS/IN_REVIEW), an optional single-status filter, an
 * optional case-insensitive title/description search, and an optional bounded
 * limit (default 10, max 25). Returns
 * { count, tickets: [{ id, title, status, priority, assignee }] } where
 * `assignee` is the assignee's display name or null. Read-only.
 * `tenantId` (optional) scopes the set to the turn's workspace/tenant.
 */
export async function listTickets(prisma, { status, limit, query, tenantId } = {}) {
  if (status !== undefined && status !== null && !ALL_STATUSES.includes(status)) {
    throw new Error(`cyraops-crm: status must be one of ${ALL_STATUSES.join("/")}`);
  }
  const take = limit === undefined || limit === null ? LIST_LIMIT_DEFAULT : normalizeBoundedLimit(limit, LIST_LIMIT_MAX);
  const q = normalizeOptionalQuery(query);
  const and = [status != null ? { status } : { status: { in: [...OPEN_STATUSES] } }];
  if (tenantId) and.push(taskTenantWhere(tenantId));
  if (q) {
    const contains = { contains: q, mode: "insensitive" };
    and.push({ OR: [{ title: contains }, { description: contains }] });
  }
  const rows = await prisma.task.findMany({
    where: { archivedAt: null, AND: and },
    select: {
      id: true,
      title: true,
      status: true,
      priority: true,
      assignee: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
    take,
  });
  const tickets = rows.map((row) => ({
    id: row.id,
    title: row.title,
    status: row.status,
    priority: row.priority,
    assignee: row.assignee?.name ?? null,
  }));
  return { count: tickets.length, tickets };
}

/**
 * Search non-archived contacts by name or email (case-insensitive contains).
 * `query` is required; a multi-word query must match every word somewhere in
 * the contact's first name, last name or email. Returns
 * { count, contacts: [{ id, name, email, company }] } where `name` is the
 * full name and `company` the company name (null when absent). Read-only.
 */
export async function searchContacts(prisma, { query, limit } = {}) {
  const q = normalizeRequiredQuery(query);
  const take = limit === undefined || limit === null ? LIST_LIMIT_DEFAULT : normalizeBoundedLimit(limit, LIST_LIMIT_MAX);
  const tokens = q.split(/\s+/).filter(Boolean);
  const contains = (token) => ({ contains: token, mode: "insensitive" });
  const and = tokens.map((token) => ({
    OR: [{ firstName: contains(token) }, { lastName: contains(token) }, { email: contains(token) }],
  }));
  const rows = await prisma.contact.findMany({
    where: { archivedAt: null, AND: and },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      company: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
    take,
  });
  const contacts = rows.map((row) => ({
    id: row.id,
    name: `${row.firstName} ${row.lastName}`.trim(),
    email: row.email ?? null,
    company: row.company?.name ?? null,
  }));
  return { count: contacts.length, contacts };
}

/**
 * List upcoming non-archived calendar events whose start falls within the
 * next `days` days (default 7, 1..30). Returns
 * { count, events: [{ id, title, start, end }] } with ISO-8601 start/end.
 * `tenantId` (optional) scopes the set to events the turn's workspace/tenant
 * created (CalendarEvent has no workspace column; creatorId is the only
 * tenant-stable key).
 * Read-only.
 */
export async function scheduleEvents(prisma, { days, tenantId } = {}) {
  const windowDays = normalizeDays(days);
  const now = new Date();
  const until = new Date(now.getTime() + windowDays * 86_400_000);
  const rows = await prisma.calendarEvent.findMany({
    where: {
      archivedAt: null,
      startsAt: { gte: now, lte: until },
      ...(tenantId ? { creatorId: tenantId } : {}),
    },
    select: { id: true, title: true, startsAt: true, endsAt: true },
    orderBy: { startsAt: "asc" },
    take: SCHEDULE_ROWS_MAX,
  });
  const events = rows.map((row) => ({
    id: row.id,
    title: row.title,
    start: row.startsAt.toISOString(),
    end: row.endsAt.toISOString(),
  }));
  return { count: events.length, events };
}

/** Run `fn` against a fresh PrismaClient, always disconnecting afterwards. */
async function withPrismaClient(run) {
  const rootRequire = createRootRequire(cyraopsRoot());
  const PrismaClient = loadPrismaClient(rootRequire);
  const prisma = new PrismaClient();
  try {
    return await run(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

/** Live read-only ticket listing (per-call PrismaClient, always disconnected). */
export function queryListTickets(args = {}) {
  return withPrismaClient((prisma) => listTickets(prisma, { ...args, tenantId: readTenantId() }));
}

/** Live read-only contact search (per-call PrismaClient, always disconnected). */
export function querySearchContacts(args = {}) {
  return withPrismaClient((prisma) => searchContacts(prisma, args));
}

/** Live read-only schedule listing (per-call PrismaClient, always disconnected). */
export function queryListSchedule(args = {}) {
  return withPrismaClient((prisma) => scheduleEvents(prisma, { ...args, tenantId: readTenantId() }));
}

// ---------------------------------------------------------------------------
// cyraops_update_ticket: the ONE write tool (TASK 1). Requires harness
// approval before it runs: the plugin's tools/pre-execute listener returns
// { kind: "ask" } for this tool and the approval service's answerer waterfall
// decides it (see index.js).
// ---------------------------------------------------------------------------

/** Validate the optional priority argument: one of LOW/MEDIUM/HIGH/URGENT. */
export function normalizePriority(priority) {
  if (typeof priority !== "string" || !ALL_PRIORITIES.includes(priority)) {
    throw new Error(`cyraops-crm: priority must be one of ${ALL_PRIORITIES.join("/")}`);
  }
  return priority;
}

/** Validate the optional title argument: a non-empty string when provided. */
export function normalizeTitle(title) {
  if (typeof title !== "string" || title.trim() === "") {
    throw new Error("cyraops-crm: title must be a non-empty string when provided");
  }
  return title.trim();
}

/** Validate the required ticket id argument: a non-empty string. */
export function normalizeTicketId(id) {
  if (typeof id !== "string" || id.trim() === "") {
    throw new Error("cyraops-crm: id must be a non-empty ticket id");
  }
  return id.trim();
}

/**
 * Update one ticket's title and/or priority. The update is tenant-scoped:
 * with a `tenantId`, the WHERE clause additionally requires the ticket to
 * belong to that tenant (creator or project owner), so a cross-tenant id
 * fails with "not found in this workspace" instead of updating another
 * tenant's row. Returns { id, title, status, priority } of the updated row.
 */
export async function updateTicket(prisma, { id, title, priority, tenantId } = {}) {
  const ticketId = normalizeTicketId(id);
  const updates = {};
  if (title !== undefined && title !== null) updates.title = normalizeTitle(title);
  if (priority !== undefined && priority !== null) updates.priority = normalizePriority(priority);
  if (Object.keys(updates).length === 0) {
    throw new Error("cyraops-crm: provide title and/or priority to update");
  }
  const where = tenantId ? { id: ticketId, ...taskTenantWhere(tenantId) } : { id: ticketId };
  const result = await prisma.task.updateMany({ where, data: updates });
  if (typeof result?.count !== "number" || result.count !== 1) {
    throw new Error(`cyraops-crm: ticket ${ticketId} not found in this workspace`);
  }
  const row = await prisma.task.findUnique({
    where: { id: ticketId },
    select: { id: true, title: true, status: true, priority: true },
  });
  if (!row) throw new Error(`cyraops-crm: ticket ${ticketId} not found in this workspace`);
  return { id: row.id, title: row.title, status: row.status, priority: row.priority };
}

/** Live ticket update (per-call PrismaClient, always disconnected). */
export function queryUpdateTicket(args = {}) {
  return withPrismaClient((prisma) => updateTicket(prisma, { ...args, tenantId: readTenantId() }));
}
