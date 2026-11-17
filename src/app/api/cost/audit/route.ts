import { NextRequest, NextResponse } from "next/server";
import { userFromRequest } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET(req: NextRequest) {
  try {
    const user = await userFromRequest(req);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // Strict Authorization: Audit logs are restricted to OWNER and ADMIN
    if (user.role !== "OWNER" && user.role !== "ADMIN") {
      return NextResponse.json({ error: "Permission denied. Audit logs are restricted to administrators." }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const entityType = searchParams.get("entityType");
    const action = searchParams.get("action");
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "50", 10)));

    const where: any = {};
    if (entityType) where.entityType = entityType;
    if (action) where.action = action;

    const logs = await db.costAuditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    return NextResponse.json({ logs });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

