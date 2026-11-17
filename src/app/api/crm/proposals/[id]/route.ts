import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { logActivity, publicUserSelect, sameOrigin, userFromRequest } from "@/lib/auth";
import { jsonError } from "@/lib/validators";

const proposalStatusSchema = z.enum([
  "DRAFT",
  "INTERNAL_REVIEW",
  "READY_TO_SEND",
  "SENT",
  "ACCEPTED",
  "REJECTED",
]);

const updateProposalSchema = z.object({
  title: z.string().trim().min(3).max(180).optional(),
  clientName: z.string().trim().min(1).max(180).optional(),
  problemStatement: z.string().trim().min(10).max(5000).optional(),
  solution: z.string().trim().min(10).max(5000).optional(),
  scope: z.string().trim().min(10).max(5000).optional(),
  deliverables: z.union([z.string(), z.array(z.string())]).optional(),
  technologies: z.union([z.string(), z.array(z.string())]).optional(),
  timeline: z.string().trim().min(2).max(100).optional(),
  pricing: z.number().min(0).optional(),
  currency: z.literal("INR").optional(),
  paymentTerms: z.string().trim().min(5).max(1000).optional(),
  assumptions: z.string().max(2000).optional().nullable(),
  validityDays: z.number().int().min(1).max(90).optional(),
  status: proposalStatusSchema.optional(),
  acceptanceChannel: z.enum(["UPWORK_CONTRACT", "EMAIL", "SIGNED_AGREEMENT", "PURCHASE_ORDER", "OTHER"]).optional().nullable(),
  acceptanceReference: z.string().trim().max(255).optional().nullable(),
  acceptanceNotes: z.string().max(2000).optional().nullable(),
});

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);

  const { id } = await params;
  const proposal = await db.proposal.findUnique({
    where: { id },
    include: {
      deal: {
        include: {
          company: true,
          contact: true,
        },
      },
      author: { select: publicUserSelect },
    },
  });

  if (!proposal) return jsonError("Proposal not found", 404);

  return Response.json({ proposal });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!sameOrigin(request)) return jsonError("Invalid request origin", 403);
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);

  const { id } = await params;
  const existing = await db.proposal.findUnique({
    where: { id },
    include: { deal: true },
  });
  if (!existing) return jsonError("Proposal not found", 404);

  const body = await request.json().catch(() => null);
  const parsed = updateProposalSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError("Validation error: " + parsed.error.issues.map((i) => i.message).join(", "), 400);
  }

  const updateData: Record<string, any> = { ...parsed.data };
  if (Array.isArray(updateData.deliverables)) {
    updateData.deliverables = JSON.stringify(updateData.deliverables);
  }
  if (Array.isArray(updateData.technologies)) {
    updateData.technologies = JSON.stringify(updateData.technologies);
  }

  // Audit enforcement: An operator cannot record a proposal as ACCEPTED without capturing confirmation evidence
  if (parsed.data.status === "ACCEPTED" && existing.status !== "ACCEPTED") {
    if (!parsed.data.acceptanceChannel) {
      return jsonError("Client acceptance channel is required to record confirmation (e.g. UPWORK_CONTRACT, EMAIL, SIGNED_AGREEMENT, PURCHASE_ORDER, OTHER)", 400);
    }
    if (!parsed.data.acceptanceReference || parsed.data.acceptanceReference.trim().length < 2) {
      return jsonError("Client confirmation reference identifier or URL is required (e.g. Upwork Contract ID, Email Message ID, PO Number)", 400);
    }
    updateData.acceptedAt = new Date();
    updateData.acceptedByUserId = user.id;
    updateData.acceptanceChannel = parsed.data.acceptanceChannel;
    updateData.acceptanceReference = parsed.data.acceptanceReference.trim();
    updateData.acceptanceNotes = parsed.data.acceptanceNotes || null;
  }

  const updated = await db.proposal.update({
    where: { id },
    data: updateData,
    include: {
      author: { select: publicUserSelect },
      acceptedByUser: { select: publicUserSelect },
      deal: true,
    },
  });

  // If status changed to ACCEPTED, advance the deal stage to CLOSED_WON or NEGOTIATION if not already closed
  if (parsed.data.status === "ACCEPTED" && existing.status !== "ACCEPTED") {
    if (existing.deal.stage !== "CLOSED_WON") {
      await db.deal.update({
        where: { id: existing.dealId },
        data: {
          stage: "CLOSED_WON",
          probability: 100,
          value: updated.pricing > 0 ? updated.pricing : existing.deal.value,
        },
      });
      await logActivity({
        action: "updated",
        entity: "deal",
        entityId: existing.dealId,
        summary: `advanced deal "${existing.deal.title}" to CLOSED_WON following verified client acceptance via ${parsed.data.acceptanceChannel} (${parsed.data.acceptanceReference})`,
        userId: user.id,
      });
    }
  }

  const activitySummary = parsed.data.status === "ACCEPTED" && existing.status !== "ACCEPTED"
    ? `recorded verified client acceptance for proposal v${updated.version} "${updated.title}" via ${parsed.data.acceptanceChannel} (Ref: ${parsed.data.acceptanceReference})`
    : `updated proposal v${updated.version} "${updated.title}" (${updated.status})`;

  await logActivity({
    action: "updated",
    entity: "proposal",
    entityId: updated.id,
    summary: activitySummary,
    userId: user.id,
  });

  return Response.json({ proposal: updated });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!sameOrigin(request)) return jsonError("Invalid request origin", 403);
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);

  const { id } = await params;
  const existing = await db.proposal.findUnique({ where: { id } });
  if (!existing) return jsonError("Proposal not found", 404);

  await db.proposal.delete({ where: { id } });

  await logActivity({
    action: "deleted",
    entity: "proposal",
    entityId: id,
    summary: `deleted proposal "${existing.title}"`,
    userId: user.id,
  });

  return Response.json({ success: true });
}

