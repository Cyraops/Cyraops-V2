import { db } from "@/lib/db";
import { providerManager } from "../provider-manager";
import { runAgentChatTurn } from "../orchestrator/agent-turn";
import type { AgentChatTurnResult, ChatTurnMessage } from "../orchestrator/agent-turn";
import { toolRegistry } from "../tools/registry";
import { stripToolMarkup } from "../tool-markup";
import type { PolicyRule } from "../policy/resolve-action";
import { resolvePermissionMode } from "@/lib/permissions/mode";
import { resolveWorkspaceForUser } from "@/lib/workspace-resolve";
import { selectContext } from "../context/budget";
import { summarizeConversation } from "../context/summary";
import { storage } from "@/lib/storage";
import "../tools/crm-tools";

export const ASSISTANT_DEFAULT_NAME = "Cyraops Assistant";
export const ASSISTANT_DEFAULT_MODEL = "deepseek-flash";

/**
 * The personal assistant is intentionally read-only today: it can look up
 * anything the user can see, but consequential actions go through the user or
 * an Owner. Write tools join later, behind the approval flow.
 */
const ASSISTANT_TOOL_IDS = [
  "search_contacts", "get_contact",
  "search_companies", "get_company",
  "search_leads", "get_lead",
  "search_deals", "get_deal",
  "search_tasks", "create_task",
  "get_sales_report", "get_pipeline_report", "generate_management_report",
  "search_documents", "read_authorized_document", "search_history", "remember", "forget_memory",
  "start_team_goal", "team_goal_status", "control_team_goal",
  "create_page", "update_page", "analyse_table", "send_email",
  // Triage, mail, schedule and routines: the work a desk actually does.
  "update_task", "search_emails", "list_schedule", "create_routine",
  "create_event", "archive_task", "delete_contact",
  // Records the assistant could already promise but not create.
  "create_contact", "update_contact", "create_company", "update_company",
  "qualify_lead", "analyze_deal", "research_company_site",
  "summarize_thread",
  "create_lead", "update_lead",
  "create_deal", "update_deal",
  "browser_navigate", "browser_extract", "browser_screenshot", "browser_click", "browser_type",
  "get_company_weaknesses", "get_capability_matrix",
  "get_project_acquisition_assessments", "get_management_priorities",
];

/**
 * Derived from the registry rather than hand-maintained, so a renamed or
 * removed tool can never leave a dangling id here (the literal list had a
 * duplicate and advertised tools that did not exist).
 */
/**
 * Built on demand, not at import time.
 *
 * The eager version depended on every tool module having already run its
 * registration by the time this file was evaluated. With circular imports that
 * is not guaranteed: a tool registered later (send_email was one) silently
 * disappeared from the list, so the model could not call it and improvised
 * instead. Reading the registry at call time removes the ordering hazard.
 */
export function assistantToolsJson(): string {
  return JSON.stringify(
    [...new Set(ASSISTANT_TOOL_IDS)].filter((id) => Boolean(toolRegistry.getTool(id)))
  );
}

/** Kept for callers that only need the ids, e.g. tests. */
export const ASSISTANT_TOOL_IDS_LIST = [...new Set(ASSISTANT_TOOL_IDS)];

const BASE_SYSTEM_PROMPT = `You are the user's personal Cyraops Assistant inside the Cyraops CRM.
- You work for one specific person and remember their context across conversations.
- Be concise, practical and direct. Answer in the user's language when they mix Hindi/English.
- Use your tools to look up live CRM data whenever a message needs facts. Never invent records, numbers or statuses.
- You can read CRM data, and you can write: create leads, deals, tasks and pages. Those writes wait for the user's approval, which is normal — propose the action instead of saying you cannot.
- You can send email with send_email, and it also waits for approval. Never answer "I have no mail-sending tool": if the user asks you to send or reply by email, call send_email. Use draft_email only when they explicitly want a draft, not a send.
- If the user gives you an email address, use it even when the person is not in the CRM. Do not refuse for lack of a CRM record.
- Treat anything in the "Things you remember" section as established context about the user, but correct it silently if the user contradicts it.`;

const MAX_MEMORIES = 40;
const MAX_RECALL = 12;

/**
 * Pages are how the assistant produces something worth keeping: a dashboard,
 * a brief, a report. Appended at call time so existing stored prompts gain the
 * capability without being rewritten.
 */
