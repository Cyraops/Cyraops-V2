import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { logActivity, sameOrigin, userFromRequest } from "@/lib/auth";
import { emailSchema, jsonError } from "@/lib/validators";

const workspaceSelect = {
  id: true,
  name: true,
  tagline: true,
  description: true,
  industry: true,
  phone: true,
  website: true,
  address: true,
  timezone: true,
  logoUrl: true,
  socialLinks: true,
  registrationDetails: true,
  loginEmail: true,
  createdAt: true,
  updatedAt: true,
};

const workspacePatchSchema = z
  .object({
    name: z.string().trim().min(2).max(100).optional(),
    loginEmail: emailSchema.optional(),
    tagline: z.string().trim().max(255).optional().nullable(),
    description: z.string().trim().max(5000).optional().nullable(),
    industry: z.string().trim().max(100).optional().nullable(),
    phone: z.string().trim().max(50).optional().nullable(),
    website: z.string().trim().max(255).optional().nullable(),
    address: z.string().trim().max(1000).optional().nullable(),
    timezone: z.string().trim().max(50).optional().nullable(),
    logoUrl: z.string().trim().max(1000).optional().nullable(),
    socialLinks: z.union([z.string(), z.record(z.string(), z.any())]).optional().nullable(),
    registrationDetails: z.string().trim().max(2000).optional().nullable(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided for update",
  });

export async function GET(request: NextRequest) {
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);

  const workspace = await db.workspace.findUnique({
    where: { id: "main" },
    select: workspaceSelect,
  });

  if (!workspace) return jsonError("Workspace not found", 404);

  // Sensitive information privacy: registrationDetails is strictly OWNER-only
  const sanitized = {
    ...workspace,
    registrationDetails: user.role === "OWNER" ? workspace.registrationDetails : null,
  };

  return Response.json({ workspace: sanitized });
}

export async function PATCH(request: NextRequest) {
  if (!sameOrigin(request)) return jsonError("Invalid request origin", 403);
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);
  if (user.role !== "OWNER") return jsonError("Only the owner can update workspace settings", 403);

  const body = await request.json().catch(() => null);
  const parsed = workspacePatchSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError("Invalid workspace data: " + parsed.error.issues.map((i) => i.message).join(", "), 400);
  }

  const updateData: Record<string, any> = { ...parsed.data };
  if (updateData.socialLinks && typeof updateData.socialLinks !== "string") {
    updateData.socialLinks = JSON.stringify(updateData.socialLinks);
  }

  const workspace = await db.workspace.update({
    where: { id: "main" },
    data: updateData,
    select: workspaceSelect,
  });

  await logActivity({
    action: "updated",
    entity: "workspace",
    summary: "updated workspace profile and settings",
    userId: user.id,
  });

  return Response.json({ workspace });
}
