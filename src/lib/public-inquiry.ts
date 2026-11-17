import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { sameOrigin, sha256 } from "@/lib/auth";
import { jsonError } from "@/lib/validators";

const inquirySchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(254),
  company: z.string().trim().max(180).optional().default(""),
  environment: z.string().trim().max(2000).optional().default(""),
  spend: z.string().trim().max(80).optional().default(""),
  helpTopic: z.string().trim().min(10).max(4000),
  website: z.string().max(255).optional().default(""),
});

const responseAccepted = () => Response.json({ ok: true }, { status: 202 });

export async function handlePublicInquiry(request: NextRequest, database: typeof db = db) {
  if (!sameOrigin(request)) return jsonError("Invalid request origin", 403);

  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > 12_000) return jsonError("Inquiry is too large", 413);

  let body: unknown;
  try {
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > 12_000) {
      return jsonError("Inquiry is too large", 413);
    }
    body = JSON.parse(rawBody);
  } catch {
    return jsonError("Enter a valid inquiry", 400);
  }

  const parsed = inquirySchema.safeParse(body);
  if (!parsed.success) return jsonError("Enter a valid inquiry", 400);
  const data = parsed.data;
  if (data.website.trim()) return responseAccepted();

  const email = data.email.toLowerCase();
  const ip = request.headers.get("cf-connecting-ip")?.trim()
    || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-real-ip")?.trim()
    || "unknown";
  const keys = [sha256(`website-inquiry:ip:${ip}`), sha256(`website-inquiry:email:${email}`)];
  const now = new Date();
  const windowEnds = new Date(Date.now() + 15 * 60 * 1000);
  const buckets = await database.authRateLimit.findMany({ where: { key: { in: keys } } });
  if (buckets.some((bucket) => bucket.windowEnds > now && bucket.hits >= 5)) {
    return jsonError("Too many inquiries. Try again later.", 429);
  }
  await Promise.all(keys.map((key) => {
    const bucket = buckets.find((entry) => entry.key === key);
    return database.authRateLimit.upsert({
      where: { key },
      create: { key, hits: 1, windowEnds },
      update: bucket && bucket.windowEnds > now
        ? { hits: { increment: 1 } }
        : { hits: 1, windowEnds },
    });
  }));

  const inquiryNotes = [
    `Website inquiry received ${new Date().toISOString()}`,
    data.spend ? `Approximate AWS spend: ${data.spend}` : "",
    data.environment ? `Environment: ${data.environment}` : "",
    `Request: ${data.helpTopic}`,
  ].filter(Boolean).join("\n");

  try {
    const owner = await database.user.findFirst({
      where: { role: "OWNER", disabledAt: null },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    const existing = await database.lead.findFirst({
      where: { email: { equals: email, mode: "insensitive" }, archivedAt: null },
      select: { id: true, notes: true, status: true, assignedToId: true },
    });
    // A prospect who writes again is a signal, not noise: reactivate a lead we
    // had previously dismissed rather than only appending a note.
    if (existing) {
      await database.lead.update({
        where: { id: existing.id },
        data: {
          notes: [existing.notes, inquiryNotes].filter(Boolean).join("\n\n").slice(-10_000),
          ...(existing.status === "UNQUALIFIED" ? { status: "NEW" } : {}),
        },
      });
      const notifyId = existing.assignedToId ?? owner?.id ?? null;
      if (notifyId) {
        await database.activity.create({
          data: {
            action: "updated",
            entity: "lead",
            entityId: existing.id,
            summary: "received another website inquiry from this prospect",
            userId: notifyId,
          },
        });
        await database.notification.create({
          data: {
            userId: notifyId,
            type: "SYSTEM",
            title: `Returning prospect: ${data.name}`,
            body: data.helpTopic.slice(0, 200),
            href: `/crm?tab=leads&id=${existing.id}`,
            dedupeKey: `lead-intake:${existing.id}:${sha256(data.helpTopic).slice(0, 12)}`,
          },
        });
      }
      return responseAccepted();
    }

    // The inquiry is a person, so it becomes a Contact too — otherwise nothing
    // can ever link this prospect's email thread back to the pipeline.
    let contactId: string | null = null;
    const existingContact = await database.contact.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
      select: { id: true },
    });
    if (existingContact) {
      contactId = existingContact.id;
    } else {
      const [firstName, ...rest] = data.name.trim().split(/\s+/);
      const contact = await database.contact.create({
        data: { firstName: firstName || data.name, lastName: rest.join(" "), email, status: "LEAD" },
        select: { id: true },
      });
      contactId = contact.id;
    }

    const assignedToId = owner?.id ?? null;
    const created = await database.lead.create({
      data: {
        title: data.name,
        companyName: data.company || null,
        email,
        status: "NEW",
        score: 0,
        source: "Website",
        assignedToId,
        contactId,
        notes: inquiryNotes,
      },
      select: { id: true },
    });

    if (assignedToId) {
      await database.activity.create({
        data: {
          action: "created",
          entity: "lead",
          entityId: created.id,
          summary: "captured a lead from a website inquiry",
          userId: assignedToId,
        },
      });
      await database.notification.create({
        data: {
          userId: assignedToId,
          type: "SYSTEM",
          title: `New website inquiry: ${data.name}`,
          body: [data.company, data.helpTopic.slice(0, 180)].filter(Boolean).join(" — ").slice(0, 300),
          href: `/crm?tab=leads&id=${created.id}`,
          dedupeKey: `lead-intake:${created.id}:${sha256(data.helpTopic).slice(0, 12)}`,
        },
      });
    }
    return responseAccepted();
  } catch (error: any) {
    if (error?.code === "P2002") return responseAccepted();
    console.error("[WebsiteInquiry] Could not save inquiry");
    return jsonError("We could not save your inquiry. Please try again.", 500);
  }
}
