import { NextRequest, NextResponse } from "next/server";
import { userFromRequest } from "@/lib/auth";
import { jsonError } from "@/lib/validators";
import { agentRegistry } from "@/lib/ai/agents/agent-registry";
import { db } from "@/lib/db";
import { toolRegistry } from "@/lib/ai/tools/registry";
import "../../../../lib/ai/tools/crm-tools";
import { getAllAgentsPresence } from "@/lib/ai/agents/presence";

export async function GET(request: NextRequest) {
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);

  await agentRegistry.ensureDefaultAgents();
  const [agents, agentStatus] = await Promise.all([
    agentRegistry.listAgents(true),
    getAllAgentsPresence(),
  ]);

  return NextResponse.json({
    agents,
    presence: agentStatus.presence,
    providerHealth: agentStatus.providerHealth,
  });
}

export async function POST(request: NextRequest) {
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);
  if (user.role === "MEMBER") {
    return jsonError("Only Owners and Admins can create agents", 403);
  }

  const body = await request.json().catch(() => ({}));
  const { name, role, description, systemPrompt, modelProfile, slug, templateSlug } = body;

  if (!name || !role) {
    return jsonError("Agent name and role are required", 400);
  }

  /**
   * Starting from a template: it supplies the wording and the abilities, and the
   * new bot is a copy. Editing the template itself is not allowed, precisely so
   * "start from Sales Agent" means the same thing tomorrow.
   */
  let template: { systemPrompt: string; description: string; role: string; tools: string; permissions: string } | null = null;
  if (templateSlug) {
    const found = await db.aiAgent.findUnique({
      where: { slug: String(templateSlug) },
      select: { systemPrompt: true, description: true, role: true, tools: true, permissions: true },
    });
    if (!found) return jsonError("That template does not exist", 400);
    template = found;
  }

  // Abilities are chosen per bot; anything unknown is refused rather than dropped.
  const requestedTools: string[] | undefined = Array.isArray(body.tools) ? body.tools.map(String) : undefined;
  if (requestedTools) {
    const unknown = requestedTools.filter((id) => !toolRegistry.getTool(id));
    if (unknown.length) return jsonError(`These abilities do not exist: ${unknown.join(", ")}`, 400);
  }

  const agentSlug = `custom_${slug || name.toLowerCase().replace(/[^a-z0-9]/g, "_")}`;

  try {
    const created = await agentRegistry.createCustomAgent({
      slug: agentSlug,
      name,
      role,
      description: description || template?.description || `Custom specialist: ${name}`,
      systemPrompt: systemPrompt || template?.systemPrompt || `You are ${name}, specializing in ${role}.`,
      modelProfile: modelProfile || "reasoning",
      temperature: 0.2,
      maxTokens: 4096,
      isMaster: false,
      tools: requestedTools ?? (template ? JSON.parse(template.tools) : ["search_companies", "search_leads", "search_deals", "create_task"]),
      permissions: template ? JSON.parse(template.permissions) : ["tasks:write", "leads:read"],
    });

    return NextResponse.json({ success: true, agent: created }, { status: 201 });
  } catch (err: any) {
    return jsonError(err?.message || "Failed to create custom agent", 500);
  }
}

