import { LeadStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { logActivity } from "@/lib/auth";
import { describeScore, scoreProspect, type LeadSignals } from "@/lib/lead-score";

/**
 * One way to create a lead, with provenance.
 *
 * There used to be four different creation paths that disagreed: the AI tool
 * wrote a bare `{title, companyName, email}` row with no source, score,
 * assignment, activity or dedup; the website form added notes but nothing else;
 * the HTTP route deduped and logged. Every AI-created lead was therefore
 * unsourced, unattributed (and invisible to members, who only see their own) and
 * duplicated on every retry. This service is the single path they all use.
 */

export interface LeadEvidence {
  url?: string;
  quote?: string;
}

export interface CreateLeadInput {
  title: string;
  companyName?: string | null;
  email?: string | null;
  phone?: string | null;
  source?: string | null;
  status?: LeadStatus;
  estimatedValue?: number | null;
  companyId?: string | null;
  contactId?: string | null;
  assignedToId?: string | null;
  notes?: string | null;
  /** A number to use when no signals were collected (legacy/manual). */
  score?: number;
  /** Structured signals; when present they override any supplied score. */
  signals?: LeadSignals;
  evidence?: LeadEvidence[];
}

export interface CreateLeadContext {
  userId: string;
  userRole?: string;
  agentSlug?: string;
}

export interface CreateLeadResult {
  lead: { id: string; title: string; score: number; source: string | null; assignedToId: string | null; contactId: string | null };
  deduped: boolean;
  matchedOn?: "email" | "phone";
  scoreDescription: string;
  band: string;
}

function normaliseEmail(value?: string | null): string | null {
  const email = (value ?? "").trim().toLowerCase();
  return email || null;
}

function normalisePhone(value?: string | null): string | null {
  const digits = (value ?? "").replace(/[^\d+]/g, "");
  return digits.length >= 7 ? digits : null;
}

function evidenceNote(evidence: LeadEvidence[] | undefined): string {
  if (!evidence?.length) return "";
  const lines = evidence
    .filter((entry) => entry.url || entry.quote)
    .slice(0, 8)
    .map((entry) => `Source: ${entry.url ?? "n/a"}${entry.quote ? ` — "${entry.quote.slice(0, 200)}"` : ""}`);
  return lines.length ? `Evidence:\n${lines.join("\n")}` : "";
}

export async function createLeadWithProvenance(
  input: CreateLeadInput,
  context: CreateLeadContext
): Promise<CreateLeadResult> {
  const email = normaliseEmail(input.email);
  const phone = normalisePhone(input.phone);
  const isAdmin = context.userRole === "OWNER" || context.userRole === "ADMIN";

  // Attribution: default to whoever is acting. A member may never assign a lead
  // to somebody else — that was one of the teammate-boundary holes.
  const assignedToId = input.assignedToId ?? context.userId;
  if (!isAdmin && assignedToId !== context.userId) {
    throw new Error("Members cannot assign leads to other users");
  }

  // Deterministic score. Signals always win over a model-supplied number.
  const scored = input.signals ? scoreProspect(input.signals) : null;
  const score = scored ? scored.score : Math.max(0, Math.min(100, Number(input.score) || 0));
  const scoreDescription = scored
    ? describeScore(scored)
    : score > 0
      ? `Manual score ${score}/100`
      : "No score yet";

  // Dedup: a re-run of the same research must not create a second lead.
  const matched = await db.lead.findFirst({
    where: {
      archivedAt: null,
      OR: [
        ...(email ? [{ email: { equals: email, mode: "insensitive" as const } }] : []),
        ...(phone ? [{ phone: { equals: phone } }] : []),
      ],
    },
    select: { id: true, title: true, score: true, source: true, assignedToId: true, contactId: true, notes: true },
  });

  if (matched) {
    // Refresh the provenance we now know, without trampling a human's edits.
    await db.lead.update({
      where: { id: matched.id },
      data: {
        ...(matched.score === 0 && score > 0 ? { score } : {}),
        ...(matched.source ? {} : input.source ? { source: input.source } : {}),
        ...(matched.contactId || !input.contactId ? {} : { contactId: input.contactId }),
      },
    });
    return {
      lead: matched,
      deduped: true,
      matchedOn: email ? "email" : "phone",
      scoreDescription,
      band: scored?.band ?? "n/a",
    };
  }

  // Link a contact when we have an email but no explicit contact, so the
  // prospect is a person in the CRM and not just a row in the pipeline.
  let contactId = input.contactId ?? null;
  if (!contactId && email) {
    const existingContact = await db.contact.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
      select: { id: true },
    });
    if (existingContact) {
      contactId = existingContact.id;
    } else {
      const [firstName, ...rest] = String(input.title || email.split("@")[0]).trim().split(/\s+/);
      const contact = await db.contact.create({
        data: {
          firstName: firstName || "Unknown",
          lastName: rest.join(" "),
          email,
          phone,
          companyId: input.companyId ?? null,
          status: "LEAD",
        },
        select: { id: true },
      });
      contactId = contact.id;
    }
  }

  const notes = [input.notes, evidenceNote(input.evidence), `Scored: ${scoreDescription}`]
    .filter(Boolean)
    .join("\n\n")
    .slice(-10_000);

  const lead = await db.lead.create({
    data: {
      title: input.title,
      companyName: input.companyName ?? null,
      email,
      phone,
      source: input.source ?? null,
      status: input.status ?? "NEW",
      score,
      estimatedValue: input.estimatedValue ?? null,
      companyId: input.companyId ?? null,
      contactId,
      assignedToId,
      notes,
    },
    select: { id: true, title: true, score: true, source: true, assignedToId: true, contactId: true },
  });

  // The activity trail is what makes the lead appear in J1's history.
  await logActivity({
    action: "created",
    entity: "lead",
    entityId: lead.id,
    summary: `captured a lead from ${input.source ?? "manual entry"} — ${scoreDescription}`,
    userId: assignedToId,
  });

  return {
    lead,
    deduped: false,
    scoreDescription,
    band: scored?.band ?? "n/a",
  };
}
