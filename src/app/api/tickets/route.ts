import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { sameOrigin, userFromRequest } from "@/lib/auth";
import { jsonError, prioritySchema, taskSourceSchema, taskStatusSchema, taskTypeSchema } from "@/lib/validators";
import { listTaskAssignees } from "@/lib/tasks/assignees";
import { createTicketFromInstruction, parseTicketInstruction, loadTicketPersonas } from "@/lib/tickets";
import { isTenantAdmin, memberTaskWhere } from "@/lib/tenants";
import type { Prisma } from "@prisma/client";

/**
 * Tickets.
 *
 * GET  — the tickets a person should see, newest first, from every project.
 *        Paginated server-side (?page/&pageSize, clamped) with the queue's
 *        filters (?status/&priority/&source/&type/&group/&assignee/&q) and an
 *        archived view (?archived=1). Returns `total` (matching rows), `open`
 *        (open tickets in the active queue) and `groups` (for the filter
 *        popover) alongside the page of rows.
 * POST — turn one sentence into a ticket: `@tasks call Northwind back @akshat`.
 *
 * Both exist so the bot can show a Tasks list on the left and create a ticket
 * without ever leaving the conversation.
 */

const createSchema = z.object({
  text: z.string().trim().min(1).max(12_000),
  kind: z.enum(["BUG", "SERVICE", "CATEGORY"]).optional(),
});

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

/** A query integer, clamped to [min, max]; anything unparseable gets the fallback. */
function clampInt(value: string | null, fallback: number, min: number, max: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

const TICKET_SELECT = {
  id: true,
  title: true,
  status: true,
  priority: true,
  kind: true,
  dueDate: true,
  createdAt: true,
  number: true,
  source: true,
  type: true,
  groupName: true,
  category: true,
  requesterName: true,
  requesterEmail: true,
  resolution: true,
  closedAt: true,
  updatedAt: true,
  archivedAt: true,
  project: { select: { id: true, name: true } },
  creator: { select: { id: true, name: true } },
} satisfies Prisma.TaskSelect;

export async function GET(request: NextRequest) {
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);

  const url = new URL(request.url);
  const page = clampInt(url.searchParams.get("page"), 1, 1, 100_000);
  // `limit` stays as a fallback so older callers keep working.
  const pageSize = clampInt(url.searchParams.get("pageSize") ?? url.searchParams.get("limit"), DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE);
  const archived = url.searchParams.get("archived") === "1" || url.searchParams.get("archived") === "true";
  const status = (url.searchParams.get("status") ?? "").trim();
  const priority = (url.searchParams.get("priority") ?? "").trim();
  const source = (url.searchParams.get("source") ?? "").trim();
  const type = (url.searchParams.get("type") ?? "").trim();
  const group = (url.searchParams.get("group") ?? "").trim();
  const assignee = (url.searchParams.get("assignee") ?? "").trim();
  const q = (url.searchParams.get("q") ?? "").trim();

  // Tenant scoping (FIX 3): previously every role got every task. OWNER/ADMIN
  // keep the app's admin-wide pattern; members are scoped to their workspace
  // (own rows + rows in projects they belong to), mirroring the calendar
  // route's member scoping. The archived view keeps the same scoping.
  const viewerWhere: Prisma.TaskWhereInput = isTenantAdmin(user.role)
    ? {}
    : { AND: [await memberTaskWhere(user.id)] };
  const where: Prisma.TaskWhereInput = {
    ...(archived ? { archivedAt: { not: null } } : { archivedAt: null }),
    ...viewerWhere,
  };

  // The status pills (open/all/closed) and the popover's explicit statuses.
  const parsedStatus = taskStatusSchema.safeParse(status);
  if (status === "open") where.status = { not: "DONE" };
  else if (status === "closed") where.status = "DONE";
  else if (parsedStatus.success) where.status = parsedStatus.data;

  const parsedPriority = prioritySchema.safeParse(priority);
  if (parsedPriority.success) where.priority = parsedPriority.data;

  const parsedSource = taskSourceSchema.safeParse(source);
  if (parsedSource.success) where.source = parsedSource.data;

  const parsedType = taskTypeSchema.safeParse(type);
  if (parsedType.success) where.type = parsedType.data;

  if (group) where.groupName = group;

  // "Unassigned" is a desk concept: no human in the owner set (agents-only
  // counts as unassigned, matching the queue's own definition).
  if (assignee === "unassigned") where.assignees = { none: { userId: { not: null } } };
  else if (assignee) where.assignees = { some: { userId: assignee } };

  // The same search the queue used to run client-side: subject, requester,
  // group and category, plus the ticket number when the query names one.
  if (q) {
    const clauses: Prisma.TaskWhereInput[] = [
      { title: { contains: q, mode: "insensitive" } },
      { requesterName: { contains: q, mode: "insensitive" } },
      { requesterEmail: { contains: q, mode: "insensitive" } },
      { groupName: { contains: q, mode: "insensitive" } },
      { category: { contains: q, mode: "insensitive" } },
    ];
    const numberMatch = q.match(/(?:^|\D)(\d+)(?:\D|$)/);
    if (numberMatch) clauses.push({ number: Number(numberMatch[1]) });
    const searchClause: Prisma.TaskWhereInput = { OR: clauses };
    if (Array.isArray(where.AND)) where.AND = [...where.AND, searchClause];
    else if (where.AND) where.AND = [where.AND, searchClause];
    else where.AND = [searchClause];
  }

  const [tasks, total, open, groupRows] = await Promise.all([
    db.task.findMany({
      where,
      select: TICKET_SELECT,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    db.task.count({ where }),
    // "open" is the active queue's headline number: non-closed, non-archived.
    db.task.count({ where: { archivedAt: null, status: { not: "DONE" }, ...viewerWhere } }),
    // Groups that actually exist in this view, so the filter never offers a dead option.
    db.task.findMany({
      where: { groupName: { not: null }, ...(archived ? { archivedAt: { not: null } } : { archivedAt: null }), ...viewerWhere },
      select: { groupName: true },
      distinct: ["groupName"],
      orderBy: { groupName: "asc" },
    }),
  ]);

  const ownerMap = await listTaskAssignees(tasks.map((task) => task.id));
  return Response.json({
    tickets: tasks.map((task) => ({ ...task, assignees: ownerMap.get(task.id) ?? [] })),
    total,
    open,
    page,
    pageSize,
    groups: groupRows.map((row) => row.groupName).filter((value): value is string => Boolean(value)),
  });
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return jsonError("Invalid request origin", 403);
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Send the instruction as text", 400);
  }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return jsonError("Send the instruction as text", 400);

  try {
    // A dry parse first, so a message with no trigger is answered clearly instead
    // of creating an empty ticket.
    const personas = await loadTicketPersonas();
    const dryRun = parseTicketInstruction(parsed.data.text, personas);
    if (!dryRun.isTicket) {
      return Response.json(
        { ok: false, reason: "no_trigger", message: "Start the message with @tasks to create a ticket." },
        { status: 200 }
      );
    }

    const result = await createTicketFromInstruction({
      text: parsed.data.text,
      actor: { id: user.id, name: user.name, role: user.role },
      kind: parsed.data.kind ?? null,
    });

    return Response.json({ ok: true, ...result }, { status: 201 });
  } catch (error: any) {
    console.error("[Tickets] Could not create ticket:", error);
    return jsonError(error?.message || "Could not create that ticket", 500);
  }
}