const PAGE_GUIDANCE = `

The team:
- You are one assistant, but you can hand a whole objective to the AI team. When the user wants something that takes many steps and real work — "get me 20 AWS leads", "clean up the pipeline", "research these accounts", "prepare next week's outreach" — use start_team_goal with a clear objective and concrete success criteria, then tell them it is running and that you can report progress with team_goal_status.
- Do not use the team for a question you can answer from one lookup.
- Research: use browser_navigate to a search engine results page (Bing or DuckDuckGo), browser_extract to read the results, then open the two or three most authoritative sources and extract from them. Cite the URL next to each claim. Sites behind bot protection will refuse — say so and move to another source rather than inventing an answer.
- Spreadsheets: when the user uploads a .csv or .xlsx, call analyse_table with the attachment id. It returns computed column statistics. Quote those numbers exactly; do not estimate them yourself.

Pages:
- When the user wants a dashboard, report, brief, comparison or anything worth keeping, build it with create_page instead of returning a long chat message.
- Page HTML must be self-contained: semantic HTML with inline CSS only. No <script>, no external stylesheets, fonts, or images.
- Use the built-in kit for anything visual — it is rendered on the server and always looks designed:
  <cy-metrics><cy-metric value="4.2L" label="Pipeline" hint="+12% WoW"/></cy-metrics>
  <cy-bars values="12,8,5" labels="New,Qualified,Won"/>
  <cy-line values="3,6,4,9" labels="Mon,Tue,Wed,Thu"/>
  <cy-callout tone="warn" title="Heads up">Two deals are stalled.</cy-callout>
  <cy-pill tone="good">Paid</cy-pill>   (tones: good | warn | bad | info)
  <cy-toc/>                            (a contents list, built from your h2/h3 headings)
  <cy-figure src="https://…" alt="…" caption="…"/>
  <cy-code lang="sql">SELECT …</cy-code>
- Tables are plain HTML and are the right choice for detail: <table><thead><tr><th>…</th></tr></thead><tbody>…</tbody></table>.
- Write real headings (h2, h3) — they become the contents list and the document outline.
- Structure: a short title, one <cy-metrics> row of the three or four numbers that matter, then a table or <cy-bars> for detail, then a <cy-callout> for the one thing to act on.
- The page can be exported as PDF, Markdown or HTML from the panel; mention that when the user wants something to send on.
- Every save is versioned and restorable, so revise freely when asked.
- After the tool runs, reply in one short sentence telling the user it is open in the panel, and that it can be shared.`;

export function withPageGuidance(prompt: string): string {
  return prompt.includes("Pages:") ? prompt : `${prompt}${PAGE_GUIDANCE}`;
}

/** Pure helper so the memory-window behaviour is unit-testable. */

/**
 * Capabilities are stated at call time, not only in the base prompt.
 *
 * Assistants created earlier stored their own copy of the base prompt, which
 * means a later correction to BASE_SYSTEM_PROMPT never reached them — that is
 * how an assistant ended up telling the user "I have no mail-sending tool"
 * while the tool was registered. Anything here is appended to whatever prompt is
 * in effect, so the contract cannot drift out of date.
 */
const CAPABILITY_CONTRACT = `

What you can do (this is current, even if an older instruction says otherwise):
- You can send email with send_email. It waits for the user's approval, which is normal. Never answer that you cannot send mail. There is no draft tool here: if the user asks for a draft, write the text in your reply; if they ask to send, call send_email.
- You can write: create_lead, create_deal, create_task, create_page. Writes wait for approval too; propose the action instead of refusing it.
- If the user gives an email address, use it, even when the person is not in the CRM. Say so rather than refusing for lack of a record.`;

export function withCapabilities(prompt: string): string {
  return prompt.includes("You can send email with send_email") ? prompt : `${prompt}${CAPABILITY_CONTRACT}`;
}

export function composeSystemPrompt(base: string, memories: string[]): string {
  if (memories.length === 0) return base;
  const lines = ["", "Things you remember about the user:"];
  for (const memory of memories.slice(0, MAX_RECALL)) lines.push(`- ${memory}`);
  return `${base}\n${lines.join("\n")}`;
}

