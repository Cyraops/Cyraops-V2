import { db } from "@/lib/db";
import { CORE_AGENTS, AgentDefinition } from "./definitions";

function isBlank(value: string | null | undefined): boolean {
  if (value === null || value === undefined) return true;
  const trimmed = value.trim();
  return trimmed === "" || trimmed === "[]" || trimmed === "{}";
}

export class AgentRegistry {
  private initialized = false;

  /**
   * Ensures the seven core agents exist.
   *
   * Existing rows are treated as operator-owned: prompts, tool allowlists and
   * permissions edited in the UI are preserved. Missing values are still seeded
   * so a partially-created row self-heals. Set SYNC_CORE_AGENTS=true to force
   * the shipped definitions over existing rows (required after changing a core
   * agent's tools in definitions.ts).
   */
  public async ensureDefaultAgents(): Promise<void> {
    const forceSync = process.env.SYNC_CORE_AGENTS === "true";

    try {
      for (const def of CORE_AGENTS) {
        const existing = await db.aiAgent.findUnique({ where: { slug: def.slug } });

        if (!existing) {
          await db.aiAgent.create({
            data: {
              slug: def.slug,
              name: def.name,
              role: def.role,
              description: def.description,
              systemPrompt: def.systemPrompt,
              modelProfile: def.modelProfile,
              temperature: def.temperature,
              maxTokens: def.maxTokens,
              isMaster: def.isMaster,
              isTemplate: true,
              status: "ACTIVE",
              tools: JSON.stringify(def.tools),
              permissions: JSON.stringify(def.permissions),
            },
          });
          continue;
        }

        const updates: Record<string, any> = {};

        if (forceSync) {
          updates.name = def.name;
          updates.role = def.role;
          updates.description = def.description;
          updates.systemPrompt = def.systemPrompt;
          updates.modelProfile = def.modelProfile;
          updates.temperature = def.temperature;
          updates.maxTokens = def.maxTokens;
          updates.isMaster = def.isMaster;
          updates.tools = JSON.stringify(def.tools);
          updates.permissions = JSON.stringify(def.permissions);
        } else {
          if (isBlank(existing.systemPrompt)) updates.systemPrompt = def.systemPrompt;
          if (isBlank(existing.tools)) updates.tools = JSON.stringify(def.tools);
          if (isBlank(existing.permissions)) updates.permissions = JSON.stringify(def.permissions);
        }

        if (Object.keys(updates).length > 0) {
          await db.aiAgent.update({ where: { slug: def.slug }, data: updates });
        }
      }
      this.initialized = true;
    } catch (error) {
      console.error("[AgentRegistry] Failed to initialize default agents:", error);
    }
  }

  public async getAgentBySlug(slug: string) {
    return await db.aiAgent.findUnique({
      where: { slug },
    });
  }

  public async getAgentById(id: string) {
    return await db.aiAgent.findUnique({
      where: { id },
    });
  }

  public async getMasterAgent() {
    return await db.aiAgent.findFirst({
      where: { isMaster: true, status: "ACTIVE" },
    });
  }

  public async listAgents(includeInactive: boolean = false) {
    return await db.aiAgent.findMany({
      where: includeInactive ? {} : { status: "ACTIVE" },
      orderBy: [{ isMaster: "desc" }, { name: "asc" }],
    });
  }

  public async updateAgent(
    slug: string,
    updates: Partial<{
      name: string;
      role: string;
      description: string;
      systemPrompt: string;
      modelProfile: string;
      temperature: number;
      maxTokens: number;
      status: string;
      tools: string[];
      permissions: string[];
    }>
  ) {
    const data: any = { ...updates };
    if (updates.tools) data.tools = JSON.stringify(updates.tools);
    if (updates.permissions) data.permissions = JSON.stringify(updates.permissions);

    return await db.aiAgent.update({
      where: { slug },
      data,
    });
  }

  public async createCustomAgent(
    def: AgentDefinition & { status?: string }
  ) {
    return await db.aiAgent.create({
      data: {
        slug: def.slug,
        name: def.name,
        role: def.role,
        description: def.description,
        systemPrompt: def.systemPrompt,
        modelProfile: def.modelProfile,
        temperature: def.temperature,
        maxTokens: def.maxTokens,
        isMaster: def.isMaster || false,
        isTemplate: false,
        status: def.status || "ACTIVE",
        tools: JSON.stringify(def.tools || []),
        permissions: JSON.stringify(def.permissions || []),
      },
    });
  }
}

export const agentRegistry = new AgentRegistry();

