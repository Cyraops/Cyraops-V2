import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { logActivity, publicUserSelect, sameOrigin, userFromRequest } from "@/lib/auth";
import { externalUrlSchema, jsonError } from "@/lib/validators";
import { DealStage } from "@prisma/client";

const dealStageSchema = z.enum(["DISCOVERY", "PROPOSAL", "NEGOTIATION", "CLOSED_WON", "CLOSED_LOST"]);

const defaultStageProbability: Record<DealStage, number> = {
  DISCOVERY: 20,
  PROPOSAL: 50,
  NEGOTIATION: 75,
  CLOSED_WON: 100,
  CLOSED_LOST: 0,
};

const createDealSchema = z.object({
  title: z.string().trim().min(2, "Deal title must be at least 2 characters").max(180),
  value: z.number().nonnegative("Value cannot be negative").optional().default(0),
  currency: z.literal("INR").default("INR"),
  stage: dealStageSchema.optional().default("DISCOVERY"),
  probability: z.number().int().min(0).max(100).optional(),
  expectedCloseDate: z.string().datetime().optional().nullable().or(z.literal("")),
  companyId: z.string().trim().optional().nullable(),
  contactId: z.string().trim().optional().nullable(),
  ownerId: z.string().trim().optional().nullable(),
  sourcePlatform: z.string().trim().max(50).optional().nullable(),
  externalUrl: externalUrlSchema,
  nextAction: z.string().trim().max(500).optional().nullable(),
  followUpDate: z.string().datetime().optional().nullable().or(z.literal("")),
  notes: z.string().max(10000).optional().default(""),
});

export async function GET(request: NextRequest) {
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);

  const searchParams = request.nextUrl.searchParams;
  const q = searchParams.get("q")?.trim() ?? "";
  const stage = searchParams.get("stage")?.trim();
  const ownerId = searchParams.get("ownerId")?.trim();
  const companyId = searchParams.get("companyId")?.trim();
  const sourcePlatform = searchParams.get("sourcePlatform")?.trim();
  const followUp = searchParams.get("followUp")?.trim();
  const includeArchived = searchParams.get("includeArchived") === "true";
  const view = searchParams.get("view"); // 'pipeline' or 'table'
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);
  const limit = view === "pipeline"
    ? 250 // for pipeline kanban, load up to 250 active deals
    : Math.min(100, Math.max(1, parseInt(searchParams.get("limit") ?? "20", 10) || 20));
  const skip = view === "pipeline" ? 0 : (page - 1) * limit;

  const where: any = {};
  if (!includeArchived) {
    where.archivedAt = null;
  }
  if (stage && Object.values(DealStage).includes(stage as any)) {
    where.stage = stage;
  }
  // Same rule as leads: the pipeline is visible to the whole team, while
  // creating, editing and moving deals stays scoped to the owner.
  if (ownerId) where.ownerId = ownerId;
  if (companyId) {
    where.companyId = companyId;
  }
  if (sourcePlatform && sourcePlatform !== "ALL") {
    where.sourcePlatform = sourcePlatform;
  }
  if (followUp === "today") {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);
    where.followUpDate = { gte: startOfDay, lte: endOfDay };
  } else if (followUp === "overdue") {
    where.followUpDate = { lte: new Date() };
  }
  if (q) {
    where.OR = [
      { title: { contains: q, mode: "insensitive" } },
      { company: { name: { contains: q, mode: "insensitive" } } },
      { contact: { firstName: { contains: q, mode: "insensitive" } } },
      { contact: { lastName: { contains: q, mode: "insensitive" } } },
      { notes: { contains: q, mode: "insensitive" } },
      { nextAction: { contains: q, mode: "insensitive" } },
    ];
  }

  const [total, deals] = await Promise.all([
    db.deal.count({ where }),
    db.deal.findMany({
      where,
      include: {
        company: { select: { id: true, name: true, domain: true } },
        contact: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
        owner: { select: publicUserSelect },
        convertedProject: { select: { id: true, name: true, status: true } },
        proposals: { select: { id: true, title: true, status: true, pricing: true, version: true } },
      },
      orderBy: [{ updatedAt: "desc" }],
      skip,
      take: limit,
    }),
  ]);

  return Response.json({
    deals,
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
  const parsed = createDealSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(parsed.error.issues[0]?.message ?? "Invalid deal payload", 400);
  }

  const data = parsed.data;

  // Validate company if provided
  if (data.companyId) {
    const company = await db.company.findUnique({ where: { id: data.companyId }, select: { id: true } });
    if (!company) return jsonError("Selected company was not found", 404);
  }

  // Validate contact if provided
  if (data.contactId) {
    const contact = await db.contact.findUnique({ where: { id: data.contactId }, select: { id: true } });
    if (!contact) return jsonError("Selected contact was not found", 404);
  }

  // Validate owner assignment
  let ownerId = data.ownerId ?? user.id;
  if (ownerId && ownerId !== user.id && user.role === "MEMBER") {
    return jsonError("Members can only assign deals to themselves", 403);
  }
  if (ownerId) {
    const owner = await db.user.findFirst({
      where: { id: ownerId, disabledAt: null },
      select: { id: true },
    });
    if (!owner) return jsonError("Assigned owner was not found", 404);
  }

  const probability = data.probability !== undefined
    ? data.probability
    : defaultStageProbability[data.stage];

  const closeDate = data.expectedCloseDate && data.expectedCloseDate.length > 0
    ? new Date(data.expectedCloseDate)
    : null;

  const followUp = data.followUpDate && data.followUpDate.length > 0
    ? new Date(data.followUpDate)
    : null;

  const deal = await db.deal.create({
    data: {
      title: data.title,
      value: data.value,
      currency: data.currency.toUpperCase(),
      stage: data.stage,
      probability,
      expectedCloseDate: closeDate,
      companyId: data.companyId || null,
      contactId: data.contactId || null,
      ownerId: ownerId || null,
      sourcePlatform: data.sourcePlatform || null,
      externalUrl: data.externalUrl || null,
      nextAction: data.nextAction || null,
      followUpDate: followUp,
      notes: data.notes,
    },
    include: {
      company: { select: { id: true, name: true } },
      contact: { select: { id: true, firstName: true, lastName: true } },
      owner: { select: publicUserSelect },
    },
  });

  await logActivity({
    action: "created",
    entity: "deal",
    entityId: deal.id,
    summary: `created deal "${deal.title}" (${deal.sourcePlatform || "Direct"}) with value ${deal.currency} ${deal.value.toLocaleString()} in stage ${deal.stage}`,
    userId: user.id,
  });

  return Response.json({ deal }, { status: 201 });
}