export async function getOrCreateAssistant(userId: string) {
  const existing = await db.assistant.findUnique({ where: { userId } });
  if (existing) return existing;

  return await db.assistant.create({
    data: {
      userId,
      name: ASSISTANT_DEFAULT_NAME,
      systemPrompt: BASE_SYSTEM_PROMPT,
      model: ASSISTANT_DEFAULT_MODEL,
      temperature: 0.3,
    },
  });
}

/**
 * Ranks memories by overlap with what was just asked, then by recency, instead
 * of recency alone: a fact about a client is only useful when that client comes
 * up, and pure recency buried it as soon as newer trivia arrived.
 */
export function rankMemories(
  memories: Array<{ content: string; updatedAt: Date; pinned?: boolean }>,
  query: string,
  limit: number = MAX_RECALL
): string[] {
  const terms = query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length > 2);

  const scored = memories.map((memory) => {
    const haystack = memory.content.toLowerCase();
    const overlap = terms.reduce((total, term) => (haystack.includes(term) ? total + 1 : total), 0);
    // Pinned facts always surface; relevance dominates, recency breaks ties.
    const score = (memory.pinned ? 3 : 0) + overlap * 2;
    return { memory, score, at: memory.updatedAt.getTime() };
  });

  scored.sort((a, b) => (b.score - a.score) || (b.at - a.at));
  return scored.slice(0, limit).map((entry) => entry.memory.content);
}

async function recallMemories(assistantId: string, query = "", limit: number = MAX_RECALL): Promise<string[]> {
  const rows = await db.assistantMemory.findMany({
    where: { assistantId, archivedAt: null },
    orderBy: { updatedAt: "desc" },
    take: 200,
  });
  return rankMemories(rows, query, limit);
}

async function persistMemories(assistantId: string, facts: string[]): Promise<void> {
  if (!facts.length) return;

  const existing = await db.assistantMemory.findMany({
    where: { assistantId, archivedAt: null },
    select: { content: true },
    orderBy: { createdAt: "asc" },
  });
  const known = new Set(existing.map((m) => m.content.trim()));

  const fresh = facts
    .map((fact) => fact.trim())
    .filter((fact) => fact.length >= 12 && !known.has(fact));

  for (const content of fresh.slice(0, 3)) {
    await db.assistantMemory.create({ data: { assistantId, content } });
  }

  const count = await db.assistantMemory.count({ where: { assistantId, archivedAt: null } });
  if (count > MAX_MEMORIES) {
    // Archive rather than delete: a forgotten fact stays recoverable, and never
    // touches something the user pinned by hand.
    const oldest = await db.assistantMemory.findMany({
      where: { assistantId, archivedAt: null, pinned: false },
      orderBy: { createdAt: "asc" },
      take: count - MAX_MEMORIES,
      select: { id: true },
    });
    if (oldest.length) {
      await db.assistantMemory.updateMany({
        where: { id: { in: oldest.map((m) => m.id) } },
        data: { archivedAt: new Date() },
      });
    }
  }
}

/**
 * Extracts durable facts about the user from their message and stores them as
 * long-term memory. One small model call per message; skipped when the message
 * is too short to carry durable context.
 */
async function extractAndStoreMemories(assistantId: string, userId: string, content: string): Promise<void> {
  if (content.trim().length < 40) return;

  try {
    const provider = providerManager.getProvider();
    const extracted = await provider.generateStructuredOutput<{ facts: string[] }>(
      [
        {
          role: "system",
          content:
            "Extract up to 3 durable facts about the user or their business that an assistant should remember long-term. " +
            "Only record CONCRETE, verifiable specifics: named people, clients, amounts, dates, stated preferences, hard constraints, how they like to work. " +
            "Do NOT record inferences, guesses, or restatements of the request — for example 'the company needs marketing' is an assumption, not a fact, and must not be stored. " +
            "If a statement is vague or you are unsure, return an empty list. Most messages contain no durable fact at all. " +
            "Return JSON: {\"facts\": []}.",
        },
        { role: "user", content },
      ],
      "JSON object with a facts string array.",
      {
        profile: "fast",
        temperature: 0,
        maxTokens: 300,
        responseFormat: "json_object",
        userId,
        source: "agent",
        agentSlug: "assistant_memory",
      }
    );

    if (extracted && Array.isArray(extracted.facts)) {
      await persistMemories(assistantId, extracted.facts);
    }
  } catch (err) {
    // Memory is best-effort; a failed extraction must never fail the reply.
    console.warn("[Assistant] Memory extraction failed:", err);
  }
}

