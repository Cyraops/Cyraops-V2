import { NextRequest, NextResponse } from "next/server";
import { userFromRequest } from "@/lib/auth";
import { jsonError } from "@/lib/validators";
import { db } from "@/lib/db";
import { getOrCreateAssistant } from "@/lib/ai/assistant/runtime";

/**
 * A short, real brief for the assistant's front door.
 *
 * The empty state used to show four generic prompts, which told a first-time
 * user nothing about their own business. This returns what is actually true
 * right now — open pipeline, what is stalling, what is overdue, which clients
 * have gone quiet — so the first screen answers "what should I do?".
 */
export async function GET(request: NextRequest) {
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);

  try {
    const isAdmin = user.role === "OWNER" || user.role === "ADMIN";
    const dayAgo = new Date(Date.now() - 86_400_000);
    const stalledBefore = new Date(Date.now() - 14 * 86_400_000);

    const dealScope = isAdmin ? {} : { ownerId: user.id };
    const taskScope = isAdmin ? {} : { assigneeId: user.id };
    const leadScope = isAdmin ? {} : { assignedToId: user.id };

    const [openDeals, stalledDeals, dueTasks, coldLeads, pages, goals, routines, assistant] = await Promise.all([
      db.deal.findMany({
        where: { archivedAt: null, ...dealScope, stage: { notIn: ["CLOSED_WON", "CLOSED_LOST"] } },
        select: { value: true },
      }),
      db.deal.count({
        where: {
          archivedAt: null,
          ...dealScope,
          stage: { notIn: ["CLOSED_WON", "CLOSED_LOST"] },
          updatedAt: { lt: stalledBefore },
        },
      }),
      db.task.findMany({
        where: {
          archivedAt: null,
          ...taskScope,
          status: { not: "DONE" },
          dueDate: { lte: new Date(Date.now() + 86_400_000) },
        },
        select: { id: true, title: true, dueDate: true },
        orderBy: { dueDate: "asc" },
        take: 20,
      }),
      db.lead.count({
        where: {
          ...leadScope,
          status: { in: ["NEW", "CONTACTED"] },
          updatedAt: { lt: stalledBefore },
        },
      }),
      db.page.findMany({
        where: { userId: user.id },
        orderBy: { updatedAt: "desc" },
        take: 3,
        select: { id: true, title: true, updatedAt: true },
      }),
      db.aiGoal.findMany({
        where: { status: { in: ["ACTIVE", "PAUSED"] } },
        orderBy: { updatedAt: "desc" },
        take: 3,
        select: { id: true, title: true, status: true, round: true, maxRounds: true },
      }),
      db.aiRoutine.findMany({
        where: isAdmin ? { isEnabled: true } : { isEnabled: true, createdById: user.id },
        orderBy: { nextRunAt: "asc" },
        take: 3,
        select: { id: true, name: true, nextRunAt: true },
      }),
      getOrCreateAssistant(user.id),
    ]);

    const pipelineValue = openDeals.reduce((total, deal) => total + (deal.value ?? 0), 0);
    const overdue = dueTasks.filter((task) => task.dueDate && task.dueDate < new Date(dayAgo));
    const dueToday = dueTasks.length - overdue.length;

    return NextResponse.json(
      {
        user: { name: user.name?.split(" ")[0] ?? null, role: user.role },
        assistant: { name: assistant.name, model: assistant.model },
        pipeline: { deals: openDeals.length, value: pipelineValue, stalled: stalledDeals },
        work: {
          overdue: overdue.length,
          dueToday: Math.max(0, dueToday),
          nextTask: dueTasks[0]?.title ?? null,
        },
        leads: { goingCold: coldLeads },
        pages: pages.map((page) => ({ id: page.id, title: page.title })),
        goals: goals.map((goal) => ({
          id: goal.id,
          title: goal.title,
          status: goal.status,
          round: goal.round,
          maxRounds: goal.maxRounds,
        })),
        routines: routines.map((routine) => ({
          id: routine.id,
          name: routine.name,
          nextRunAt: routine.nextRunAt ? routine.nextRunAt.toISOString() : null,
        })),
        isEmpty:
          openDeals.length === 0 && dueTasks.length === 0 && coldLeads === 0 && pages.length === 0,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err: any) {
    console.error("[API:assistant/today] Failed:", err);
    return jsonError("Could not load your brief", 500);
  }
}
