import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { sameOrigin, userFromRequest } from "@/lib/auth";
import { jsonError } from "@/lib/validators";
import { listTaskAssignees } from "@/lib/tasks/assignees";
import { createTicketFromInstruction, parseTicketInstruction, loadTicketPersonas } from "@/lib/tickets";

/**
 * Tickets.
 *
 * GET  — the tickets a person should see, newest first, from every project.
 * POST — turn one sentence into a ticket: `@tasks call Northwind back @akshat`.
 *
 * Both exist so the bot can show a Tasks list on the left and create a ticket
 * without ever leaving the conversation.
 */

const createSchema = z.object({
  text: z.string().trim().min(1).max(12_000),
  kind: z.enum(["BUG", "SERVICE", "CATEGORY"]).optional(),
});

export async function GET(request: NextRequest) {
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);

  const limit = Math.min(60, Math.max(1, Number(new URL(request.url).searchParams.get("limit") ?? 25)));

  const tasks = await db.task.findMany({
    where: { archivedAt: null },
    select: {
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
      project: { select: { id: true, name: true } },
      creator: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  const ownerMap = await listTaskAssignees(tasks.map((task) => task.id));
  return Response.json({
    tickets: tasks.map((task) => ({ ...task, assignees: ownerMap.get(task.id) ?? [] })),
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
