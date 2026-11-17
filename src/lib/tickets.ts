import { db } from "@/lib/db";
import { agentRegistry } from "@/lib/ai/agents/agent-registry";
import { delegateAgentWork } from "@/lib/tasks/delegate";
import { normaliseAssigneeSet, setTaskAssignees } from "@/lib/tasks/assignees";

/**
 * Tickets from a sentence.
 *
 * A task board that requires six fields before it accepts a thought does not get
 * used. So the fastest path to a ticket is a message: `@tasks Call Northwind back
 * @akshat` becomes a ticket assigned to Akshat, and `@tasks research their stack
 * @research` becomes an agent ticket (which, for a member, waits on the owner).
 *
 * The parsing here is deliberately narrow and predictable. It never guesses a
 * person: a name it cannot match is left out and reported, and an instruction
 * with no recognisable assignee goes to the person who wrote it rather than
 * silently landing on nobody.
 */

export const TICKET_TRIGGER = "@tasks";
const TRIGGER_PATTERN = /(^|\s)@tasks?\b/i;

const MAX_TITLE = 180;
const MAX_DESCRIPTION = 10_000;

export interface TicketPersona {
  kind: "user" | "agent";
  id: string;
  name: string;
  /** Extra strings that identify this persona in text. */
  aliases: string[];
}

export interface ParsedTicket {
  /** False when the text has no `@tasks` trigger at all. */
  isTicket: boolean;
  title: string;
  description: string;
  /** Personas matched in the text, in the order they appear. */
  assignees: TicketPersona[];
  /** `@mentions` that matched nobody, so the reply can say so. */
  unmatched: string[];
  /** The instruction with the trigger and assignee mentions removed. */
  remainder: string;
}

export function parseTicketInstruction(text: string, people: TicketPersona[]): ParsedTicket {
  const source = (text ?? "").trim();
  const empty: ParsedTicket = {
    isTicket: false,
    title: "",
    description: "",
    assignees: [],
    unmatched: [],
    remainder: source,
  };
  if (!TRIGGER_PATTERN.test(source)) return empty;

  // Collect every @mention first: they may name a person or an agent, and they
  // must be removed from the title either way.
  const mentions = [...source.matchAll(/@([a-zA-Z0-9][a-zA-Z0-9._-]*)/g)].map((match) => ({
    raw: match[0],
    token: match[1].toLowerCase(),
  }));

  const matched: TicketPersona[] = [];
  const unmatched: string[] = [];
  for (const mention of mentions) {
    // `@tasks` is the trigger, not an assignee.
    if (mention.token === "tasks" || mention.token === "task") continue;
    const persona = people.find((candidate) =>
      candidate.aliases.some((alias) => alias === mention.token)
    );
    if (!persona) {
      unmatched.push(mention.raw);
      continue;
    }
    if (!matched.some((existing) => existing.kind === persona.kind && existing.id === persona.id)) {
      matched.push(persona);
    }
  }

  // "…assign to Akshat" / "…for Research" without an @: match a persona name in
  // the prose, but only a whole word, so "Rakesh" never matches "Akshat".
  if (matched.length === 0) {
    for (const persona of people) {
      const hit = persona.aliases.some((alias) => {
        if (alias.length < 3) return false;
        const pattern = new RegExp(`(^|[^a-z0-9])${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`, "i");
        return pattern.test(source);
      });
      if (hit) {
        matched.push(persona);
        break;
      }
    }
  }

  // Strip trigger and mentions to get the actual instruction, keeping line
  // breaks so a multi-line brain dump keeps its structure.
  let remainder = source.replace(TRIGGER_PATTERN, " ");
  for (const mention of mentions) {
    if (mention.token === "tasks" || mention.token === "task") continue;
    remainder = remainder.split(mention.raw).join(" ");
  }
  remainder = remainder.replace(/[ \t]{2,}/g, " ").trim();

  const [firstLine, ...restLines] = remainder.split(/\r?\n/);
  const title = (firstLine ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_TITLE);
  // A one-liner is its own description; a multi-line instruction keeps the rest.
  const description = (restLines.join("\n").trim() || title).slice(0, MAX_DESCRIPTION);

  return {
    isTicket: title.length > 0,
    title: title || "Untitled request",
    description,
    assignees: matched,
    unmatched,
    remainder,
  };
}

/** Builds the persona list a parser needs from the live roster. */
export async function loadTicketPersonas(): Promise<TicketPersona[]> {
  // The default agents are seeded lazily elsewhere, so a fresh workspace would
  // otherwise have an empty agent roster and `@research` would match nobody.
  await agentRegistry.ensureDefaultAgents();
  const [users, agents] = await Promise.all([
    db.user.findMany({
      where: { disabledAt: null },
      select: { id: true, name: true, email: true },
      orderBy: { createdAt: "asc" },
    }),
    db.aiAgent.findMany({ where: { status: "ACTIVE" }, select: { slug: true, name: true } }),
  ]);

  const personas: TicketPersona[] = [];
  for (const user of users) {
    const first = user.name.split(/\s+/)[0] ?? user.name;
    const handle = user.email?.split("@")[0];
    personas.push({
      kind: "user",
      id: user.id,
      name: user.name,
      aliases: [...new Set([
        first.toLowerCase(),
        user.name.toLowerCase().replace(/\s+/g, ""),
        user.name.toLowerCase().replace(/\s+/g, "."),
        ...(handle ? [handle.toLowerCase()] : []),
      ])],
    });
  }
  for (const agent of agents) {
    const base = agent.name.replace(/\s+agent$/i, "");
    personas.push({
      kind: "agent",
      id: agent.slug,
      name: agent.name,
      aliases: [...new Set([
        agent.slug.toLowerCase(),
        agent.slug.toLowerCase().replace(/_/g, ""),
        base.toLowerCase().replace(/\s+/g, ""),
        base.toLowerCase().replace(/\s+/g, "_"),
      ])],
    });
  }
  return personas;
}

