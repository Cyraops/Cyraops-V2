import { NextRequest, NextResponse } from "next/server";
import { userFromRequest } from "@/lib/auth";
import { jsonError } from "@/lib/validators";
import { db } from "@/lib/db";

const BUILTIN_MODELS = [
  { id: "deepseek-flash", label: "DeepSeek V4 Flash", kind: "builtin" },
  { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro", kind: "builtin" },
];

export async function GET(request: NextRequest) {
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);

  try {
    const custom = await db.aiProviderConfig.findMany({
      where: { isActive: true },
      select: { id: true, label: true, defaultModel: true },
      orderBy: { createdAt: "asc" },
    });

    const models = [
      ...BUILTIN_MODELS,
      ...custom.map((config) => ({
        id: `custom:${config.id}`,
        label: `${config.label} · ${config.defaultModel}`,
        kind: "custom" as const,
      })),
    ];

    return NextResponse.json({ models });
  } catch (err: any) {
    console.error("[API:assistant/models] Failed:", err);
    return jsonError("Failed to load models", 500);
  }
}
