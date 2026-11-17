import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { sha256 } from "@/lib/auth";
import { jsonError } from "@/lib/validators";
import { createLeadWithProvenance } from "@/lib/leads/create-lead";
import { markIntakeTokenUsed, resolveIntakeToken } from "@/lib/intake-token";
import { classifyInboundEmail, signalsFromEmail } from "@/lib/email-intake";

/**
 * Inbound email intake: `POST /api/intake/<token>/email`.
 *
 * Point a mail provider's inbound webhook (or a forwarding rule) here and each
 * message that looks like a prospective buyer becomes a lead. Three limits keep
 * a mailbox from becoming a junk drawer:
 *
 *  1. A guard list rejects automated senders, bounces, auto-replies and our own
 *     domains before anything is written.
 *  2. A per-token hourly cap bounds how much one compromised or misconfigured
 *     integration can write.
 *  3. Every accepted message goes through the same lead service as the website
 *     form, so it is scored, deduped, linked to a contact and attributed.
 */

const MAX_BODY_BYTES = 200_000;
const MAX_PER_HOUR = 60;

const emailSchema = z.object({
  /** Accept the shapes real providers send. */
  from: z.string().trim().max(320).optional(),
  /** Some providers nest the sender. */
  sender: z.string().trim().max(320).optional(),
  fromName: z.string().trim().max(200).optional(),
  to: z.string().trim().max(320).optional(),
  subject: z.string().trim().max(500).optional(),
  text: z.string().max(MAX_BODY_BYTES).optional(),
  body: z.string().max(MAX_BODY_BYTES).optional(),
  plain: z.string().max(MAX_BODY_BYTES).optional(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const resolved = await resolveIntakeToken(token);
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

  // Separate bucket from the generic intake route: a noisy mailbox must not stop
  // form submissions (or vice versa).
  const bucketKey = sha256(`intake-email:${resolved.id}`);
  const now = new Date();
  const windowEnds = new Date(Date.now() + 60 * 60 * 1000);
  const bucket = await db.authRateLimit.findUnique({ where: { key: bucketKey } });
  if (bucket && bucket.windowEnds > now && bucket.hits >= MAX_PER_HOUR) {
    // 429 tells the provider to retry later rather than silently dropping mail.
    return jsonError("Hourly email intake cap reached", 429);
  }

  let body: unknown;
  try {
    body = JSON.parse(raw || "{}");
  } catch {
    return jsonError("Send a JSON body", 400);
  }
  const parsed = emailSchema.safeParse(body);
  if (!parsed.success) return jsonError("Invalid email payload", 400);
  const data = parsed.data;

  const classification = classifyInboundEmail({
    from: data.from ?? data.sender ?? "",
    fromName: data.fromName,
    to: data.to,
    subject: data.subject,
    text: data.text ?? data.body ?? data.plain ?? "",
  });

  if (!classification.accepted || !classification.lead) {
    // Counted so a misconfigured forwarder is visible, but nothing is written.
    await db.authRateLimit.upsert({
      where: { key: bucketKey },
      create: { key: bucketKey, hits: 1, windowEnds },
      update: bucket && bucket.windowEnds > now
        ? { hits: { increment: 1 } }
        : { hits: 1, windowEnds },
    });
    return Response.json(
      { ok: true, accepted: false, reason: classification.reason, detail: classification.detail },
      { status: 202 }
    );
  }

  try {
    const result = await createLeadWithProvenance(
      {
        title: classification.lead.title,
        email: classification.lead.email,
        companyName: classification.lead.companyName,
        source: resolved.source === "webhook" ? "Email" : resolved.source,
        notes: classification.lead.notes,
        assignedToId: resolved.assignedToId ?? resolved.userId,
        signals: signalsFromEmail(classification),
        evidence: [{ quote: `Inbound email from ${classification.lead.email}` }],
      },
      { userId: resolved.userId, userRole: resolved.userRole }
    );

    await db.authRateLimit.upsert({
      where: { key: bucketKey },
      create: { key: bucketKey, hits: 1, windowEnds },
      update: bucket && bucket.windowEnds > now
        ? { hits: { increment: 1 } }
        : { hits: 1, windowEnds },
    });
    await markIntakeTokenUsed(resolved.id);

    if (!result.deduped) {
      await db.notification.create({
        data: {
          userId: resolved.assignedToId ?? resolved.userId,
          type: "SYSTEM",
          title: `New lead by email: ${classification.lead.title}`,
          body: (data.subject || classification.lead.notes).slice(0, 180),
          href: `/crm?tab=leads&id=${result.lead.id}`,
          dedupeKey: `intake-email:${result.lead.id}:${sha256(classification.lead.email).slice(0, 12)}`,
        },
      });
    }

    return Response.json(
      { ok: true, accepted: true, leadId: result.lead.id, deduped: result.deduped, band: result.band },
      { status: result.deduped ? 200 : 201 }
    );
  } catch (error: any) {
    if (error?.code === "P2002") return Response.json({ ok: true, deduped: true }, { status: 200 });
    console.error("[IntakeEmail] Could not create lead:", error);
    return jsonError("Could not save the lead", 500);
  }
}
