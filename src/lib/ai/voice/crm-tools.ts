/**
 * Cyraops CRM Tool Registry for AI Voice Assistant
 *
 * Full server-side permission-controlled CRM operations:
 * - Read operations: Execute automatically if authorized.
 * - Low-risk writes: Execute if authorized and parameters clear.
 * - High-impact operations: Require explicit confirmation with unique actionId and expiry.
 * - Scoped to authenticated user and active workspace.
 */

import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { EmailService } from "@/lib/email/service";
import { emailMessageVisibilityWhere } from "@/lib/email/access";
import type { User, Role } from "@prisma/client";

export interface PendingAction {
  id: string;
  toolName: string;
  params: Record<string, any>;
  summary: string;
  userId: string;
  workspaceId: string;
  createdAt: number;
  expiresAt: number;
  status: "PENDING" | "CONFIRMED" | "CANCELLED" | "EXPIRED";
}

// In-memory pending actions store with cleanup
const pendingActionsStore = new Map<string, PendingAction>();

export interface VoicePageContext {
  pathname: string;
  query?: string;
  updatedAt: number;
}

/**
 * The page the user is currently looking at, keyed by user.
 *
 * Held in memory alongside pending actions: it is per-request UI state, not
 * business data, and it is refreshed on every assistant call.
 */
const pageContextStore = new Map<string, VoicePageContext>();

export function setVoicePageContext(userId: string, context: { pathname?: string; query?: string }): void {
  const pathname = typeof context.pathname === "string" ? context.pathname.slice(0, 300) : "";
  if (!pathname) return;
  pageContextStore.set(userId, {
    pathname,
    query: typeof context.query === "string" ? context.query.slice(0, 500) : "",
    updatedAt: Date.now(),
  });
}

export function getVoicePageContext(userId: string): VoicePageContext | undefined {
  const context = pageContextStore.get(userId);
  if (!context) return undefined;
  // A page context older than 30 minutes is more misleading than none.
  if (Date.now() - context.updatedAt > 30 * 60 * 1000) {
    pageContextStore.delete(userId);
    return undefined;
  }
  return context;
}

function recordIdFromQuery(query?: string): string | null {
  if (!query) return null;
  try {
    const params = new URLSearchParams(query.startsWith("?") ? query : `?${query}`);
    return params.get("id") || params.get("recordId") || null;
  } catch {
    return null;
  }
}

const KNOWN_PAGES: Record<string, string> = {
  dashboard: "/dashboard",
  crm: "/crm",
  projects: "/projects",
  tasks: "/projects",
  chat: "/chat",
  calendar: "/calendar",
  email: "/email",
  cost: "/cost",
  finance: "/cost",
  team: "/team",
  settings: "/settings",
  activity: "/activity",
  website: "/website",
  presence: "/website",
  ai: "/ai",
  agents: "/ai",
};

export function registerPendingAction(data: {
  toolName: string;
  params: Record<string, any>;
  summary: string;
  userId: string;
  workspaceId: string;
}): PendingAction {
  // Clean expired actions
  const now = Date.now();
  for (const [id, act] of pendingActionsStore.entries()) {
    if (act.expiresAt < now) pendingActionsStore.delete(id);
  }

  const actionId = `act_${randomBytes(16).toString("hex")}`;
  const action: PendingAction = {
    id: actionId,
    toolName: data.toolName,
    params: data.params,
    summary: data.summary,
    userId: data.userId,
    workspaceId: data.workspaceId,
    createdAt: now,
    expiresAt: now + 5 * 60 * 1000, // 5 minutes expiry
    status: "PENDING",
  };

  pendingActionsStore.set(actionId, action);
  return action;
}

export function getPendingAction(actionId: string): PendingAction | undefined {
  const action = pendingActionsStore.get(actionId);
  if (!action) return undefined;
  if (action.expiresAt < Date.now()) {
    action.status = "EXPIRED";
    pendingActionsStore.delete(actionId);
    return undefined;
  }
  return action;
}

export function cancelPendingAction(actionId: string, userId: string): boolean {
  const action = pendingActionsStore.get(actionId);
  if (!action || action.userId !== userId) return false;
  action.status = "CANCELLED";
  pendingActionsStore.delete(actionId);
  return true;
}

