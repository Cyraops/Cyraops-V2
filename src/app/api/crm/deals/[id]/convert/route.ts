import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { logActivity, publicUserSelect, sameOrigin, userFromRequest } from "@/lib/auth";
import { jsonError, prioritySchema } from "@/lib/validators";

const convertDealSchema = z.object({
  confirm: z.literal(true),
  projectName: z.string().trim().min(2, "Project name must be at least 2 characters").max(120).optional(),
  description: z.string().max(5000).optional(),
  priority: prioritySchema.optional().default("MEDIUM"),
  deadline: z.string().datetime().optional().nullable().or(z.literal("")),
  ownerId: z.string().trim().optional(),
  memberIds: z.array(z.string().trim()).optional(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!sameOrigin(request)) return jsonError("Invalid request origin", 403);
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);

  const { id } = await params;
  const deal = await db.deal.findUnique({
    where: { id },
    include: {
      company: true,
      contact: true,
      convertedProject: { select: { id: true, name: true } },
    },
  });

  if (!deal) return jsonError("Deal not found", 404);

  // A Member may convert only a deal they personally own, and leads the project
  // that comes out of it. Owners and Admins may convert any won deal.
  if (user.role === "MEMBER" && deal.ownerId !== user.id) {
    return jsonError("Only the deal owner or an admin can convert this deal into a project", 403);
  }

  // F-P2-05: Server-side validation that only CLOSED_WON deals can be converted to projects
  if (deal.stage !== "CLOSED_WON") {
    return jsonError("Only deals in CLOSED_WON stage can be converted to projects", 400);
  }

  // Idempotency: Prevent duplicate project creation
  if (deal.convertedProjectId && deal.convertedProject) {
    return jsonError(
      `This deal has already been converted into project "${deal.convertedProject.name}".`,
      400
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = convertDealSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(parsed.error.issues[0]?.message ?? "Invalid conversion payload", 400);
  }

  const data = parsed.data;
  const projectName = data.projectName || deal.title;
  const projectOwnerId =
    user.role === "MEMBER" ? user.id : data.ownerId || deal.ownerId || user.id;

  // Validate owner
  const validOwner = await db.user.findFirst({
    where: { id: projectOwnerId, disabledAt: null },
    select: { id: true },
  });
  if (!validOwner) return jsonError("Designated project owner is not a valid active team member", 404);

  // Determine initial members
  const memberIdSet = new Set<string>([user.id, projectOwnerId, ...(data.memberIds ?? [])]);
  const memberIds = Array.from(memberIdSet);

  const validMembers = await db.user.findMany({
    where: { id: { in: memberIds }, disabledAt: null },
    select: { id: true },
  });
  if (validMembers.length !== memberIds.length) {
    return jsonError("One or more project members could not be found", 404);
  }

  const deadline = data.deadline && data.deadline.length > 0
    ? new Date(data.deadline)
    : deal.expectedCloseDate;

  // Build descriptive brief
  const contextParts: string[] = [];
  if (data.description) contextParts.push(data.description);
  else if (deal.notes) contextParts.push(deal.notes);
  if (deal.company) contextParts.push(`Client: ${deal.company.name}`);
  if (deal.contact) contextParts.push(`Key Contact: ${deal.contact.firstName} ${deal.contact.lastName} (${deal.contact.email || "No email"})`);
  contextParts.push(`Deal Value: ${deal.currency} ${deal.value.toLocaleString()}`);

  const projectDescription = contextParts.join("\n\n");

  // Atomic transaction: create project and link to deal
  try {
    const { project, updatedDeal } = await db.$transaction(async (tx) => {
      // Re-verify deal status and idempotency inside transaction
      const currentDeal = await tx.deal.findUnique({
        where: { id: deal.id },
        select: {
          id: true,
          stage: true,
          convertedProjectId: true,
          convertedProject: { select: { id: true, name: true } },
        },
      });

      if (!currentDeal) {
        throw new Error("DEAL_NOT_FOUND");
      }

      if (currentDeal.stage !== "CLOSED_WON") {
        throw new Error("DEAL_NOT_CLOSED_WON");
      }

      if (currentDeal.convertedProjectId) {
        const pName = currentDeal.convertedProject?.name || "an existing project";
        throw new Error(`ALREADY_CONVERTED:${pName}`);
      }

      const newProject = await tx.project.create({
        data: {
          name: projectName,
          description: projectDescription,
          status: "PLANNING",
          priority: data.priority,
          deadline,
          ownerId: projectOwnerId,
          dealId: deal.id,
          members: {
            create: memberIds.map((userId) => ({ userId, role: userId === projectOwnerId ? "lead" : "member" })),
          },
        },
        include: {
          owner: { select: publicUserSelect },
          members: { include: { user: { select: publicUserSelect } } },
        },
      });

      const updDeal = await tx.deal.update({
        where: { id: deal.id },
        data: {
          convertedProjectId: newProject.id,
          stage: "CLOSED_WON",
          probability: 100,
        },
        include: {
          convertedProject: { select: { id: true, name: true } },
        },
      });

      await tx.activity.create({
        data: {
          action: "converted",
          entity: "deal",
          entityId: deal.id,
          summary: `converted won deal "${deal.title}" into delivery project "${newProject.name}"`,
          userId: user.id,
          projectId: newProject.id,
        },
      });

      await tx.activity.create({
        data: {
          action: "created",
          entity: "project",
          entityId: newProject.id,
          summary: `created project "${newProject.name}" from sales deal "${deal.title}"`,
          userId: user.id,
          projectId: newProject.id,
        },
      });

      return { project: newProject, updatedDeal: updDeal };
    });

    return Response.json(
      {
        success: true,
        message: `Deal converted successfully into project "${project.name}"`,
        project,
        deal: updatedDeal,
      },
      { status: 201 }
    );
  } catch (error: any) {
    if (error?.code === "P2002") {
      return jsonError("This deal has already been converted into a project", 400);
    }
    if (typeof error?.message === "string") {
      if (error.message.startsWith("ALREADY_CONVERTED:")) {
        const pName = error.message.replace("ALREADY_CONVERTED:", "");
        return jsonError(`This deal has already been converted into project "${pName}".`, 400);
      }
      if (error.message === "DEAL_NOT_CLOSED_WON") {
        return jsonError("Only deals in CLOSED_WON stage can be converted to projects", 400);
      }
      if (error.message === "DEAL_NOT_FOUND") {
        return jsonError("Deal not found", 404);
      }
    }
    console.error("[CRM] Failed to convert deal:", error);
    return jsonError("Failed to convert deal to project", 500);
  }
}
