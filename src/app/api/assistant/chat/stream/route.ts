import { NextRequest } from "next/server";
import { userFromRequest } from "@/lib/auth";
import {
  ConversationNotFoundError,
  deriveConversationTitle,
  getOrCreateAssistant,
  resolveConversation,
  sendAssistantMessage,
} from "@/lib/ai/assistant/runtime";
import { checkDailySpend, checkRateLimit } from "@/lib/ai/assistant/guard";
import { db } from "@/lib/db";
import { storage } from "@/lib/storage";
import { streamHarnessTurn, harnessTaskForTurn, planDirectiveFor, type StreamHarnessTurnResult } from "@/lib/harness/bot-stream";
import { HarnessRunError, isAbortError, runtimeFactory, type AgentRuntime } from "@/lib/harness/runtime";
import type { HarnessEvent } from "@/lib/harness/client";
import { approvalBroker } from "@/lib/harness/approval-broker";
import { planOfToolCall, planReviewOfQuestion, toolCallsUsedOf, type PlanReviewQuestion } from "@/lib/harness/events";
import { workspaceRootForTurn } from "@/lib/harness/workspace-root";
import {
  classifyCommand,
  commandTaskFor,
  COMMAND_MAX_LENGTH,
  SHELL_DISABLED_REPLY,
} from "@/lib/harness/command-classifier";
import { resolvePermissionMode, runtimePermissionMode, allowsSystemTools } from "@/lib/permissions/mode";
import { resolveWorkspaceForUser } from "@/lib/workspace-resolve";
import {
  createHarnessApprovalRow,
  installApprovalDecisionHook,
  maskToolOutput,
  persistHarnessTurnAudit,
  recordShellCommandAudit,
  toolInputForApproval,
  usageForDonePayload,
  type ToolCallTimings,
} from "@/lib/harness/audit";

const encoder = new TextEncoder();

