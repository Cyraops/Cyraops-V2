import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { logActivity, publicUserSelect, sameOrigin, userFromRequest } from "@/lib/auth";
import { jsonError } from "@/lib/validators";

const updateCompanySchema = z.object({
  name: z.string().trim().min(2).max(180).optional(),
  domain: z.string().trim().max(180).optional().nullable(),
  industry: z.string().trim().max(100).optional().nullable(),
  size: z.string().trim().max(50).optional().nullable(),
  website: z.string().trim().max(255).optional().nullable(),
  phone: z.string().trim().max(40).optional().nullable(),
  address: z.string().trim().max(500).optional().nullable(),
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
  const company = await db.company.findUnique({
    where: { id },
    include: {
      contacts: {
        where: { archivedAt: null },
        orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      },
      deals: {
        where: { archivedAt: null },
        include: {
          owner: { select: publicUserSelect },
          contact: { select: { id: true, firstName: true, lastName: true } },
        },
        orderBy: { createdAt: "desc" },
      },
      leads: {
        where: { archivedAt: null },
        include: { assignedTo: { select: publicUserSelect } },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!company) return jsonError("Company not found", 404);

  const activities = await db.activity.findMany({
    where: { entity: "company", entityId: id },
    include: { user: { select: publicUserSelect } },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return Response.json({ company, activities });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!sameOrigin(request)) return jsonError("Invalid request origin", 403);
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);

  const { id } = await params;
  const existing = await db.company.findUnique({ where: { id } });
  if (!existing) return jsonError("Company not found", 404);

  const body = await request.json().catch(() => null);
  const parsed = updateCompanySchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(parsed.error.issues[0]?.message ?? "Invalid update payload", 400);
  }

  const data = parsed.data;

  if ((data.archive || data.unarchive) && user.role === "MEMBER") {
    return jsonError("Only an owner or admin can archive or unarchive companies", 403);
  }

  // Duplicate name check if changing
  if (data.name && data.name.trim().toLowerCase() !== existing.name.toLowerCase()) {
    const dup = await db.company.findFirst({
      where: {
        name: { equals: data.name.trim(), mode: "insensitive" },
        archivedAt: null,
        id: { not: id },
      },
      select: { id: true, name: true },
    });
    if (dup) return jsonError(`Another company named "${dup.name}" already exists.`, 409);
  }

  const updateData: any = {};
  if (data.name !== undefined) updateData.name = data.name.trim();
  if (data.domain !== undefined) updateData.domain = data.domain ? data.domain.toLowerCase().trim() : null;
  if (data.industry !== undefined) updateData.industry = data.industry;
  if (data.size !== undefined) updateData.size = data.size;
  if (data.website !== undefined) updateData.website = data.website;
  if (data.phone !== undefined) updateData.phone = data.phone;
  if (data.address !== undefined) updateData.address = data.address;
  if (data.notes !== undefined) updateData.notes = data.notes;
  if (data.archive) updateData.archivedAt = new Date();
  if (data.unarchive) updateData.archivedAt = null;

  const updated = await db.company.update({
    where: { id },
    data: updateData,
  });

  const summary = data.archive
    ? `archived company "${updated.name}"`
    : data.unarchive
    ? `restored company "${updated.name}"`
    : `updated company "${updated.name}"`;

  await logActivity({
    action: data.archive ? "archived" : data.unarchive ? "restored" : "updated",
    entity: "company",
    entityId: updated.id,
    summary,
    userId: user.id,
  });

  return Response.json({ company: updated });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!sameOrigin(request)) return jsonError("Invalid request origin", 403);
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);
  if (user.role === "MEMBER") return jsonError("Only an owner or admin can archive companies", 403);

  const { id } = await params;
  const existing = await db.company.findUnique({ where: { id } });
  if (!existing) return jsonError("Company not found", 404);

  const company = await db.company.update({
    where: { id },
    data: { archivedAt: new Date() },
  });

  await logActivity({
    action: "archived",
    entity: "company",
    entityId: id,
    summary: `archived company "${company.name}"`,
    userId: user.id,
  });

  return Response.json({ company, message: "Company archived successfully" });
}
