import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { logActivity, publicUserSelect, sameOrigin, userFromRequest } from "@/lib/auth";
import { jsonError } from "@/lib/validators";
import { LeadStatus } from "@prisma/client";

const leadStatusSchema = z.enum(["NEW", "CONTACTED", "QUALIFIED", "UNQUALIFIED", "CONVERTED"]);

const updateLeadSchema = z.object({
  title: z.string().trim().min(2).max(180).optional(),
  companyName: z.string().trim().max(180).optional().nullable(),
  companyId: z.string().trim().optional().nullable(),
  contactId: z.string().trim().optional().nullable(),
  email: z.string().trim().email().max(254).optional().nullable().or(z.literal("")),
  phone: z.string().trim().max(40).optional().nullable(),
  status: leadStatusSchema.optional(),
  score: z.number().int().min(0).max(100).optional(),
  source: z.string().trim().max(80).optional().nullable(),
  estimatedValue: z.number().nonnegative().optional().nullable(),
  assignedToId: z.string().trim().optional().nullable(),
  notes: z.string().max(10000).optional(),
  archive: z.boolean().optional(),
  unarchive: z.boolean().optional(),
});

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);

  const { id } = await params;
  const lead = await db.lead.findUnique({
    where: { id },
    include: {
      assignedTo: { select: publicUserSelect },
      company: { select: { id: true, name: true, domain: true, industry: true, website: true, phone: true } },
      contact: { select: { id: true, firstName: true, lastName: true, email: true, phone: true, title: true } },
    },
  });

  if (!lead) return jsonError("Lead not found", 404);
  // Reading is open to the whole team, matching the list endpoint: a lead you can
  // see in the pipeline must be a lead you can open. Editing and reassigning stay
  // scoped to the assignee, enforced in PATCH below.

  // Fetch activity history
  const activities = await db.activity.findMany({
    where: { entity: "lead", entityId: id },
    include: { user: { select: publicUserSelect } },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return Response.json({ lead, activities });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!sameOrigin(request)) return jsonError("Invalid request origin", 403);
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);

  const { id } = await params;
  const existing = await db.lead.findUnique({ where: { id } });
  if (!existing) return jsonError("Lead not found", 404);

  // Teammate boundary: a MEMBER may not rewrite a lead assigned to a teammate.
  if (user.role === "MEMBER" && existing.assignedToId && existing.assignedToId !== user.id) {
    return jsonError("Members cannot modify leads assigned to other team members", 403);
  }

  const body = await request.json().catch(() => null);
  const parsed = updateLeadSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(parsed.error.issues[0]?.message ?? "Invalid update payload", 400);
  }

  const data = parsed.data;

  // Handle archive/unarchive permissions
  if ((data.archive || data.unarchive) && user.role === "MEMBER") {
    return jsonError("Only an owner or admin can archive or unarchive leads", 403);
  }

  // Handle reassignment permissions
  if (data.assignedToId !== undefined && data.assignedToId !== existing.assignedToId) {
    if (user.role === "MEMBER" && data.assignedToId !== user.id) {
      return jsonError("Members cannot reassign leads to other users", 403);
    }
  }

  // Duplicate checks if email or phone is updated
  const normalizedEmail = data.email !== undefined
    ? (data.email && data.email.length > 0 ? data.email.toLowerCase() : null)
    : undefined;

  if (normalizedEmail && normalizedEmail !== existing.email) {
    const dup = await db.lead.findFirst({
      where: {
        email: { equals: normalizedEmail, mode: "insensitive" },
        archivedAt: null,
        id: { not: id },
      },
      select: { id: true, title: true },
    });
    if (dup) return jsonError(`Another lead with email "${normalizedEmail}" already exists ("${dup.title}").`, 409);
  }

  const updateData: any = {};
  if (data.title !== undefined) updateData.title = data.title;
  if (data.companyName !== undefined) updateData.companyName = data.companyName;
  if (data.companyId !== undefined) updateData.companyId = data.companyId || null;
  if (data.contactId !== undefined) updateData.contactId = data.contactId || null;
  if (normalizedEmail !== undefined) updateData.email = normalizedEmail;
  if (data.phone !== undefined) updateData.phone = data.phone;
  if (data.status !== undefined) updateData.status = data.status;
  if (data.score !== undefined) updateData.score = data.score;
  if (data.source !== undefined) updateData.source = data.source;
  if (data.estimatedValue !== undefined) updateData.estimatedValue = data.estimatedValue;
  if (data.assignedToId !== undefined) updateData.assignedToId = data.assignedToId || null;
  if (data.notes !== undefined) updateData.notes = data.notes;
  if (data.archive) updateData.archivedAt = new Date();
  if (data.unarchive) updateData.archivedAt = null;

  const updated = await db.lead.update({
    where: { id },
    data: updateData,
    include: {
      assignedTo: { select: publicUserSelect },
      company: { select: { id: true, name: true } },
      contact: { select: { id: true, firstName: true, lastName: true, email: true } },
    },
  });

  const summary = data.archive
    ? `archived lead "${updated.title}"`
    : data.unarchive
    ? `restored lead "${updated.title}"`
    : data.status && data.status !== existing.status
    ? `changed status of lead "${updated.title}" from ${existing.status} to ${data.status}`
    : `updated lead "${updated.title}"`;

  await logActivity({
    action: data.archive ? "archived" : data.unarchive ? "restored" : "updated",
    entity: "lead",
    entityId: updated.id,
    summary,
    userId: user.id,
  });

  return Response.json({ lead: updated });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!sameOrigin(request)) return jsonError("Invalid request origin", 403);
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);
  if (user.role === "MEMBER") return jsonError("Only an owner or admin can archive leads", 403);

  const { id } = await params;
  const existing = await db.lead.findUnique({ where: { id } });
  if (!existing) return jsonError("Lead not found", 404);

  // Soft archive
  const lead = await db.lead.update({
    where: { id },
    data: { archivedAt: new Date() },
  });

  await logActivity({
    action: "archived",
    entity: "lead",
    entityId: id,
    summary: `archived lead "${lead.title}"`,
    userId: user.id,
  });

  return Response.json({ lead, message: "Lead archived successfully" });
}