/**
 * The workspace's inbox project: where tickets with no obvious home land.
 * A ticket must belong to a project, and asking a person to choose one before
 * they can write down a task defeats the purpose. Created once, reused after.
 */
export async function ensureInboxProject(ownerId: string): Promise<string> {
  const existing = await db.project.findFirst({
    where: { name: "Tasks", archivedAt: null },
    select: { id: true },
  });
  if (existing) return existing.id;

  const members = await db.user.findMany({ where: { disabledAt: null }, select: { id: true } });
  const project = await db.project.create({
    data: {
      name: "Tasks",
      description: "Tickets created from chat. Anything that needs a real project can be moved later.",
      ownerId,
      members: { create: members.map((member) => ({ userId: member.id })) },
    },
    select: { id: true },
  });
  return project.id;
}

export interface CreatedTicket {
  id: string;
  title: string;
  projectId: string;
  owners: Array<{ kind: "user" | "agent"; name: string }>;
  /** Agent tickets a member asked for, waiting on an owner. */
  awaitingApproval: string[];
}

export type TicketKind = "BUG" | "SERVICE" | "CATEGORY";

/**
 * Reads the classification from the message when the writer names one, so
 * "@tasks bug: login fails" is filed as a bug without a second step.
 */
export function inferTicketKind(text: string): TicketKind | null {
  const match = text.trim().match(/^@tasks\s+(bug|service|category)\b/i);
  if (!match) return null;
  return match[1].toUpperCase() as TicketKind;
}

export async function createTicketFromInstruction(params: {
  text: string;
  actor: { id: string; name: string; role: string };
  kind?: TicketKind | null;
}): Promise<{ parsed: ParsedTicket; ticket?: CreatedTicket }> {
  const people = await loadTicketPersonas();
  const parsed = parseTicketInstruction(params.text, people);
  if (!parsed.isTicket) return { parsed };

  // Nobody named, or nobody recognised: it is still the writer's task.
  const assignees = parsed.assignees.length > 0
    ? parsed.assignees
    : [{ kind: "user" as const, id: params.actor.id, name: params.actor.name, aliases: [] }];

  const projectId = await ensureInboxProject(params.actor.role === "OWNER" ? params.actor.id : await primaryOwnerId());

  const owners = normaliseAssigneeSet({
    userIds: assignees.filter((a) => a.kind === "user").map((a) => a.id),
    agentSlugs: assignees.filter((a) => a.kind === "agent").map((a) => a.id),
  });

  const awaitingApproval: string[] = [];
  for (const agentSlug of owners.agentSlugs) {
    const result = await delegateAgentWork({
      objective: parsed.title,
      prompt: parsed.description,
      agentSlug,
      requestedById: params.actor.id,
      requestedByRole: params.actor.role,
    });
    if (result.mode === "pending_approval") awaitingApproval.push(agentSlug);
  }

  const task = await db.task.create({
    data: {
      title: parsed.title,
      description: parsed.description,
      projectId,
      creatorId: params.actor.id,
      assigneeId: owners.userIds[0] ?? null,
      kind: params.kind ?? inferTicketKind(params.text),
      source: "CHAT",
      type: "SERVICE_REQUEST",
    },
    select: { id: true, title: true },
  });
  await setTaskAssignees(task.id, owners);

  for (const userId of owners.userIds) {
    if (userId === params.actor.id) continue;
    await db.notification.create({
      data: {
        userId,
        type: "TASK_ASSIGNED",
        title: `${params.actor.name} assigned you a ticket`,
        body: parsed.title,
        href: `/projects?project=${projectId}&tab=tasks`,
        dedupeKey: `ticket:${task.id}:${userId}`,
      },
    });
  }

  await db.activity.create({
    data: {
      action: "created",
      entity: "task",
      entityId: task.id,
      summary: `created ticket ${parsed.title} from chat`,
      userId: params.actor.id,
      projectId,
    },
  });

  return {
    parsed,
    ticket: {
      id: task.id,
      title: task.title,
      projectId,
      owners: assignees.map((a) => ({ kind: a.kind, name: a.name })),
      awaitingApproval,
    },
  };
}

async function primaryOwnerId(): Promise<string> {
  const owner = await db.user.findFirst({
    where: { role: "OWNER", disabledAt: null },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (!owner) throw new Error("This workspace has no owner to own the Tasks project");
  return owner.id;
}
