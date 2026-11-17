import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { logActivity, publicUserSelect, sameOrigin, userFromRequest } from "@/lib/auth";
import { jsonError } from "@/lib/validators";
import { LeadStatus } from "@prisma/client";

const leadStatusSchema = z.enum(["NEW", "CONTACTED", "QUALIFIED", "UNQUALIFIED", "CONVERTED"]);

const createLeadSchema = z.object({
  title: z.string().trim().min(2, "Lead title or name must be at least 2 characters").max(180),
  companyName: z.string().trim().max(180).optional().nullable(),
  companyId: z.string().trim().optional().nullable(),
  contactId: z.string().trim().optional().nullable(),
  email: z.string().trim().email("Invalid email address").max(254).optional().nullable().or(z.literal("")),
  phone: z.string().trim().max(40).optional().nullable(),
  status: leadStatusSchema.optional().default("NEW"),
  score: z.number().int().min(0).max(100).optional().default(0),
  source: z.string().trim().max(80).optional().nullable(),
  estimatedValue: z.number().nonnegative("Estimated value cannot be negative").optional().nullable(),
  assignedToId: z.string().trim().optional().nullable(),
  notes: z.string().max(10000).optional().default(""),
});

export async function GET(request: NextRequest) {
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);

  const searchParams = request.nextUrl.searchParams;
  const q = searchParams.get("q")?.trim() ?? "";
  const status = searchParams.get("status")?.trim();
  const assignedToId = searchParams.get("assignedToId")?.trim();
  const companyId = searchParams.get("companyId")?.trim();
  const source = searchParams.get("source")?.trim();
  const includeArchived = searchParams.get("includeArchived") === "true";
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") ?? "20", 10) || 20));
  const skip = (page - 1) * limit;

  const where: any = {};
  if (!includeArchived) {
    where.archivedAt = null;
  }
  // The pipeline is shared: everyone on the team sees every lead, because a
  // sales process where each person can only see their own records is not a
  // pipeline, it is four private notebooks. Writes remain scoped — a MEMBER can
  // only create or edit leads assigned to themselves (enforced below and in
  // /api/crm/leads/[id]) — so visibility widened without handing out authority.
  if (assignedToId) where.assignedToId = assignedToId;
  if (status && Object.values(LeadStatus).includes(status as any)) {
    where.status = status;
  }
  if (companyId) {
    where.companyId = companyId;
  }
  if (source) {
    where.source = { equals: source, mode: "insensitive" };
  }
  if (q) {
    where.OR = [
      { title: { contains: q, mode: "insensitive" } },
      { companyName: { contains: q, mode: "insensitive" } },
      { email: { contains: q, mode: "insensitive" } },
      { phone: { contains: q, mode: "insensitive" } },
      { notes: { contains: q, mode: "insensitive" } },
    ];
  }

  const [total, leads] = await Promise.all([
    db.lead.count({ where }),
    db.lead.findMany({
      where,
      include: {
        assignedTo: { select: publicUserSelect },
        company: { select: { id: true, name: true, domain: true } },
        contact: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
      },
      orderBy: [{ createdAt: "desc" }],
      skip,
      take: limit,
    }),
  ]);

  return Response.json({
    leads,
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
  const parsed = createLeadSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(parsed.error.issues[0]?.message ?? "Invalid lead payload", 400);
  }

  const data = parsed.data;
  const normalizedEmail = data.email && data.email.length > 0 ? data.email.toLowerCase() : null;
  const normalizedPhone = data.phone ? data.phone.trim() : null;

  // Duplicate prevention: check email and phone on active leads
  if (normalizedEmail) {
    const existing = await db.lead.findFirst({
      where: { email: { equals: normalizedEmail, mode: "insensitive" }, archivedAt: null },
      select: { id: true, title: true },
    });
    if (existing) {
      return jsonError(`An active lead with email "${normalizedEmail}" already exists ("${existing.title}").`, 409);
    }
  }

  if (normalizedPhone) {
    const existing = await db.lead.findFirst({
      where: { phone: { equals: normalizedPhone }, archivedAt: null },
      select: { id: true, title: true },
    });
    if (existing) {
      return jsonError(`An active lead with phone "${normalizedPhone}" already exists ("${existing.title}").`, 409);
    }
  }

  // Validate company if provided
  let companyName = data.companyName ?? null;
  if (data.companyId) {
    const company = await db.company.findUnique({
      where: { id: data.companyId },
      select: { id: true, name: true },
    });
    if (!company) return jsonError("Selected company was not found", 404);
    if (!companyName) companyName = company.name;
  }

  // Validate contact if provided
  if (data.contactId) {
    const contact = await db.contact.findUnique({
      where: { id: data.contactId },
      select: { id: true },
    });
    if (!contact) return jsonError("Selected contact was not found", 404);
  }

  // Validate assigned user if provided; non-admin members cannot assign other users
  let assignedToId = data.assignedToId ?? user.id;
  if (assignedToId && assignedToId !== user.id && user.role === "MEMBER") {
    return jsonError("Members can only assign leads to themselves", 403);
  }
  if (assignedToId) {
    const assignee = await db.user.findFirst({
      where: { id: assignedToId, disabledAt: null },
      select: { id: true },
    });
    if (!assignee) return jsonError("Assigned team member was not found", 404);
  }

  try {
    const lead = await db.lead.create({
      data: {
        title: data.title,
        companyName,
        companyId: data.companyId || null,
        contactId: data.contactId || null,
        email: normalizedEmail,
        phone: normalizedPhone,
        status: data.status,
        score: data.score,
        source: data.source || null,
        estimatedValue: data.estimatedValue ?? null,
        assignedToId: assignedToId || null,
        notes: data.notes,
      },
      include: {
        assignedTo: { select: publicUserSelect },
        company: { select: { id: true, name: true } },
        contact: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });

    await logActivity({
      action: "created",
      entity: "lead",
      entityId: lead.id,
      summary: `created lead "${lead.title}" with status ${lead.status}`,
      userId: user.id,
    });

    return Response.json({ lead }, { status: 201 });
  } catch (error: any) {
    if (error?.code === "P2002") {
      return jsonError(`An active lead with email "${normalizedEmail}" already exists.`, 409);
    }
    console.error("[CRM] Failed to create lead:", error);
    return jsonError("Failed to create lead", 500);
  }
}
