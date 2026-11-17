import { db } from "@/lib/db";
import { estimateCostUsd } from "./models";

export interface LogUsageParams {
  userId?: string | null;
  source?: string | null;
  taskId?: string;
  agentSlug?: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  durationMs?: number;
}

export async function recordAiUsage(params: LogUsageParams) {
  try {
    const totalTokens = params.promptTokens + params.completionTokens;
    const estimatedCostUsd = estimateCostUsd(params.model, params.promptTokens, params.completionTokens);

    return await db.aiUsageLog.create({
      data: {
        userId: params.userId || null,
        source: params.source || null,
        taskId: params.taskId,
        agentSlug: params.agentSlug,
        model: params.model,
        promptTokens: params.promptTokens,
        completionTokens: params.completionTokens,
        totalTokens,
        estimatedCostUsd,
        durationMs: params.durationMs || 0,
      },
    });
  } catch (error) {
    console.error("[AiUsage] Failed to log usage metrics:", error);
    return null;
  }
}

/**
 * Fire-and-forget usage recording for provider calls.
 *
 * Requires a userId: an unattributed row would make the per-person report lie,
 * and guessing an owner is worse than recording nothing.
 */
export function recordChatUsage(
  context: { userId?: string | null; source?: string | null; agentSlug?: string; taskId?: string },
  model: string,
  usage: { promptTokens?: number; completionTokens?: number } | undefined,
  durationMs?: number
): void {
  if (!context.userId || !usage) return;

  void recordAiUsage({
    userId: context.userId,
    source: context.source || null,
    agentSlug: context.agentSlug,
    taskId: context.taskId,
    model,
    promptTokens: usage.promptTokens || 0,
    completionTokens: usage.completionTokens || 0,
    durationMs,
  });
}

function sinceDate(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

export async function getAiUsageSummary(days: number = 30) {
  const logs = await db.aiUsageLog.findMany({
    where: { createdAt: { gte: sinceDate(days) } },
    orderBy: { createdAt: "desc" },
  });

  const totalTokens = logs.reduce((sum, l) => sum + l.totalTokens, 0);
  const totalCostUsd = logs.reduce((sum, l) => sum + l.estimatedCostUsd, 0);

  return {
    totalCalls: logs.length,
    totalTokens,
    totalCostUsd: Number(totalCostUsd.toFixed(4)),
    logs: logs.slice(0, 50),
  };
}

export interface AiUsageTotals {
  requests: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  lastUsedAt: string | null;
}

export interface AiUsageBySource extends AiUsageTotals {
  source: string;
}

export interface AiUsageByUser extends AiUsageTotals {
  userId: string;
  name: string;
  email: string;
  role: string;
  bySource: AiUsageBySource[];
}

export interface AiUsageReport {
  rangeDays: number;
  self: AiUsageTotals & { bySource: AiUsageBySource[] };
  /** Only populated for Owners/Admins. */
  byUser?: AiUsageByUser[];
  team?: AiUsageTotals;
  unattributedRequests: number;
}

function emptyTotals(): AiUsageTotals {
  return {
    requests: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    estimatedCostUsd: 0,
    lastUsedAt: null,
  };
}

interface UsageRow {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  createdAt: Date;
}

function accumulate(target: AiUsageTotals, row: UsageRow): void {
  target.requests += 1;
  target.promptTokens += row.promptTokens;
  target.completionTokens += row.completionTokens;
  target.totalTokens += row.totalTokens;
  target.estimatedCostUsd += row.estimatedCostUsd;
  const stamp = row.createdAt.toISOString();
  if (!target.lastUsedAt || stamp > target.lastUsedAt) {
    target.lastUsedAt = stamp;
  }
}

function roundCost(totals: AiUsageTotals): AiUsageTotals {
  return { ...totals, estimatedCostUsd: Number(totals.estimatedCostUsd.toFixed(4)) };
}

/**
 * Per-user AI usage report.
 *
 * Every signed-in user sees their own numbers. Owners and Admins additionally
 * get a per-person breakdown, which is what makes spend attributable instead of
 * a single unexplained total.
 */
export async function getAiUsageReport(
  viewer: { id: string; role: string },
  days: number = 30
): Promise<AiUsageReport> {
  const since = sinceDate(days);
  const isAdmin = viewer.role === "OWNER" || viewer.role === "ADMIN";

  const logs = await db.aiUsageLog.findMany({
    where: { createdAt: { gte: since } },
    select: {
      userId: true,
      source: true,
      promptTokens: true,
      completionTokens: true,
      totalTokens: true,
      estimatedCostUsd: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });

  const selfTotals = emptyTotals();
  const selfSources = new Map<string, AiUsageBySource>();
  const perUser = new Map<string, AiUsageByUser>();
  const teamTotals = emptyTotals();
  let unattributedRequests = 0;

  for (const log of logs) {
    accumulate(teamTotals, log);
    const sourceKey = log.source || "agent";
    const attributed = Boolean(log.userId);

    if (!attributed) {
      unattributedRequests += 1;
      continue;
    }

    if (log.userId === viewer.id) {
      accumulate(selfTotals, log);
      const bucket = selfSources.get(sourceKey) || { source: sourceKey, ...emptyTotals() };
      accumulate(bucket, log);
      selfSources.set(sourceKey, bucket);
    }

    if (!isAdmin) continue;

    let row = perUser.get(log.userId as string);
    if (!row) {
      row = {
        userId: log.userId as string,
        name: "Unknown user",
        email: "",
        role: "",
        bySource: [],
        ...emptyTotals(),
      };
      perUser.set(row.userId, row);
    }
    accumulate(row, log);

    let sourceRow = row.bySource.find((s) => s.source === sourceKey);
    if (!sourceRow) {
      sourceRow = { source: sourceKey, ...emptyTotals() };
      row.bySource.push(sourceRow);
    }
    accumulate(sourceRow, log);
  }

  let byUser: AiUsageByUser[] | undefined;

  if (isAdmin && perUser.size > 0) {
    const users = await db.user.findMany({
      where: { id: { in: Array.from(perUser.keys()) } },
      select: { id: true, name: true, email: true, role: true },
    });
    const byId = new Map(users.map((u) => [u.id, u]));

    byUser = Array.from(perUser.values())
      .map((row) => {
        const user = byId.get(row.userId);
        return {
          ...row,
          estimatedCostUsd: Number(row.estimatedCostUsd.toFixed(4)),
          name: user?.name || "Removed user",
          email: user?.email || "",
          role: user?.role || "",
          bySource: row.bySource
            .map((s) => roundCost(s) as AiUsageBySource)
            .sort((a, b) => b.totalTokens - a.totalTokens),
        };
      })
      .sort((a, b) => b.estimatedCostUsd - a.estimatedCostUsd);
  }

  return {
    rangeDays: days,
    self: {
      ...roundCost(selfTotals),
      bySource: Array.from(selfSources.values())
        .map((s) => roundCost(s) as AiUsageBySource)
        .sort((a, b) => b.totalTokens - a.totalTokens),
    },
    byUser,
    team: isAdmin ? roundCost(teamTotals) : undefined,
    unattributedRequests,
  };
}
