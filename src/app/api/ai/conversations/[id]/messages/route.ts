import { NextRequest, NextResponse } from "next/server";
import { userFromRequest } from "@/lib/auth";
import { jsonError } from "@/lib/validators";
import { db } from "@/lib/db";
import { createAndDispatchTask } from "@/lib/ai/orchestrator/dispatcher";
import { agentRegistry } from "@/lib/ai/agents/agent-registry";
import { canViewAiConversation } from "@/lib/ai/access";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);

  const { id: conversationId } = await context.params;

  const conversation = await db.aiConversation.findUnique({
    where: { id: conversationId },
    include: {
      agent: true,
      messages: { orderBy: { createdAt: "asc" } },
    },
  });

  if (!conversation) return jsonError("Conversation not found", 404);

  // Conversations are private to their owner. Respond 404 rather than 403 so the
  // endpoint cannot be used to enumerate conversation ids.
  if (!canViewAiConversation(user, conversation)) {
    return jsonError("Conversation not found", 404);
  }

  // Check if there is an active or recently finished task for this conversation / agent
  const activeTask = await db.aiTask.findFirst({
    where: {
      OR: [
        { conversationId },
        { assignedAgentId: conversation.agentId, requestingUserId: user.id },
      ],
      status: { in: ["RUNNING", "PLANNING", "AWAITING_APPROVAL", "PAUSED", "RECOVERING", "COMPLETED"] },
    },
    include: {
      steps: { orderBy: { stepIndex: "asc" } },
      approvals: true,
      toolCalls: { orderBy: { createdAt: "asc" } },
    },
    orderBy: { updatedAt: "desc" },
  });

  // Return sanitized conversation messages (no hidden reasoning exposure)
  const sanitizedConversation = {
    ...conversation,
    messages: conversation.messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      createdAt: m.createdAt,
    })),
  };

  return NextResponse.json({
    conversation: sanitizedConversation,
    activeTask,
  });
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);

  const { id: conversationId } = await context.params;
  const conversation = await db.aiConversation.findUnique({
    where: { id: conversationId },
    include: { agent: true },
  });

  if (!conversation) return jsonError("Conversation not found", 404);

  if (!canViewAiConversation(user, conversation)) {
    return jsonError("Conversation not found", 404);
  }

  const body = await request.json().catch(() => ({}));
  const { content, priority = "MEDIUM", delegateToSlug } = body;

  if (!content || !content.trim()) {
    return jsonError("Message content is required", 400);
  }

  // 1. Record User Message
  const userMessage = await db.aiMessage.create({
    data: {
      conversationId,
      role: "user",
      content: content.trim(),
    },
  });

  // Determine target agent
  const targetSlug = delegateToSlug || conversation.agent.slug;
  const targetAgent = await agentRegistry.getAgentBySlug(targetSlug) || conversation.agent;

  let assistantContent = "";
  let taskResult: any = null;

  // 2. Dispatch Task
  try {
    const task = await createAndDispatchTask({
      objective: content.trim(),
      prompt: content.trim(),
      requestingUserId: user.id,
      requestingUserRole: user.role,
      assignedAgentSlug: targetAgent.slug,
      priority,
      conversationId: conversation.id,
    });

    if (task?.id) {
      taskResult = await db.aiTask.findUnique({
        where: { id: task.id },
        include: {
          steps: { orderBy: { stepIndex: "asc" } },
          approvals: true,
          toolCalls: { orderBy: { createdAt: "asc" } },
        },
      });
    } else {
      taskResult = task;
    }

    if (!task) {
      assistantContent = `Objective "${content.trim()}" received. Orchestration initiated.`;
    } else if (task.status === "COMPLETED") {
      let parsedResult: any = {};
      try {
        parsedResult = JSON.parse(task.result || "{}");
      } catch {
        parsedResult = { summary: task.result };
      }
      assistantContent = parsedResult.summary || `Objective "${content.trim()}" completed and verified across all steps.`;
    } else if (task.status === "AWAITING_APPROVAL") {
      assistantContent = `I have formulated the plan and executed initial steps. However, step requires your explicit authorization before proceeding. Please review the approval card below.`;
    } else if (task.status === "PAUSED") {
      assistantContent = `Task has been paused. You can resume it from the control panel once ready.`;
    } else if (task.status === "FAILED") {
      assistantContent = `Task failed before completion. ${task.error || "The AI provider or an execution step is unavailable."} No completion was reported.`;
    } else {
      assistantContent = `Task is currently in ${task.status} status. Monitoring progress...`;
    }
  } catch (err: any) {
    console.error("[Conversation] Task execution error:", err);
    if (err?.name === "OpenAIKeyMissingError" || err?.message?.includes("OPENAI_API_KEY")) {
      assistantContent = "OPENAI_API_KEY is not configured in .env. Please configure your OpenAI API key in the non-production environment and restart the server.";
    } else if (err?.name === "OpenAIKeyInvalidError" || err?.status === 401) {
      assistantContent = "OpenAI authentication failed: Invalid OPENAI_API_KEY. Please verify your API key in .env.";
    } else if (err?.name === "OpenAIRateLimitError" || err?.status === 429) {
      assistantContent = "OpenAI rate limit exceeded. Please wait a moment and retry your instruction.";
    } else if (err?.name === "OpenAIUnavailableError" || err?.message?.includes("OpenAI")) {
      assistantContent = `OpenAI API is currently unreachable (${err?.message || "Connection failed"}). Your task state and instructions have been preserved safely in the database.`;
    } else {
      assistantContent = `Encountered an operational error: ${err?.message || "Execution failed"}. The task has been safely marked for review.`;
    }
  }

  // 3. Record Assistant Message (Never expose private model reasoning)
  const assistantMessage = await db.aiMessage.create({
    data: {
      conversationId,
      role: "assistant",
      content: assistantContent,
      reasoning: null,
    },
  });

  // Update conversation timestamp
  await db.aiConversation.update({
    where: { id: conversationId },
    data: { updatedAt: new Date() },
  });

  return NextResponse.json({
    userMessage: {
      id: userMessage.id,
      role: userMessage.role,
      content: userMessage.content,
      createdAt: userMessage.createdAt,
    },
    assistantMessage: {
      id: assistantMessage.id,
      role: assistantMessage.role,
      content: assistantMessage.content,
      createdAt: assistantMessage.createdAt,
    },
    task: taskResult,
  });
}
