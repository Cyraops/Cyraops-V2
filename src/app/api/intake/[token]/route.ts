import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { sha256 } from "@/lib/auth";
import { jsonError } from "@/lib/validators";
import { createLeadWithProvenance } from "@/lib/leads/create-lead";
import { markIntakeTokenUsed, resolveIntakeToken } from "@/lib/intake-token";
import type { LeadSignals } from "@/lib/lead-score";

/**
 * Machine intake: `POST /api/intake/<token>`.
 *
 * This is how a form handler, Zapier zap or Typeform hooks into the pipeline
 * without a person present. Three things keep that safe:
 *
 *  1. Authentication is a bearer token, not a cookie. There is no ambient
 *     credential here, so a malicious page cannot make a visitor's browser post
 *     leads on our behalf — which is exactly why CSRF does not apply and why the
 *     route must never fall back to session auth.
 *  2. Every write goes through `createLeadWithProvenance`, so an API lead has the
 *     same score, source, contact link, activity and dedup behaviour as one typed
 *     in by hand. A second intake path that skips that is how duplicate leads
 *     appear.
 *  3. The response says nothing about existing pipeline contents. A caller who
 *     guesses a token learns whether their token works and nothing more.
 */

const MAX_BODY_BYTES = 16_000;
/** A busy form still fits comfortably under this. */
const MAX_CALLS_PER_HOUR = 240;

const signalState = z.enum(["observed", "checked_absent", "not_checked"]);
/** Mirrors `Signal<T>` in lead-score: a value only counts if someone looked. */
const signal = <T extends z.ZodTypeAny>(inner: T) =>
  z.object({ value: inner.optional(), state: signalState, observedAt: z.string().optional() });

const signalsSchema = z.object({
  cloudFootprint: signal(z.enum(["aws", "azure", "gcp", "none"])),
  headcount: signal(z.number()),
  industryMatch: signal(z.enum(["exact", "adjacent", "none"])),
  funding: signal(z.enum(["series_a_b", "seed", "none"])),
  hiring: signal(z.number()),
  publicPain: signal(z.enum(["migration", "cost", "compliance", "outage", "blog", "none"])),
  authority: signal(z.enum(["exec", "lead", "none"])),
  reachable: signal(z.enum(["verified", "form", "none"])),
  warmPath: signal(z.boolean()),
  valueBand: signal(z.enum(["xl", "l", "m", "s", "unknown"])),
  timing: signal(z.enum(["60", "180", "none"])),
  knockout: z.object({
    competitor: z.boolean().optional(),
    repeatLost: z.boolean().optional(),
    freeMailOnly: z.boolean().optional(),
    cheapest: z.boolean().optional(),
    archived: z.boolean().optional(),
  }).partial(),
}).partial();

