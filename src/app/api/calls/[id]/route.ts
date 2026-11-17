import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { userFromRequest } from "@/lib/auth";
import { jsonError } from "@/lib/validators";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Context) {
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);

  const { id } = await context.params;
  const url = new URL(request.url);
  const eventCursor = url.searchParams.get("eventCursor");
  const eventLimitParam = Number(url.searchParams.get("eventLimit") ?? "25");
  const eventLimit = Math.min(Math.max(isNaN(eventLimitParam) ? 25 : eventLimitParam, 1), 50);

  const call = await db.callSession.findUnique({
    where: { id },
    include: {
      initiator: { select: { id: true, name: true, email: true, avatarUrl: true } },
      host: { select: { id: true, name: true, email: true, avatarUrl: true } },
      participants: {
        include: {
          user: { select: { id: true, name: true, email: true, avatarUrl: true, role: true } },
        },
      },
      events: {
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: eventLimit + 1,
        ...(eventCursor ? { cursor: { id: eventCursor }, skip: 1 } : {}),
      },
      conversation: { select: { id: true, name: true, type: true } },
    },
  });

  if (!call) return jsonError("Call not found", 404);

  // Authorization check: User must be a member of the conversation
  const isMember = await db.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId: call.conversationId, userId: user.id } },
  });

  if (!isMember) {
    return jsonError("You are not authorized to view this call", 403);
  }

  const hasMoreEvents = call.events.length > eventLimit;
  const returnedEvents = hasMoreEvents ? call.events.slice(0, eventLimit) : call.events;
  const nextEventCursor = hasMoreEvents ? returnedEvents[returnedEvents.length - 1]?.id ?? null : null;

  return Response.json({
    call: {
      ...call,
      events: returnedEvents,
    },
    nextEventCursor,
  });
}
