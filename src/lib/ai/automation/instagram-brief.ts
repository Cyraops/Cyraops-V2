import { db } from "@/lib/db";
import { providerManager } from "../provider-manager";

export interface InstagramBrief {
  headline: string;
  readyToApprove: Array<{ caption: string; hashtags: string[]; imageIdea: string; rationale: string }>;
  decisions: string[];
  manualActions: Array<{ action: string; suggestedText: string; where: string }>;
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

/**
 * Collects the material the brief is written from. Everything here is already
 * in the CRM, so the assistant never has to invent activity — and it never
 * implies it has Instagram analytics, because it does not.
 */
async function gatherMaterial() {
  const since = daysAgo(45);

  const [completedProjects, activeProjects, wonLeads, urgentTasks] = await Promise.all([
    db.project.findMany({
      where: { archivedAt: null, status: "COMPLETED", updatedAt: { gte: since } },
      select: { name: true, description: true, updatedAt: true },
      orderBy: { updatedAt: "desc" },
      take: 6,
    }),
    db.project.findMany({
      where: { archivedAt: null, status: { in: ["PLANNING", "ACTIVE", "ON_HOLD"] } },
      select: { name: true, status: true, priority: true },
      orderBy: { updatedAt: "desc" },
      take: 8,
    }),
    db.lead.findMany({
      where: { status: "CONVERTED", updatedAt: { gte: since } },
      select: { title: true, companyName: true, estimatedValue: true, updatedAt: true },
      orderBy: { updatedAt: "desc" },
      take: 5,
    }),
    db.task.findMany({
      where: { archivedAt: null, status: { not: "DONE" }, dueDate: { lte: new Date(Date.now() + 7 * 86400000) } },
      select: { title: true, dueDate: true },
      orderBy: { dueDate: "asc" },
      take: 5,
    }),
  ]);

  const wonDeals = await db.deal.findMany({
    where: { stage: "CLOSED_WON", updatedAt: { gte: since } },
    select: { title: true, value: true, updatedAt: true },
    orderBy: { updatedAt: "desc" },
    take: 5,
  });

  const workspace = await db.workspace.findUnique({
    where: { id: "main" },
    select: { name: true, socialLinks: true },
  });

  let instagramProfile: string | null = null;
  if (workspace?.socialLinks) {
    try {
      const parsed = JSON.parse(workspace.socialLinks);
      if (typeof parsed?.instagram === "string" && parsed.instagram.trim()) {
        instagramProfile = parsed.instagram.trim();
      }
    } catch {
      instagramProfile = null;
    }
  }

  return { completedProjects, activeProjects, wonLeads, wonDeals, urgentTasks, instagramProfile };
}

function formatMaterial(material: Awaited<ReturnType<typeof gatherMaterial>>): string {
  const lines: string[] = [];

  lines.push(`Instagram profile on file: ${material.instagramProfile || "NOT SET"}`);
  lines.push("");

  lines.push("Projects completed in the last 45 days:");
  lines.push(
    material.completedProjects.length
      ? material.completedProjects.map((p) => `- ${p.name}${p.description ? `: ${p.description.slice(0, 160)}` : ""}`).join("\n")
      : "- none"
  );
  lines.push("");

  lines.push("Active projects (potential work-in-progress content):");
  lines.push(
    material.activeProjects.length
      ? material.activeProjects.map((p) => `- ${p.name} [${p.status}/${p.priority}]`).join("\n")
      : "- none"
  );
  lines.push("");

  lines.push("Deals/leads won in the last 45 days:");
  lines.push(
    material.wonLeads.length
      ? material.wonLeads
          .map((l) => `- ${l.companyName || l.title}${l.estimatedValue ? ` (value ${l.estimatedValue})` : ""}`)
          .join("\n")
      : "- none"
  );
  lines.push("");

  lines.push("Deals closed won in the last 45 days:");
  lines.push(
    material.wonDeals.length
      ? material.wonDeals.map((d) => `- ${d.title}${d.value ? ` (value ${d.value})` : ""}`).join("\n")
      : "- none"
  );
  lines.push("");

  lines.push("Tasks due within 7 days:");
  lines.push(material.urgentTasks.length ? material.urgentTasks.map((t) => `- ${t.title}`).join("\n") : "- none");

  return lines.join("\n");
}

/**
 * Produces today's Instagram plan for Cyraops.
 *
 * Deliberately explicit about its sources: it reasons only from CRM records and
 * has no Instagram analytics, follower counts or inbox access, so it must not
 * imply otherwise.
 */
export async function buildInstagramBrief(actor: { userId: string }): Promise<InstagramBrief> {
  const material = await gatherMaterial();
  const provider = providerManager.getProvider();

  const systemPrompt = `You are the Cyraops social media operations assistant.
You produce the daily Instagram action plan for a small IT services and consulting company.

WHAT YOU KNOW:
- The CRM records listed by the user message.
- The Instagram profile URL on file, if any.

WHAT YOU DO NOT KNOW — never imply otherwise:
- You have NO Instagram analytics, follower counts, reach, engagement, comments or DMs.
- You have NOT seen any post performance.
- Never invent metrics, testimonials, client names, or results.

RULES:
1. Base every suggestion on real CRM activity listed. If there is little activity, say so and suggest evergreen angles instead of inventing achievements.
2. Write captions in a confident, specific, non-corporate voice, 1-3 short paragraphs, no emojis unless they carry meaning. Include a call to action when natural.
3. Never name a client without it already appearing in the CRM data, and never include confidential project detail.
4. Put anything the Instagram API cannot do (replying to DMs, answering comments, editing the bio, following accounts) under manualActions, with the exact text a human should paste.
5. Keep decisions to genuine open questions where a human choice changes the content.
6. Return at most 2 readyToApprove items, 2 decisions and 3 manualActions. Be brief: captions under 120 words, decisions and manualActions one sentence each.

Return a JSON object:
{
  "headline": "one line summarising today's focus",
  "readyToApprove": [{ "caption": "", "hashtags": ["..."], "imageIdea": "", "rationale": "" }],
  "decisions": ["..."],
  "manualActions": [{ "action": "", "suggestedText": "", "where": "" }]
}`;

  const messages = [
    { role: "system" as const, content: systemPrompt },
    { role: "user" as const, content: `Today is ${new Date().toISOString().slice(0, 10)}.\n\nCRM material:\n${formatMaterial(material)}` },
  ];

  const callProvider = (temperature: number, maxTokens: number) =>
    provider.generateStructuredOutput<InstagramBrief>(
      messages,
      "JSON object with headline, readyToApprove, decisions and manualActions.",
      {
        profile: "general",
        temperature,
        // DeepSeek spends part of the budget on reasoning tokens at the default
        // effort level, so a tight limit truncates the JSON mid-string.
        maxTokens,
        responseFormat: "json_object",
        userId: actor.userId,
        source: "agent",
        agentSlug: "instagram_daily_plan",
      }
    );

  let brief: InstagramBrief;
  try {
    brief = await callProvider(0.4, 4000);
  } catch (err: any) {
    if (!/parse structured AI output/i.test(err?.message || "")) throw err;
    // One tightened retry: shorter, stricter output usually parses cleanly.
    console.warn("[InstagramBrief] First attempt returned unparseable JSON; retrying with stricter settings.");
    brief = await callProvider(0.2, 4000);
  }

  if (!brief || typeof brief.headline !== "string") {
    throw new Error("The AI provider returned an invalid Instagram brief.");
  }

  return {
    headline: brief.headline,
    readyToApprove: Array.isArray(brief.readyToApprove) ? brief.readyToApprove.slice(0, 3) : [],
    decisions: Array.isArray(brief.decisions) ? brief.decisions.slice(0, 3) : [],
    manualActions: Array.isArray(brief.manualActions) ? brief.manualActions.slice(0, 5) : [],
  };
}

export function formatBriefForNotification(brief: InstagramBrief): string {
  const parts: string[] = [];
  parts.push(brief.headline);

  if (brief.readyToApprove.length) {
    parts.push("");
    parts.push(`Ready for your approval (${brief.readyToApprove.length}):`);
    brief.readyToApprove.forEach((item, index) => {
      parts.push(`${index + 1}. ${item.caption}`);
      if (item.hashtags?.length) parts.push(`   ${item.hashtags.map((tag) => (tag.startsWith("#") ? tag : `#${tag}`)).join(" ")}`);
      if (item.imageIdea) parts.push(`   Image: ${item.imageIdea}`);
    });
  }

  if (brief.decisions.length) {
    parts.push("");
    parts.push("Needs your decision:");
    brief.decisions.forEach((item) => parts.push(`• ${item}`));
  }

  if (brief.manualActions.length) {
    parts.push("");
    parts.push("Do it yourself (the API cannot):");
    brief.manualActions.forEach((item) => {
      parts.push(`• ${item.action}${item.where ? ` — ${item.where}` : ""}`);
      if (item.suggestedText) parts.push(`   "${item.suggestedText}"`);
    });
  }

  parts.push("");
  parts.push("Based on CRM activity only — no Instagram analytics are connected yet.");

  return parts.join("\n");
}
