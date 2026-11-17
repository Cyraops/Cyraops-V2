import type { Server } from "socket.io";
import type { Message, User } from "@prisma/client";

declare global {
  var __companyIO: Server | undefined;
}

export function setRealtimeServer(io: Server) {
  globalThis.__companyIO = io;
}

export function publishMessage(message: Message & { sender: Pick<User, "id" | "name" | "avatarUrl"> }) {
  globalThis.__companyIO?.to(message.conversationId).emit("message:new", message);
}

/**
 * Broadcasts an agent-authored message into the same stream a human message
 * uses, so the client renders it identically to any other participant.
 */
export function publishAssistantMessage(message: {
  id: string;
  body: string;
  conversationId: string;
  assistantId: string;
  createdAt: string;
  sender?: null;
  assistant: { id: string; name: string };
}) {
  globalThis.__companyIO?.to(message.conversationId).emit("message:new", message);
}

export function publishAgentMessage(message: {
  id: string;
  clientId?: string | null;
  body: string;
  conversationId: string;
  agentId: string;
  createdAt: string;
  sender?: null;
  agent: { id: string; slug: string; name: string };
}) {
  globalThis.__companyIO?.to(message.conversationId).emit("message:new", message);
}

export function publishMemberRemoval(conversationId: string, userId: string) {
  globalThis.__companyIO?.to(conversationId).emit("conversation:member-removed", { conversationId, userId });
}

export function disconnectUserSockets(userId: string) {
  if (!globalThis.__companyIO) return;
  const sockets = globalThis.__companyIO.sockets.sockets;
  for (const [, socket] of sockets) {
    if (socket.data?.userId === userId) {
      socket.disconnect(true);
    }
  }
}

export function publishCallEvent(event: { callId: string; conversationId: string; type: string; payload?: any }) {
  globalThis.__companyIO?.to(event.conversationId).emit("call:event", event);
}

export function publishCallIncoming(targetUserId: string, data: {
  callId: string;
  conversationId: string;
  type: string;
  initiator: { id: string; name: string; avatarUrl?: string | null };
  ringTimeoutAt?: string | null;
  conversationName?: string | null;
  isGroup?: boolean;
  participantCount?: number;
}) {
  globalThis.__companyIO?.to(`user:${targetUserId}`).emit("call:incoming", data);
}

export function publishCallStateChange(conversationId: string, data: {
  callId: string;
  conversationId?: string;
  status: string;
  participantId?: string;
  participantStatus?: string;
  terminationReason?: string | null;
  actorId?: string | null;
  hostName?: string | null;
  targets?: string[];
  type?: string;
  isGroup?: boolean;
  conversationName?: string | null;
  activeParticipantsCount?: number;
  hostId?: string;
}) {
  globalThis.__companyIO?.to(conversationId).emit("call:state", data);
  if (data.targets && data.targets.length > 0) {
    for (const userId of data.targets) {
      globalThis.__companyIO?.to(`user:${userId}`).emit("call:state", data);
    }
  }
}
