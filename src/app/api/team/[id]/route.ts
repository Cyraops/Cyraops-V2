import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { sameOrigin, userFromRequest } from "@/lib/auth";
import { jsonError } from "@/lib/validators";
import { canManageMember } from "@/lib/permissions";
import { disconnectUserSockets } from "@/lib/realtime";
import { ejectUserFromActiveCalls } from "@/lib/calling/state-machine";
import { triggerImmediateSfuEjection } from "@/lib/calling/outbox";

type Context = { params: Promise<{ id: string }> };
export async function PATCH(request: NextRequest, context: Context) {
  if (!sameOrigin(request)) return jsonError("Invalid request origin", 403);
  const actor = await userFromRequest(request);
  if (!actor) return jsonError("Unauthorized", 401);
  if (actor.role === "MEMBER") return jsonError("Only an owner or admin can manage teammates", 403);
  const { id } = await context.params;
  const target = await db.user.findUnique({ where: { id } });
  if (!target || target.role === "OWNER") return jsonError("Teammate not found", 404);
  const parsed = z.object({ role: z.enum(["ADMIN", "MEMBER"]).optional(), disabled: z.boolean().optional() }).safeParse(await request.json().catch(() => null));
  if (!parsed.success || !canManageMember(actor.role, target.role, parsed.data?.role)) return jsonError("You do not have permission to assign that role", 403);
  const updated = await db.user.update({ where: { id }, data: { ...(parsed.data.role ? { role: parsed.data.role } : {}), ...(parsed.data.disabled !== undefined ? { disabledAt: parsed.data.disabled ? new Date() : null } : {}) }, select: { id: true, name: true, role: true, disabledAt: true } });
  if (parsed.data.disabled !== undefined) {
    await db.session.deleteMany({ where: { userId: id } });
    if (parsed.data.disabled) {
      await db.passwordSetupToken.deleteMany({ where: { userId: id, usedAt: null } });
      disconnectUserSockets(id);
      const ejection = await ejectUserFromActiveCalls(db, id, actor.id);
      if (ejection.queuedJobIds && ejection.queuedJobIds.length > 0) {
        await triggerImmediateSfuEjection(ejection.queuedJobIds);
      }
    }
  }
  return Response.json({ user: updated });
}
