import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { logActivity, publicUserSelect, sameOrigin, userFromRequest } from "@/lib/auth";
import { jsonError } from "@/lib/validators";
import { ContactStatus } from "@prisma/client";

const contactStatusSchema = z.enum(["LEAD", "CUSTOMER", "PARTNER", "INACTIVE"]);

const createContactSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required").max(60),
  lastName: z.string().trim().min(1, "Last name is required").max(60),
  email: z.string().trim().email("Invalid email address").max(254).optional().nullable().or(z.literal("")),
  phone: z.string().trim().max(40).optional().nullable(),
  title: z.string().trim().max(100).optional().nullable(),
  status: contactStatusSchema.optional().default("LEAD"),
  companyId: z.string().trim().optional().nullable(),
  notes: z.string().max(10000).optional().default(""),
});

export async function GET(request: NextRequest) {
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);

  const searchParams = request.nextUrl.searchParams;
  const q = searchParams.get("q")?.trim() ?? "";
  const companyId = searchParams.get("companyId")?.trim();
  const status = searchParams.get("status")?.trim();
  const includeArchived = searchParams.get("includeArchived") === "true";
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") ?? "20", 10) || 20));
  const skip = (page - 1) * limit;

  const where: any = {};
  if (!includeArchived) {
    where.archivedAt = null;
  }
  if (companyId) {
    where.companyId = companyId;
  }
  if (status && Object.values(ContactStatus).includes(status as any)) {
    where.status = status;
  }
  if (q) {
    where.OR = [
      { firstName: { contains: q, mode: "insensitive" } },
      { lastName: { contains: q, mode: "insensitive" } },
      { email: { contains: q, mode: "insensitive" } },
      { phone: { contains: q, mode: "insensitive" } },
      { title: { contains: q, mode: "insensitive" } },
      { company: { name: { contains: q, mode: "insensitive" } } },
    ];
  }

  const [total, contacts] = await Promise.all([
    db.contact.count({ where }),
    db.contact.findMany({
      where,
      include: {
        company: { select: { id: true, name: true, domain: true } },
        _count: { select: { deals: true, leads: true } },
      },
      orderBy: [{ createdAt: "desc" }],
      skip,
      take: limit,
    }),
  ]);

  return Response.json({
    contacts,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit) || 1,
  });
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return jsonError("Invalid request origin", 403);
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);

  const body = await request.json().catch(() => null);
  const parsed = createContactSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(parsed.error.issues[0]?.message ?? "Invalid contact payload", 400);
  }

  const data = parsed.data;
  const normalizedEmail = data.email && data.email.length > 0 ? data.email.toLowerCase() : null;
  const normalizedPhone = data.phone ? data.phone.trim() : null;

  // Duplicate check for active contacts
  if (normalizedEmail) {
    const existing = await db.contact.findFirst({
      where: { email: { equals: normalizedEmail, mode: "insensitive" }, archivedAt: null },
      select: { id: true, firstName: true, lastName: true },
    });
    if (existing) {
      return jsonError(`An active contact with email "${normalizedEmail}" already exists ("${existing.firstName} ${existing.lastName}").`, 409);
    }
  }

  if (normalizedPhone) {
    const existing = await db.contact.findFirst({
      where: { phone: { equals: normalizedPhone }, archivedAt: null },
      select: { id: true, firstName: true, lastName: true },
    });
    if (existing) {
      return jsonError(`An active contact with phone "${normalizedPhone}" already exists ("${existing.firstName} ${existing.lastName}").`, 409);
    }
  }

  // Validate company if provided
  if (data.companyId) {
    const company = await db.company.findUnique({
      where: { id: data.companyId },
      select: { id: true },
    });
    if (!company) return jsonError("Selected company was not found", 404);
  }

  try {
    const contact = await db.contact.create({
      data: {
        firstName: data.firstName,
        lastName: data.lastName,
        email: normalizedEmail,
        phone: normalizedPhone,
        title: data.title || null,
        status: data.status,
        companyId: data.companyId || null,
        notes: data.notes,
      },
      include: {
        company: { select: { id: true, name: true } },
      },
    });

    await logActivity({
      action: "created",
      entity: "contact",
      entityId: contact.id,
      summary: `created contact "${contact.firstName} ${contact.lastName}"`,
      userId: user.id,
    });

    return Response.json({ contact }, { status: 201 });
  } catch (error: any) {
    if (error?.code === "P2002") {
      return jsonError(`An active contact with email "${normalizedEmail}" already exists.`, 409);
    }
    console.error("[CRM] Failed to create contact:", error);
    return jsonError("Failed to create contact", 500);
  }
}
