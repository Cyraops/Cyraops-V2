import { db } from "@/lib/db";
import { providerManager } from "../provider-manager";
import { toolRegistry } from "../tools/registry";
import { normalizeApprovalMode, resolveToolPolicy, type ApprovalMode, type PolicyRule } from "../policy/resolve-action";
import "../tools/crm-tools";
import type { ChatMessage, ToolCallPayload } from "../types";

function parseToolIds(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((id): id is string => typeof id === "string");
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function inputSchemaToJsonSchema(schema: Record<string, any>): Record<string, any> {
  const properties: Record<string, any> = {};
  const required: string[] = [];
  const typeMap: Record<string, string> = {
    string: "string",
    number: "number",
    boolean: "boolean",
    integer: "integer",
    object: "object",
    array: "array",
  };
  // String shorthand supports enums too: "LOW|MEDIUM|HIGH".
  const enumMap: Record<string, string[]> = {};

  for (const [key, value] of Object.entries(schema || {})) {
    let optional = false;
    let raw: any = value;
    if (typeof raw === "string" && raw.endsWith("?")) {
      optional = true;
      raw = raw.slice(0, -1);
    }

    if (typeof raw === "string" && raw.includes("|")) {
      const choices = raw.split("|").map((choice) => choice.trim()).filter(Boolean);
      properties[key] = { type: "string", enum: choices };
    } else if (raw === "object") {
      properties[key] = { type: "object", additionalProperties: true };
    } else if (raw === "array") {
      properties[key] = { type: "array", items: {} };
    } else if (typeof raw === "string" && typeMap[raw]) {
      properties[key] = { type: typeMap[raw] };
    } else if (raw && typeof raw === "object" && typeof raw.type === "string") {
      // Object form keeps description, enum, items and friends intact.
      properties[key] = { ...raw };
    } else {
      // Unknown shorthand: pass it through as text rather than pretending.
      properties[key] = { type: "string" };
    }

    if (!optional) required.push(key);
  }

  return { type: "object", properties, ...(required.length ? { required } : {}) };
}

function toolToFunction(tool: ReturnType<typeof toolRegistry.getTool>): any {
  return {
    type: "function",
    function: {
      name: tool!.id,
      description: tool!.description,
      parameters: inputSchemaToJsonSchema(tool!.inputSchema),
    },
  };
}

export interface ChatTurnMessage {
  role: "user" | "assistant";
  content: string;
  senderName?: string;
}

export interface PendingToolCall {
  toolId: string;
  toolName: string;
  arguments: Record<string, any>;
  /** Whether the card may offer "always allow this tool". */
  canAlwaysAllow?: boolean;
  /** Why it needs a person, shown on the card. */
  reason?: string;
}

export interface AgentChatTurnResult {
  reply: string;
  toolCallsUsed: string[];
  pendingAction?: PendingToolCall;
}

export interface TurnAgentConfig {
  slug: string;
  name: string;
  systemPrompt: string;
  modelProfile: string;
  temperature: number;
  maxTokens: number;
  tools: string;
  model?: string;
}

/**
 * One conversational turn for an agent.
 *
 * Read tools (CLASS_A) execute immediately with live results. Write tools
 * (CLASS_B) are surfaced as a single pending action that the user must approve
 * before anything executes — nothing is written automatically.
 */
export async function runAgentChatTurn(params: {
  agent: TurnAgentConfig;
  history: ChatTurnMessage[];
  actorUserId: string;
  actorUserRole?: string;
  onToken?: (chunk: string) => void;
  /** Fired as each tool starts, so the UI can show work in progress. */
  onTool?: (name: string) => void;
  /** Fired when a tool finishes, with its outcome and duration. */
  onToolDone?: (name: string, ok: boolean, durationMs: number) => void;
  /** How much this assistant asks before acting, and its standing answers. */
  approvalMode?: ApprovalMode | string;
  approvalRules?: PolicyRule[];
  /** Nobody is watching this run, so a card waits instead of blocking. */
  unattended?: boolean;
  /** Recorded on each tool call so assistant actions are inspectable. */
  conversationId?: string;
}): Promise<AgentChatTurnResult> {
  const toolIds = parseToolIds(params.agent.tools);
  /**
   * Every declared tool is offered to the model, including CLASS_C.
   *
   * CLASS_C used to be filtered out here, which meant an irreversible action
   * such as sending email was invisible to the model: it could not call the
   * tool, so it wrote the request as text ("I've queued that email") or emitted
   * raw markup. Hiding a tool does not make it safe — the approval gate does
   * that, and it runs after the model asks. The gate, not the filter, is the
   * boundary.
   */
  const tools = toolIds
    .map((id) => toolRegistry.getTool(id))
    .filter((tool): tool is NonNullable<typeof tool> => Boolean(tool));

  const functions = tools.map(toolToFunction);

  const systemPrompt = `${params.agent.systemPrompt}

You are ${params.agent.name}, talking to a signed-in user.
- Reply in plain, concise, conversational sentences.
- Use read tools for live CRM data; never invent records, numbers or statuses.
- You may propose write actions (creating, updating). When you do, state clearly what you will do; the user must approve it before it runs.
- Do not claim you performed a write action unless it was approved and executed.`;

  const messages: ChatMessage[] = [{ role: "system", content: systemPrompt }];

  // The assistant's own turns belong in the history. Dropping them made it
  // structurally amnesiac: it re-asked answered questions, lost every "yes, do
  // that" / "the second one" referent, and contradicted its last reply. The
  // window is already budgeted by the caller, so nothing is re-sliced here.
  for (const item of params.history) {
    const content = String(item.content ?? "").trim();
    if (!content) continue;
    if (item.role === "assistant") {
      messages.push({ role: "assistant", content });
      continue;
    }
    const label = item.senderName ? `${item.senderName}: ` : "";
    messages.push({ role: "user", content: `${label}${content}` });
  }

  const provider = await providerManager.getProviderForModel(params.agent.model);
  const toolCallsUsed: string[] = [];
  let finalContent = "";
  let pendingAction: PendingToolCall | undefined;
  const mode = normalizeApprovalMode(params.approvalMode);
  const rules = params.approvalRules ?? [];
  // Set once any tool returns text an outsider could have written. From then on
  // the run cannot take consequential actions without a person.
  let runTainted = false;
  /** The provider hit its output limit; say so instead of ending mid-sentence. */
  let truncated = false;

  for (let round = 0; round < 6; round += 1) {
    const toolRoundBudget = Math.max(1024, Math.min(params.agent.maxTokens || 4096, 2048));
    const requestTools = () =>
      provider.chat(messages, {
        model: params.agent.model,
        temperature: params.agent.temperature,
        maxTokens: toolRoundBudget,
        tools: functions.length > 0 ? functions : undefined,
        userId: params.actorUserId,
        source: "agent",
        agentSlug: params.agent.slug,
      });

    let result: Awaited<ReturnType<typeof requestTools>>;
    try {
      result = await requestTools();
    } catch (err: any) {
      // DeepSeek counts reasoning tokens against max_tokens, so a tool call can
      // arrive cut off mid-JSON. One retry usually lands cleanly; without it the
      // whole turn surfaced as "the assistant failed to reply".
      if (!/json|parse|unexpected|unterminated|invalid/i.test(String(err?.message || ""))) throw err;
      console.warn("[agent-turn] retrying after unreadable model output:", err?.message);
      result = await requestTools();
    }

    const toolCalls: ToolCallPayload[] = result.toolCalls ?? [];
    if (toolCalls.length === 0) {
      if (params.onToken) {
        // Stream the final answer so the UI receives tokens live.
        const streamed = await provider.stream(
          messages,
          {
            model: params.agent.model,
            temperature: params.agent.temperature,
            maxTokens: Math.max(1024, Math.min(params.agent.maxTokens || 4096, 4096)),
            userId: params.actorUserId,
            source: "agent",
            agentSlug: params.agent.slug,
          },
          params.onToken
        );
        finalContent = streamed.content || result.content;
        if (streamed.truncated) truncated = true;
      } else {
        finalContent = result.content;
        if (result.truncated) truncated = true;
      }
      break;
    }

    messages.push({ role: "assistant", content: result.content || "", toolCalls });

    for (const call of toolCalls) {
      const tool = toolRegistry.getTool(call.name);
      if (!tool) {
        messages.push({
          role: "tool",
          toolCallId: call.id,
          name: call.name,
          content: JSON.stringify({ success: false, error: "Unknown tool." }),
        });
        continue;
      }

      // A tool whose arguments did not parse is not executed at all: running a
      // filtered search with {} returns everything, and a write with {} proposes
      // an empty card. Hand the error back so the model re-issues the call.
      if (call.parseError) {
        messages.push({
          role: "tool",
          toolCallId: call.id,
          name: call.name,
          content: JSON.stringify({
            success: false,
            error: `${call.parseError} Re-issue the call with complete, valid arguments.`,
          }),
        });
        continue;
      }

      // One place decides: deny rules, security boundaries, taint and the
      // assistant's own approval mode. The old check was `riskClass !== "CLASS_A"`.
      const policy = resolveToolPolicy({
        tool,
        rules,
        mode,
        runTainted,
        unattended: params.unattended,
      });

      if (policy.decision === "deny") {
        // Tell the model plainly so it stops trying and explains itself.
        messages.push({
          role: "tool",
          toolCallId: call.id,
          name: call.name,
          content: JSON.stringify({
            success: false,
            error: `${policy.reason} Do not try another way; tell the user it is blocked.`,
          }),
        });
        continue;
      }

      if (policy.decision === "ask") {
        // Consequential action: stop and ask the user for approval.
        pendingAction = {
          toolId: tool.id,
          toolName: tool.name,
          arguments: call.arguments || {},
          canAlwaysAllow: policy.canAlwaysAllow,
          reason: policy.reason,
        };
        finalContent =
          result.content || `I'd like to run "${tool.name}". Review and approve it below.`;
        break;
      }

      toolCallsUsed.push(call.name);
      params.onTool?.(call.name);
      const startedAt = Date.now();
      const execution = await toolRegistry.executeTool(call.name, call.arguments || {}, {
        userId: params.actorUserId,
        userRole: params.actorUserRole,
        agentSlug: params.agent.slug,
        // Gives the assistant a tool-call history (who ran what, when) instead
        // of leaving every call invisible.
        conversationId: params.conversationId,
      });
      params.onToolDone?.(call.name, execution.success !== false, Date.now() - startedAt);

      if (tool.taintsRun) runTainted = true;

      // Cap what a tool can inject into the context: an unbounded result used
      // to be able to blow the window mid-turn and kill the entire reply.
      const payload = JSON.stringify({
        success: execution.success,
        data: execution.data ?? null,
        error: execution.error ?? null,
      });
      const TOOL_RESULT_LIMIT = 12_000;
      messages.push({
        role: "tool",
        toolCallId: call.id,
        name: call.name,
        content:
          payload.length > TOOL_RESULT_LIMIT
            ? `${payload.slice(0, TOOL_RESULT_LIMIT)}… [truncated ${payload.length - TOOL_RESULT_LIMIT} chars]`
            : payload,
      });
    }

    if (pendingAction) break;
  }

  if (truncated && finalContent) {
    finalContent = `${finalContent}\n\n_(Cut short by the model's output limit — ask me to continue.)_`;
  }

  if (!finalContent) {
    finalContent = toolCallsUsed.length
      ? "I've gathered the information, but I couldn't summarise it cleanly. Please ask me to narrow it down."
      : "I don't have enough to answer that yet.";
  }

  return { reply: finalContent, toolCallsUsed, pendingAction };
}

export function matchAgentMentions(
  body: string,
  agents: Array<{ slug: string; name: string }>
): Array<{ slug: string; name: string }> {
  const mentioned = new Set<string>();
  const matches = body.toLowerCase().match(/@([a-z0-9_]+)/g) || [];

  for (const match of matches) {
    const key = match.slice(1);
    for (const agent of agents) {
      const nameTokens = agent.name.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length >= 3);
      const keys = new Set([agent.slug, ...nameTokens]);
      if (keys.has(key)) {
        mentioned.add(agent.slug);
      }
    }
  }

  return agents.filter((agent) => mentioned.has(agent.slug));
}

export async function listActiveAgents() {
  return await db.aiAgent.findMany({
    where: { status: "ACTIVE" },
    select: { id: true, slug: true, name: true },
    orderBy: [{ isMaster: "desc" }, { name: "asc" }],
  });
}
