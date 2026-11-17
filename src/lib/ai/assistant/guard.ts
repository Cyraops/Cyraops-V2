import { db } from "@/lib/db";

const rateBuckets = new Map<string, { count: number; resetAt: number }>();

export function checkRateLimit(userId: string, limit = 30, windowMs = 60_000): { ok: boolean; reason?: string } {
  const now = Date.now();
  const bucket = rateBuckets.get(userId);

  if (!bucket || bucket.resetAt < now) {
    rateBuckets.set(userId, { count: 1, resetAt: now + windowMs });
    return { ok: true };
  }
  if (bucket.count >= limit) {
    return { ok: false, reason: "You're sending messages too quickly. Wait a minute and try again." };
  }
  bucket.count += 1;
  return { ok: true };
}

export async function checkDailySpend(userId: string, capUsd = 2): Promise<{ ok: boolean; reason?: string }> {
  try {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const spend = await db.aiUsageLog.aggregate({
      where: { userId, createdAt: { gte: startOfDay } },
      _sum: { estimatedCostUsd: true },
    });
    const spent = spend._sum.estimatedCostUsd || 0;
    if (spent >= capUsd) {
      return { ok: false, reason: "Today's AI usage limit has been reached. It resets at midnight." };
    }
    return { ok: true };
  } catch {
    // A failed spend check should never block the user.
    return { ok: true };
  }
}
