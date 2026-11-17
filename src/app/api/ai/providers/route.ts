import { NextRequest, NextResponse } from "next/server";
import { userFromRequest } from "@/lib/auth";
import { jsonError } from "@/lib/validators";
import { db } from "@/lib/db";
import { encryptSecret, isEncryptionAvailable, maskSecret } from "@/lib/ai/crypto";

function adminOnly(role: string): boolean {
  return role === "OWNER" || role === "ADMIN";
}

function publicConfig(config: {
  id: string;
  label: string;
  baseUrl: string;
  defaultModel: string;
  apiKeyHint: string;
  isActive: boolean;
  createdAt: Date;
}) {
  return {
    id: config.id,
    label: config.label,
    baseUrl: config.baseUrl,
    defaultModel: config.defaultModel,
    apiKeyHint: config.apiKeyHint,
    isActive: config.isActive,
    createdAt: config.createdAt,
  };
}

export async function GET(request: NextRequest) {
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);
  if (!adminOnly(user.role)) return jsonError("Only Owners and Admins can manage AI providers", 403);

  const configs = await db.aiProviderConfig.findMany({ orderBy: { createdAt: "desc" } });
  return NextResponse.json({
    providers: configs.map(publicConfig),
    encryptionAvailable: isEncryptionAvailable(),
  });
}

export async function POST(request: NextRequest) {
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);
  if (!adminOnly(user.role)) return jsonError("Only Owners and Admins can add AI providers", 403);
  if (!isEncryptionAvailable()) {
    return jsonError(
      "Server-side key encryption is not configured (AI_KEY_ENCRYPTION_SECRET). Ask the operator to set it before adding provider keys.",
      400
    );
  }

  const body = await request.json().catch(() => null);
  const label = typeof body?.label === "string" ? body.label.trim().slice(0, 80) : "";
  const baseUrlRaw = typeof body?.baseUrl === "string" ? body.baseUrl.trim().replace(/\/+$/, "") : "";
  const defaultModel = typeof body?.defaultModel === "string" ? body.defaultModel.trim().slice(0, 120) : "";
  const apiKey = typeof body?.apiKey === "string" ? body.apiKey.trim() : "";

  if (!label || !defaultModel || !apiKey) return jsonError("Label, model and API key are required", 400);

  let baseUrl: URL;
  try {
    baseUrl = new URL(baseUrlRaw);
  } catch {
    return jsonError("Base URL must be a valid URL, e.g. https://api.example.com/v1", 400);
  }
  if (baseUrl.protocol !== "https:") return jsonError("Base URL must use https://", 400);

  // Verify the key works before storing it.
  try {
    const probe = await fetch(`${baseUrlRaw}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!probe.ok) {
      return jsonError(`The provider rejected this key (HTTP ${probe.status}). Check the key and base URL.`, 400);
    }
  } catch (err: any) {
    return jsonError(`Could not reach ${baseUrl.host}: ${err?.message || "network error"}`, 400);
  }

  try {
    const config = await db.aiProviderConfig.create({
      data: {
        label,
        baseUrl: baseUrlRaw,
        defaultModel,
        apiKeyEncrypted: encryptSecret(apiKey),
        apiKeyHint: maskSecret(apiKey),
        createdById: user.id,
      },
    });
    return NextResponse.json({ provider: publicConfig(config) }, { status: 201 });
  } catch (err: any) {
    console.error("[API:ai/providers] Create failed:", err);
    return jsonError("Failed to save the provider", 500);
  }
}