/** Pure helper: a short, readable title from the first user message. */
export function deriveConversationTitle(text: string, maxLength: number = 60): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return "New chat";
  if (cleaned.length <= maxLength) return cleaned;
  return `${cleaned.slice(0, maxLength).trimEnd()}…`;
}

export async function listConversations(assistantId: string, agentSlug?: string | null) {
  return await db.assistantConversation.findMany({
    // Each AI teammate keeps its own threads.
    where: { assistantId, agentSlug: agentSlug ?? null },
    // Pinned first, then most recent. Archived chats are returned too: the UI
    // folds them away, so nothing vanishes without a way back.
    // `desc` sorts NULLS FIRST in Postgres, which buried pinned chats at the
    // bottom of the rail. Explicit nulls-last keeps them on top.
    orderBy: [
      { pinnedAt: { sort: "desc", nulls: "last" } },
      { updatedAt: "desc" },
    ],
    take: 60,
    // Project-work harness (Phase A): the conversation's project root rides
    // the read payload so the UI can show which chats are rooted.
    select: {
      id: true,
      title: true,
      updatedAt: true,
      pinnedAt: true,
      archivedAt: true,
      workspaceRoot: true,
      workspaceRootRealpath: true,
    },
  });
}

export async function createConversation(
  assistantId: string,
  title: string = "New chat",
  agentSlug?: string | null
) {
  return await db.assistantConversation.create({ data: { assistantId, title, agentSlug: agentSlug ?? null } });
}

/**
 * Thrown when a caller targets a conversation that does not exist (or belongs
 * to a different assistant/agent scope). Callers that opt into strict
 * resolution surface this as a typed error instead of silently hijacking the
 * latest conversation.
 */
export class ConversationNotFoundError extends Error {
  readonly conversationId: string;

  constructor(conversationId: string) {
    super(`Conversation not found: ${conversationId}`);
    this.name = "ConversationNotFoundError";
    this.conversationId = conversationId;
  }
}

/**
 * Resolves the conversation to use for a turn.
 *
 * Legacy (default) mode keeps the original behaviour — unknown ids fall back
 * to the latest conversation, and no id means the latest conversation — for
 * the callers that rely on it (the messages route and the V1 chat path).
 *
 * Strict mode (the harness chat path) has no silent fallback:
 * - an id that does not exist in the caller's scope throws
 *   {@link ConversationNotFoundError};
 * - no id means the caller explicitly wants a brand-new thread, so a fresh
 *   conversation is created.
 */
export async function resolveConversation(
  assistantId: string,
  conversationId?: string,
  agentSlug?: string | null,
  options: { strict?: boolean } = {}
) {
  const scope = { assistantId, agentSlug: agentSlug ?? null };
  if (conversationId) {
    const existing = await db.assistantConversation.findFirst({
      where: { id: conversationId, ...scope },
    });
    if (existing) return existing;
    if (options.strict) throw new ConversationNotFoundError(conversationId);
  }
  if (options.strict) {
    return await createConversation(assistantId, "New chat", agentSlug);
  }
  const latest = await db.assistantConversation.findFirst({
    where: scope,
    orderBy: { updatedAt: "desc" },
  });
  if (latest) return latest;
  return await createConversation(assistantId, "New chat", agentSlug);
}

export async function getConversationMessages(assistantId: string, conversationId: string) {
  const conversation = await db.assistantConversation.findFirst({
    where: { id: conversationId, assistantId },
  });
  if (!conversation) return null;

  // Newest 200, then restored to chronological order: `asc + take 200` returned
  // the FIRST 200 and silently hid the most recent exchanges in a long chat.
  const newest = await db.assistantMessage.findMany({
    where: { assistantId, conversationId },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: { id: true, role: true, content: true, toolCalls: true, attachments: true, createdAt: true },
  });
  return { conversation, messages: newest.reverse() };
}

/**
 * The standing answers this assistant has collected from its approval cards,
 * loaded once per turn so the policy resolver stays a pure function.
 */
async function loadApprovalRules(assistantId: string): Promise<PolicyRule[]> {
  const rules = await db.assistantApprovalRule.findMany({
    where: { assistantId },
    select: { toolName: true, effect: true },
  });
  return rules.map((rule) => ({ toolName: rule.toolName, effect: rule.effect as PolicyRule["effect"] }));
}

