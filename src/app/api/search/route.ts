import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { publicUserSelect, userFromRequest } from "@/lib/auth";
import { jsonError } from "@/lib/validators";

export async function GET(request: NextRequest) {
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);
  const query = request.nextUrl.searchParams.get("q")?.trim().slice(0, 100) ?? "";
  if (query.length < 2) return Response.json({ results: [] });
  const isAdmin = user.role === "OWNER" || user.role === "ADMIN";
  const projectFilter = { archivedAt: null, ...(isAdmin ? {} : { members: { some: { userId: user.id } } }) };
  // Revenue data follows the same rule as the AI tools: members only see their own.
  const leadOwnerFilter = isAdmin ? {} : { assignedToId: user.id };
  const dealOwnerFilter = isAdmin ? {} : { ownerId: user.id };
  const accessibleProjects = await db.project.findMany({ where: projectFilter, select: { id: true } });
  const projectIds = accessibleProjects.map((project) => project.id);
  const [projects, tasks, members, conversations, files, leads, deals, contacts, companies] = await Promise.all([
    db.project.findMany({ where: { ...projectFilter, name: { contains: query, mode: "insensitive" } }, select: { id: true, name: true }, take: 8 }),
    db.task.findMany({ where: { projectId: { in: projectIds }, archivedAt: null, title: { contains: query, mode: "insensitive" } }, select: { id: true, title: true, status: true, projectId: true }, take: 8 }),
    db.user.findMany({ where: { disabledAt: null, name: { contains: query, mode: "insensitive" } }, select: publicUserSelect, take: 8 }),
    db.conversation.findMany({ where: { members: { some: { userId: user.id } }, OR: [{ name: { contains: query, mode: "insensitive" } }, { messages: { some: { body: { contains: query, mode: "insensitive" } } } }] }, include: { members: { include: { user: { select: publicUserSelect } } } }, take: 8 }),
    db.driveFile.findMany({ where: { projectId: { in: projectIds }, deletedAt: null, name: { contains: query, mode: "insensitive" } }, select: { id: true, name: true, projectId: true }, take: 8 }),
    db.lead.findMany({ where: { archivedAt: null, ...leadOwnerFilter, OR: [{ title: { contains: query, mode: "insensitive" } }, { email: { contains: query, mode: "insensitive" } }, { companyName: { contains: query, mode: "insensitive" } }] }, select: { id: true, title: true, status: true }, take: 4 }),
    db.deal.findMany({ where: { archivedAt: null, ...dealOwnerFilter, title: { contains: query, mode: "insensitive" } }, select: { id: true, title: true, stage: true, value: true, currency: true }, take: 4 }),
    db.contact.findMany({ where: { archivedAt: null, OR: [{ firstName: { contains: query, mode: "insensitive" } }, { lastName: { contains: query, mode: "insensitive" } }, { email: { contains: query, mode: "insensitive" } }] }, select: { id: true, firstName: true, lastName: true, title: true }, take: 4 }),
    db.company.findMany({ where: { archivedAt: null, name: { contains: query, mode: "insensitive" } }, select: { id: true, name: true, industry: true }, take: 4 }),
  ]);
  const safeConversations = conversations.map((conversation) => ({ id: conversation.id, label: conversation.name ?? conversation.members.find((member) => member.userId !== user.id)?.user.name ?? "Direct message" }));
  return Response.json({ results: [
    ...projects.map((item) => ({ type: "project", id: item.id, label: item.name, detail: "Project", href: `/projects?project=${item.id}` })),
    ...tasks.map((item) => ({ type: "task", id: item.id, label: item.title, detail: item.status.replaceAll("_", " "), href: `/projects?project=${item.projectId}&tab=tasks` })),
    ...members.map((item) => ({ type: "member", id: item.id, label: item.name, detail: item.title ?? `${item.role.toLowerCase()} profile`, href: "/team" })),
    ...deals.map((item) => ({ type: "deal", id: item.id, label: item.title, detail: `${item.currency} ${item.value.toLocaleString()} · ${item.stage.replaceAll("_", " ")}`, href: `/crm?tab=deals&id=${item.id}` })),
    ...leads.map((item) => ({ type: "lead", id: item.id, label: item.title, detail: `Lead · ${item.status}`, href: `/crm?tab=leads&id=${item.id}` })),
    ...contacts.map((item) => ({ type: "contact", id: item.id, label: `${item.firstName} ${item.lastName}`, detail: item.title || "Contact", href: `/crm?tab=contacts&id=${item.id}` })),
    ...companies.map((item) => ({ type: "company", id: item.id, label: item.name, detail: item.industry || "Company", href: `/crm?tab=companies&id=${item.id}` })),
    ...safeConversations.map((item) => ({ type: "conversation", id: item.id, label: item.label, detail: "Conversation", href: `/chat?conversation=${item.id}` })),
    ...files.map((item) => ({ type: "file", id: item.id, label: item.name, detail: "Project file", href: `/projects?project=${item.projectId}&tab=files` })),
  ] });
}
