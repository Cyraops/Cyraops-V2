import { NextRequest, NextResponse } from "next/server";
import { sameOrigin, userFromRequest } from "@/lib/auth";
import { jsonError } from "@/lib/validators";
import { db } from "@/lib/db";
import { getOrCreateAssistant } from "@/lib/ai/assistant/runtime";

const BUILTIN_MODELS = ["deepseek-flash", "deepseek-v4-pro"];

/** Custom models are stored as `custom:<providerConfigId>`. */
async function isModelAllowed(model: string): Promise<boolean> {
  if (BUILTIN_MODELS.includes(model)) return true;
  if (!model.startsWith("custom:")) return false;
  const configId = model.slice("custom:".length);
  const config = await db.aiProviderConfig.findFirst({ where: { id: configId, isActive: true }, select: { id: true } });
  return Boolean(config);
}

export async function GET(request: NextRequest) {
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);

  try {
    const assistant = await getOrCreateAssistant(user.id);
    const approvalRules = await db.assistantApprovalRule.findMany({
      where: { assistantId: assistant.id },
      select: { toolName: true, effect: true },
      orderBy: { createdAt: "asc" },
    });
    return NextResponse.json({ assistant, supportedModels: BUILTIN_MODELS, approvalRules });
  } catch (err: any) {
    console.error("[API:assistant/me] Failed:", err);
    return jsonError("Failed to load your assistant", 500);
  }
}

export async function PATCH(request: NextRequest) {
  if (!sameOrigin(request)) return jsonError("Invalid request origin", 403);
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);

  const body = await request.json().catch(() => null);
  const model = typeof body?.model === "string" ? body.model : null;
  const approvalMode = ["ASK", "AUTO", "NEVER"].includes(body?.approvalMode)
    ? (body.approvalMode as string)
    : null;
  const removeTool = typeof body?.removeRuleFor === "string" ? body.removeRuleFor : null;

  try {
    const assistant = await getOrCreateAssistant(user.id);
    if (model) {
      if (!(await isModelAllowed(model))) {
        return jsonError("That model is not available. Pick one from the model list.", 400);
      }
      await db.assistant.update({ where: { id: assistant.id }, data: { model } });
      assistant.model = model;
    }
    if (approvalMode) {
      await db.assistant.update({ where: { id: assistant.id }, data: { approvalMode } });
      assistant.approvalMode = approvalMode;
    }
    if (removeTool) {
      await db.assistantApprovalRule.deleteMany({
        where: { assistantId: assistant.id, toolName: removeTool },
      });
    }
    const approvalRules = await db.assistantApprovalRule.findMany({
      where: { assistantId: assistant.id },
      select: { toolName: true, effect: true },
      orderBy: { createdAt: "asc" },
    });
    return NextResponse.json({ assistant, supportedModels: BUILTIN_MODELS, approvalRules });
  } catch (err: any) {
    console.error("[API:assistant/me] Update failed:", err);
    return jsonError("Failed to update your assistant", 500);
  }
}