/** One-shot assistant reply used inside a shared team conversation. */
export async function runAssistantInThread(params: {
  userId: string;
  userRole?: string;
  history: ChatTurnMessage[];
  unattended?: boolean;
}): Promise<AgentChatTurnResult & { assistantId: string; assistantName: string }> {
  const assistant = await getOrCreateAssistant(params.userId);
  const approvalRules = await loadApprovalRules(assistant.id);
  const latestTurn = params.history.at(-1)?.content ?? "";
  const memories = await recallMemories(assistant.id, latestTurn);
  const systemPrompt = withCapabilities(withPageGuidance(composeSystemPrompt(assistant.systemPrompt || BASE_SYSTEM_PROMPT, memories)));

  const turn = await runAgentChatTurn({
    agent: {
      slug: "assistant",
      name: assistant.name,
      systemPrompt,
      modelProfile: "general",
      temperature: assistant.temperature,
      maxTokens: 1600,
      tools: assistantToolsJson(),
      model: assistant.model || ASSISTANT_DEFAULT_MODEL,
    },
    history: params.history,
    actorUserId: params.userId,
    actorUserRole: params.userRole,
    approvalMode: assistant.approvalMode,
    approvalRules: approvalRules,
    unattended: params.unattended,
    permissionMode: await resolvePermissionMode({
      workspace: await resolveWorkspaceForUser({ db, userId: params.userId }),
    }),
  });

  return { ...turn, assistantId: assistant.id, assistantName: assistant.name };
}

export interface AssistantReply {
  reply: string;
  toolCallsUsed: string[];
  pendingAction?: { id: string; toolName: string; summary: string };
}

/**
 * Executes or rejects a pending write action. Only the user who requested it
 * may decide, and only once (status moves out of PENDING atomically).
 */
export async function decidePendingAction(params: {
  actionId: string;
  userId: string;
  userRole: string;
  approve: boolean;
  /** Remember this answer so the same tool stops asking. */
  alwaysAllow?: boolean;
}): Promise<{ status: string; toolName: string; result?: unknown }> {
  const action = await db.assistantPendingAction.findFirst({
    where: { id: params.actionId, userId: params.userId, status: "PENDING" },
  });
  if (!action) throw new Error("Action not found or already decided");

  // Claim it with a conditional update. Read-then-write let two clicks (or two
  // tabs) both pass the PENDING check and run the tool twice, duplicating the
  // record it created.
  const claimed = await db.assistantPendingAction.updateMany({
    where: { id: action.id, userId: params.userId, status: "PENDING" },
    data: { status: params.approve ? "APPROVED" : "REJECTED" },
  });
  if (claimed.count !== 1) throw new Error("Action not found or already decided");

  if (!params.approve) {
    return { status: "REJECTED", toolName: action.toolName };
  }

  let input: Record<string, any> = {};
  try {
    input = JSON.parse(action.input) || {};
  } catch {
    input = {};
  }

  const tool = toolRegistry.getTool(action.toolId);
  if (!tool) {
    return { status: "FAILED", toolName: action.toolName, result: { error: "Tool no longer exists" } };
  }

  const execution = await toolRegistry.executeTool(action.toolId, input, {
    userId: params.userId,
    userRole: params.userRole,
    agentSlug: "assistant",
  });

  // "Always allow" becomes real state, but never for a security-boundary tool:
  // those must be judged every single time.
  if (params.alwaysAllow && tool && !tool.explicitApproval) {
    await db.assistantApprovalRule
      .upsert({
        where: { assistantId_toolName: { assistantId: action.assistantId, toolName: action.toolId } },
        create: { assistantId: action.assistantId, toolName: action.toolId, effect: "ALLOW" },
        update: { effect: "ALLOW" },
      })
      .catch(() => null);
  }

  return { status: execution.success ? "EXECUTED" : "FAILED", toolName: action.toolName, result: execution };
}

