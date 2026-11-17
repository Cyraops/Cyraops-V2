import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { logActivity, sameOrigin, userFromRequest } from "@/lib/auth";
import { jsonError } from "@/lib/validators";

const DEFAULT_READINESS_ITEMS = [
  {
    category: "COMPANY_PROFILE",
    title: "Company Identity & Positioning",
    description: "Finalize Cyraops company brand, official tagline, contact details, and core IT service positioning.",
  },
  {
    category: "SERVICE_OFFERINGS",
    title: "Cloud & DevOps Service Catalogue",
    description: "Publish 4 core services: Cloud Infrastructure, AWS Ops, Linux Administration, and CI/CD Automation with starting rates.",
  },
  {
    category: "PORTFOLIO",
    title: "Portfolio Case Studies & Evidence",
    description: "Document baseline case studies (AWS migration, Docker/K8s automation, high-availability Linux setup) with quantifiable results.",
  },
  {
    category: "TEAM_PROFILES",
    title: "Collaborator Skills & Role Clarity",
    description: "Verify team member profiles, technical certifications, and platform role assignments across both collaborators.",
  },
  {
    category: "FREELANCE_PLATFORMS",
    title: "Channel Profiles (Upwork, Freelancer, Fiverr)",
    description: "Set up and verify professional profiles and connect channel links in the Public Presence workspace.",
  },
  {
    category: "PROPOSALS",
    title: "Standard Proposal & Estimation Templates",
    description: "Set up reusable proposal outlines with problem statements, deliverables, payment terms, and INR pricing matrices.",
  },
  {
    category: "DELIVERY",
    title: "Delivery Workflow & Milestone Standards",
    description: "Standardize client communication, task boards, milestones, git repository access, and handover checklists.",
  },
  {
    category: "BILLING_LEGAL",
    title: "Invoicing & Payment Collection Setup",
    description: "Configure client invoice numbering, payment terms, bank details / UPI, and payment tracking procedures.",
  },
];

export async function GET(request: NextRequest) {
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);

  // Check if items already exist; if not, seed defaults
  const count = await db.businessReadinessItem.count();
  if (count === 0) {
    for (const item of DEFAULT_READINESS_ITEMS) {
      await db.businessReadinessItem.create({
        data: {
          category: item.category,
          title: item.title,
          description: item.description,
          status: "NOT_STARTED",
          ownerId: user.id,
        },
      });
    }
  }

  const items = await db.businessReadinessItem.findMany({
    orderBy: [{ createdAt: "asc" }],
    include: {
      owner: {
        select: { id: true, name: true, email: true },
      },
    },
  });

  const total = items.length;
  const completed = items.filter((i) => i.status === "COMPLETED").length;
  const inProgress = items.filter((i) => i.status === "IN_PROGRESS").length;
  const progressPercent = total > 0 ? Math.round((completed / total) * 100) : 0;

  return Response.json({
    items,
    summary: {
      total,
      completed,
      inProgress,
      pending: total - completed - inProgress,
      progressPercent,
    },
  });
}

const createItemSchema = z.object({
  category: z.string().trim().min(2).max(50),
  title: z.string().trim().min(3).max(150),
  description: z.string().trim().min(5).max(1000),
  status: z.enum(["NOT_STARTED", "IN_PROGRESS", "COMPLETED", "BLOCKED"]).default("NOT_STARTED"),
  ownerId: z.string().optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return jsonError("Invalid request origin", 403);
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);

  const body = await request.json().catch(() => null);
  const parsed = createItemSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError("Validation error: " + parsed.error.issues.map((i) => i.message).join(", "), 400);
  }

  const item = await db.businessReadinessItem.create({
    data: {
      category: parsed.data.category,
      title: parsed.data.title,
      description: parsed.data.description,
      status: parsed.data.status,
      ownerId: parsed.data.ownerId || user.id,
      notes: parsed.data.notes || null,
      completedAt: parsed.data.status === "COMPLETED" ? new Date() : null,
    },
    include: {
      owner: {
        select: { id: true, name: true, email: true },
      },
    },
  });

  await logActivity({
    action: "created",
    entity: "business_readiness",
    summary: `added readiness item: ${item.title}`,
    userId: user.id,
  });

  return Response.json({ item }, { status: 201 });
}

