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

const createProposalSchema = z.object({
  dealId: z.string().trim().min(1, "Deal ID is required"),
  title: z.string().trim().min(3).max(180),
  clientName: z.string().trim().min(1).max(180),
  problemStatement: z.string().trim().min(10).max(5000),
  solution: z.string().trim().min(10).max(5000),
  scope: z.string().trim().min(10).max(5000),
  deliverables: z.union([z.string(), z.array(z.string())]),
  technologies: z.union([z.string(), z.array(z.string())]).optional().default("[]"),
  timeline: z.string().trim().min(2).max(100),
  pricing: z.number().min(0),
  currency: z.literal("INR").default("INR"),
  paymentTerms: z.string().trim().min(5).max(1000),
  assumptions: z.string().max(2000).optional().nullable(),
  validityDays: z.number().int().min(1).max(90).default(14),
  status: proposalStatusSchema.default("DRAFT"),
});

export async function GET(request: NextRequest) {
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);

  const searchParams = request.nextUrl.searchParams;
  const dealId = searchParams.get("dealId")?.trim();
  const status = searchParams.get("status")?.trim();

  const where: any = {};
  if (dealId) where.dealId = dealId;
  if (status && ["DRAFT", "INTERNAL_REVIEW", "READY_TO_SEND", "SENT", "ACCEPTED", "REJECTED"].includes(status)) {
    where.status = status;
  }

  const proposals = await db.proposal.findMany({
    where,
    include: {
      deal: {
        select: {
          id: true,
          title: true,
          stage: true,
          value: true,
          currency: true,
          sourcePlatform: true,
        },
      },
      author: { select: publicUserSelect },
    },
    orderBy: [{ createdAt: "desc" }],
  });

  return Response.json({ proposals });
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return jsonError("Invalid request origin", 403);
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);

  const body = await request.json().catch(() => null);
  const parsed = createProposalSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError("Validation error: " + parsed.error.issues.map((i) => i.message).join(", "), 400);
  }

  const data = parsed.data;

  // Validate deal
  const deal = await db.deal.findUnique({
    where: { id: data.dealId },
    select: { id: true, title: true, ownerId: true },
  });
  if (!deal) return jsonError("Associated deal was not found", 404);

  // Check version count for this deal
  const latestProposal = await db.proposal.findFirst({
    where: { dealId: data.dealId },
    orderBy: { version: "desc" },
    select: { version: true },
  });
  const version = latestProposal ? latestProposal.version + 1 : 1;

  const deliverablesStr = Array.isArray(data.deliverables)
    ? JSON.stringify(data.deliverables)
    : data.deliverables;

  const technologiesStr = Array.isArray(data.technologies)
    ? JSON.stringify(data.technologies)
    : data.technologies;

  const proposal = await db.proposal.create({
    data: {
      dealId: data.dealId,
      title: data.title,
      clientName: data.clientName,
      problemStatement: data.problemStatement,
      solution: data.solution,
      scope: data.scope,
      deliverables: deliverablesStr,
      technologies: technologiesStr,
      timeline: data.timeline,
      pricing: data.pricing,
      currency: data.currency,
      paymentTerms: data.paymentTerms,
      assumptions: data.assumptions || null,
      validityDays: data.validityDays,
      status: data.status,
      version,
      authorId: user.id,
    },
    include: {
      author: { select: publicUserSelect },
      deal: { select: { id: true, title: true } },
    },
  });

  await logActivity({
    action: "created",
    entity: "proposal",
    entityId: proposal.id,
    summary: `created proposal v${proposal.version} "${proposal.title}" for deal "${deal.title}" (₹${proposal.pricing.toLocaleString()})`,
    userId: user.id,
  });

  return Response.json({ proposal }, { status: 201 });
}

