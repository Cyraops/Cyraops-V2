import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { userFromRequest } from "@/lib/auth";
import { jsonError } from "@/lib/validators";

export async function POST(request: NextRequest) {
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);

  try {
    const { improvementId } = await request.json();
    if (!improvementId) return jsonError("Improvement ID is required", 400);

    const improvement = await db.businessImprovement.findUnique({
      where: { id: improvementId }
    });

    if (!improvement) return jsonError("Improvement not found", 404);

    // Find or create the Internal Operations project
    let project = await db.project.findFirst({
      where: { name: "Internal IT Operations & Capability Readiness" }
    });

    if (!project) {
      project = await db.project.create({
        data: {
          name: "Internal IT Operations & Capability Readiness",
          description: "Internal capability building, certifications, and delivery readiness tasks.",
          status: "ACTIVE",
          ownerId: user.id
        }
      });
    }

    // Check if task already exists
    if (improvement.convertedTaskId) {
      const existingTask = await db.task.findUnique({
        where: { id: improvement.convertedTaskId }
      });
      if (existingTask) {
        return NextResponse.json({
          success: true,
          task: existingTask,
          message: "Task already exists for this improvement item"
        });
      }
    }

    // Create the task
    const task = await db.task.create({
      data: {
        title: improvement.title,
        description: `**Strategic Reason:** ${improvement.businessReason}\n\n**Expected Impact:** ${improvement.expectedImpact}\n**Required Resources:** ${improvement.requiredResources}\n**Effort:** ${improvement.estimatedEffort}`,
        status: "TODO",
        priority: improvement.priority === "CRITICAL" ? "HIGH" : (improvement.priority as any) || "HIGH",
        dueDate: improvement.targetDate || new Date(Date.now() + 14 * 86400000),
        projectId: project.id,
        creatorId: user.id,
        assigneeId: improvement.ownerId || user.id
      }
    });

    // Update the improvement record
    await db.businessImprovement.update({
      where: { id: improvementId },
      data: {
        convertedTaskId: task.id,
        status: "IN_PROGRESS"
      }
    });

    return NextResponse.json({ success: true, task });
  } catch (error: any) {
    return jsonError(error.message || "Failed to convert improvement to CRM task", 500);
  }
}

