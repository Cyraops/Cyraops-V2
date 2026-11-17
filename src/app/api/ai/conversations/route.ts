import { NextRequest, NextResponse } from "next/server";
import { userFromRequest } from "@/lib/auth";
import { jsonError } from "@/lib/validators";
import { db } from "@/lib/db";
import { agentRegistry } from "@/lib/ai/agents/agent-registry";

export async function GET(request: NextRequest) {
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);

  await agentRegistry.ensureDefaultAgents();

  const { searchParams } = new URL(request.url);
  const agentSlug = searchParams.get("agentSlug");

  const where: any = { userId: user.id };
  if (agentSlug) {
    const agent = await agentRegistry.getAgentBySlug(agentSlug);
    if (agent) where.agentId = agent.id;
  }

  // Find or create default conversations for agents if none exist
  const existingConversations = await db.aiConversation.findMany({
    where,
    include: {
      agent: true,
      messages: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
    orderBy: { updatedAt: "desc" },
  });

  return NextResponse.json({ conversations: existingConversations });
}

export async function POST(request: NextRequest) {
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);

  const body = await request.json().catch(() => ({}));
  const { agentSlug = "chief_of_staff", title = "New Mission" } = body;

  const agent = await agentRegistry.getAgentBySlug(agentSlug) || await agentRegistry.getMasterAgent();
  if (!agent) return jsonError("Agent not found", 404);

  const conversation = await db.aiConversation.create({
    data: {
      agentId: agent.id,
      userId: user.id,
      title: title.slice(0, 80),
    },
    include: {
      agent: true,
      messages: true,
    },
  });

  // Seed welcome message from agent
  await db.aiMessage.create({
    data: {
      conversationId: conversation.id,
      role: "assistant",
      content: `Hello! I am ${agent.name}, your ${agent.role}. How can I assist with your business operations today? You can instruct me in natural language, request data analysis, or ask me to coordinate with other agents.`,
    },
  });

  const refreshed = await db.aiConversation.findUnique({
    where: { id: conversation.id },
    include: { agent: true, messages: { orderBy: { createdAt: "asc" } } },
  });

  return NextResponse.json({ conversation: refreshed }, { status: 201 });
}

