import { NextRequest } from "next/server";
import { userFromRequest } from "@/lib/auth";
import { sendAssistantMessage } from "@/lib/ai/assistant/runtime";
import { checkDailySpend, checkRateLimit } from "@/lib/ai/assistant/guard";

const encoder = new TextEncoder();

function sse(data: Record<string, unknown>): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(data)}\n\n`);
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
