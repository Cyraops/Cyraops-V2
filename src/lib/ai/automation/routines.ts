import { db } from "@/lib/db";
import { createAndDispatchTask } from "../orchestrator/dispatcher";

export const DEFAULT_SKILLS = [
  {
    slug: "lead_hygiene_audit",
    name: "Lead Hygiene & Enrichment Audit",
    description: "Audits leads for missing contact data, flags inactive prospects, and calculates up-to-date qualification scores.",
    instructions: "Query all active leads. Verify company domains, phone records, and calculate scores based on available details.",
    requiredTools: ["search_leads", "update_lead", "qualify_lead"],
  },
  {
    slug: "pipeline_risk_review",
    name: "Pipeline Risk & Stalled Deal Review",
    description: "Evaluates active opportunities open longer than 30 days and generates proactive mitigation plans.",
    instructions: "Inspect active deals in DISCOVERY or PROPOSAL stage with long cycle times. Generate recommended next steps.",
    requiredTools: ["search_deals", "analyze_deal", "create_task"],
  },
  {
    slug: "executive_weekly_brief",
    name: "Executive Weekly CRM Brief",
    description: "Generates an end-of-week executive briefing consolidating win rates, deal velocity, and pipeline forecasts.",
    instructions: "Generate sales, pipeline, and management reports. Synthesize key highlights into an executive summary.",
    requiredTools: ["get_sales_report", "get_pipeline_report", "generate_management_report"],
  },
  {
    slug: "instagram_daily_plan",
    name: "Instagram Daily Plan",
    description: "Prepares a daily Instagram plan for Cyraops: captions ready to approve, open decisions, and the manual actions the Instagram API cannot perform.",
    instructions: "Build today's Instagram plan from CRM activity. Produce captions ready for approval, list open decisions, and list the manual actions a human must perform in the Instagram app. Never claim Instagram analytics.",
    requiredTools: ["get_sales_report", "search_leads", "search_deals"],
  },
];

export async function ensureDefaultSkills(): Promise<void> {
  try {
    for (const skill of DEFAULT_SKILLS) {
      await db.aiSkill.upsert({
        where: { slug: skill.slug },
        update: {
          name: skill.name,
          description: skill.description,
          instructions: skill.instructions,
          requiredTools: JSON.stringify(skill.requiredTools),
        },
        create: {
          slug: skill.slug,
          name: skill.name,
          description: skill.description,
          instructions: skill.instructions,
          requiredTools: JSON.stringify(skill.requiredTools),
        },
      });
    }
  } catch (error) {
    console.error("[Skills] Failed to seed default skills:", error);
  }
}

/**
 * Seeds the daily Instagram brief routine.
 *
 * Cron is evaluated in the container timezone, which is pinned to Asia/Kolkata
 * in the deployment, so "0 9 * * *" means 09:00 IST.
 */
export async function ensureDefaultRoutine(): Promise<void> {
  try {
    const [skill, agent] = await Promise.all([
      db.aiSkill.findUnique({ where: { slug: "instagram_daily_plan" } }),
      db.aiAgent.findUnique({ where: { slug: "business_analyst" } }),
    ]);

    if (!skill || !agent) return;

    const existing = await db.aiRoutine.findFirst({ where: { name: "Instagram Daily Plan" } });
    if (existing) return;

    await db.aiRoutine.create({
      data: {
        name: "Instagram Daily Plan",
        description: "Delivers the daily Instagram plan every morning at 09:00 IST.",
        cronExpression: "0 9 * * *",
        skillId: skill.id,
        agentId: agent.id,
        isEnabled: true,
      },
    });
  } catch (error) {
    console.error("[Skills] Failed to seed the Instagram daily routine:", error);
  }
}

export async function listSkills() {
  await ensureDefaultSkills();
  return await db.aiSkill.findMany({
    orderBy: { createdAt: "asc" },
  });
}

export async function listRoutines() {
  return await db.aiRoutine.findMany({
    include: { skill: true, agent: true },
    orderBy: { createdAt: "desc" },
  });
}

export async function executeRoutine(routineId: string, userId: string, occurrenceKey?: string) {
  const routine = await db.aiRoutine.findUnique({
    where: { id: routineId },
    include: { skill: true, agent: true },
  });

  if (!routine) throw new Error("Routine not found");
  if (routine.agent.slug === "workflow_automation") {
    throw new Error("A routine cannot be assigned to Workflow Automation because that would recursively launch another routine.");
  }

  const task = await createAndDispatchTask({
    objective: `Automated Routine: ${routine.name}`,
    prompt: routine.skill.instructions,
    requestingUserId: userId,
    assignedAgentSlug: routine.agent.slug,
    // One task per occurrence. Without this a retry, a lease steal or a
    // redeploy mid-run created a second identical task and did the work twice.
    ...(occurrenceKey ? { idempotencyKey: `routine-${routineId}-${occurrenceKey}` } : {}),
  });
  if (!task) throw new Error("Routine dispatcher did not return a task.");

  await db.aiRoutine.update({
    where: { id: routineId },
    data: {
      lastRunAt: new Date(),
      lastStatus: task.status,
    },
  });

  return task;
}

