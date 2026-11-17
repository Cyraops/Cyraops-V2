import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { userFromRequest } from "@/lib/auth";
import { jsonError } from "@/lib/validators";

export async function POST(request: NextRequest) {
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);

  try {
    const body = await request.json();
    const {
      projectName,
      clientName,
      serviceCategory,
      scopeDescription = "",
      clientBudget,
      timelineMonths = 3,
      slaRequired = false,
      dealId
    } = body;

    if (!projectName?.trim() || !clientName?.trim() || !serviceCategory?.trim()) {
      return jsonError("Project name, client name, and service category are required", 400);
    }

    // Lookup matching service capability and verified team skills
    const [capability, teamSkills, certs] = await Promise.all([
      db.serviceCapability.findFirst({
        where: { name: serviceCategory }
      }),
      db.teamSkill.findMany({
        where: { verified: true }
      }),
      db.certification.findMany({
        where: { verified: true }
      })
    ]);

    // Calculate Technical Fit Score (0-100)
    let score = 50;
    const missingCaps: string[] = [];
    const conditions: string[] = [];
    const reasons: string[] = [];
    let deliveryRisk: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" = "MEDIUM";
    let marginPercent = 35;

    if (capability) {
      if (capability.deliveryReadiness === "PRODUCTION_READY") {
        score += 35;
        reasons.push(`Core capability "${serviceCategory}" is verified as Production Ready with ${capability.verifiedProjectsCount} completed projects.`);
      } else if (capability.deliveryReadiness === "CONDITIONAL_PARTNER") {
        score += 15;
        reasons.push(`Capability "${serviceCategory}" is marked Conditional Partner. Requires specialized external advisory or contractor assistance.`);
        conditions.push(`Contract an accredited subcontractor for specialized ${serviceCategory} modules.`);
      } else {
        score -= 25;
        missingCaps.push(`No verified track record or certifications for "${serviceCategory}".`);
        reasons.push(`Cyraops currently has NOT_READY status for "${serviceCategory}".`);
        deliveryRisk = "HIGH";
      }
    } else {
      score -= 20;
      missingCaps.push(`Uncategorized service requirement: "${serviceCategory}".`);
    }

    // Check SLA requirements
    if (slaRequired) {
      score -= 15;
      deliveryRisk = deliveryRisk === "HIGH" ? "CRITICAL" : "HIGH";
      missingCaps.push("24/7 Follow-the-sun on-call rotation with guaranteed 15-minute response SLA.");
      conditions.push("Must integrate PagerDuty and secure secondary on-call engineer agreement before contract execution.");
      reasons.push("Strict SLA requirement introduces breach penalty exposure without dedicated on-call staff.");
    }

    // Budget & Timeline
    const budgetNum = Number(clientBudget) || 0;
    if (budgetNum > 0 && budgetNum < 20000 && timelineMonths > 2) {
      marginPercent = 18;
      score -= 10;
      reasons.push("Client budget is below the minimum profitable threshold for an extended engagement.");
      conditions.push("Request fixed milestone billing or scope down to a timeboxed architectural sprint.");
    } else if (budgetNum >= 40000) {
      marginPercent = 40;
      score += 10;
      reasons.push("Healthy commercial budget provides sufficient margin cushion for dedicated senior engineering.");
    }

    // Clamp score
    const finalScore = Math.max(10, Math.min(98, score));

    // Determine Recommendation
    let recommendation: "GREEN" | "AMBER" | "RED" = "AMBER";
    if (finalScore >= 75 && deliveryRisk !== "CRITICAL") {
      recommendation = "GREEN";
      deliveryRisk = deliveryRisk === "HIGH" ? "MEDIUM" : "LOW";
    } else if (finalScore < 45 || deliveryRisk === "CRITICAL") {
      recommendation = "RED";
    } else {
      recommendation = "AMBER";
    }

    if (recommendation === "GREEN") {
      conditions.push("Milestone payment structure: 30% upfront on architecture signoff, 40% mid-project, 30% on acceptance.");
    }

    const assessment = await db.projectFitAssessment.create({
      data: {
        dealId: dealId || null,
        projectName: projectName.trim(),
        clientName: clientName.trim(),
        serviceCategory: serviceCategory.trim(),
        estimatedValue: budgetNum || 25000,
        recommendation,
        technicalFitScore: finalScore,
        deliveryRisk,
        estimatedMarginPercent: marginPercent,
        timelineFeasible: true,
        clientBudget: budgetNum || null,
        missingCapabilities: JSON.stringify(missingCaps),
        conditions: JSON.stringify(conditions),
        reasons: JSON.stringify(reasons),
        status: "PENDING_REVIEW"
      }
    });

    return NextResponse.json({ success: true, assessment });
  } catch (error: any) {
    return jsonError(error.message || "Failed to evaluate project", 500);
  }
}

export async function PATCH(request: NextRequest) {
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);

  try {
    const body = await request.json();
    const { id, status, decisionNotes } = body;

    if (!id || !status) return jsonError("Assessment ID and status are required", 400);

    const assessment = await db.projectFitAssessment.update({
      where: { id },
      data: {
        status,
        decisionNotes: decisionNotes?.trim() || null,
        reviewedById: user.id,
        reviewedAt: new Date()
      }
    });

    return NextResponse.json({ success: true, assessment });
  } catch (error: any) {
    return jsonError(error.message || "Failed to update assessment", 500);
  }
}

