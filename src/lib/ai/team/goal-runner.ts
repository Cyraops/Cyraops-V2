import { db } from "@/lib/db";
import { providerManager } from "@/lib/ai/provider-manager";
import { createAndDispatchTask } from "@/lib/ai/orchestrator/dispatcher";

/**
 * The AI team's goal loop.
 *
 * Before this, work was one-shot: a task was created, it ran, and nobody asked
 * whether the business objective had actually moved. A goal is the durable thing
 * the team keeps coming back to: the orchestrator reviews what happened, decides
 * who should do what next, and the loop repeats until the success criteria are
 * genuinely met — or the budget runs out and a human is told why.
 */

/** Statuses that mean a task is still being worked on right now. */
const IN_FLIGHT = [
  "CREATED",
  "PLANNING",
  "READY",
  "RUNNING",
  "RECOVERING",
  "WAITING_FOR_AGENT",
  "WAITING_FOR_EXTERNAL_RESULT",
  // A task waiting on a human is NOT finished. Omitting these let the sweep
  // decide nothing was running, plan the same work again, and pile up duplicate
  // tasks and approval cards while the first one sat unanswered.
  "AWAITING_APPROVAL",
  "PAUSED",
] as const;

const DEFAULT_TEAM = [
  "research",
  "sales",
  "communication",
  "business_analyst",
  "workflow_automation",
];

export interface GoalAction {
  agentSlug: string;
  objective: string;
  prompt: string;
}

export interface GoalEvaluation {
  achieved: boolean;
  reasoning: string;
  gaps: string[];
  actions: GoalAction[];
}

/** Reads the shared thread so each round has memory of what was tried. */
async function buildTranscript(goalId: string, limit = 40): Promise<string> {
  const messages = await db.aiAgentMessage.findMany({
    where: { goalId },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: { kind: true, fromAgentSlug: true, toAgentSlug: true, body: true, createdAt: true },
  });

  return messages
    .reverse()
    .map((message) => {
      const who =
        message.kind === "SYSTEM"
          ? "Orchestrator"
          : message.kind === "USER"
            ? "Owner"
            : message.kind === "RESULT"
              ? `${message.fromAgentSlug ?? "agent"} (result)`
              : `${message.fromAgentSlug ?? "agent"}${message.toAgentSlug ? ` → ${message.toAgentSlug}` : ""}`;
      return `[${who}] ${message.body.replace(/\s+/g, " ").slice(0, 500)}`;
    })
    .join("\n");
}

async function summariseTasks(goalId: string): Promise<string> {
  const tasks = await db.aiTask.findMany({
    where: { goalId },
    orderBy: { createdAt: "desc" },
    take: 12,
    select: { objective: true, status: true, error: true, result: true, assignedAgent: { select: { slug: true } } },
  });
  if (!tasks.length) return "No tasks have run yet.";

  return tasks
    .reverse()
    .map((task) => {
      const outcome = task.error
        ? `failed: ${task.error.slice(0, 160)}`
        : task.result
          ? task.result.replace(/\s+/g, " ").slice(0, 200)
          : "no result recorded";
      return `- [${task.assignedAgent?.slug ?? "agent"}] ${task.objective} — ${task.status} (${outcome})`;
    })
    .join("\n");
}

/**
 * One deliberative round. The model plays Chief of Staff: review, judge, assign.
 */
