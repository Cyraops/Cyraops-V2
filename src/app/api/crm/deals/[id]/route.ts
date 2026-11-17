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

// A deal moves one step forward, or to lost. Winning requires the whole chain,
// and a decided deal stays decided — a bare stage write must not skip stages or
// silently reopen a won/lost deal.
const ALLOWED_TRANSITIONS: Record<DealStage, DealStage[]> = {
  DISCOVERY: ["PROPOSAL", "CLOSED_LOST"],
  PROPOSAL: ["NEGOTIATION", "CLOSED_LOST"],
  NEGOTIATION: ["CLOSED_WON", "CLOSED_LOST"],
  CLOSED_WON: [],
  CLOSED_LOST: [],
};

const updateDealSchema = z.object({
  title: z.string().trim().min(2).max(180).optional(),
  value: z.number().nonnegative().optional(),
  currency: z.literal("INR").optional(),
  stage: dealStageSchema.optional(),
  probability: z.number().int().min(0).max(100).optional(),
  expectedCloseDate: z.string().datetime().optional().nullable().or(z.literal("")),
  companyId: z.string().trim().optional().nullable(),
  contactId: z.string().trim().optional().nullable(),
  ownerId: z.string().trim().optional().nullable(),
  sourcePlatform: z.string().trim().max(50).optional().nullable(),
  externalUrl: externalUrlSchema,
  nextAction: z.string().trim().max(500).optional().nullable(),
  followUpDate: z.string().datetime().optional().nullable().or(z.literal("")),
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
  const deal = await db.deal.findUnique({
    where: { id },
    include: {
      company: true,
      contact: true,
      owner: { select: publicUserSelect },
      convertedProject: {
        select: {
          id: true,
          name: true,
          status: true,
          priority: true,
          deadline: true,
        },
      },
      proposals: {
        orderBy: { createdAt: "desc" },
        include: {
          author: { select: publicUserSelect },
        },
      },
      clientInvoices: {
        orderBy: { createdAt: "desc" },
      },
      fitAssessments: {
        orderBy: { createdAt: "desc" },
        take: 5,
      },
    },
  });
  // Reading is open to the whole team, matching the list endpoint. Editing a deal
  // someone else owns is still refused in PATCH below.
  if (!deal) return jsonError("Deal not found", 404);

  const activities = await db.activity.findMany({
    where: { entity: "deal", entityId: id },
    include: { user: { select: publicUserSelect } },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return Response.json({ deal, activities });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!sameOrigin(request)) return jsonError("Invalid request origin", 403);
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);

  const { id } = await params;
  const existing = await db.deal.findUnique({ where: { id } });
  if (!existing) return jsonError("Deal not found", 404);

  const body = await request.json().catch(() => null);
  const parsed = updateDealSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(parsed.error.issues[0]?.message ?? "Invalid update payload", 400);
  }

  const data = parsed.data;

  // MEMBER deal modification boundary (F-P2-06):
  // Non-admin members cannot modify values, stages, notes, or details on deals owned by other team members
  if (user.role === "MEMBER" && existing.ownerId && existing.ownerId !== user.id) {
    return jsonError("Members cannot modify deals owned by other team members", 403);
  }

  // Archive authorization check
  if ((data.archive || data.unarchive) && user.role === "MEMBER") {
    return jsonError("Only an owner or admin can archive or unarchive deals", 403);
  }

  // Owner reassignment authorization check
  if (data.ownerId !== undefined && data.ownerId !== existing.ownerId) {
    if (user.role === "MEMBER" && data.ownerId !== user.id) {
      return jsonError("Members cannot reassign deals to other users", 403);
    }
  }

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

  const updateData: any = {};
  if (data.title !== undefined) updateData.title = data.title;
  if (data.value !== undefined) updateData.value = data.value;
  if (data.currency !== undefined) updateData.currency = data.currency.toUpperCase();
  if (data.companyId !== undefined) updateData.companyId = data.companyId || null;
  if (data.contactId !== undefined) updateData.contactId = data.contactId || null;
  if (data.ownerId !== undefined) updateData.ownerId = data.ownerId || null;
  if (data.notes !== undefined) updateData.notes = data.notes;
  if (data.sourcePlatform !== undefined) updateData.sourcePlatform = data.sourcePlatform || null;
  if (data.externalUrl !== undefined) updateData.externalUrl = data.externalUrl || null;
  if (data.nextAction !== undefined) updateData.nextAction = data.nextAction || null;

  if (data.expectedCloseDate !== undefined) {
    updateData.expectedCloseDate = data.expectedCloseDate && data.expectedCloseDate.length > 0
      ? new Date(data.expectedCloseDate)
      : null;
  }

  if (data.followUpDate !== undefined) {
    updateData.followUpDate = data.followUpDate && data.followUpDate.length > 0
      ? new Date(data.followUpDate)
      : null;
  }

  if (data.stage !== undefined && data.stage !== existing.stage) {
    // A deal that became a delivery project cannot fall back out of CLOSED_WON.
    if (existing.convertedProjectId) {
      return jsonError("This deal is being delivered as a project and cannot be reopened", 400);
    }
    const allowed = ALLOWED_TRANSITIONS[existing.stage] ?? [];
    if (!allowed.includes(data.stage)) {
      return jsonError(
        `Deals cannot move from ${existing.stage.toLowerCase()} to ${data.stage.toLowerCase()}.`,
        400
      );
    }
    updateData.stage = data.stage;
    if (data.probability === undefined) {
      updateData.probability = defaultStageProbability[data.stage];
    }
  }
  if (data.probability !== undefined) {
    updateData.probability = data.probability;
  }

  if (data.archive) updateData.archivedAt = new Date();
  if (data.unarchive) updateData.archivedAt = null;

  const updated = await db.deal.update({
    where: { id },
    data: updateData,
    include: {
      company: { select: { id: true, name: true } },
      contact: { select: { id: true, firstName: true, lastName: true } },
      owner: { select: publicUserSelect },
      convertedProject: { select: { id: true, name: true } },
    },
  });

  const summary = data.archive
    ? `archived deal "${updated.title}"`
    : data.unarchive
    ? `restored deal "${updated.title}"`
    : data.stage && data.stage !== existing.stage
    ? `advanced deal "${updated.title}" from ${existing.stage} to ${data.stage}`
    : `updated deal "${updated.title}"`;

  await logActivity({
    action: data.archive ? "archived" : data.unarchive ? "restored" : "updated",
    entity: "deal",
    entityId: updated.id,
    summary,
    userId: user.id,
  });

  return Response.json({ deal: updated });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!sameOrigin(request)) return jsonError("Invalid request origin", 403);
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);
  if (user.role === "MEMBER") return jsonError("Only an owner or admin can archive deals", 403);

  const { id } = await params;
  const existing = await db.deal.findUnique({ where: { id } });
  if (!existing) return jsonError("Deal not found", 404);

  const deal = await db.deal.update({
    where: { id },
    data: { archivedAt: new Date() },
  });

  await logActivity({
    action: "archived",
    entity: "deal",
    entityId: id,
    summary: `archived deal "${deal.title}"`,
    userId: user.id,
  });

  return Response.json({ deal, message: "Deal archived successfully" });
}
