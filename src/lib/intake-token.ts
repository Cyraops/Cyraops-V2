import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { sha256 } from "@/lib/auth";

/**
 * Bearer tokens for machine intake.
 *
 * A website form hands a prospect to us without a session cookie, so it cannot
 * use the normal auth path. The alternative — an unauthenticated endpoint that
 * trusts whatever it is told — would let anyone write rows into the pipeline and
 * let one tenant read another's data. A token scopes each intake endpoint to one
 * user (the person leads are attributed to) and can be revoked without touching
 * anyone else.
 *
 * The raw token is returned exactly once, at creation. Only its SHA-256 hash is
 * stored, so a database dump does not hand out working credentials.
 */

const PREFIX = "cyi_";
const BYTES = 24;

export interface IssuedIntakeToken {
  /** The raw secret. Show it once; it cannot be recovered. */
  token: string;
  id: string;
  label: string;
  source: string;
  hint: string;
}

export interface ResolvedIntakeToken {
  id: string;
  userId: string;
  source: string;
  assignedToId: string | null;
  userRole: string;
  userName: string;
}

function hashToken(raw: string): string {
  return sha256(raw);
}

/** Only the tail is stored readable, so a list can distinguish tokens. */
function hintFor(raw: string): string {
  return raw.slice(-6);
}

export async function createIntakeToken(params: {
  userId: string;
  label: string;
  source?: string;
  assignedToId?: string | null;
}): Promise<IssuedIntakeToken> {
  const raw = `${PREFIX}${randomBytes(BYTES).toString("base64url")}`;
  const record = await db.intakeToken.create({
    data: {
      userId: params.userId,
      label: params.label,
      source: params.source?.trim() || "webhook",
      tokenHash: hashToken(raw),
      hint: hintFor(raw),
      assignedToId: params.assignedToId ?? null,
    },
    select: { id: true, label: true, source: true, hint: true },
  });
  return { token: raw, ...record };
}

/**
 * Looks a token up without revealing whether the token merely does not exist or
 * belongs to a disabled row: both are simply "no".
 */
export async function resolveIntakeToken(raw: string): Promise<ResolvedIntakeToken | null> {
  const token = raw?.trim();
  if (!token.startsWith(PREFIX) || token.length < PREFIX.length + 16) return null;

  const record = await db.intakeToken.findUnique({
    where: { tokenHash: hashToken(token) },
    select: {
      id: true,
      userId: true,
      source: true,
      assignedToId: true,
      disabledAt: true,
      user: { select: { role: true, name: true, disabledAt: true } },
    },
  });
  if (!record || record.disabledAt) return null;
  // A token is only as good as the account behind it.
  if (!record.user || record.user.disabledAt) return null;

  return {
    id: record.id,
    userId: record.userId,
    source: record.source,
    assignedToId: record.assignedToId,
    userRole: record.user.role,
    userName: record.user.name,
  };
}

/** Records use without letting a write failure reject a good lead. */
export async function markIntakeTokenUsed(id: string): Promise<void> {
  try {
    await db.intakeToken.update({
      where: { id },
      data: { lastUsedAt: new Date(), useCount: { increment: 1 } },
    });
  } catch (error) {
    console.error("[IntakeToken] Could not record token use:", error);
  }
}

export async function listIntakeTokens(userId: string) {
  return db.intakeToken.findMany({
    where: { userId },
    select: {
      id: true,
      label: true,
      source: true,
      hint: true,
      assignedToId: true,
      disabledAt: true,
      lastUsedAt: true,
      useCount: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });
}

/** Revocation is scoped to the owner so one account cannot disable another's. */
export async function disableIntakeToken(params: { id: string; userId: string }): Promise<boolean> {
  const result = await db.intakeToken.updateMany({
    where: { id: params.id, userId: params.userId, disabledAt: null },
    data: { disabledAt: new Date() },
  });
  return result.count > 0;
}
