import { db } from "@/lib/db";
import { MemoryType } from "@prisma/client";

export class MemoryManager {
  public async storeMemory(params: {
    type: MemoryType;
    key: string;
    content: string;
    metadata?: Record<string, any>;
    userId?: string;
    agentId?: string;
  }) {
    return await db.aiMemory.create({
      data: {
        type: params.type,
        key: params.key,
        content: params.content,
        metadata: JSON.stringify(params.metadata || {}),
        userId: params.userId,
        agentId: params.agentId,
      },
    });
  }

  public async getMemoryByKey(type: MemoryType, key: string) {
    return await db.aiMemory.findFirst({
      where: { type, key },
      orderBy: { updatedAt: "desc" },
    });
  }

  public async listMemories(type?: MemoryType, limit: number = 50) {
    return await db.aiMemory.findMany({
      where: type ? { type } : {},
      orderBy: { updatedAt: "desc" },
      take: limit,
    });
  }

  public async getConversationHistory(conversationId: string, limit: number = 30) {
    return await db.aiMessage.findMany({
      where: { conversationId },
      orderBy: { createdAt: "asc" },
      take: limit,
    });
  }

  public async recordMessage(params: {
    conversationId: string;
    role: string;
    content: string;
    toolCalls?: any[];
  }) {
    return await db.aiMessage.create({
      data: {
        conversationId: params.conversationId,
        role: params.role,
        content: params.content,
        reasoning: null,
        toolCalls: params.toolCalls ? JSON.stringify(params.toolCalls) : null,
      },
    });
  }
}

export const memoryManager = new MemoryManager();

