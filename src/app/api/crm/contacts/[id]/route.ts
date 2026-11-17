import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { logActivity, publicUserSelect, sameOrigin, userFromRequest } from "@/lib/auth";
import { jsonError } from "@/lib/validators";
import { ContactStatus } from "@prisma/client";

const contactStatusSchema = z.enum(["LEAD", "CUSTOMER", "PARTNER", "INACTIVE"]);

const updateContactSchema = z.object({
  firstName: z.string().trim().min(1).max(60).optional(),
  lastName: z.string().trim().min(1).max(60).optional(),
  email: z.string().trim().email().max(254).optional().nullable().or(z.literal("")),
  phone: z.string().trim().max(40).optional().nullable(),
  title: z.string().trim().max(100).optional().nullable(),
  status: contactStatusSchema.optional(),
  companyId: z.string().trim().optional().nullable(),
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
  const contact = await db.contact.findUnique({
    where: { id },
    include: {
      company: true,
      deals: {
        where: { archivedAt: null },
        include: { owner: { select: publicUserSelect } },
        orderBy: { createdAt: "desc" },
      },
      leads: {
        where: { archivedAt: null },
        include: { assignedTo: { select: publicUserSelect } },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!contact) return jsonError("Contact not found", 404);

  const activities = await db.activity.findMany({
    where: { entity: "contact", entityId: id },
    include: { user: { select: publicUserSelect } },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return Response.json({ contact, activities });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!sameOrigin(request)) return jsonError("Invalid request origin", 403);
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);

  const { id } = await params;
  const existing = await db.contact.findUnique({ where: { id } });
  if (!existing) return jsonError("Contact not found", 404);

  const body = await request.json().catch(() => null);
  const parsed = updateContactSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(parsed.error.issues[0]?.message ?? "Invalid update payload", 400);
  }

  const data = parsed.data;

  if ((data.archive || data.unarchive) && user.role === "MEMBER") {
    return jsonError("Only an owner or admin can archive or unarchive contacts", 403);
  }

  // Duplicate checks if email is changing
  const normalizedEmail = data.email !== undefined
    ? (data.email && data.email.length > 0 ? data.email.toLowerCase() : null)
    : undefined;

  if (normalizedEmail && normalizedEmail !== existing.email) {
    const dup = await db.contact.findFirst({
      where: {
        email: { equals: normalizedEmail, mode: "insensitive" },
        archivedAt: null,
        id: { not: id },
      },
      select: { id: true, firstName: true, lastName: true },
    });
    if (dup) return jsonError(`Another contact with email "${normalizedEmail}" already exists ("${dup.firstName} ${dup.lastName}").`, 409);
  }

  // Validate company if provided
  if (data.companyId) {
    const company = await db.company.findUnique({ where: { id: data.companyId }, select: { id: true } });
    if (!company) return jsonError("Selected company was not found", 404);
  }

  const updateData: any = {};
  if (data.firstName !== undefined) updateData.firstName = data.firstName;
  if (data.lastName !== undefined) updateData.lastName = data.lastName;
  if (normalizedEmail !== undefined) updateData.email = normalizedEmail;
  if (data.phone !== undefined) updateData.phone = data.phone;
  if (data.title !== undefined) updateData.title = data.title;
  if (data.status !== undefined) updateData.status = data.status;
  if (data.companyId !== undefined) updateData.companyId = data.companyId || null;
  if (data.notes !== undefined) updateData.notes = data.notes;
  if (data.archive) updateData.archivedAt = new Date();
  if (data.unarchive) updateData.archivedAt = null;

  const updated = await db.contact.update({
    where: { id },
    data: updateData,
    include: { company: { select: { id: true, name: true } } },
  });

  const summary = data.archive
    ? `archived contact "${updated.firstName} ${updated.lastName}"`
    : data.unarchive
    ? `restored contact "${updated.firstName} ${updated.lastName}"`
    : `updated contact "${updated.firstName} ${updated.lastName}"`;

  await logActivity({
    action: data.archive ? "archived" : data.unarchive ? "restored" : "updated",
    entity: "contact",
    entityId: updated.id,
    summary,
    userId: user.id,
  });

  return Response.json({ contact: updated });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!sameOrigin(request)) return jsonError("Invalid request origin", 403);
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);
  if (user.role === "MEMBER") return jsonError("Only an owner or admin can archive contacts", 403);

  const { id } = await params;
  const existing = await db.contact.findUnique({ where: { id } });
  if (!existing) return jsonError("Contact not found", 404);

  const contact = await db.contact.update({
    where: { id },
    data: { archivedAt: new Date() },
  });

  await logActivity({
    action: "archived",
    entity: "contact",
    entityId: id,
    summary: `archived contact "${contact.firstName} ${contact.lastName}"`,
    userId: user.id,
  });

  return Response.json({ contact, message: "Contact archived successfully" });
}
