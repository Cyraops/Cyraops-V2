import { NextRequest, NextResponse } from "next/server";
import { userFromRequest } from "@/lib/auth";
import { jsonError } from "@/lib/validators";
import { db } from "@/lib/db";

type Context = { params: Promise<{ id: string }> };

export async function DELETE(request: NextRequest, context: Context) {
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);
  if (user.role !== "OWNER" && user.role !== "ADMIN") {
    return jsonError("Only Owners and Admins can remove AI providers", 403);
  }

  const { id } = await context.params;
  try {
    await db.aiProviderConfig.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("[API:ai/providers] Delete failed:", err);
    return jsonError("Failed to remove the provider", 500);
  }
}
