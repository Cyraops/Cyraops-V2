import { NextRequest, NextResponse } from "next/server";
import { userFromRequest } from "@/lib/auth";
import { jsonError } from "@/lib/validators";
import { db } from "@/lib/db";
import { sendAssistantMessage } from "@/lib/ai/assistant/runtime";

// Per-user rate limit (in-process; the app runs a single replica today).
const rateBuckets = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 30; // requests per minute
const RATE_WINDOW_MS = 60_000;

// Hard daily spend ceiling per user, so one person cannot run away with cost.
const DAILY_COST_CAP_USD = 2;

function checkRateLimit(userId: string): { ok: boolean; reason?: string } {
  const now = Date.now();
  const bucket = rateBuckets.get(userId);

  if (!bucket || bucket.resetAt < now) {
    rateBuckets.set(userId, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return { ok: true };
  }
  if (bucket.count >= RATE_LIMIT) {
    return { ok: false, reason: "You're sending messages too quickly. Wait a minute and try again." };
  }
  bucket.count += 1;
  return { ok: true };
}

export async function POST(request: NextRequest) {
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);

  const body = await request.json().catch(() => null);
  const content = typeof body?.content === "string" ? body.content.trim() : "";
  if (!content || content.length > 5000) {
    return jsonError("A message between 1 and 5000 characters is required", 400);
  }

  // Rate limit before any model work.
  const limited = checkRateLimit(user.id);
  if (!limited.ok) return jsonError(limited.reason || "Rate limit exceeded", 429);

  // Daily spend ceiling.
  try {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const spend = await db.aiUsageLog.aggregate({
      where: { userId: user.id, createdAt: { gte: startOfDay } },
      _sum: { estimatedCostUsd: true },
    });
    const spent = spend._sum.estimatedCostUsd || 0;
    if (spent >= DAILY_COST_CAP_USD) {
      return jsonError("Today's AI usage limit has been reached. It resets at midnight.", 429);
    }
  } catch {
    // If the spend check fails, do not block the user; the rate limit still holds.
  }

  try {
    const result = await sendAssistantMessage({
      assistantId: body.assistantId,
      userId: user.id,
      content,
      conversationId: typeof body?.conversationId === "string" ? body.conversationId : undefined,
      userRole: user.role,
    });
    return NextResponse.json(result);
  } catch (err: any) {
    console.error("[API:assistant/chat] Failed:", err);
    if (/not found/i.test(err?.message || "")) return jsonError("Assistant not found", 404);
    return jsonError("The assistant failed to reply. Please try again.", 500);
  }
}