export async function evaluateGoal(params: {
  goal: { id: string; title: string; objective: string; successCriteria: string; round: number; maxRounds: number };
  transcript: string;
  tasks: string;
  team: string[];
}): Promise<GoalEvaluation> {
  const provider = providerManager.getProvider();

  const result = await provider.generateStructuredOutput<GoalEvaluation>(
    [
      {
        role: "system",
        content: `You are the Chief of Staff of an AI team working inside a CRM for a small AWS/cloud consultancy.

Your job: decide whether the team's goal is genuinely achieved, and if not, assign the next round of work to specialists.
Available specialists: ${params.team.join(", ")}.
- research: finding information, company profiles, competitor/market research, qualifying prospects.
- sales: leads, pipeline, deal progression, outreach lists.
- communication: drafting emails and messages (drafting only; sending needs approval).
- business_analyst: metrics, reporting, dashboards, briefs.
- workflow_automation: repeatable/batch operations, scheduled work.

Rules:
1. Be strict about "achieved". Only set achieved when the success criteria are demonstrably met by evidence in the task results. "In progress" is not achieved.
2. If not achieved, produce at most 3 concrete actions, each assigned to one specialist, each with a specific instruction — not a vague theme.
3. Do not repeat work that already succeeded. Read the results and gaps first.
4. Never plan to send email or contact a real person without approval being required — drafting is fine.
5. If the goal needs information a human must supply, set achieved=false and put the blocker in gaps, with an action assigned to communication to draft the question.

Return JSON only: {"achieved": boolean, "reasoning": string, "gaps": string[], "actions": [{"agentSlug": string, "objective": string, "prompt": string}]}`,
      },
      {
        role: "user",
        content: `GOAL: ${params.goal.title}
OBJECTIVE: ${params.goal.objective}
SUCCESS CRITERIA: ${params.goal.successCriteria}
ROUND: ${params.goal.round + 1} of ${params.goal.maxRounds}

WORK SO FAR (tasks):
${params.tasks}

TEAM THREAD:
${params.transcript || "(no messages yet)"}`,
      },
    ],
    'JSON with "achieved" boolean, "reasoning" string, "gaps" string array, "actions" array of {agentSlug, objective, prompt}.',
    {
      profile: "reasoning",
      temperature: 0.2,
      maxTokens: 1600,
      responseFormat: "json_object",
      userId: "",
      source: "agent",
      agentSlug: "chief_of_staff",
    }
  );

  const actions = Array.isArray(result?.actions) ? result.actions : [];
  return {
    achieved: Boolean(result?.achieved),
    reasoning: String(result?.reasoning ?? "").slice(0, 2000),
    gaps: Array.isArray(result?.gaps) ? result.gaps.map((gap) => String(gap).slice(0, 300)) : [],
    actions: actions
      .filter((action) => action && typeof action.agentSlug === "string" && params.team.includes(action.agentSlug))
      .slice(0, 3)
      .map((action) => ({
        agentSlug: String(action.agentSlug),
        objective: String(action.objective ?? "").slice(0, 300),
        prompt: String(action.prompt ?? "").slice(0, 2000),
      })),
  };
}

/**
 * Advances one goal by a single round. Safe to call repeatedly: it refuses to
 * act while work is still in flight, so the loop never piles up parallel rounds.
 */

/** Which Prisma model a countable goal metric refers to. */
const METRIC_MODEL: Record<string, "lead" | "deal" | "task" | "contact"> = {
  leads: "lead",
  deals: "deal",
  tasks: "task",
  contacts: "contact",
};

/**
 * Counts the records created since the goal started. This is the part that
 * makes "achieved" a fact: the orchestrator cannot declare success while the
 * database disagrees with the number the owner asked for.
 */
export async function verifyGoalData(goal: {
  id: string;
  metric: string | null;
  minValue: number | null;
  createdAt: Date;
}): Promise<{ verified: boolean; produced: number; target: number | null; metric: string | null }> {
  if (!goal.metric || goal.minValue == null) {
    return { verified: true, produced: 0, target: null, metric: null };
  }
  const model = METRIC_MODEL[goal.metric];
  if (!model) return { verified: true, produced: 0, target: null, metric: goal.metric };

  // Explicit switch: Prisma's model union has incompatible overloads, and the
  // compiler is right to reject a dynamic index.
  let produced = 0;
  if (model === "lead") produced = await db.lead.count({ where: { createdAt: { gte: goal.createdAt } } });
  else if (model === "deal") produced = await db.deal.count({ where: { createdAt: { gte: goal.createdAt } } });
  else if (model === "task") produced = await db.task.count({ where: { createdAt: { gte: goal.createdAt } } });
  else if (model === "contact") produced = await db.contact.count({ where: { createdAt: { gte: goal.createdAt } } });
  return {
    verified: produced >= goal.minValue,
    produced,
    target: goal.minValue,
    metric: goal.metric,
  };
}