function sse(data: Record<string, unknown>): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(data)}\n\n`);
}

/**
 * HARNESS_BOT switches the bot chat engine to the harness AgentRuntime:
 * "1" enables it with whatever HARNESS_RUNTIME selects (default cli), while
 * "cli" and "native" force that runtime. Any other value (including unset)
 * keeps the existing V1 assistant path exactly as it was.
 */
function harnessBotRuntime(env: NodeJS.ProcessEnv = process.env): AgentRuntime | null {
  const flag = env.HARNESS_BOT?.trim().toLowerCase();
  if (flag === "1") return runtimeFactory(env);
  if (flag === "cli") return runtimeFactory({ ...env, HARNESS_RUNTIME: "cli" });
  if (flag === "native") return runtimeFactory({ ...env, HARNESS_RUNTIME: "native" });
  return null;
}

// One runtime for the process: harness sessions must survive across requests.
const harnessRuntime = harnessBotRuntime();

/** The same friendly-error shaping the V1 path uses, plus harness/abort cases. */
function describeHarnessFailure(error: unknown): string {
  if (isAbortError(error)) return "The turn was cancelled.";
  if (error instanceof ConversationNotFoundError) {
    // FIX: strict conversation ids — an unknown id errors instead of silently
    // hijacking the latest thread. The user message was never persisted, so
    // starting a new chat retries it safely.
    return "That conversation no longer exists. Start a new chat.";
  }
  if (error instanceof HarnessRunError) {
    if (error.details.timedOut) return "The assistant took too long and was stopped.";
    return (
      error.details.stderr?.trim().split("\n").slice(-3).join("\n") ||
      error.message ||
      "The assistant failed to reply."
    );
  }
  const raw = String((error as { message?: string } | null)?.message || "").slice(0, 240);
  if (/not found/i.test(raw)) return "Assistant not found";
  if (/context|token|length/i.test(raw))
    return "That conversation is too long for the model. Start a new chat or ask something shorter.";
  if (/json|parse|unexpected/i.test(raw)) return "The model returned an unreadable response. Please try again.";
  return raw ? `The assistant failed to reply: ${raw}` : "The assistant failed to reply.";
}

export async function POST(request: NextRequest) {
  const user = await userFromRequest(request);
  if (!user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });
  }

  const body = await request.json().catch(() => null);
  const content = typeof body?.content === "string" ? body.content.trim() : "";
  if (!content || content.length > 5000) {
    return new Response(JSON.stringify({ error: "A message between 1 and 5000 characters is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const limited = checkRateLimit(user.id);
  if (!limited.ok) {
    return new Response(JSON.stringify({ error: limited.reason }), { status: 429, headers: { "Content-Type": "application/json" } });
  }
  const spend = await checkDailySpend(user.id);
  if (!spend.ok) {
    return new Response(JSON.stringify({ error: spend.reason }), { status: 429, headers: { "Content-Type": "application/json" } });
  }

  if (harnessRuntime) {
    return streamHarnessReply(request, user, body, content);
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let sent = false;
      const send = (payload: Record<string, unknown>) => {
        try {
          controller.enqueue(sse(payload));
          sent = true;
        } catch {
          // client disconnected
        }
      };

      try {
        const result = await sendAssistantMessage({
          assistantId: typeof body?.assistantId === "string" ? body.assistantId : undefined,
          conversationId: typeof body?.conversationId === "string" ? body.conversationId : undefined,
          userId: user.id,
          userRole: user.role,
          content,
          // The client sent these and this route silently dropped them, which
          // made the whole attach-a-file feature a no-op on the only path the
          // UI uses.
          agentSlug: typeof body?.agentSlug === "string" ? body.agentSlug : undefined,
          voice: body?.voice === true,
          attachmentIds: Array.isArray(body?.attachmentIds)
            ? body.attachmentIds.filter((id: unknown) => typeof id === "string")
            : undefined,
          onToken: (chunk: string) => send({ type: "token", content: chunk }),
          onTool: (name: string) => send({ type: "tool", name }),
          onToolDone: (name: string, ok: boolean, durationMs: number) =>
            send({ type: "tool_done", name, ok, durationMs }),
        });

        send({
          type: "done",
          reply: result.reply,
          toolCallsUsed: result.toolCallsUsed,
          conversationId: result.conversationId,
          pendingAction: result.pendingAction,
        });
      } catch (err: any) {
        // Swallowing this is why the UI could only ever say "failed to reply".
        console.error("[assistant/stream] turn failed:", err?.stack || err?.message || err);
        const raw = String(err?.message || "").slice(0, 240);
        const friendly = /not found/i.test(raw)
          ? "Assistant not found"
          : /context|token|length/i.test(raw)
            ? "That conversation is too long for the model. Start a new chat or ask something shorter."
            : /json|parse|unexpected/i.test(raw)
              ? "The model returned an unreadable response. Please try again."
              : raw
                ? `The assistant failed to reply: ${raw}`
                : "The assistant failed to reply.";
        send({ type: "error", error: friendly });
      } finally {
        if (!sent) send({ type: "done", reply: "" });
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

/**
 * The HARNESS_BOT branch: same request contract, same SSE payloads the UI
 * already renders (`token` for streamed text, terminal `done` with the final
 * `reply`), but the turn is answered by the harness AgentRuntime and the
 * messages are persisted into the same AssistantMessage tables so reloads
 * and history behave exactly as before. The harness session itself carries
 * the conversation's context across turns.
 */
async function streamHarnessReply(
  request: NextRequest,
  user: { id: string; role: string },
  body: Record<string, unknown> | null,
  content: string
): Promise<Response> {
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let sent = false;
      let auditConversationId: string | null = null;
      // Audit trail (FIX 2): harness turns previously left zero rows. The
      // PENDING approval row must exist BEFORE a decision can land, so it is
      // created the moment the approval event surfaces; tool-call and usage
      // rows are persisted from the collected events once the turn ends.
      // All writes are best-effort and never fail the chat stream.
      const auditEvents: HarnessEvent[] = [];
      const toolTimings = new Map<string, { call?: number; result?: number }>();
      const toolNames = new Map<string, string>();
      /** exit_plan_mode call ids seen this turn (their tool_result closes the review). */
      const planCallIds = new Set<string>();
      const auditTimings: ToolCallTimings = {
        get: (callId) => toolTimings.get(callId),
      };
      const turnStartedAt = Date.now();
      const send = (payload: Record<string, unknown>) => {
        try {
          controller.enqueue(sse(payload));
          sent = true;
        } catch {
          // client disconnected
        }
      };

      /** The tool-result text the collapsible timeline shows (masked + truncated). */
      const truncatedToolResult = (result: unknown): string | undefined => {
        const text = maskToolOutput(result);
        if (text === null) return undefined;
        const trimmed = text.trim();
        return trimmed.length > 160 ? `${trimmed.slice(0, 160)}…` : trimmed;
      };

      try {
        const assistant = await getOrCreateAssistant(user.id);
        installApprovalDecisionHook(approvalBroker());

        // A teammate is scoped exactly like the V1 path: the same thread
        // store, and an unknown slug fails the turn the same way.
        const agentSlug = typeof body?.agentSlug === "string" ? body.agentSlug : undefined;
        if (agentSlug) {
          const agent = await db.aiAgent.findFirst({ where: { slug: agentSlug, status: "ACTIVE" } });
          if (!agent) throw new Error("That teammate is not available");
        }

        // The unified Permission Manager: resolve the authenticated user's
        // workspace (no singleton fallback), then the workspace/agent mode and
        // role-gate it (a non-owner under FULL_CONTROL/SYSTEM gets CONTROLLED)
        // before the runtime maps it onto the harness.
        const permissionMode = runtimePermissionMode(
          await resolvePermissionMode({
            workspace: await resolveWorkspaceForUser({ db, userId: user.id }),
            agentSlug,
          }),
          user.role
        );

        // FIX: strict conversation ids. An unknown id throws
        // ConversationNotFoundError (never a silent fallback onto the latest
        // thread), and an absent id is the client's explicit ask for a brand-
        // new thread. The V1 path keeps the legacy fallback behaviour.
        const conversation = await resolveConversation(
          assistant.id,
          typeof body?.conversationId === "string" ? body.conversationId : undefined,
          agentSlug ?? null,
          { strict: true }
        );
        auditConversationId = conversation.id;
        const isFirstMessage = (await db.assistantMessage.count({ where: { conversationId: conversation.id } })) === 0;

        // Command-box intent (Workspace panel): body.command marks the turn as
        // a shell-command run. The persisted user message is the command text
        // (the client sends content === command), the harness task becomes the
        // fixed "run and report exactly" prompt, destructive commands wait for
        // an approval through the SAME broker flow tool approvals use, and
        // every command is recorded in AiAuditLog (eventType SHELL_COMMAND).
        const commandInput = typeof body?.command === "string" ? body.command : "";
        const command = commandInput.trim();
        const commandIntent = command.length > 0;
        if (commandIntent && command.length > COMMAND_MAX_LENGTH) {
          throw new Error(`Commands longer than ${COMMAND_MAX_LENGTH} characters are not allowed.`);
        }

        // Project-work harness (Phase A): the conversation's project root rides
        // the turn only for the conversation's OWNER (the assistant's owner —
        // every conversation resolved above is scoped to this caller's own
        // assistant, so this gate is structural today and fails closed for any
        // future shared thread). Any other caller's turn runs WITHOUT a root.
        const workspaceRoot = workspaceRootForTurn({
          actorId: user.id,
          conversationOwnerId: assistant.userId,
          workspaceRootRealpath: conversation.workspaceRootRealpath,
        });

        // Attachments are persisted and their text is inlined into the task,
        // mirroring the V1 path.
        let attachmentContext = "";
        let attachmentsJson: string | null = null;
        const attachmentIds = Array.isArray(body?.attachmentIds)
          ? body.attachmentIds.filter((id: unknown) => typeof id === "string")
          : undefined;
        if (attachmentIds && attachmentIds.length > 0) {
          const rows = await db.assistantAttachment.findMany({
            where: { id: { in: attachmentIds.slice(0, 5) }, assistantId: assistant.id },
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
            content: content.trim(),
            attachments: attachmentsJson,
          },
        });

        if (isFirstMessage) {
          await db.assistantConversation.update({
            where: { id: conversation.id },
            data: { title: deriveConversationTitle(content) },
          });
        }

        // The voice screen posts voice:true: the reply will be read aloud, so
        // shape it to spoken length (one to three short sentences) before it
        // is generated, exactly like the V1 voice flag does.
        //
        // Tier-2 plan preview: a "/plan" message is the harness's own
        // plan-mode command (the headless runner provides no /plan adapter).
        // "/plan <message>" runs the message as a plan-mode turn; bare
        // "/plan" / "/plan off" only switch the mode and get a friendly
        // confirmation instead of a model turn. The user message persists as
        // typed, so the transcript renders exactly as before.
        const planDirective = commandIntent ? null : planDirectiveFor(content);
        // A BARE switch (no message) runs no model turn: the confirmation
        // stands in for the empty reply. A "/plan <message>" turn keeps the
        // model's actual reply. Only a directive with an explicit mode and no
        // task is a switch — ordinary turns ({mode:null, task:null}) must keep
        // the model's reply, or every harness message reads "Plan mode is off".
        const planSwitchText =
          planDirective && planDirective.mode !== null && planDirective.task === null
            ? planDirective.mode === "on"
              ? "Plan mode is on for this chat. Describe what you want planned — I'll explore first, present a plan for your review, and wait for your approval before executing."
              : "Plan mode is off — I'll work without a review step again."
            : null;
        // Command turns hand the harness the fixed command task; everything
        // else keeps the existing shaping (plan directive, attachments, voice).
        const task = commandIntent
          ? commandTaskFor(command)
          : harnessTaskForTurn({
              content: planDirective?.task ?? (planDirective?.mode ? "" : content),
              attachmentContext,
              voice: body?.voice === true,
            });

        // -----------------------------------------------------------------
        // Command gate: classify BEFORE anything runs. Destructive commands
        // emit the approval through the existing broker ({ type: "approval" }
        // SSE + /api/harness/approve) and execute only after an allow;
        // non-SYSTEM workspaces never mounted the shell tools, so their
        // commands get the honest "shell is disabled" answer instead of a
        // model turn that fails silently. Every command is audit-logged.
        // -----------------------------------------------------------------
        let result: StreamHarnessTurnResult | null = null;
        /** The reply streamed for a shortcut (no-model) command turn. */
        let shortcutReply: string | null = null;
        /** A destructive command's gate, mirrored into the done payload. */
        let commandGate: { id: string; toolName: string; summary: string; answered: "allow" | "deny" } | null = null;

        if (commandIntent) {
          const classification = classifyCommand(command);
          if (!allowsSystemTools(permissionMode)) {
            // Shell tools are only mounted in SYSTEM mode; answer honestly
            // instead of running a turn whose shell tool would not exist.
            shortcutReply = SHELL_DISABLED_REPLY;
            send({ type: "token", content: SHELL_DISABLED_REPLY });
            void recordShellCommandAudit({
              userId: user.id,
              conversationId: conversation.id,
              command,
              approved: false,
            });
          } else if (classification.destructive) {
            // The approval gate. The SSE card and the PENDING audit row surface
            // the moment the request is minted; the turn below runs only when
            // the broker's outcome is allowed-once.
            const pending = approvalBroker().request({
              toolName: "shell",
              summary: command,
              reason: `Destructive command (${classification.matches.map((match) => match.label).join("; ")})`,
            });
            send({
              type: "approval",
              approvalId: pending.approvalId,
              toolName: pending.toolName,
              summary: pending.summary,
              ...(pending.reason ? { reason: pending.reason } : {}),
              // FIX: approval countdown — the broker's auto-reject deadline
              // rides the payload so the card can tick down to it.
              deadline: pending.deadline,
            });
            void createHarnessApprovalRow({
              approvalId: pending.approvalId,
              assistantId: assistant.id,
              userId: user.id,
              conversationId: conversation.id,
              toolName: pending.toolName,
              summary: pending.summary,
              input: JSON.stringify({ command }),
            });
            const onAbort = () => pending.cancel();
            if (request.signal.aborted) pending.cancel();
            else request.signal.addEventListener("abort", onAbort, { once: true });
            const outcome = await pending.outcome;
            request.signal.removeEventListener("abort", onAbort);
            const answered = outcome === "allowed-once" ? "allow" : "deny";
            commandGate = { id: pending.approvalId, toolName: pending.toolName, summary: command, answered };
            if (answered === "deny") {
              // Not executed. The user message above stays in the transcript,
              // and the honest denial becomes the assistant reply.
              shortcutReply = pending.timedOut
                ? "Command not run — the approval request timed out."
                : outcome === "cancelled"
                  ? "Command not run — the request was cancelled."
                  : "Command not run — approval was rejected.";
              send({ type: "token", content: shortcutReply });
              void recordShellCommandAudit({
                userId: user.id,
                conversationId: conversation.id,
                command,
                approved: false,
              });
            } else {
              void recordShellCommandAudit({
                userId: user.id,
                conversationId: conversation.id,
                command,
                approved: true,
              });
            }
          } else {
            // Non-destructive, SYSTEM mode: runs directly, audited.
            void recordShellCommandAudit({
              userId: user.id,
              conversationId: conversation.id,
              command,
              approved: true,
            });
          }
        }

        if (!shortcutReply) {
          result = await streamHarnessTurn({
          runtime: harnessRuntime as AgentRuntime,
          conversationId: conversation.id,
          tenantId: user.id,
          task,
          signal: request.signal,
          // Tenant scoping: the conversation's owner (Assistant.userId) is the
          // workspace/tenant key the CRM tools filter by (the schema has no
          // workspace column on Task/Contact/CalendarEvent; the owner user id
          // is the only tenant-stable key). Passed to the runtime, which
          // publishes it as CYRAOPS_WORKSPACE_ID for the bridge.
          workspaceId: assistant.userId,
          // Project-work harness (Phase A): owner-gated project root for the
          // turn (null = CRM mode for anyone but the conversation owner).
          workspaceRoot,
          // The resolved, role-gated permission mode for this turn.
          permissionMode,
          // Tier-2 plan preview: "/plan …" runs the turn in the harness's
          // plan mode (native runtime; other runtimes ignore the flag).
          planMode: planDirective?.mode ?? undefined,
          onText: (chunk: string) => send({ type: "token", content: chunk }),
          // Collect the turn's raw events for the post-turn audit write, and
          // relay tool calls as live SSE events (TASK 3: tool timeline) in the
          // exact per-event shape the chat UI already renders for V1 —
          // `name`/`ok`/`durationMs` plus the harness-only `callId` and the
          // masked+truncated `result` the collapsible tools line expands.
          onEvent: (event) => {
            auditEvents.push(event);
            if (event.type === "tool_call" && typeof event.callId === "string") {
              const timing = toolTimings.get(event.callId) ?? {};
              timing.call = Date.now();
              toolTimings.set(event.callId, timing);
              const tool = typeof event.tool === "string" && event.tool ? event.tool : "tool";
              toolNames.set(event.callId, tool);
              send({ type: "tool", name: tool, status: "running", callId: event.callId });
              // Tier-2 plan preview: exit_plan_mode's input carries the
              // complete plan markdown. Stream it as the collapsible Plan
              // block's text the moment the model presents it (before the
              // review question arrives). The review flag flips to true when
              // the plan-review question surfaces below.
              const plan = planOfToolCall(event);
              if (plan) {
                planCallIds.add(plan.planId);
                send({ type: "plan", planId: plan.planId, text: plan.text, review: false });
              }
            } else if (event.type === "tool_result" && typeof event.callId === "string") {
              const timing = toolTimings.get(event.callId) ?? {};
              timing.result = Date.now();
              toolTimings.set(event.callId, timing);
              const completed = event.status === "completed";
              send({
                type: "tool_done",
                name: toolNames.get(event.callId) ?? "tool",
                ok: completed,
                callId: event.callId,
                durationMs: Math.max(0, (timing.result ?? 0) - (timing.call ?? 0)),
                status: completed ? "completed" : "error",
                result: truncatedToolResult(event.result),
              });
              // Plan review settled: approved plans complete the tool call
              // ("Plan approved — plan mode exited…"); a rejection is an
              // errored call carrying the feedback. Either way the UI closes
              // the review buttons on the Plan block.
              if (planCallIds.has(event.callId)) {
                send({ type: "plan_done", planId: event.callId, approved: completed });
              }
            }
          },
          // Approval mapping: the harness's ask → the same SSE shape the V1
          // approval card consumes. The turn stays open (callback approval:
          // the harness answerer waterfall awaits /api/harness/approve).
          onApproval: (approval) => {
            // FIX: approval countdown — the broker knows the auto-reject
            // deadline; the request is still pending while this callback runs,
            // so peek() answers for approval events forwarded without it.
            const deadline =
              typeof (approval as { deadline?: unknown }).deadline === "number"
                ? (approval as { deadline?: number }).deadline
                : approvalBroker().peek(approval.approvalId)?.deadline;
            send({
              type: "approval",
              approvalId: approval.approvalId,
              toolName: approval.toolName,
              summary: approval.summary,
              ...(approval.reason ? { reason: approval.reason } : {}),
              ...(approval.callId ? { callId: approval.callId } : {}),
              ...(typeof deadline === "number" ? { deadline } : {}),
            });
            // PENDING audit row (AssistantPendingAction, the V1 assistant's
            // approval table): settled by the broker's onDecided hook.
            void createHarnessApprovalRow({
              approvalId: approval.approvalId,
              assistantId: assistant.id,
              userId: user.id,
              conversationId: conversation.id,
              toolName: approval.toolName,
              summary: approval.summary,
              input: toolInputForApproval(auditEvents, approval.callId, approval.toolName),
            });
          },
          // Ask-user mapping (TASK 1): an ask_user_question tool call becomes
          // a { type: "question" } SSE payload the inline question UI renders.
          // The harness answerer waterfall holds the turn open until
          // /api/harness/answer resolves the question broker.
          //
          // Tier-2 plan preview: exit_plan_mode's review arrives through the
          // SAME waterfall as a question whose intent is kind "plan-review".
          // Instead of the free-text question card, it becomes a
          // { type: "plan", review: true } payload carrying the plan text
          // (detail) and the broker question id the Approve / Keep planning
          // buttons answer through /api/harness/answer.
          onQuestion: (question) => {
            const planReview = planReviewOfQuestion(question.questions as PlanReviewQuestion[], question.questionId);
            if (planReview) {
              send({
                type: "plan",
                planId: planReview.planId || question.questionId,
                questionId: planReview.questionId,
                text: planReview.text,
                review: true,
              });
              return;
            }
            send({
              type: "question",
              questionId: question.questionId,
              text: question.text,
              questions: question.questions,
              ...(question.callId ? { callId: question.callId } : {}),
            });
          },
          onQuestionDecided: (info) => {
            send({ type: "question_done", questionId: info.questionId, timedOut: info.timedOut });
          },
          onDone: () =>
            console.info(`[assistant/stream] harness turn finished (conversation=${conversation.id})`),
        });
        }

        const toolCallsUsed = result ? toolCallsUsedOf(auditEvents) : [];
        // A bare "/plan" / "/plan off" switch runs no model turn: the harness
        // result is empty and the friendly confirmation stands in. Shortcut
        // command turns (disabled shell, denied approval) already streamed
        // their honest reply.
        const reply = result ? planSwitchText ?? result.text : shortcutReply ?? "";

        await db.assistantMessage.create({
          data: {
            assistantId: assistant.id,
            conversationId: conversation.id,
            role: "assistant",
            content: reply,
            toolCalls: JSON.stringify(toolCallsUsed),
          },
        });

        await db.assistantConversation.update({
          where: { id: conversation.id },
          data: { updatedAt: new Date() },
        });

        send({
          type: "done",
          reply,
          toolCallsUsed,
          conversationId: conversation.id,
          // TASK 2: usage display. The same events audit.ts persists, cost via
          // the existing estimate mapper; absent usage keeps the field null so
          // the UI shows no caption (V1-engine turns never carry it).
          usage: result ? usageForDonePayload(auditEvents) : undefined,
          // Mirror the V1 pendingAction shape so the SAME approval card
          // renders in the unchanged UI (answered state: the decision has
          // already been made by the time the turn completes). Command turns
          // mirror their gate the same way.
          pendingAction: commandGate
            ? { ...commandGate, canAlwaysAllow: false, via: "harness" }
            : result?.approval
              ? { ...result.approval, via: "harness" }
              : undefined,
          runtime: result ? result.runtimeKind : (await (harnessRuntime as AgentRuntime).healthCheck()).kind,
        });
      } catch (err: any) {
        console.error("[assistant/stream] harness turn failed:", err?.stack || err?.message || err);
        send({ type: "error", error: describeHarnessFailure(err) });
      } finally {
        // FIX 2: persist whatever audit evidence the turn produced — even a
        // failed turn has tool calls and usage worth recording. Best-effort.
        if (auditConversationId && auditEvents.length > 0) {
          await persistHarnessTurnAudit({
            events: auditEvents,
            conversationId: auditConversationId,
            userId: user.id,
            durationMs: Date.now() - turnStartedAt,
            timings: auditTimings,
          }).catch((auditError: unknown) => {
            console.warn("[assistant/stream] audit persist failed:", auditError);
          });
        }
        if (!sent) send({ type: "done", reply: "" });
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
