import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { userFromRequest } from "@/lib/auth";
import { jsonError } from "@/lib/validators";

export async function GET(request: NextRequest) {
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);

  const [skills, certifications, capabilities] = await Promise.all([
    db.teamSkill.findMany({
      include: { user: { select: { id: true, name: true, role: true } } },
      orderBy: [{ verified: "desc" }, { skillName: "asc" }]
    }),
    db.certification.findMany({
      include: { user: { select: { id: true, name: true, role: true } } },
      orderBy: { createdAt: "desc" }
    }),
    db.serviceCapability.findMany({
      orderBy: { name: "asc" }
    })
  ]);

  return NextResponse.json({ skills, certifications, capabilities });
}

export async function POST(request: NextRequest) {
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);

  try {
    const body = await request.json();
    const {
      type = "skill", // "skill" | "certification" | "capability_verify"
      skillName,
      category = "Cloud & Infrastructure",
      level = "INTERMEDIATE",
      yearsExperience = 1,
      verified = false,
      evidenceUrl,
      deliveryCount = 0,
      targetUserId,
      // For certification
      certName,
      issuer,
      credentialId,
      credentialUrl,
      // For capability update
      capabilityId,
      deliveryReadiness,
      verifiedProjectsCount,
      portfolioEvidence
    } = body;

    const assignedUserId = targetUserId || user.id;

    if (type === "skill") {
      if (!skillName?.trim()) return jsonError("Skill name is required", 400);

      const isVerified = Boolean(verified);
      const skill = await db.teamSkill.create({
        data: {
          userId: assignedUserId,
          skillName: skillName.trim(),
          category,
          level,
          yearsExperience: Number(yearsExperience) || 1,
          verified: isVerified,
          verifiedBy: isVerified ? user.name : null,
          verifiedAt: isVerified ? new Date() : null,
          evidenceUrl: evidenceUrl?.trim() || null,
          deliveryCount: Number(deliveryCount) || 0
        }
      });
      return NextResponse.json({ success: true, skill });
    }

    if (type === "certification") {
      if (!certName?.trim() || !issuer?.trim()) return jsonError("Certification name and issuer are required", 400);

      const cert = await db.certification.create({
        data: {
          userId: assignedUserId,
          name: certName.trim(),
          issuer: issuer.trim(),
          credentialId: credentialId?.trim() || null,
          credentialUrl: credentialUrl?.trim() || null,
          verified: Boolean(verified),
          issueDate: new Date(),
        }
      });
      return NextResponse.json({ success: true, cert });
    }

    if (type === "capability_verify") {
      if (!capabilityId) return jsonError("Capability ID is required", 400);

      const capability = await db.serviceCapability.update({
        where: { id: capabilityId },
        data: {
          ...(deliveryReadiness ? { deliveryReadiness } : {}),
          ...(typeof verifiedProjectsCount === "number" ? { verifiedProjectsCount } : {}),
          ...(portfolioEvidence !== undefined ? { portfolioEvidence } : {})
        }
      });
      return NextResponse.json({ success: true, capability });
    }

    return jsonError("Invalid request type", 400);
  } catch (error: any) {
    return jsonError(error.message || "Failed to save skill record", 500);
  }
}