export async function sendAssistantMessage(params: {
  assistantId: string;
  userId: string;
  content: string;
  conversationId?: string;
  userRole?: string;
  attachmentIds?: string[];
  onToken?: (chunk: string) => void;
  onTool?: (name: string) => void;
  onToolDone?: (name: string, ok: boolean, durationMs: number) => void;
  unattended?: boolean;
  /** Talk to a specific AI teammate instead of the personal assistant. */
  agentSlug?: string;
  /** The reply is being read aloud, so it has to be short and plain. */
  voice?: boolean;
}): Promise<AssistantReply & { conversationId: string }> {
  const assistant = await db.assistant.findFirst({
    where: { id: params.assistantId, userId: params.userId },
  });
  if (!assistant) throw new Error("Assistant not found");

  // A teammate is an agent row: its own persona, tools and temperature, but the
  // same conversation store, memory and approval policy.
  const agent = params.agentSlug
    ? await db.aiAgent.findFirst({ where: { slug: params.agentSlug, status: "ACTIVE" } })
    : null;
  if (params.agentSlug && !agent) throw new Error("That teammate is not available");

  const conversation = await resolveConversation(assistant.id, params.conversationId, agent?.slug ?? null);
  const isFirstMessage = (await db.assistantMessage.count({ where: { conversationId: conversation.id } })) === 0;

  let attachmentContext = "";
  let attachmentsJson: string | null = null;

  if (params.attachmentIds && params.attachmentIds.length > 0) {
    const rows = await db.assistantAttachment.findMany({
      where: { id: { in: params.attachmentIds.slice(0, 5) }, assistantId: assistant.id },
    });
    if (rows.length > 0) {
      attachmentsJson = JSON.stringify(rows.map((row) => ({ id: row.id, name: row.name, mimeType: row.mimeType, size: row.size, url: `/api/assistant/files/${row.storageKey}` })));
      const parts: string[] = [];
      for (const row of rows) {
        const isText = ["text/plain", "text/csv", "text/markdown", "application/json"].includes(row.mimeType);
        if (isText) {
          try {
            const bytes = await storage.get(row.storageKey);
            parts.push(`--- ${row.name} (${row.mimeType}) ---\n${bytes.toString("utf8").slice(0, 20000)}`);
            continue;
          } catch {
            // fall through to name-only
          }
        }
        parts.push(`--- ${row.name} (${row.mimeType}, ${row.size} bytes) — binary attachment, contents not inlined`);
      }
      attachmentContext = `\n\n[Attached files]\n${parts.join("\n\n")}`;
    }
  }

  await db.assistantMessage.create({
    data: {
      assistantId: assistant.id,
      conversationId: conversation.id,
      role: "user",
      content: params.content.trim(),
      attachments: attachmentsJson,
    },
  });

  if (isFirstMessage) {
    await db.assistantConversation.update({
      where: { id: conversation.id },
      data: { title: deriveConversationTitle(params.content) },
    });
  }

  const approvalRules = await loadApprovalRules(assistant.id);
  // A blind take: 20 silently truncated long threads. Read a wider window and
  // keep the contiguous recent suffix that actually fits the input budget.
  const recent = await db.assistantMessage.findMany({
    where: { assistantId: assistant.id, conversationId: conversation.id },
    orderBy: { createdAt: "desc" },
    take: 60,
  });
  const candidates = recent
    .reverse()
    .map((message) => ({ role: message.role as "user" | "assistant", content: message.content }));
  const selection = selectContext(candidates);

  const history = selection.messages;
  if (conversation.summary) {
    // Older turns were folded away, so carry their meaning forward as context.
    history.unshift({
      role: "user",
      content: `Summary of our earlier conversation:\n${conversation.summary}`,
    });
  }

  if (attachmentContext && history.length > 0) {
    // Bound it: attachments were appended after the budget was applied, so a
    // file-heavy turn could exceed the window and 400 the whole request.
    const ATTACHMENT_CHAR_BUDGET = 12_000;
    const clipped =
      attachmentContext.length > ATTACHMENT_CHAR_BUDGET
        ? `${attachmentContext.slice(0, ATTACHMENT_CHAR_BUDGET)}\n… [attachment text truncated]`
        : attachmentContext;
    const last = history[history.length - 1];
    history[history.length - 1] = { ...last, content: `${last.content}${clipped}` };
  }

  const memories = await recallMemories(assistant.id, params.content ?? "");
  const systemPrompt = agent
    ? `${agent.systemPrompt}\n\nYou are one of the owner's AI teammates inside Cyraops CRM. Be concrete and brief. If the task belongs to a goal, post progress to the team thread with message_team so the others can see it.`
    : withCapabilities(
        withPageGuidance(composeSystemPrompt(assistant.systemPrompt || BASE_SYSTEM_PROMPT, memories)) +
          (params.voice
            ? "\n\nYou are speaking aloud right now through a voice interface. Answer in one to three short spoken sentences, no lists, no headings, no markdown, no URLs. If there is a lot to say, offer to continue rather than reciting it all."
            : "")
      );

  const turn = await runAgentChatTurn({
    agent: {
      slug: agent?.slug ?? "assistant",
      name: agent?.name ?? assistant.name,
      systemPrompt,
      modelProfile: "general",
      temperature: agent?.temperature ?? assistant.temperature,
      maxTokens: agent?.maxTokens ?? 1600,
      tools: agent?.tools ?? assistantToolsJson(),
      model: assistant.model || ASSISTANT_DEFAULT_MODEL,
    },
    history,
    actorUserId: params.userId,
    actorUserRole: params.userRole,
    approvalMode: assistant.approvalMode,
    approvalRules: approvalRules,
    unattended: params.unattended,
    conversationId: conversation.id,
    onToken: params.onToken,
    onTool: params.onTool,
    onToolDone: params.onToolDone,
    permissionMode: await resolvePermissionMode({
      workspace: await resolveWorkspaceForUser({ db, userId: params.userId }),
      agentSlug: agent?.slug ?? undefined,
    }),
  });

  let pendingAction:
    | { id: string; toolName: string; summary: string; reason?: string; canAlwaysAllow?: boolean }
    | undefined;

  if (turn.pendingAction) {
    const summary = `${turn.pendingAction.toolName}: ${JSON.stringify(turn.pendingAction.arguments).slice(0, 300)}`;
    const row = await db.assistantPendingAction.create({
      data: {
        assistantId: assistant.id,
        userId: params.userId,
        conversationId: conversation.id,
        toolId: turn.pendingAction.toolId,
        toolName: turn.pendingAction.toolName,
        input: JSON.stringify(turn.pendingAction.arguments),
        summary,
        status: "PENDING",
      },
    });
    pendingAction = {
      id: row.id,
      toolName: row.toolName,
      summary: turn.pendingAction.reason
        ? `${turn.pendingAction.reason} (${turn.pendingAction.toolName})`
        : summary,
      reason: turn.pendingAction.reason,
      canAlwaysAllow: turn.pendingAction.canAlwaysAllow,
    };
    turn.reply = `${turn.reply}\n\n⚠️ This action needs your approval: ${row.toolName}. Approve or reject it below.`;
  }

  // FULL_CONTROL/SYSTEM owner auto-approval: the action already ran, so the
  // audit row is created settled — status APPROVED — instead of a pending card.
  if (turn.autoApproved) {
    await db.assistantPendingAction.create({
      data: {
        assistantId: assistant.id,
        userId: params.userId,
        conversationId: conversation.id,
        toolId: turn.autoApproved.toolId,
        toolName: turn.autoApproved.toolName,
        input: JSON.stringify(turn.autoApproved.arguments),
        summary: `${turn.autoApproved.reason ?? "Auto-approved by permission mode"} (${turn.autoApproved.toolName})`,
        status: "APPROVED",
      },
    });
  }

  /**
   * Tool markup is stripped before storing, not only before rendering: once it is
   * in the transcript it comes back on every reload, in the voice screen's copy of
   * the thread, and in anything that summarises history.
   */
  turn.reply = stripToolMarkup(turn.reply);

  await db.assistantMessage.create({
    data: {
      assistantId: assistant.id,
      conversationId: conversation.id,
      role: "assistant",
      content: turn.reply,
      toolCalls: JSON.stringify(turn.toolCallsUsed),
    },
  });

  await db.assistantConversation.update({
    where: { id: conversation.id },
    data: { updatedAt: new Date() },
  });

  void extractAndStoreMemories(assistant.id, params.userId, params.content);
  // Fold older turns into the rolling summary in the background; the reply is
  // already on its way and must not wait for a second model call.
  void summarizeConversation({
    assistantId: assistant.id,
    conversationId: conversation.id,
    userId: params.userId,
  });

  return { reply: turn.reply, toolCallsUsed: turn.toolCallsUsed, conversationId: conversation.id, pendingAction };
}