export async function advanceGoal(
  goalId: string,
  options: { force?: boolean } = {}
): Promise<{ advanced: boolean; status: string; round: number; created: number; reason?: string }> {
  const goal = await db.aiGoal.findUnique({ where: { id: goalId } });
  if (!goal) return { advanced: false, status: "MISSING", round: 0, created: 0, reason: "Goal not found" };
  if (goal.status !== "ACTIVE") {
    return { advanced: false, status: goal.status, round: goal.round, created: 0, reason: `Goal is ${goal.status.toLowerCase()}` };
  }

  // Wait for the current round's work before planning the next one.
  const inFlight = await db.aiTask.count({ where: { goalId, status: { in: [...IN_FLIGHT] } } });
  if (inFlight > 0 && !options.force) {
    const awaiting = await db.aiTask.count({ where: { goalId, status: { in: ["AWAITING_APPROVAL", "PAUSED"] } } });
    // Say why nothing is moving, in the thread the owner actually reads.
    if (awaiting > 0) {
      const last = await db.aiAgentMessage.findFirst({
        where: { goalId, kind: "SYSTEM", body: { contains: "awaiting your approval" } },
        orderBy: { createdAt: "desc" },
        select: { id: true, createdAt: true },
      });
      const fresh = !last || Date.now() - last.createdAt.getTime() > 30 * 60_000;
      if (fresh) {
        await db.aiAgentMessage.create({
          data: {
            goalId,
            kind: "SYSTEM",
            body: `${awaiting} piece(s) of work are awaiting your approval — the team is paused until you act on them.`,
          },
        });
      }
    }
    return {
      advanced: false,
      status: goal.status,
      round: goal.round,
      created: 0,
      reason: awaiting > 0 ? `${awaiting} task(s) awaiting approval` : `${inFlight} task(s) still running`,
    };
  }

  if (goal.round >= goal.maxRounds) {
    await db.aiGoal.update({
      where: { id: goal.id },
      data: { status: "PAUSED", lastAdvancedAt: new Date() },
    });
    await db.aiAgentMessage.create({
      data: {
        goalId: goal.id,
        kind: "SYSTEM",
        body: `Paused after ${goal.round} rounds without meeting the success criteria. A human needs to decide whether to continue or change the goal.`,
      },
    });
    return { advanced: false, status: "PAUSED", round: goal.round, created: 0, reason: "Round budget exhausted" };
  }

  const [transcript, tasks] = await Promise.all([buildTranscript(goal.id), summariseTasks(goal.id)]);
  const evaluation = await evaluateGoal({
    goal: {
      id: goal.id,
      title: goal.title,
      objective: goal.objective,
      successCriteria: goal.successCriteria,
      round: goal.round,
      maxRounds: goal.maxRounds,
    },
    transcript,
    tasks,
    team: DEFAULT_TEAM,
  });

  const nextRound = goal.round + 1;
  const verified = await verifyGoalData({
    id: goal.id,
    metric: goal.metric,
    minValue: goal.minValue,
    createdAt: goal.createdAt,
  });

  // The model may claim success, but the number is the truth: if the owner asked
  // for 20 leads and only 6 exist, the goal is not done.
  const actuallyAchieved =
    evaluation.achieved &&
    (verified.target == null
      ? true
      : verified.verified);

  if (!verified.verified && verified.target != null && evaluation.achieved) {
    evaluation.achieved = false;
    evaluation.gaps.push(
      `The team believes it is done, but only ${verified.produced} of the ${verified.target} ${verified.metric} exist in the CRM. Keep going.`
    );
  }

  if (actuallyAchieved) {
    await db.aiGoal.update({
      where: { id: goal.id },
      data: {
        status: "ACHIEVED",
        round: nextRound,
        achievedAt: new Date(),
        lastAdvancedAt: new Date(),
        lastEvaluation: evaluation.reasoning,
      },
    });
    await db.aiAgentMessage.create({
      data: {
        goalId: goal.id,
        kind: "SYSTEM",
        body: `Goal achieved: ${evaluation.reasoning || "success criteria met"}${
          verified.target != null ? ` (${verified.produced}/${verified.target} ${verified.metric} verified in the CRM)` : ""
        }`,
      },
    });
    if (goal.createdById) {
      await db.notification
        .create({
          data: {
            userId: goal.createdById,
            type: "SYSTEM",
            title: `Goal achieved: ${goal.title}`,
            body: (evaluation.reasoning || "The team met your success criteria.").slice(0, 300),
            href: `/ai/team?goal=${goal.id}`,
          },
        })
        .catch(() => {});
    }
    return { advanced: true, status: "ACHIEVED", round: nextRound, created: 0 };
  }

  // Record the plan and the assignments in the shared thread, so the team's
  // reasoning is visible rather than buried in a database column.
  await db.aiAgentMessage.create({
    data: {
      goalId: goal.id,
      kind: "SYSTEM",
      body:
        `Round ${nextRound} plan: ${evaluation.reasoning || "continuing"}` +
        (evaluation.gaps.length ? ` Gaps: ${evaluation.gaps.join("; ")}` : ""),
    },
  });

  let created = 0;
  for (const [index, action] of evaluation.actions.entries()) {
    const agent = await db.aiAgent.findUnique({ where: { slug: action.agentSlug }, select: { slug: true, name: true } });
    if (!agent) continue;

    try {
      const task = await createAndDispatchTask({
        objective: action.objective || `${goal.title}: ${action.agentSlug}`,
        prompt: `${action.prompt}\n\nContext — goal: ${goal.objective}\nSuccess criteria: ${goal.successCriteria}`,
        requestingUserId: goal.createdById ?? "",
        assignedAgentSlug: action.agentSlug,
        idempotencyKey: `goal-${goal.id}-r${nextRound}-${index}`,
        goalId: goal.id,
      });
      if (!task) continue;
      created += 1;
      await db.aiAgentMessage.create({
        data: {
          goalId: goal.id,
          kind: "AGENT",
          fromAgentSlug: "chief_of_staff",
          toAgentSlug: action.agentSlug,
          taskId: task.id,
          body: `@${action.agentSlug}: ${action.objective}`,
        },
      });
    } catch (error: any) {
      console.error(`[GoalRunner] Could not dispatch ${action.agentSlug}:`, error?.message ?? error);
    }
  }

  await db.aiGoal.update({
    where: { id: goal.id },
    data: {
      round: nextRound,
      lastAdvancedAt: new Date(),
      lastEvaluation: evaluation.reasoning,
      ...(created === 0 ? { status: "PAUSED" } : {}),
    },
  });

  if (created === 0) {
    await db.aiAgentMessage.create({
      data: {
        goalId: goal.id,
        kind: "SYSTEM",
        body: "Paused: the orchestrator could not produce a usable next step. A human should refine the goal or success criteria.",
      },
    });
  }

  return { advanced: true, status: created === 0 ? "PAUSED" : goal.status, round: nextRound, created };
}

/**
 * Called from the minute sweep. Advances at most a couple of goals so a long
 * goal cannot starve routines, and only those whose round has gone quiet.
 */
export async function sweepGoals(now: Date = new Date(), limit = 2): Promise<number> {
  const quietSince = new Date(now.getTime() - 2 * 60_000);
  const candidates = await db.aiGoal.findMany({
    where: {
      status: "ACTIVE",
      OR: [{ lastAdvancedAt: null }, { lastAdvancedAt: { lt: quietSince } }],
    },
    orderBy: { lastAdvancedAt: "asc" },
    take: limit,
    select: { id: true },
  });

  let advanced = 0;
  for (const candidate of candidates) {
    try {
      const result = await advanceGoal(candidate.id);
      if (result.advanced) advanced += 1;
    } catch (error) {
      console.error(`[GoalRunner] Goal ${candidate.id} failed:`, error);
    }
  }
  return advanced;
}