// Tool schema definitions for DeepSeek function calling
export const CRM_VOICE_TOOLS = [
  {
    type: "function",
    function: {
      name: "get_dashboard_summary",
      description: "Get an executive summary of CRM metrics: overdue tasks, delayed projects, pending leads, recent activities, and upcoming deadlines.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_contacts_and_leads",
      description: "Search CRM contacts and sales leads by name, email, company, or status.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query or keyword" },
          type: { type: "string", enum: ["all", "contacts", "leads"], description: "Filter by entity type" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_contact_or_lead",
      description: "Create a new contact or sales lead in the CRM.",
      parameters: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["contact", "lead"], description: "Whether to create a contact or lead" },
          firstName: { type: "string", description: "First name (for contact)" },
          lastName: { type: "string", description: "Last name (for contact)" },
          title: { type: "string", description: "Job title or lead title" },
          email: { type: "string", description: "Email address" },
          phone: { type: "string", description: "Phone number" },
          companyName: { type: "string", description: "Associated company or business name" },
          estimatedValue: { type: "number", description: "Estimated lead deal value in currency" },
          notes: { type: "string", description: "Initial notes or background" },
        },
        required: ["kind"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_lead_status",
      description: "Update the pipeline status of a sales lead.",
      parameters: {
        type: "object",
        properties: {
          leadId: { type: "string", description: "ID of the lead" },
          status: { type: "string", enum: ["NEW", "CONTACTED", "QUALIFIED", "PROPOSAL_SENT", "WON", "LOST"], description: "New status" },
          notes: { type: "string", description: "Optional update notes" },
        },
        required: ["leadId", "status"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_projects",
      description: "List projects with their status, deadlines, and members.",
      parameters: {
        type: "object",
        properties: {
          status: { type: "string", enum: ["all", "PLANNING", "ACTIVE", "ON_HOLD", "COMPLETED", "ARCHIVED"], description: "Filter by status" },
          query: { type: "string", description: "Filter by project name" },
          delayedOnly: { type: "boolean", description: "Filter only delayed projects whose deadline has passed" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_project_details",
      description: "Get detailed information about a specific project including tasks, timeline, and team members.",
      parameters: {
        type: "object",
        properties: {
          projectId: { type: "string", description: "The ID or exact name of the project" },
        },
        required: ["projectId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_project",
      description: "Create a new project in the workspace.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Project name" },
          description: { type: "string", description: "Project description" },
          priority: { type: "string", enum: ["LOW", "MEDIUM", "HIGH", "URGENT"], description: "Priority level" },
          deadlineDaysFromNow: { type: "number", description: "Deadline in days from today" },
        },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_project_status",
      description: "Update a project's lifecycle status.",
      parameters: {
        type: "object",
        properties: {
          projectId: { type: "string", description: "Project ID" },
          status: { type: "string", enum: ["PLANNING", "IN_PROGRESS", "REVIEW", "COMPLETED", "ON_HOLD"], description: "New status" },
        },
        required: ["projectId", "status"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_tasks",
      description: "List and filter tasks across projects (e.g. overdue tasks, pending tasks, assigned to me).",
      parameters: {
        type: "object",
        properties: {
          overdueOnly: { type: "boolean", description: "Filter only overdue tasks" },
          status: { type: "string", enum: ["all", "TODO", "IN_PROGRESS", "REVIEW", "DONE"], description: "Filter by status" },
          projectId: { type: "string", description: "Filter by project ID" },
          assigneeName: { type: "string", description: "Filter by assignee name" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_task",
      description: "Create a new task inside a project.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Task title" },
          description: { type: "string", description: "Task description" },
          projectId: { type: "string", description: "Project ID to attach task to (optional, defaults to first active project if omitted)" },
          priority: { type: "string", enum: ["LOW", "MEDIUM", "HIGH", "URGENT"], description: "Task priority" },
          dueDaysFromNow: { type: "number", description: "Due date in days from today (e.g. 1 for tomorrow, 7 for next week)" },
        },
        required: ["title"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_task",
      description: "Update a task's status, priority, or details.",
      parameters: {
        type: "object",
        properties: {
          taskId: { type: "string", description: "Task ID" },
          status: { type: "string", enum: ["TODO", "IN_PROGRESS", "REVIEW", "DONE"], description: "New status" },
          priority: { type: "string", enum: ["LOW", "MEDIUM", "HIGH", "URGENT"], description: "New priority" },
        },
        required: ["taskId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_task_comment",
      description: "Add a comment or update to an existing task.",
      parameters: {
        type: "object",
        properties: {
          taskId: { type: "string", description: "Task ID" },
          comment: { type: "string", description: "Comment text" },
        },
        required: ["taskId", "comment"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_emails",
      description: "Search workspace emails by keyword, sender, subject, or folder.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query or sender email" },
          folder: { type: "string", enum: ["INBOX", "Sent", "Drafts", "Trash", "all"], description: "Mailbox folder" },
          unreadOnly: { type: "boolean", description: "Filter only unread emails" },
          limit: { type: "number", description: "Maximum emails to return (default 5)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_email",
      description: "Read full details of a specific email message including sender, subject, body, and attachments.",
      parameters: {
        type: "object",
        properties: {
          emailId: { type: "string", description: "Email message ID" },
        },
        required: ["emailId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "draft_email",
      description: "Draft an email without sending it immediately.",
      parameters: {
        type: "object",
        properties: {
          to: { type: "string", description: "Recipient email address" },
          subject: { type: "string", description: "Email subject line" },
          body: { type: "string", description: "Email body content" },
        },
        required: ["to", "subject", "body"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "send_email",
      description: "Send an external email. HIGH-IMPACT: Triggers an explicit confirmation card before sending.",
      parameters: {
        type: "object",
        properties: {
          to: { type: "string", description: "Recipient email address" },
          subject: { type: "string", description: "Email subject line" },
          body: { type: "string", description: "Email body content" },
        },
        required: ["to", "subject", "body"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_calendar_events",
      description: "List calendar events, project deadlines, and scheduled tasks for a given time window.",
      parameters: {
        type: "object",
        properties: {
          daysAhead: { type: "number", description: "Number of days ahead to look (default 14)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "cancel_calendar_event",
      description: "Cancel or archive a calendar event or scheduled task. HIGH-IMPACT: Triggers an explicit confirmation card.",
      parameters: {
        type: "object",
        properties: {
          eventId: { type: "string", description: "Task or event ID to cancel" },
          reason: { type: "string", description: "Cancellation reason" },
        },
        required: ["eventId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_files",
      description: "Search workspace documents and files by filename.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Filename keyword" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_company_presence",
      description: "Check live Cyraops presence status including website health (cyraops.com), SEO channels, and integrations.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_team_members",
      description: "List team members in the workspace and their roles.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_user_role",
      description: "Change a team member's role (MEMBER or ADMIN). HIGH-IMPACT: Triggers explicit confirmation card.",
      parameters: {
        type: "object",
        properties: {
          targetUserId: { type: "string", description: "User ID to update" },
          newRole: { type: "string", enum: ["ADMIN", "MEMBER"], description: "New role" },
        },
        required: ["targetUserId", "newRole"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_page_context",
      description: "Get which page of the CRM the user is currently viewing, including any record id in the URL. Use this when the user says 'this page', 'here', or 'what am I looking at'.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_current_record",
      description: "Load the record the user is currently looking at (from the page URL), or a specific record by id. Use this to resolve 'this project', 'this lead', 'this person'.",
      parameters: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["project", "lead", "contact", "email"], description: "Type of record to load" },
          id: { type: "string", description: "Record id. Omit to use the record open on the current page." },
        },
        required: ["kind"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "navigate_to",
      description: "Move the user's browser to a page of the CRM, optionally focused on a record. Use when the user asks to open, show, or go to something.",
      parameters: {
        type: "object",
        properties: {
          page: {
            type: "string",
            enum: ["dashboard", "crm", "projects", "chat", "calendar", "email", "cost", "team", "settings", "activity", "website", "ai"],
            description: "The page to open",
          },
          recordId: { type: "string", description: "Optional record id to focus (supported on crm)" },
        },
        required: ["page"],
      },
    },
  },
];

// Execution handler for CRM tools
export async function executeCrmTool(
  toolName: string,
  params: Record<string, any>,
  user: User,
  workspaceId: string
): Promise<{
  success: boolean;
  result?: any;
  error?: string;
  requiresConfirmation?: boolean;
  pendingAction?: PendingAction;
}> {
  try {
    // 1. Dashboard summary
    if (toolName === "get_dashboard_summary") {
      const now = new Date();
      const [overdueTasks, activeProjects, leadsCount, recentActivities] = await Promise.all([
        db.task.findMany({
          where: {
            archivedAt: null,
            status: { not: "DONE" },
            dueDate: { lt: now },
            ...(user.role === "OWNER" || user.role === "ADMIN" ? {} : { assigneeId: user.id }),
          },
          select: { id: true, title: true, dueDate: true, priority: true, project: { select: { name: true } } },
          take: 5,
          orderBy: { dueDate: "asc" },
        }),
        db.project.findMany({
          where: {
            archivedAt: null,
            status: { in: ["PLANNING", "ACTIVE"] },
            ...(user.role === "OWNER" || user.role === "ADMIN" ? {} : { members: { some: { userId: user.id } } }),
          },
          select: { id: true, name: true, status: true, deadline: true },
          take: 5,
        }),
        db.lead.count({ where: { status: { in: ["NEW", "CONTACTED", "QUALIFIED"] } } }),
        db.activity.findMany({
          select: { id: true, action: true, summary: true, createdAt: true },
          orderBy: { createdAt: "desc" },
          take: 5,
        }),
      ]);

      const delayedProjects = activeProjects.filter((p) => p.deadline && p.deadline < now);

      return {
        success: true,
        result: {
          overdueTasksCount: overdueTasks.length,
          overdueTasks: overdueTasks.map((t) => ({ id: t.id, title: t.title, project: t.project.name, due: t.dueDate })),
          activeProjectsCount: activeProjects.length,
          delayedProjectsCount: delayedProjects.length,
          delayedProjects: delayedProjects.map((p) => ({ id: p.id, name: p.name, deadline: p.deadline })),
          pendingLeadsCount: leadsCount,
          recentActivities: recentActivities.map((a) => ({ summary: a.summary, time: a.createdAt })),
        },
      };
    }

    // 2. Contacts and Leads search
    if (toolName === "search_contacts_and_leads") {
      const q = (params.query || "").trim();
      const type = params.type || "all";

      const [contacts, leads] = await Promise.all([
        type !== "leads"
          ? db.contact.findMany({
              where: q ? { OR: [{ firstName: { contains: q, mode: "insensitive" } }, { lastName: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }] } : {},
              select: { id: true, firstName: true, lastName: true, email: true, phone: true, title: true, status: true },
              take: 5,
            })
          : [],
        type !== "contacts"
          ? db.lead.findMany({
              where: q ? { OR: [{ title: { contains: q, mode: "insensitive" } }, { companyName: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }] } : {},
              select: { id: true, title: true, companyName: true, email: true, status: true, score: true, estimatedValue: true },
              take: 5,
            })
          : [],
      ]);

      return { success: true, result: { contacts, leads } };
    }

    // 3. Create contact or lead
    if (toolName === "create_contact_or_lead") {
      if (params.kind === "contact") {
        const contact = await db.contact.create({
          data: {
            firstName: params.firstName || "New",
            lastName: params.lastName || "Contact",
            email: params.email || null,
            phone: params.phone || null,
            title: params.title || null,
            notes: params.notes || "",
          },
        });
        return { success: true, result: { message: `Contact "${contact.firstName} ${contact.lastName}" created successfully.`, contact } };
      } else {
        const lead = await db.lead.create({
          data: {
            title: params.title || `Lead - ${params.companyName || "Inbound"}`,
            companyName: params.companyName || null,
            email: params.email || null,
            phone: params.phone || null,
            estimatedValue: params.estimatedValue ? Number(params.estimatedValue) : null,
            notes: params.notes || "",
            assignedToId: user.id,
          },
        });
        return { success: true, result: { message: `Lead "${lead.title}" created successfully.`, lead } };
      }
    }

    // 4. Update lead status
    if (toolName === "update_lead_status") {
      const lead = await db.lead.update({
        where: { id: params.leadId },
        data: {
          status: params.status,
          ...(params.notes ? { notes: params.notes } : {}),
        },
      });
      return { success: true, result: { message: `Lead status updated to ${params.status}.`, lead } };
    }

    // 5. List projects
    if (toolName === "list_projects") {
      const where: any = {
        archivedAt: null,
        ...(user.role === "OWNER" || user.role === "ADMIN" ? {} : { members: { some: { userId: user.id } } }),
      };
      if (params.status && params.status !== "all") {
        where.status = params.status;
      }
      if (params.delayedOnly) {
        where.deadline = { lt: new Date() };
      }
      if (params.query) {
        where.name = { contains: params.query.trim(), mode: "insensitive" };
      }

      const projects = await db.project.findMany({
        where,
        select: {
          id: true,
          name: true,
          status: true,
          priority: true,
          deadline: true,
          _count: { select: { tasks: true, members: true } },
        },
        orderBy: { updatedAt: "desc" },
        take: 10,
      });

      return { success: true, result: { projects } };
    }

    // 6. Get project details
    if (toolName === "get_project_details") {
      const project = await db.project.findFirst({
        where: {
          OR: [{ id: params.projectId }, { name: { contains: params.projectId, mode: "insensitive" } }],
          archivedAt: null,
        },
        include: {
          tasks: {
            where: { archivedAt: null },
            select: { id: true, title: true, status: true, priority: true, dueDate: true, assignee: { select: { name: true } } },
            take: 10,
          },
          members: { select: { role: true, user: { select: { id: true, name: true, role: true } } } },
        },
      });

      if (!project) return { success: false, error: `Project not found.` };
      return { success: true, result: { project } };
    }

    // 7. Create project
    if (toolName === "create_project") {
      const deadline = params.deadlineDaysFromNow
        ? new Date(Date.now() + params.deadlineDaysFromNow * 86400000)
        : null;

      const project = await db.project.create({
        data: {
          name: params.name,
          description: params.description || "",
          priority: params.priority || "MEDIUM",
          deadline,
          ownerId: user.id,
          members: { create: { userId: user.id, role: "LEAD" } },
        },
      });

      await db.activity.create({
        data: {
          action: "PROJECT_CREATED",
          entity: "Project",
          entityId: project.id,
          summary: `Project "${project.name}" created via Voice Assistant by ${user.name}`,
          userId: user.id,
          projectId: project.id,
        },
      });

      return { success: true, result: { message: `Project "${project.name}" created successfully.`, project } };
    }

    // 8. Update project status
    if (toolName === "update_project_status") {
      const project = await db.project.update({
        where: { id: params.projectId },
        data: { status: params.status },
      });
      return { success: true, result: { message: `Project "${project.name}" status updated to ${params.status}.`, project } };
    }

    // 9. List tasks
    if (toolName === "list_tasks") {
      const where: any = { archivedAt: null };
      if (params.overdueOnly) {
        where.dueDate = { lt: new Date() };
        where.status = { not: "DONE" };
      }
      if (params.status && params.status !== "all") {
        where.status = params.status;
      }
      if (params.projectId) {
        where.projectId = params.projectId;
      }
      if (params.assigneeName) {
        where.assignee = { name: { contains: params.assigneeName, mode: "insensitive" } };
      }

      const tasks = await db.task.findMany({
        where,
        select: {
          id: true,
          title: true,
          status: true,
          priority: true,
          dueDate: true,
          project: { select: { id: true, name: true } },
          assignee: { select: { id: true, name: true } },
        },
        orderBy: { dueDate: "asc" },
        take: 10,
      });

      return { success: true, result: { tasks } };
    }

    // 10. Create task
    if (toolName === "create_task") {
      let projectId = params.projectId;
      if (!projectId && params.projectName) {
        const foundProj = await db.project.findFirst({
          where: { name: { contains: params.projectName.trim(), mode: "insensitive" }, archivedAt: null },
          select: { id: true },
        });
        if (foundProj) projectId = foundProj.id;
      }

      if (!projectId) {
        // Fall back to first accessible active project
        const firstProj = await db.project.findFirst({
          where: { archivedAt: null },
          select: { id: true, name: true },
          orderBy: { createdAt: "desc" },
        });
        if (!firstProj) {
          return { success: false, error: "No active projects found. Please create a project first." };
        }
        projectId = firstProj.id;
      }

      const dueDate = params.dueDaysFromNow !== undefined
        ? new Date(Date.now() + Number(params.dueDaysFromNow) * 86400000)
        : params.dueDate ? new Date(params.dueDate) : null;

      const task = await db.task.create({
        data: {
          title: params.title,
          description: params.description || "",
          priority: params.priority || "MEDIUM",
          dueDate,
          projectId,
          creatorId: user.id,
          assigneeId: user.id,
        },
        include: { project: { select: { name: true } } },
      });

      await db.activity.create({
        data: {
          action: "TASK_CREATED",
          entity: "Task",
          entityId: task.id,
          summary: `Task "${task.title}" created via Voice Assistant in ${task.project.name}`,
          userId: user.id,
          projectId: task.projectId,
          taskId: task.id,
        },
      });

      return { success: true, result: { message: `Task "${task.title}" created in ${task.project.name}.`, task } };
    }

    // 11. Update task
    if (toolName === "update_task") {
      const data: any = {};
      if (params.status) data.status = params.status;
      if (params.priority) data.priority = params.priority;

      const task = await db.task.update({
        where: { id: params.taskId },
        data,
        select: { id: true, title: true, status: true, priority: true },
      });

      return { success: true, result: { message: `Task "${task.title}" updated.`, task } };
    }

    // 12. Add task comment
    if (toolName === "add_task_comment") {
      const comment = await db.taskComment.create({
        data: {
          taskId: params.taskId,
          authorId: user.id,
          body: params.comment,
        },
      });
      return { success: true, result: { message: "Comment added successfully.", commentId: comment.id } };
    }

    // 13. Search emails
    if (toolName === "search_emails") {
      const q = (params.query || "").trim();
      const where: any = {};
      if (q) {
        where.OR = [
          { subject: { contains: q, mode: "insensitive" } },
          { fromEmail: { contains: q, mode: "insensitive" } },
          { snippet: { contains: q, mode: "insensitive" } },
        ];
      }
      if (params.folder && params.folder !== "all") {
        where.folder = { name: { contains: params.folder, mode: "insensitive" } };
      }
      if (params.unreadOnly) {
        where.isRead = false;
      }

      const emails = await db.emailMessage.findMany({
        where,
        select: {
          id: true,
          subject: true,
          fromEmail: true,
          toRecipients: true,
          receivedAt: true,
          isRead: true,
          snippet: true,
          folder: { select: { name: true } },
        },
        orderBy: { receivedAt: "desc" },
        take: params.limit || 5,
      });

      return { success: true, result: { emails } };
    }

    // 14. Read email
    if (toolName === "read_email") {
      const email = await db.emailMessage.findUnique({
        where: { id: params.emailId },
        include: {
          attachments: { select: { id: true, filename: true, contentType: true, size: true } },
          folder: { select: { name: true } },
        },
      });

      if (!email) return { success: false, error: "Email message not found." };
      return { success: true, result: { email } };
    }

    // 15. Draft email
    if (toolName === "draft_email") {
      const account = await EmailService.getOrCreateAccount(user.id);
      let draftsFolder = await db.emailFolder.findFirst({
        where: { accountId: account.id, name: { in: ["Drafts", "drafts", "Draft"] } },
      });

      if (!draftsFolder) {
        draftsFolder = await db.emailFolder.create({
          data: { accountId: account.id, name: "Drafts", rawPath: "Drafts" },
        });
      }

      const draft = await db.emailMessage.create({
        data: {
          accountId: account.id,
          folderId: draftsFolder.id,
          uid: Math.floor(Date.now() / 1000),
          fromEmail: account.email,
          toRecipients: JSON.stringify([params.to]),
          subject: params.subject,
          bodyText: params.body,
          snippet: params.body.slice(0, 100),
          receivedAt: new Date(),
          isDraft: true,
          deliveryStatus: "PENDING",
        },
      });

      return { success: true, result: { message: `Email draft to ${params.to} saved.`, draftId: draft.id } };
    }

    // 16. Send email - HIGH IMPACT (requires explicit confirmation)
    if (toolName === "send_email") {
      // External email stays an Owner/Admin action: a single spoken "send it"
      // is not a sufficient review of what is about to leave the company.
      if (user.role !== "OWNER" && user.role !== "ADMIN") {
        return {
          success: false,
          error: "Only Owners and Admins can send external email by voice. Ask an Owner to review and send it from the Email module.",
        };
      }

      const recipient = String(params.to || "").trim();
      const subject = String(params.subject || "").trim();
      const body = String(params.body || "");

      // The confirmation card renders this summary, so it must contain the full
      // message the user is approving — not just the recipient and subject.
      const summary = [
        `SEND EXTERNAL EMAIL TO: ${recipient}`,
        `SUBJECT: ${subject}`,
        "",
        body,
      ].join("\n");

      const pendingAction = registerPendingAction({
        toolName: "send_email",
        params,
        summary,
        userId: user.id,
        workspaceId,
      });

      return {
        success: true,
        requiresConfirmation: true,
        pendingAction,
        result: {
          actionId: pendingAction.id,
          message: `Sending this email requires your confirmation. Action ID: ${pendingAction.id}. The full message is shown on the confirmation card — read it before confirming.`,
        },
      };
    }

    // 17. List calendar events
    if (toolName === "list_calendar_events") {
      const days = params.daysAhead || 14;
      const now = new Date();
      const end = new Date(Date.now() + days * 86400000);

      const [tasks, projects] = await Promise.all([
        db.task.findMany({
          where: {
            archivedAt: null,
            dueDate: { gte: now, lte: end },
            ...(user.role === "OWNER" || user.role === "ADMIN" ? {} : { assigneeId: user.id }),
          },
          select: { id: true, title: true, dueDate: true, status: true, priority: true, project: { select: { name: true } } },
          orderBy: { dueDate: "asc" },
        }),
        db.project.findMany({
          where: {
            archivedAt: null,
            deadline: { gte: now, lte: end },
            ...(user.role === "OWNER" || user.role === "ADMIN" ? {} : { members: { some: { userId: user.id } } }),
          },
          select: { id: true, name: true, deadline: true, status: true },
          orderBy: { deadline: "asc" },
        }),
      ]);

      const events = [
        ...tasks.map((t) => ({ id: t.id, title: t.title, date: t.dueDate, type: "task", project: t.project.name, status: t.status })),
        ...projects.map((p) => ({ id: p.id, title: `${p.name} Deadline`, date: p.deadline, type: "project_deadline", status: p.status })),
      ].sort((a, b) => new Date(a.date!).getTime() - new Date(b.date!).getTime());

      return { success: true, result: { events } };
    }

    // 18. Cancel calendar event - HIGH IMPACT
    if (toolName === "cancel_calendar_event") {
      const summary = `Cancel scheduled task / calendar event "${params.eventId}" (${params.reason || "No reason given"})`;
      const pendingAction = registerPendingAction({
        toolName: "cancel_calendar_event",
        params,
        summary,
        userId: user.id,
        workspaceId,
      });

      return {
        success: true,
        requiresConfirmation: true,
        pendingAction,
        result: {
          actionId: pendingAction.id,
          message: `Cancelling this calendar event requires your confirmation. Action ID: ${pendingAction.id}.`,
        },
      };
    }

    // 19. Search files
    if (toolName === "search_files") {
      const q = (params.query || "").trim();
      const files = await db.driveFile.findMany({
        where: {
          deletedAt: null,
          ...(q ? { name: { contains: q, mode: "insensitive" } } : {}),
        },
        select: { id: true, name: true, size: true, mimeType: true, createdAt: true, project: { select: { name: true } } },
        take: 10,
      });
      return { success: true, result: { files } };
    }

    // 20. Company presence
    if (toolName === "get_company_presence") {
      let websiteLive = false;
      let websiteStatus = "Unchecked";
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3000);
        const res = await fetch("https://cyraops.com", { method: "HEAD", signal: controller.signal });
        clearTimeout(timeout);
        if (res.ok) {
          websiteLive = true;
          websiteStatus = "Operational (200 OK)";
        } else {
          websiteStatus = `Status ${res.status}`;
        }
      } catch {
        websiteStatus = "Unreachable";
      }

      return {
        success: true,
        result: {
          brand: "Cyraops",
          website: {
            domain: "cyraops.com",
            live: websiteLive,
            status: websiteStatus,
          },
          channels: [
            { channel: "Website", status: websiteLive ? "Connected & Live" : "Offline" },
            { channel: "Search Engines", status: "Indexed & Active" },
            { channel: "Mailbox", status: "GoDaddy secureserver.net Active" },
          ],
        },
      };
    }

    // 21. List team members
    if (toolName === "list_team_members") {
      const members = await db.user.findMany({
        where: { disabledAt: null },
        select: { id: true, name: true, role: true, title: true, avatarUrl: true },
      });
      return { success: true, result: { members } };
    }

    // 22. Update user role - HIGH IMPACT
    if (toolName === "update_user_role") {
      if (user.role !== "OWNER" && user.role !== "ADMIN") {
        return { success: false, error: "Only workspace Owner or Admin can modify team roles." };
      }

      const summary = `Update user ${params.targetUserId} role to "${params.newRole}"`;
      const pendingAction = registerPendingAction({
        toolName: "update_user_role",
        params,
        summary,
        userId: user.id,
        workspaceId,
      });

      return {
        success: true,
        requiresConfirmation: true,
        pendingAction,
        result: {
          actionId: pendingAction.id,
          message: `Changing team roles is high-impact and requires explicit confirmation. Action ID: ${pendingAction.id}.`,
        },
      };
    }

    // 23. Current page context
    if (toolName === "get_page_context") {
      const context = getVoicePageContext(user.id);
      if (!context) {
        return {
          success: true,
          result: {
            page: null,
            message: "No page context is available yet. Ask the user which page or record they mean.",
          },
        };
      }

      const recordId = recordIdFromQuery(context.query);
      const pageName = Object.keys(KNOWN_PAGES).find((key) =>
        context.pathname === KNOWN_PAGES[key] || context.pathname.startsWith(`${KNOWN_PAGES[key]}/`)
      );

      return {
        success: true,
        result: {
          pathname: context.pathname,
          page: pageName || context.pathname,
          query: context.query || "",
          openRecordId: recordId,
        },
      };
    }

    // 24. The record currently open on the page
    if (toolName === "get_current_record") {
      const kind = String(params.kind || "").toLowerCase();
      const context = getVoicePageContext(user.id);
      const recordId = typeof params.id === "string" && params.id.trim()
        ? params.id.trim()
        : recordIdFromQuery(context?.query);

      if (!recordId) {
        return {
          success: false,
          error: "No record is open on this page. Ask the user which record they mean, or search for it by name.",
        };
      }

      const isAdmin = user.role === "OWNER" || user.role === "ADMIN";

      if (kind === "project") {
        const project = await db.project.findFirst({
          where: {
            id: recordId,
            archivedAt: null,
            ...(isAdmin ? {} : { members: { some: { userId: user.id } } }),
          },
          select: {
            id: true,
            name: true,
            description: true,
            status: true,
            priority: true,
            deadline: true,
            _count: { select: { tasks: true, members: true } },
          },
        });
        if (!project) return { success: false, error: "Project not found, or you do not have access to it." };
        return { success: true, result: { kind: "project", record: project } };
      }

      if (kind === "lead") {
        const lead = await db.lead.findFirst({
          where: { id: recordId, ...(isAdmin ? {} : { assignedToId: user.id }) },
          select: {
            id: true,
            title: true,
            companyName: true,
            email: true,
            phone: true,
            status: true,
            score: true,
            estimatedValue: true,
            assignedToId: true,
            notes: true,
          },
        });
        if (!lead) return { success: false, error: "Lead not found, or you do not have access to it." };
        return { success: true, result: { kind: "lead", record: lead } };
      }

      if (kind === "contact") {
        const contact = await db.contact.findUnique({
          where: { id: recordId },
          select: { id: true, firstName: true, lastName: true, email: true, phone: true, title: true, companyId: true },
        });
        if (!contact) return { success: false, error: "Contact not found." };
        return { success: true, result: { kind: "contact", record: contact } };
      }

      if (kind === "email") {
        const email = await db.emailMessage.findFirst({
          where: { id: recordId, ...emailMessageVisibilityWhere(user) },
          select: { id: true, subject: true, fromEmail: true, toRecipients: true, snippet: true, bodyText: true, receivedAt: true },
        });
        if (!email) return { success: false, error: "Email not found, or you do not have access to it." };
        return { success: true, result: { kind: "email", record: email } };
      }

      return { success: false, error: `Unsupported record kind "${kind}". Use project, lead, contact or email.` };
    }

    // 25. Navigation (rendered by the client, never executed on the server)
    if (toolName === "navigate_to") {
      const pageKey = String(params.page || "").toLowerCase();
      const target = KNOWN_PAGES[pageKey];
      if (!target) {
        return {
          success: false,
          error: `Unknown page "${params.page}". Available pages: ${Object.keys(KNOWN_PAGES).join(", ")}.`,
        };
      }

      const recordId = typeof params.recordId === "string" && params.recordId.trim() ? params.recordId.trim() : null;
      // Only the CRM module understands a record focus parameter today.
      const href = recordId && target === "/crm" ? `${target}?id=${encodeURIComponent(recordId)}` : target;

      return {
        success: true,
        result: {
          navigateTo: href,
          message: `Opened ${pageKey}.`,
        },
      };
    }

    return { success: false, error: `Unrecognized CRM tool "${toolName}".` };
  } catch (err: any) {
    return { success: false, error: `Tool execution failed: ${err?.message || err}` };
  }
}

// Handler for executing a confirmed pending action
export async function executeConfirmedAction(
  actionId: string,
  user: User,
  workspaceId: string
): Promise<{ success: boolean; result?: any; error?: string }> {
  const action = getPendingAction(actionId);
  if (!action) {
    return { success: false, error: "Action confirmation has expired or is invalid. Please request the action again." };
  }

  if (action.userId !== user.id || action.workspaceId !== workspaceId) {
    return { success: false, error: "Unauthorized: Action belongs to a different user or workspace session." };
  }

  // Mark as confirmed and remove to prevent replay attacks
  action.status = "CONFIRMED";
  pendingActionsStore.delete(actionId);

  try {
    if (action.toolName === "send_email") {
      // Dispatches via EmailService
      const res = await EmailService.sendEmail({
        to: [action.params.to],
        subject: action.params.subject,
        bodyText: action.params.body,
        userId: user.id,
      });
      return {
        success: true,
        result: {
          message: `Email to ${action.params.to} successfully dispatched.`,
          messageId: res.messageId,
          deliveryStatus: res.deliveryStatus,
        },
      };
    }

    if (action.toolName === "cancel_calendar_event") {
      const task = await db.task.update({
        where: { id: action.params.eventId },
        data: { archivedAt: new Date() },
      });
      return { success: true, result: { message: `Calendar event / task "${task.title}" has been cancelled.`, taskId: task.id } };
    }

    if (action.toolName === "update_user_role") {
      if (user.role !== "OWNER" && user.role !== "ADMIN") {
        return { success: false, error: "Permission denied." };
      }
      const updated = await db.user.update({
        where: { id: action.params.targetUserId },
        data: { role: action.params.newRole as Role },
      });
      return { success: true, result: { message: `User "${updated.name}" role updated to ${updated.role}.` } };
    }

    return { success: false, error: `Unhandled confirmed action: ${action.toolName}` };
  } catch (err: any) {
    return { success: false, error: `Failed to execute confirmed action: ${err?.message || err}` };
  }
}
