import { compare, hash } from "bcryptjs";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { cookieOptions, createSession, SESSION_COOKIE, sameOrigin, sha256 } from "@/lib/auth";
import { resolveLoginCredential, type LegacyWorkspaceCredential } from "@/lib/login-credentials";
import { emailSchema, jsonError } from "@/lib/validators";

const dummyPasswordHash = hash("cyraops-cms-invalid-account-password", 12);

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return jsonError("Invalid request origin", 403);
  const body = await request.json().catch(() => null);
  const email = emailSchema.safeParse(body?.email);
  if (!email.success || typeof body?.password !== "string") return jsonError("Enter a valid email and password", 400);
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const normalizedEmail = email.data.toLowerCase().trim();
  const keys = [sha256(`ip:${ip}`), sha256(`email:${normalizedEmail}`)];
  const now = new Date();
  const windowEnds = new Date(Date.now() + 15 * 60 * 1000);
  const buckets = await db.authRateLimit.findMany({ where: { key: { in: keys } } });
  if (buckets.some((bucket) => bucket.windowEnds > now && bucket.hits >= 12)) return jsonError("Too many attempts. Try again in 15 minutes.", 429);
  const user = await db.user.findFirst({
    where: { email: { equals: normalizedEmail, mode: "insensitive" } },
  });
  let legacyWorkspace: LegacyWorkspaceCredential | null = null;
  if (!user) {
    legacyWorkspace = await db.workspace.findFirst({
      where: { loginEmail: { equals: normalizedEmail, mode: "insensitive" } },
      select: {
        loginEmail: true,
        loginPasswordHash: true,
        owner: {
          select: { id: true, role: true, passwordHash: true, disabledAt: true, mustChangePassword: true },
        },
      },
    });
  }
  const credential = resolveLoginCredential(user, legacyWorkspace, normalizedEmail);
  const passwordMatches = await compare(body.password, credential?.passwordHash ?? await dummyPasswordHash);
  if (!credential || credential.user.disabledAt || !credential.passwordHash || !passwordMatches) {
    await Promise.all(keys.map((key) => {
      const bucket = buckets.find((entry) => entry.key === key);
      return db.authRateLimit.upsert({ where: { key }, create: { key, hits: 1, windowEnds }, update: bucket && bucket.windowEnds > now ? { hits: { increment: 1 } } : { hits: 1, windowEnds } });
    }));
    return jsonError("Email or password is incorrect", 401);
  }
  await db.authRateLimit.deleteMany({ where: { key: { in: keys } } });
  const session = await createSession(credential.user.id);
  const response = NextResponse.json({ ok: true, mustChangePassword: credential.user.mustChangePassword });
  response.cookies.set(SESSION_COOKIE, session.token, cookieOptions(session.expiresAt, request));
  return response;
}
