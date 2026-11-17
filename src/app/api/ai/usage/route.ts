import { NextRequest, NextResponse } from "next/server";
import { userFromRequest } from "@/lib/auth";
import { jsonError } from "@/lib/validators";
import { getAiUsageReport } from "@/lib/ai/usage";

export async function GET(request: NextRequest) {
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);

  const { searchParams } = new URL(request.url);
  const requested = parseInt(searchParams.get("days") || "30", 10);
  const days = [1, 7, 30, 90].includes(requested) ? requested : 30;

  try {
    // Every signed-in user gets their own usage. The per-person breakdown is
    // added by the report itself only for Owners and Admins.
    const report = await getAiUsageReport({ id: user.id, role: user.role }, days);
    return NextResponse.json(report);
  } catch (err: any) {
    console.error("[API:ai/usage] Failed to build usage report:", err);
    return jsonError("Failed to load AI usage", 500);
  }
}
