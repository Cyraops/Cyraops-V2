import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { logActivity, sameOrigin, userFromRequest } from "@/lib/auth";
import { jsonError } from "@/lib/validators";

const createSchema = z.object({
  title: z.string().trim().min(1).max(160),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime().optional(),
  minutes: z.number().int().min(5).max(600).optional(),
  notes: z.string().max(2000).optional(),
  location: z.string().trim().max(200).optional(),
  attendees: z.string().max(500).optional(),
});

export async function GET(request: NextRequest) {
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);

  const searchParams = request.nextUrl.searchParams;
  const from = new Date(searchParams.get("from") ?? new Date().toISOString());
  const to = new Date(searchParams.get("to") ?? new Date(Date.now() + 30 * 86_400_000).toISOString());
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return jsonError("Invalid date range", 400);

  const range = { gte: from, lte: to };
  const projectId = searchParams.get("projectId");
  const memberId = searchParams.get("memberId");

  const availableProjects = await db.project.findMany({ where: { archivedAt: null, ...(user.role === "OWNER" || user.role === "ADMIN" ? {} : { members: { some: { userId: user.id } } }) }, select: { id: true } });
  const projectIds = availableProjects.map((p) => p.id);

  const [tasks, projects, meetings] = await Promise.all([
    db.task.findMany({ where: { archivedAt: null, dueDate: range, projectId: projectId ?? { in: projectIds }, ...(memberId ? { assigneeId: memberId } : {}) }, select: { id: true, title: true, dueDate: true, status: true, priority: true, project: { select: { id: true, name: true } } }, orderBy: { dueDate: "asc" } }),
    db.project.findMany({ where: { ...((user.role === "OWNER" || user.role === "ADMIN") ? {} : { members: { some: { userId: user.id } } }), ...(projectId ? { id: projectId } : {}), deadline: range, archivedAt: null }, select: { id: true, name: true, deadline: true, status: true }, orderBy: { deadline: "asc" } }),
    // Meetings are workspace-wide: a calendar you cannot see the team's calls in
    // is not a calendar.
    db.calendarEvent.findMany({ where: { archivedAt: null, startsAt: range }, select: { id: true, title: true, startsAt: true, endsAt: true, location: true, attendees: true }, orderBy: { startsAt: "asc" } }),
  ]);

  return Response.json({
    events: [
      ...tasks.map((task) => ({ id: task.id, title: task.title, date: task.dueDate, kind: "task", status: task.status, priority: task.priority, project: task.project })),
      ...projects.map((project) => ({ id: project.id, title: project.name, date: project.deadline, kind: "project", status: project.status, priority: null, project: { id: project.id, name: project.name } })),
      ...meetings.map((meeting) => ({ id: meeting.id, title: meeting.title, date: meeting.startsAt, endsAt: meeting.endsAt, kind: "meeting", status: null, priority: null, location: meeting.location, attendees: meeting.attendees, project: null })),
    ],
  });
}

/** Put a meeting on the calendar. */
export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return jsonError("Invalid request origin", 403);
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Check the meeting details", 400);
  const data = parsed.data;

  const startsAt = new Date(data.startsAt);
  const endsAt = data.endsAt ? new Date(data.endsAt) : new Date(startsAt.getTime() + (data.minutes ?? 30) * 60_000);
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) return jsonError("That start time is not a valid date", 400);
  if (endsAt <= startsAt) return jsonError("The meeting has to end after it starts", 400);

  const meeting = await db.calendarEvent.create({
    data: {
      title: data.title,
      notes: data.notes ?? "",
      location: data.location ?? null,
      startsAt,
      endsAt,
      attendees: data.attendees ?? "",
      creatorId: user.id,
    },
    select: { id: true, title: true, startsAt: true, endsAt: true, location: true, attendees: true },
  });

  await logActivity({ action: "created", entity: "task", entityId: meeting.id, summary: `scheduled ${meeting.title}`, userId: user.id });
  return Response.json({ meeting }, { status: 201 });
}