const intakeSchema = z.object({
  title: z.string().trim().min(2).max(200).optional(),
  name: z.string().trim().min(2).max(200).optional(),
  company: z.string().trim().max(200).optional(),
  companyName: z.string().trim().max(200).optional(),
  email: z.string().trim().max(254).optional(),
  phone: z.string().trim().max(40).optional(),
  message: z.string().trim().max(4000).optional(),
  notes: z.string().trim().max(4000).optional(),
  estimatedValue: z.union([z.number(), z.string()]).optional(),
  value: z.union([z.number(), z.string()]).optional(),
  signals: signalsSchema.optional(),
  /** Honeypot: a hidden field human visitors leave empty. */
  website: z.string().max(255).optional(),
});

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[$,\s]/g, ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const resolved = await resolveIntakeToken(token);
  // Same answer for a revoked token and a wrong one: a scanner learns nothing.
  if (!resolved) return jsonError("Invalid intake token", 401);

  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_BODY_BYTES) return jsonError("Payload is too large", 413);

  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return jsonError("Send a JSON body", 400);
  }
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
    return jsonError("Payload is too large", 413);
  }

  // The token itself is the rate-limit bucket: one abusive caller must not be
  // able to spend the whole workspace's budget.
  const bucketKey = sha256(`intake:${resolved.id}`);
  const now = new Date();
  const windowEnds = new Date(Date.now() + 60 * 60 * 1000);
  const bucket = await db.authRateLimit.findUnique({ where: { key: bucketKey } });
  if (bucket && bucket.windowEnds > now && bucket.hits >= MAX_CALLS_PER_HOUR) {
    return jsonError("Too many requests for this intake token", 429);
  }
  await db.authRateLimit.upsert({
    where: { key: bucketKey },
    create: { key: bucketKey, hits: 1, windowEnds },
    update: bucket && bucket.windowEnds > now
      ? { hits: { increment: 1 } }
      : { hits: 1, windowEnds },
  });

  let body: unknown;
  try {
    body = JSON.parse(raw || "{}");
  } catch {
    return jsonError("Send a JSON body", 400);
  }

  const parsed = intakeSchema.safeParse(body);
  if (!parsed.success) return jsonError("Invalid lead payload", 400);
  const data = parsed.data;

  // Honeypot filled in: answer as if stored so a bot does not retry, write nothing.
  if (data.website?.trim()) return Response.json({ ok: true }, { status: 202 });

  const title = firstNonEmpty(data.title, data.name, data.email);
  if (!title) return jsonError("A title, name or email is required", 400);

  const email = firstNonEmpty(data.email)?.toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return jsonError("Invalid email address", 400);
  }

  const notes = firstNonEmpty(data.notes, data.message);
  const estimatedValue = toNumber(data.estimatedValue) ?? toNumber(data.value);

  try {
    const result = await createLeadWithProvenance(
      {
        title,
        companyName: firstNonEmpty(data.companyName, data.company) ?? null,
        email: email ?? null,
        phone: firstNonEmpty(data.phone) ?? null,
        source: resolved.source,
        assignedToId: resolved.assignedToId ?? resolved.userId,
        notes: notes ?? null,
        estimatedValue: estimatedValue ?? null,
        signals: data.signals as LeadSignals | undefined,
        evidence: [{ quote: `Received via ${resolved.source} intake` }],
      },
      // The token owner is the actor: leads they receive are theirs to see.
      { userId: resolved.userId, userRole: resolved.userRole, agentSlug: undefined }
    );

    await markIntakeTokenUsed(resolved.id);

    // Tell a person. A lead nobody is told about is a lead nobody calls.
    const notifyId = resolved.assignedToId ?? resolved.userId;
    if (!result.deduped) {
      await db.notification.create({
        data: {
          userId: notifyId,
          type: "SYSTEM",
          title: `New lead from ${resolved.source}: ${title}`,
          body: [result.band !== "INSUFFICIENT_DATA" ? `Score ${result.lead.score} (${result.band})` : null, notes?.slice(0, 160)]
            .filter(Boolean)
            .join(" — ")
            .slice(0, 300),
          href: `/crm?tab=leads&id=${result.lead.id}`,
          dedupeKey: `intake:${result.lead.id}:${sha256(title).slice(0, 12)}`,
        },
      });
    }

    return Response.json(
      {
        ok: true,
        leadId: result.lead.id,
        deduped: result.deduped,
        score: result.lead.score,
        band: result.band,
      },
      { status: result.deduped ? 200 : 201 }
    );
  } catch (error: any) {
    // A duplicate unique key means the lead is already there: success for the
    // caller, no second row for us.
    if (error?.code === "P2002") return Response.json({ ok: true, deduped: true }, { status: 200 });
    console.error("[Intake] Could not create lead from intake token:", error);
    return jsonError("Could not save the lead", 500);
  }
}

/** Lets a webhook author check the URL without creating anything. */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const resolved = await resolveIntakeToken(token);
  if (!resolved) return jsonError("Invalid intake token", 401);
  return Response.json({ ok: true, source: resolved.source, owner: resolved.userName });
}
