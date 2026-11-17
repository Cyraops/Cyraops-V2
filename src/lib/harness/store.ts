/**
 * Persistence for the AgentRuntime session store.
 *
 * The harness assigns its durable session id on the first turn; runtimes
 * capture it and persist it here so the next turn can resume with
 * `--session-id` (CLI) or the equivalent in-process resume (native). The
 * record of truth is `AiConversation.harnessSessionId`, keyed by the
 * conversation id, with tenant scoping enforced by the conversation's owner.
 *
 * Fallbacks:
 * - When the conversation id does not name an `AiConversation` row (the
 *   `/api/harness/run` route derives synthetic conversation ids until the UI
 *   wiring passes real ones), a process-local Map keeps the value. It is
 *   scoped by `${tenantId}\0${conversationId}` so tenants can never collide.
 * - When Prisma itself is unavailable, the same Map keeps the runtime usable
 *   (turns still work; the id just does not survive a restart).
 */

import { db } from "@/lib/db";
import type { PrismaClient } from "@prisma/client";

export interface HarnessSessionStore {
  /** The harness session id persisted for this conversation, or null. */
  loadHarnessSessionId(input: { tenantId: string; conversationId: string }): Promise<string | null>;
  /** Persist (or replace) the harness session id for this conversation. */
  saveHarnessSessionId(input: {
    tenantId: string;
    conversationId: string;
    harnessSessionId: string;
  }): Promise<void>;
  /** Forget the harness session id for this conversation. */
  clearHarnessSessionId(input: { tenantId: string; conversationId: string }): Promise<void>;
}

/** Thrown when a save targets a conversation owned by another tenant. */
class TenantScopeError extends Error {
  constructor(conversationId: string) {
    super(`tenant scoping: conversation ${conversationId} belongs to a different tenant`);
    this.name = "TenantScopeError";
  }
}

export function createPrismaSessionStore(prisma: PrismaClient = db): HarnessSessionStore {
  const fallback = new Map<string, string>();
  const key = (tenantId: string, conversationId: string) => `${tenantId}\u0000${conversationId}`;

  async function loadHarnessSessionId(input: { tenantId: string; conversationId: string }) {
    const { tenantId, conversationId } = input;
    try {
      const conversation = await prisma.aiConversation.findUnique({
        where: { id: conversationId },
        select: { userId: true, harnessSessionId: true },
      });
      if (!conversation) return fallback.get(key(tenantId, conversationId)) ?? null;
      if (conversation.userId !== tenantId) return null; // row exists but is not this tenant's
      return conversation.harnessSessionId;
    } catch (error) {
      console.warn(
        `[harness-store] Prisma unavailable, using in-memory fallback: ${error instanceof Error ? error.message : String(error)}`
      );
      return fallback.get(key(tenantId, conversationId)) ?? null;
    }
  }

  async function saveHarnessSessionId(input: {
    tenantId: string;
    conversationId: string;
    harnessSessionId: string;
  }) {
    const { tenantId, conversationId, harnessSessionId } = input;
    try {
      const conversation = await prisma.aiConversation.findUnique({
        where: { id: conversationId },
        select: { userId: true },
      });
      if (!conversation) {
        fallback.set(key(tenantId, conversationId), harnessSessionId);
        return;
      }
      if (conversation.userId !== tenantId) throw new TenantScopeError(conversationId);
      await prisma.aiConversation.update({
        where: { id: conversationId },
        data: { harnessSessionId },
      });
      fallback.delete(key(tenantId, conversationId));
    } catch (error) {
      if (error instanceof TenantScopeError) throw error;
      console.warn(
        `[harness-store] Prisma unavailable, using in-memory fallback: ${error instanceof Error ? error.message : String(error)}`
      );
      fallback.set(key(tenantId, conversationId), harnessSessionId);
    }
  }

  async function clearHarnessSessionId(input: { tenantId: string; conversationId: string }) {
    const { tenantId, conversationId } = input;
    try {
      const conversation = await prisma.aiConversation.findUnique({
        where: { id: conversationId },
        select: { userId: true },
      });
      if (!conversation) {
        fallback.delete(key(tenantId, conversationId));
        return;
      }
      if (conversation.userId !== tenantId) return; // never clear across tenants
      await prisma.aiConversation.update({
        where: { id: conversationId },
        data: { harnessSessionId: null },
      });
    } catch (error) {
      console.warn(
        `[harness-store] Prisma unavailable, clearing in-memory fallback: ${error instanceof Error ? error.message : String(error)}`
      );
      fallback.delete(key(tenantId, conversationId));
    }
  }

  return { loadHarnessSessionId, saveHarnessSessionId, clearHarnessSessionId };
}
