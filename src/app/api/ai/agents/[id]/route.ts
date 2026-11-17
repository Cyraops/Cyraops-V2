import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { logActivity, sameOrigin, userFromRequest } from "@/lib/auth";
import { jsonError } from "@/lib/validators";
import { toolRegistry } from "@/lib/ai/tools/registry";
import "../../../../../lib/ai/tools/crm-tools";

/**
 * Editing and retiring a bot.
 *
 * A template is a starting point, not a record you own: it is the same for
 * everybody, so it cannot be renamed or deleted — only cloned. A bot created
 * from one is yours.
 */

type Context = { params: Promise<{ id: string }> };

const updateSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  role: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(300).optional(),
  systemPrompt: z.string().trim().min(1).max(8000).optional(),
  tools: z.array(z.string()).max(60).optional(),
  status: z.enum(["ACTIVE", "PAUSED"]).optional(),
});

/** Tool ids must exist, or the bot silently loses the ability to act. */
function unknownTools(ids: string[]) {
  return ids.filter((id) => !toolRegistry.getTool(id));
}

export async function PATCH(request: NextRequest, context: Context) {
  if (!sameOrigin(request)) return jsonError("Invalid request origin", 403);
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);
  if (user.role === "MEMBER") return jsonError("Only Owners and Admins can edit bots", 403);
  const { id } = await context.params;

  const agent = await db.aiAgent.findUnique({ where: { id }, select: { id: true, slug: true, isTemplate: true, name: true } });
  if (!agent) return jsonError("Bot not found", 404);
  if (agent.isTemplate) return jsonError("That is a template. Clone it first, then edit your copy.", 409);

  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Check the bot details", 400);
  const data = parsed.data;

  if (data.tools) {
    const missing = unknownTools(data.tools);
    if (missing.length) return jsonError(`These abilities do not exist: ${missing.join(", ")}`, 400);
  }

  const updated = await db.aiAgent.update({
    where: { id },
    data: {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.role !== undefined ? { role: data.role } : {}),
      ...(data.description !== undefined ? { description: data.description } : {}),
      ...(data.systemPrompt !== undefined ? { systemPrompt: data.systemPrompt } : {}),
      ...(data.tools !== undefined ? { tools: JSON.stringify(data.tools) } : {}),
      ...(data.status !== undefined ? { status: data.status } : {}),
    },
    select: { id: true, slug: true, name: true, role: true, description: true, systemPrompt: true, tools: true, status: true, isTemplate: true },
  });

  await logActivity({ action: "updated", entity: "task", entityId: agent.id, summary: `edited bot ${updated.name}`, userId: user.id });
  return Response.json({ agent: updated });
}

export async function DELETE(request: NextRequest, context: Context) {
  if (!sameOrigin(request)) return jsonError("Invalid request origin", 403);
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);
  if (user.role === "MEMBER") return jsonError("Only Owners and Admins can retire bots", 403);
  const { id } = await context.params;

  const agent = await db.aiAgent.findUnique({
    where: { id },
    select: { id: true, name: true, isTemplate: true, _count: { select: { routines: true, tasks: true } } },
  });
  if (!agent) return jsonError("Bot not found", 404);
  if (agent.isTemplate) return jsonError("That is a template and cannot be deleted.", 409);

  // A bot with history is paused, not deleted: its runs and tasks still matter.
  if (agent._count.routines > 0 || agent._count.tasks > 0) {
    const paused = await db.aiAgent.update({ where: { id }, data: { status: "PAUSED" }, select: { id: true, name: true, status: true } });
    return Response.json({
      agent: paused,
      retired: "paused",
      note: `It has ${agent._count.routines} routine${agent._count.routines === 1 ? "" : "s"} and ${agent._count.tasks} task${agent._count.tasks === 1 ? "" : "s"}, so it was paused rather than deleted to keep that history.`,
    });
  }

  await db.aiAgent.delete({ where: { id } });
  await logActivity({ action: "deleted", entity: "task", entityId: id, summary: `retired bot ${agent.name}`, userId: user.id });
  return Response.json({ deleted: true, name: agent.name });
}
