import { NextRequest } from "next/server";
import { z } from "zod";
import { sameOrigin, userFromRequest } from "@/lib/auth";
import { db } from "@/lib/db";
import { effectivePermissionMode } from "@/lib/permissions/mode";
import { jsonError } from "@/lib/validators";

/**
 * The unified Permission Manager settings API (CYRAOPS_PERMISSION_AUDIT.md §8).
 *
 * GET  — the workspace mode plus every active agent's override and its
 *        effective mode (agent override ?? workspace ?? CONTROLLED).
 * POST — change the workspace mode and/or one agent's override. Server-side
 *        enforcement only; the UI card that renders these values is a later
 *        round. Owner/Admin gated like the existing approvals route, and
 *        same-origin guarded like the other mutating workspace routes.
 */

const permissionModeSchema = z.enum(["READ_ONLY", "CONTROLLED", "FULL_CONTROL", "SYSTEM"]);

const patchSchema = z
  .object({
    workspaceMode: permissionModeSchema.optional(),
    agentId: z.string().min(1).max(100).optional(),
    /** null clears the override so the agent inherits the workspace mode. */
    agentMode: permissionModeSchema.nullable().optional(),
  })
  .refine((data) => data.workspaceMode !== undefined || data.agentMode !== undefined, {
    message: "workspaceMode or agentMode must be provided",
  })
  .refine((data) => (data.agentId === undefined) === (data.agentMode === undefined), {
    message: "agentId and agentMode must be provided together",
  });

export async function GET(request: NextRequest) {
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);
  if (user.role === "MEMBER") return jsonError("Only Owners and Admins can view permission modes", 403);

  const [workspace, agents] = await Promise.all([
    db.workspace.findUnique({
      where: { id: "main" },
      select: { id: true, name: true, permissionMode: true },
    }),
    db.aiAgent.findMany({
      where: { status: "ACTIVE" },
      select: { id: true, slug: true, name: true, permissionMode: true },
      orderBy: { name: "asc" },
    }),
  ]);

  if (!workspace) return jsonError("Workspace not found", 404);

  const workspaceMode = workspace.permissionMode;
  return Response.json({
    workspace: { id: workspace.id, name: workspace.name, mode: workspaceMode },
    agents: agents.map((agent) => ({
      id: agent.id,
      slug: agent.slug,
      name: agent.name,
      mode: agent.permissionMode, // null = inherit the workspace mode
      effective: effectivePermissionMode(agent.permissionMode, workspaceMode),
    })),
  });
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return jsonError("Invalid request origin", 403);
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);
  if (user.role === "MEMBER") return jsonError("Only Owners and Admins can change permission modes", 403);

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return jsonError(
      "Invalid permission mode data: " + parsed.error.issues.map((issue) => issue.message).join(", "),
      400
    );
  }
  const { workspaceMode, agentId, agentMode } = parsed.data;

  if (workspaceMode !== undefined) {
    const updated = await db.workspace.updateMany({
      where: { id: "main" },
      data: { permissionMode: workspaceMode },
    });
    if (updated.count === 0) return jsonError("Workspace not found", 404);
  }

  if (agentId !== undefined && agentMode !== undefined) {
    const agent = await db.aiAgent.findUnique({ where: { id: agentId }, select: { id: true } });
    if (!agent) return jsonError("Agent not found", 404);
    await db.aiAgent.update({ where: { id: agentId }, data: { permissionMode: agentMode } });
  }

  // The POST response is the same shape as GET: the new state plus every
  // agent's effective mode, so the caller can re-render the settings card.
  return GET(request);
}
