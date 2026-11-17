import { db } from "@/lib/db";
import { providerManager } from "../provider-manager";

export type AgentPresenceState =
  | "Available"
  | "Working"
  | "Thinking"
  | "Waiting for approval"
  | "Waiting for user"
  | "Paused"
  | "Offline"
  | "Failed";

export interface AgentPresenceInfo {
  agentId: string;
  slug: string;
  state: AgentPresenceState;
  currentTask?: {
    id: string;
    objective: string;
    activeStepTitle?: string;
    progressPercent: number;
  };
}

export interface ProviderHealth {
  ok: boolean;
  message: string;
}

export async function getAgentPresence(
  agentId: string,
  slug: string,
  providerHealth?: ProviderHealth
): Promise<AgentPresenceInfo> {
  // 1. Check active tasks assigned to this agent
  const activeTask = await db.aiTask.findFirst({
    where: {
      assignedAgentId: agentId,
      status: { in: ["RUNNING", "PLANNING", "AWAITING_APPROVAL", "PAUSED", "WAITING_FOR_AGENT"] },
    },
    include: {
      steps: { orderBy: { stepIndex: "asc" } },
      approvals: { where: { status: "PENDING" } },
    },
    orderBy: { updatedAt: "desc" },
  });

  if (!activeTask) {
    // Check if provider is configured and available
    const health = providerHealth ?? await getCachedProviderHealth();
    if (!health.ok) {
      return { agentId, slug, state: "Offline" };
    }

    // Check recent failures in last 5 minutes
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const recentFailed = await db.aiTask.findFirst({
      where: {
        assignedAgentId: agentId,
        status: "FAILED",
        updatedAt: { gte: fiveMinutesAgo },
      },
    });

    if (recentFailed) {
      return { agentId, slug, state: "Failed" };
    }

    return { agentId, slug, state: "Available" };
  }

  // Calculate progress
  const totalSteps = activeTask.steps.length;
  const completedSteps = activeTask.steps.filter((s) => s.status === "COMPLETED").length;
  const progressPercent = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0;
  const activeStep = activeTask.steps.find((s) => s.status === "RUNNING") || activeTask.steps.find((s) => s.status === "CREATED");

  let state: AgentPresenceState = "Working";
  if (activeTask.status === "PLANNING") {
    state = "Thinking";
  } else if (activeTask.status === "AWAITING_APPROVAL" || activeTask.approvals.length > 0) {
    state = "Waiting for approval";
  } else if (activeTask.status === "PAUSED") {
    state = "Paused";
  } else if (activeTask.status === "RUNNING") {
    state = activeStep?.title?.toLowerCase().includes("reason") || activeStep?.title?.toLowerCase().includes("analyz")
      ? "Thinking"
      : "Working";
  }

  return {
    agentId,
    slug,
    state,
    currentTask: {
      id: activeTask.id,
      objective: activeTask.objective,
      activeStepTitle: activeStep?.title,
      progressPercent,
    },
  };
}

const PROVIDER_HEALTH_TTL_MS = 60_000;

let cachedProviderHealth: { value: ProviderHealth; expiresAt: number } | null = null;

/**
 * Provider health performs a live network call (for example a /models request),
 * so the result is cached briefly instead of running on every workspace load.
 */
export async function getCachedProviderHealth(): Promise<ProviderHealth> {
  const now = Date.now();
  if (cachedProviderHealth && cachedProviderHealth.expiresAt > now) {
    return cachedProviderHealth.value;
  }

  const value = await providerManager.getProvider().healthCheck().catch(() => ({
    ok: false,
    message: "Provider health check failed",
  }));

  cachedProviderHealth = { value, expiresAt: now + PROVIDER_HEALTH_TTL_MS };
  return value;
}

export async function getAllAgentsPresence(): Promise<{
  presence: Record<string, AgentPresenceInfo>;
  providerHealth: ProviderHealth;
}> {
  const agents = await db.aiAgent.findMany({ where: { status: "ACTIVE" } });
  const providerHealth = await getCachedProviderHealth();
  const presenceMap: Record<string, AgentPresenceInfo> = {};

  for (const a of agents) {
    presenceMap[a.slug] = await getAgentPresence(a.id, a.slug, providerHealth);
  }

  return { presence: presenceMap, providerHealth };
}

