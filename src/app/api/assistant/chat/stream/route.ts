import { NextRequest } from "next/server";
import { userFromRequest } from "@/lib/auth";
import {
  deriveConversationTitle,
  getOrCreateAssistant,
  resolveConversation,
  sendAssistantMessage,
} from "@/lib/ai/assistant/runtime";
import { checkDailySpend, checkRateLimit } from "@/lib/ai/assistant/guard";
import { db } from "@/lib/db";
import { storage } from "@/lib/storage";
import { streamHarnessTurn } from "@/lib/harness/bot-stream";
import { HarnessRunError, isAbortError, runtimeFactory, type AgentRuntime } from "@/lib/harness/runtime";

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
      const send = (payload: Record<string, unknown>) => {
        try {
          controller.enqueue(sse(payload));
          sent = true;
        } catch {
          // client disconnected
        }
      };

      try {
        const assistant = await getOrCreateAssistant(user.id);

        // A teammate is scoped exactly like the V1 path: the same thread
        // store, and an unknown slug fails the turn the same way.
        const agentSlug = typeof body?.agentSlug === "string" ? body.agentSlug : undefined;
        if (agentSlug) {
          const agent = await db.aiAgent.findFirst({ where: { slug: agentSlug, status: "ACTIVE" } });
          if (!agent) throw new Error("That teammate is not available");
        }

        const conversation = await resolveConversation(
          assistant.id,
          typeof body?.conversationId === "string" ? body.conversationId : undefined,
          agentSlug ?? null
        );
        const isFirstMessage = (await db.assistantMessage.count({ where: { conversationId: conversation.id } })) === 0;

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

        const voiceNote =
          body?.voice === true
            ? "\n\nYou are speaking aloud right now through a voice interface. Answer in one to three short spoken sentences, no lists, no headings, no markdown, no URLs. If there is a lot to say, offer to continue rather than reciting it all."
            : "";
        const task = `${content}${attachmentContext}${voiceNote}`;

        const result = await streamHarnessTurn({
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
          onText: (chunk: string) => send({ type: "token", content: chunk }),
          // Approval mapping: the harness's ask → the same SSE shape the V1
          // approval card consumes. The turn stays open (callback approval:
          // the harness answerer waterfall awaits /api/harness/approve).
          onApproval: (approval) =>
            send({
              type: "approval",
              approvalId: approval.approvalId,
              toolName: approval.toolName,
              summary: approval.summary,
              ...(approval.reason ? { reason: approval.reason } : {}),
              ...(approval.callId ? { callId: approval.callId } : {}),
            }),
          onDone: () =>
            console.info(`[assistant/stream] harness turn finished (conversation=${conversation.id})`),
        });

        await db.assistantMessage.create({
          data: {
            assistantId: assistant.id,
            conversationId: conversation.id,
            role: "assistant",
            content: result.text,
            toolCalls: JSON.stringify([]),
          },
        });

        await db.assistantConversation.update({
          where: { id: conversation.id },
          data: { updatedAt: new Date() },
        });

        send({
          type: "done",
          reply: result.text,
          toolCallsUsed: [],
          conversationId: conversation.id,
          // Mirror the V1 pendingAction shape so the SAME approval card
          // renders in the unchanged UI (answered state: the decision has
          // already been made by the time the turn completes).
          pendingAction: result.approval ? { ...result.approval, via: "harness" } : undefined,
          runtime: result.runtimeKind,
        });
      } catch (err: any) {
        console.error("[assistant/stream] harness turn failed:", err?.stack || err?.message || err);
        send({ type: "error", error: describeHarnessFailure(err) });
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
