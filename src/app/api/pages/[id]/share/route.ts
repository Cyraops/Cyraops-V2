import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { sameOrigin, userFromRequest } from "@/lib/auth";
import { jsonError } from "@/lib/validators";
import { db } from "@/lib/db";

type Context = { params: Promise<{ id: string }> };

/**
 * Sharing is a deliberate act with a revocable token.
 *
 * `regenerate` mints a brand-new slug, which is how a leaked or forwarded link
 * is revoked: the old one stops resolving immediately.
 */
export async function POST(request: NextRequest, context: Context) {
  if (!sameOrigin(request)) return jsonError("Invalid request origin", 403);
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);
  const { id } = await context.params;

  const parsed = z
    .object({
      enabled: z.boolean().optional(),
      regenerate: z.boolean().optional(),
      expiresInDays: z.number().int().min(1).max(365).nullable().optional(),
    })
    .safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return jsonError("Invalid sharing request", 400);

  const existing = await db.page.findFirst({
    where: { id, userId: user.id },
    select: { id: true, isPublic: true, publicSlug: true },
  });
  if (!existing) return jsonError("Page not found", 404);

  const data: Record<string, unknown> = {};
  if (parsed.data.regenerate) data.publicSlug = randomUUID();
  if (parsed.data.enabled !== undefined) {
    data.isPublic = parsed.data.enabled;
    // Re-enabling must clear a stale expiry, or the "shared" link 404s while
    // the toggle proudly says shared.
    if (parsed.data.enabled && parsed.data.expiresInDays === undefined) data.shareExpiresAt = null;
  }
  if (parsed.data.expiresInDays !== undefined) {
    data.shareExpiresAt = parsed.data.expiresInDays === null ? null : new Date(Date.now() + parsed.data.expiresInDays * 86_400_000);
  }
  if (!Object.keys(data).length) return jsonError("Nothing to change", 400);

  const page = await db.page.update({
    where: { id },
    data,
    select: { id: true, publicSlug: true, isPublic: true, shareExpiresAt: true },
  });
  return NextResponse.json({ page });
}
