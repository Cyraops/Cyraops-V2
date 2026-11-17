import { NextRequest, NextResponse } from "next/server";
import { userFromRequest } from "@/lib/auth";
import { jsonError } from "@/lib/validators";
import { providerManager } from "@/lib/ai/provider-manager";
import { getAiUsageSummary } from "@/lib/ai/usage";
import { getSystemSafetyStatus, triggerEmergencyStop } from "@/lib/ai/orchestrator/emergency";

export async function GET(request: NextRequest) {
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);

  const providers = providerManager.listProviders();
  const defaultProvider = providerManager.getProvider();
  const health = await defaultProvider.healthCheck();
  const usage = await getAiUsageSummary(30);
  const safety = await getSystemSafetyStatus();

  return NextResponse.json({
    activeProvider: {
      id: defaultProvider.id,
      name: defaultProvider.name,
      health,
    },
    providers,
    usage,
    safety,
  });
}

export async function POST(request: NextRequest) {
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);
  if (user.role === "MEMBER") return jsonError("Only Admins and Owners can trigger emergency controls", 403);

  const body = await request.json().catch(() => ({}));
  const { action, reason } = body;

  if (action === "EMERGENCY_STOP") {
    const result = await triggerEmergencyStop(user.id, reason);
    return NextResponse.json(result);
  }

  return jsonError("Invalid action", 400);
}
